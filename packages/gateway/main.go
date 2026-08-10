package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"golang.org/x/crypto/ssh"
)

var gatewayVersion = "0.2.0"

const (
	minColumns = 40
	maxColumns = 240
	minRows    = 20
	maxRows    = 120
)

const maxTrackedAdmissionIPs = 4096

type config struct {
	ListenAddress       string
	HealthAddress       string
	HostKeyPath         string
	ClientPath          string
	ServerURL           string
	MaxConnections      int
	MaxConnectionsPerIP int
	MaxSessions         int
	MaxSessionsPerIP    int
	AttemptsPerMinute   int
	HandshakeTimeout    time.Duration
	SessionTimeout      time.Duration
	ShutdownGrace       time.Duration
}

type gateway struct {
	cfg         config
	sshConfig   *ssh.ServerConfig
	connections *admissionGate
	sessions    *admissionGate
	nextSession atomic.Uint64
	listener    net.Listener
	health      *http.Server
	wg          sync.WaitGroup
}

type admissionGate struct {
	mu        sync.Mutex
	now       func() time.Time
	maxTotal  int
	maxPerIP  int
	maxWindow int
	window    time.Duration
	total     int
	active    map[string]int
	attempts  map[string][]time.Time
}

func newAdmissionGate(maxTotal, maxPerIP, maxWindow int, window time.Duration) *admissionGate {
	return &admissionGate{
		now:       time.Now,
		maxTotal:  maxTotal,
		maxPerIP:  maxPerIP,
		maxWindow: maxWindow,
		window:    window,
		active:    make(map[string]int),
		attempts:  make(map[string][]time.Time),
	}
}

func (g *admissionGate) acquire(ip string) bool {
	g.mu.Lock()
	defer g.mu.Unlock()

	now := g.now()
	if g.maxWindow > 0 {
		cutoff := now.Add(-g.window)
		if _, tracked := g.attempts[ip]; !tracked && len(g.attempts) >= maxTrackedAdmissionIPs {
			for trackedIP, attempts := range g.attempts {
				if g.active[trackedIP] == 0 && len(attempts) > 0 && !attempts[len(attempts)-1].After(cutoff) {
					delete(g.attempts, trackedIP)
				}
			}
			if len(g.attempts) >= maxTrackedAdmissionIPs {
				return false
			}
		}
		recent := g.attempts[ip][:0]
		for _, attempt := range g.attempts[ip] {
			if attempt.After(cutoff) {
				recent = append(recent, attempt)
			}
		}
		if len(recent) >= g.maxWindow {
			g.attempts[ip] = recent
			return false
		}
		g.attempts[ip] = append(recent, now)
	}
	if g.total >= g.maxTotal || g.active[ip] >= g.maxPerIP {
		return false
	}
	g.total++
	g.active[ip]++
	return true
}

func (g *admissionGate) release(ip string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.active[ip] <= 0 || g.total <= 0 {
		return
	}
	g.active[ip]--
	g.total--
	if g.active[ip] == 0 {
		delete(g.active, ip)
	}
}

func (g *admissionGate) count() int {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.total
}

type windowSize struct {
	Columns uint32
	Rows    uint32
	Width   uint32
	Height  uint32
}

type ptyRequest struct {
	Term    string
	Columns uint32
	Rows    uint32
	Width   uint32
	Height  uint32
	Modes   string
}

type exitStatus struct {
	Status uint32
}

func boundedWindow(columns, rows, width, height uint32) windowSize {
	return windowSize{
		Columns: clamp(columns, minColumns, maxColumns),
		Rows:    clamp(rows, minRows, maxRows),
		Width:   width,
		Height:  height,
	}
}

func clamp(value uint32, minimum, maximum uint32) uint32 {
	if value < minimum {
		return minimum
	}
	if value > maximum {
		return maximum
	}
	return value
}

func safeTerm(term string) string {
	if len(term) == 0 || len(term) > 64 {
		return "xterm-256color"
	}
	for _, r := range term {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') ||
			(r >= '0' && r <= '9') || strings.ContainsRune("._+-", r) {
			continue
		}
		return "xterm-256color"
	}
	return term
}

func parseConfig() (config, error) {
	var cfg config
	flag.StringVar(&cfg.ListenAddress, "listen-address", "127.0.0.1:2222", "SSH listen address")
	flag.StringVar(&cfg.HealthAddress, "health-address", "127.0.0.1:3001", "health listen address")
	flag.StringVar(&cfg.HostKeyPath, "host-key", "", "Ed25519 SSH host private key")
	flag.StringVar(&cfg.ClientPath, "client", "./dist/termenor", "compiled Termenor client path")
	flag.StringVar(&cfg.ServerURL, "server", "ws://127.0.0.1:3000", "authoritative Termenor server URL")
	flag.IntVar(&cfg.MaxConnections, "max-connections", 16, "maximum concurrent SSH transports")
	flag.IntVar(&cfg.MaxConnectionsPerIP, "max-connections-per-ip", 3, "maximum concurrent SSH transports per IP")
	flag.IntVar(&cfg.MaxSessions, "max-sessions", 8, "maximum concurrent game sessions")
	flag.IntVar(&cfg.MaxSessionsPerIP, "max-sessions-per-ip", 2, "maximum concurrent game sessions per IP")
	flag.IntVar(&cfg.AttemptsPerMinute, "attempts-per-minute", 10, "maximum connection attempts per IP per minute")
	flag.DurationVar(&cfg.HandshakeTimeout, "handshake-timeout", 10*time.Second, "SSH handshake timeout")
	flag.DurationVar(&cfg.SessionTimeout, "session-timeout", 6*time.Hour, "maximum game session duration")
	flag.DurationVar(&cfg.ShutdownGrace, "shutdown-grace", 3*time.Second, "client process termination grace")
	version := flag.Bool("version", false, "print version")
	flag.Parse()
	if *version {
		fmt.Println(gatewayVersion)
		os.Exit(0)
	}
	if cfg.HostKeyPath == "" {
		return config{}, errors.New("--host-key is required")
	}
	if cfg.MaxConnections < 1 || cfg.MaxConnectionsPerIP < 1 ||
		cfg.MaxSessions < 1 || cfg.MaxSessionsPerIP < 1 || cfg.AttemptsPerMinute < 1 {
		return config{}, errors.New("connection and session limits must be positive")
	}
	if cfg.MaxSessions > cfg.MaxConnections || cfg.MaxSessionsPerIP > cfg.MaxConnectionsPerIP {
		return config{}, errors.New("session limits cannot exceed connection limits")
	}
	return cfg, nil
}

func loadHostKey(path string) (ssh.Signer, string, error) {
	contents, err := os.ReadFile(path)
	if err != nil {
		return nil, "", fmt.Errorf("read host key: %w", err)
	}
	signer, err := ssh.ParsePrivateKey(contents)
	if err != nil {
		return nil, "", fmt.Errorf("parse host key: %w", err)
	}
	fingerprint := sha256.Sum256(signer.PublicKey().Marshal())
	return signer, hex.EncodeToString(fingerprint[:8]), nil
}

func newGateway(cfg config) (*gateway, string, error) {
	hostKey, fingerprint, err := loadHostKey(cfg.HostKeyPath)
	if err != nil {
		return nil, "", err
	}
	sshConfig := &ssh.ServerConfig{
		NoClientAuth:  true,
		ServerVersion: "SSH-2.0-Termenor_" + gatewayVersion,
		MaxAuthTries:  1,
	}
	sshConfig.AddHostKey(hostKey)
	return &gateway{
		cfg:         cfg,
		sshConfig:   sshConfig,
		connections: newAdmissionGate(cfg.MaxConnections, cfg.MaxConnectionsPerIP, cfg.AttemptsPerMinute, time.Minute),
		sessions:    newAdmissionGate(cfg.MaxSessions, cfg.MaxSessionsPerIP, 0, time.Minute),
	}, fingerprint, nil
}

func (g *gateway) run(ctx context.Context) error {
	listener, err := net.Listen("tcp", g.cfg.ListenAddress)
	if err != nil {
		return fmt.Errorf("listen for SSH: %w", err)
	}
	g.listener = listener
	g.health = &http.Server{
		Addr:              g.cfg.HealthAddress,
		Handler:           http.HandlerFunc(g.serveHealth),
		ReadHeaderTimeout: 2 * time.Second,
		ReadTimeout:       2 * time.Second,
		WriteTimeout:      2 * time.Second,
		IdleTimeout:       5 * time.Second,
	}
	healthListener, err := net.Listen("tcp", g.cfg.HealthAddress)
	if err != nil {
		listener.Close()
		return fmt.Errorf("listen for health: %w", err)
	}
	g.wg.Add(1)
	go func() {
		defer g.wg.Done()
		if err := g.health.Serve(healthListener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("health server stopped: %v", err)
		}
	}()

	acceptErr := make(chan error, 1)
	g.wg.Add(1)
	go func() {
		defer g.wg.Done()
		for {
			conn, err := listener.Accept()
			if err != nil {
				if errors.Is(err, net.ErrClosed) {
					return
				}
				acceptErr <- err
				return
			}
			ip := remoteIP(conn.RemoteAddr())
			if !g.connections.acquire(ip) {
				conn.Close()
				continue
			}
			g.wg.Add(1)
			go func() {
				defer g.wg.Done()
				defer g.connections.release(ip)
				g.serveConnection(ctx, conn, ip)
			}()
		}
	}()

	select {
	case <-ctx.Done():
	case err := <-acceptErr:
		listener.Close()
		return fmt.Errorf("accept SSH connection: %w", err)
	}
	listener.Close()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_ = g.health.Shutdown(shutdownCtx)
	g.wg.Wait()
	return nil
}

func remoteIP(address net.Addr) string {
	if host, _, err := net.SplitHostPort(address.String()); err == nil {
		return host
	}
	return address.String()
}

func (g *gateway) serveHealth(response http.ResponseWriter, request *http.Request) {
	if request.URL.Path != "/health" {
		http.NotFound(response, request)
		return
	}
	response.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(response).Encode(map[string]any{
		"status":      "ok",
		"connections": g.connections.count(),
		"sessions":    g.sessions.count(),
		"maxSessions": g.cfg.MaxSessions,
	})
}

func (g *gateway) serveConnection(parent context.Context, raw net.Conn, ip string) {
	defer raw.Close()
	_ = raw.SetDeadline(time.Now().Add(g.cfg.HandshakeTimeout))
	connection, channels, requests, err := ssh.NewServerConn(raw, g.sshConfig)
	if err != nil {
		return
	}
	_ = raw.SetDeadline(time.Time{})
	defer connection.Close()
	connectionContext, cancelConnection := context.WithCancel(parent)
	defer cancelConnection()
	go func() {
		_ = connection.Wait()
		cancelConnection()
	}()
	go ssh.DiscardRequests(requests)

	var claimed atomic.Bool
	for channel := range channels {
		if channel.ChannelType() != "session" || !claimed.CompareAndSwap(false, true) {
			_ = channel.Reject(ssh.Prohibited, "only one game session is allowed")
			continue
		}
		stream, streamRequests, err := channel.Accept()
		if err != nil {
			return
		}
		g.handleSession(connectionContext, stream, streamRequests, ip)
		return
	}
}

func (g *gateway) handleSession(parent context.Context, channel ssh.Channel, requests <-chan *ssh.Request, ip string) {
	defer channel.Close()
	var requestedPTY *ptyRequest
	for request := range requests {
		switch request.Type {
		case "pty-req":
			if requestedPTY != nil {
				reply(request, false)
				continue
			}
			var pty ptyRequest
			if err := ssh.Unmarshal(request.Payload, &pty); err != nil {
				reply(request, false)
				continue
			}
			pty.Term = safeTerm(pty.Term)
			size := boundedWindow(pty.Columns, pty.Rows, pty.Width, pty.Height)
			pty.Columns, pty.Rows, pty.Width, pty.Height = size.Columns, size.Rows, size.Width, size.Height
			requestedPTY = &pty
			reply(request, true)
		case "shell":
			if requestedPTY == nil || len(request.Payload) != 0 || !g.sessions.acquire(ip) {
				reply(request, false)
				continue
			}
			defer g.sessions.release(ip)
			reply(request, true)
			g.runClientSession(parent, channel, requests, *requestedPTY)
			return
		default:
			// exec, subsystem, env, X11, agent, break, and every extension fail closed.
			reply(request, false)
		}
	}
}

func reply(request *ssh.Request, accepted bool) {
	if request.WantReply {
		_ = request.Reply(accepted, nil)
	}
}

func (g *gateway) runClientSession(parent context.Context, channel ssh.Channel, requests <-chan *ssh.Request, pty ptyRequest) {
	sessionID := g.nextSession.Add(1)
	ctx, cancel := context.WithTimeout(parent, g.cfg.SessionTimeout)
	defer cancel()

	terminal, process, err := startPTY(g.cfg.ClientPath, g.cfg.ServerURL, pty.Term, boundedWindow(pty.Columns, pty.Rows, pty.Width, pty.Height))
	if err != nil {
		log.Printf("session=%d client start failed: %v", sessionID, err)
		_, _ = io.WriteString(channel.Stderr(), "Termenor is temporarily unavailable.\r\n")
		return
	}
	log.Printf("session=%d started", sessionID)
	go func() {
		for request := range requests {
			switch request.Type {
			case "window-change":
				var size windowSize
				if ssh.Unmarshal(request.Payload, &size) == nil {
					size = boundedWindow(size.Columns, size.Rows, size.Width, size.Height)
					_ = resizePTY(terminal, size)
				}
				reply(request, true)
			case "signal":
				var signal struct{ Name string }
				if ssh.Unmarshal(request.Payload, &signal) == nil {
					reply(request, signalProcessGroup(process, signal.Name))
				} else {
					reply(request, false)
				}
			default:
				reply(request, false)
			}
		}
	}()

	outputDone := make(chan struct{})
	waitDone := make(chan error, 1)
	go func() { _, _ = io.Copy(channel, terminal); close(outputDone) }()
	go func() { _, _ = io.Copy(terminal, channel) }()
	go func() { waitDone <- process.Wait() }()

	var waitErr error
	select {
	case waitErr = <-waitDone:
	case <-ctx.Done():
		waitErr = terminateProcessGroup(process, waitDone, g.cfg.ShutdownGrace)
	case <-outputDone:
		waitErr = terminateProcessGroup(process, waitDone, g.cfg.ShutdownGrace)
	}
	_ = terminal.Close()
	status := processExitStatus(waitErr)
	_, _ = channel.SendRequest("exit-status", false, ssh.Marshal(exitStatus{Status: status}))
	log.Printf("session=%d stopped status=%d", sessionID, status)
}

func processExitStatus(err error) uint32 {
	if err == nil {
		return 0
	}
	var exitError *exec.ExitError
	if errors.As(err, &exitError) && exitError.ExitCode() >= 0 {
		return uint32(exitError.ExitCode())
	}
	return 1
}

func main() {
	log.SetFlags(log.LstdFlags | log.LUTC)
	cfg, err := parseConfig()
	if err != nil {
		log.Fatal(err)
	}
	app, fingerprint, err := newGateway(cfg)
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("Termenor SSH gateway %s host_key=%s", gatewayVersion, fingerprint)
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	if err := app.run(ctx); err != nil {
		log.Fatal(err)
	}
}

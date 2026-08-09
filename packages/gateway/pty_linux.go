//go:build linux

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"syscall"
	"time"
	"unsafe"
)

const (
	tioCGPTN   = 0x80045430
	tioCSPTLCK = 0x40045431
	tioCSWINSZ = 0x5414
)

type terminalSize struct {
	Rows    uint16
	Columns uint16
	Width   uint16
	Height  uint16
}

func ioctl(fd uintptr, request uintptr, value unsafe.Pointer) error {
	_, _, errno := syscall.Syscall(syscall.SYS_IOCTL, fd, request, uintptr(value))
	if errno != 0 {
		return errno
	}
	return nil
}

func openPTY(size windowSize) (*os.File, *os.File, error) {
	master, err := os.OpenFile("/dev/ptmx", os.O_RDWR|syscall.O_NOCTTY, 0)
	if err != nil {
		return nil, nil, fmt.Errorf("open PTY master: %w", err)
	}
	closeMaster := true
	defer func() {
		if closeMaster {
			_ = master.Close()
		}
	}()

	unlock := int32(0)
	if err := ioctl(master.Fd(), tioCSPTLCK, unsafe.Pointer(&unlock)); err != nil {
		return nil, nil, fmt.Errorf("unlock PTY: %w", err)
	}
	var number uint32
	if err := ioctl(master.Fd(), tioCGPTN, unsafe.Pointer(&number)); err != nil {
		return nil, nil, fmt.Errorf("resolve PTY: %w", err)
	}
	slave, err := os.OpenFile(filepath.Join("/dev/pts", strconv.FormatUint(uint64(number), 10)), os.O_RDWR|syscall.O_NOCTTY, 0)
	if err != nil {
		return nil, nil, fmt.Errorf("open PTY slave: %w", err)
	}
	if err := resizePTY(master, size); err != nil {
		_ = slave.Close()
		return nil, nil, err
	}
	closeMaster = false
	return master, slave, nil
}

func startPTY(clientPath, serverURL, term string, size windowSize) (*os.File, *exec.Cmd, error) {
	master, slave, err := openPTY(size)
	if err != nil {
		return nil, nil, err
	}
	command := exec.Command(clientPath, "--server", serverURL)
	command.Env = []string{
		"COLORTERM=truecolor",
		"HOME=/nonexistent",
		"LANG=C.UTF-8",
		"TERM=" + safeTerm(term),
	}
	command.Stdin = slave
	command.Stdout = slave
	command.Stderr = slave
	command.SysProcAttr = &syscall.SysProcAttr{
		Setsid:    true,
		Setctty:   true,
		Ctty:      0,
		Pdeathsig: syscall.SIGKILL,
	}
	if err := command.Start(); err != nil {
		_ = slave.Close()
		_ = master.Close()
		return nil, nil, fmt.Errorf("start compiled client: %w", err)
	}
	_ = slave.Close()
	return master, command, nil
}

func resizePTY(terminal *os.File, size windowSize) error {
	bounded := boundedWindow(size.Columns, size.Rows, size.Width, size.Height)
	value := terminalSize{
		Rows:    uint16(bounded.Rows),
		Columns: uint16(bounded.Columns),
		Width:   uint16(min(bounded.Width, 65535)),
		Height:  uint16(min(bounded.Height, 65535)),
	}
	if err := ioctl(terminal.Fd(), tioCSWINSZ, unsafe.Pointer(&value)); err != nil {
		return fmt.Errorf("resize PTY: %w", err)
	}
	return nil
}

func signalProcessGroup(process *exec.Cmd, name string) bool {
	var signal syscall.Signal
	switch name {
	case "INT":
		signal = syscall.SIGINT
	case "TERM":
		signal = syscall.SIGTERM
	case "HUP":
		signal = syscall.SIGHUP
	default:
		return false
	}
	return syscall.Kill(-process.Process.Pid, signal) == nil
}

func terminateProcessGroup(process *exec.Cmd, wait <-chan error, grace time.Duration) error {
	_ = syscall.Kill(-process.Process.Pid, syscall.SIGTERM)
	timer := time.NewTimer(grace)
	defer timer.Stop()
	select {
	case err := <-wait:
		return err
	case <-timer.C:
		_ = syscall.Kill(-process.Process.Pid, syscall.SIGKILL)
		return <-wait
	}
}

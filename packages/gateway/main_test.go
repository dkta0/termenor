package main

import (
	"os"
	"testing"
	"time"
)

func TestBoundedWindowClampsTerminalDimensions(t *testing.T) {
	size := boundedWindow(500, 1, 900, 700)
	if size.Columns != maxColumns || size.Rows != minRows || size.Width != 900 || size.Height != 700 {
		t.Fatalf("unexpected bounded window: %#v", size)
	}
}

func TestSafeTermRejectsEnvironmentSyntax(t *testing.T) {
	if got := safeTerm("xterm-256color\nPATH=/tmp"); got != "xterm-256color" {
		t.Fatalf("unsafe TERM accepted: %q", got)
	}
	if got := safeTerm("screen-256color"); got != "screen-256color" {
		t.Fatalf("safe TERM changed: %q", got)
	}
}

func TestAdmissionGateEnforcesRateAndConcurrentLimits(t *testing.T) {
	gate := newAdmissionGate(2, 1, 2, time.Minute)
	now := time.Unix(1000, 0)
	gate.now = func() time.Time { return now }

	if !gate.acquire("192.0.2.1") {
		t.Fatal("first connection was rejected")
	}
	if gate.acquire("192.0.2.1") {
		t.Fatal("per-IP concurrent limit was bypassed")
	}
	gate.release("192.0.2.1")
	if gate.acquire("192.0.2.1") {
		t.Fatal("rate limit did not count rejected concurrent attempts")
	}
	now = now.Add(time.Minute + time.Second)
	if !gate.acquire("192.0.2.1") {
		t.Fatal("rate limit did not expire")
	}
	gate.release("192.0.2.1")
}

func TestSessionGateDoesNotRetainRateBuckets(t *testing.T) {
	gate := newAdmissionGate(1, 1, 0, time.Minute)
	for range 100 {
		if !gate.acquire("192.0.2.1") {
			t.Fatal("session was rejected")
		}
		gate.release("192.0.2.1")
	}
	if len(gate.attempts) != 0 {
		t.Fatalf("session gate retained %d unused rate buckets", len(gate.attempts))
	}
}

func TestAdmissionGateBoundsTrackedSourceIPs(t *testing.T) {
	gate := newAdmissionGate(1, 1, 2, time.Minute)
	for index := range maxTrackedAdmissionIPs {
		ip := "source-" + string(rune(index))
		if !gate.acquire(ip) {
			t.Fatalf("source %d was rejected before the tracking bound", index)
		}
		gate.release(ip)
	}
	if gate.acquire("one-too-many") {
		t.Fatal("source-IP tracking bound was bypassed")
	}
	if len(gate.attempts) != maxTrackedAdmissionIPs {
		t.Fatalf("tracked %d source IPs", len(gate.attempts))
	}
}

func TestLoadHostKeyRejectsMissingFile(t *testing.T) {
	if _, _, err := loadHostKey(t.TempDir() + "/missing"); err == nil {
		t.Fatal("missing host key was accepted")
	}
}

func TestProcessExitStatus(t *testing.T) {
	if got := processExitStatus(nil); got != 0 {
		t.Fatalf("success status = %d", got)
	}
	if got := processExitStatus(os.ErrPermission); got != 1 {
		t.Fatalf("error status = %d", got)
	}
}

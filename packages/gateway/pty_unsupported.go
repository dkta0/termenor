//go:build !linux

package main

import (
	"errors"
	"os"
	"os/exec"
	"time"
)

func startPTY(_ string, _ string, _ string, _ windowSize) (*os.File, *exec.Cmd, error) {
	return nil, nil, errors.New("the SSH gateway requires Linux PTYs")
}

func resizePTY(_ *os.File, _ windowSize) error {
	return errors.New("the SSH gateway requires Linux PTYs")
}
func signalProcessGroup(_ *exec.Cmd, _ string) bool                               { return false }
func terminateProcessGroup(_ *exec.Cmd, wait <-chan error, _ time.Duration) error { return <-wait }

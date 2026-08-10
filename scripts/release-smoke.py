#!/usr/bin/env python3
"""Exercise freshly compiled Termenor server and client binaries through a real PTY."""

from __future__ import annotations

import argparse
import fcntl
import json
import os
from pathlib import Path
import pty
import select
import signal
import socket
import struct
import subprocess
import tempfile
import termios
import time
from urllib.request import urlopen


def free_port() -> int:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def health(port: int) -> dict[str, object]:
    with urlopen(f"http://127.0.0.1:{port}/health", timeout=1) as response:
        return json.load(response)


def wait_for_health(port: int, predicate, timeout: float) -> dict[str, object]:
    deadline = time.monotonic() + timeout
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            state = health(port)
            if predicate(state):
                return state
        except Exception as error:  # The process may still be binding its socket.
            last_error = error
        time.sleep(0.05)
    raise RuntimeError(f"health condition timed out: {last_error}")


def terminate_group(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
        process.wait(timeout=3)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait(timeout=3)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--server", required=True, type=Path)
    parser.add_argument("--client", required=True, type=Path)
    args = parser.parse_args()
    server_binary = args.server.resolve(strict=True)
    client_binary = args.client.resolve(strict=True)
    port = free_port()

    with tempfile.TemporaryDirectory(prefix="termenor-release-smoke-") as directory:
        environment = os.environ.copy()
        environment.update({
            "HOST": "127.0.0.1",
            "PORT": str(port),
            "DB_PATH": str(Path(directory) / "world.sqlite"),
            "MAX_CONNECTIONS": "8",
            "MAX_CONNECTIONS_PER_IP": "4",
            "CONNECTION_ATTEMPTS_PER_MINUTE": "20",
        })
        server = subprocess.Popen(
            [str(server_binary)],
            env=environment,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        master = -1
        client: subprocess.Popen[bytes] | None = None
        try:
            wait_for_health(port, lambda state: state.get("status") == "ok", 10)
            master, slave = pty.openpty()
            fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 100, 0, 0))
            client_environment = os.environ.copy()
            client_environment.update({
                "TERM": "xterm-256color",
                "COLORTERM": "truecolor",
                "TERMENOR_USER": "release_smoke",
                "TERMENOR_PASS": "release-smoke-password",
            })
            client = subprocess.Popen(
                [str(client_binary), "--server", f"ws://127.0.0.1:{port}"],
                env=client_environment,
                stdin=slave,
                stdout=slave,
                stderr=slave,
                start_new_session=True,
            )
            os.close(slave)

            output = bytearray()
            deadline = time.monotonic() + 12
            while time.monotonic() < deadline and len(output) < 4 * 1024 * 1024:
                ready, _, _ = select.select([master], [], [], 0.1)
                if ready:
                    try:
                        output.extend(os.read(master, 65536))
                    except OSError:
                        break
                if b"Inv" in output and "▀".encode() in output:
                    break
                if client.poll() is not None:
                    break

            if b"Inv" not in output or "▀".encode() not in output:
                raise RuntimeError(
                    f"client did not render the authenticated world (bytes={len(output)}, exit={client.poll()})"
                )
            wait_for_health(port, lambda state: state.get("connections") == 1, 3)
            terminate_group(client)
            wait_for_health(port, lambda state: state.get("connections") == 0, 3)
            print("release client authenticated, rendered the world, and disconnected cleanly")
            return 0
        finally:
            if master >= 0:
                os.close(master)
            if client is not None:
                terminate_group(client)
            terminate_group(server)


if __name__ == "__main__":
    raise SystemExit(main())

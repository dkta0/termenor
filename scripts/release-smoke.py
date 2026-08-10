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


def read_pty_until(
    master: int,
    process: subprocess.Popen[bytes],
    output: bytearray,
    predicate,
    *,
    timeout: float,
    description: str,
) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline and len(output) < 4 * 1024 * 1024:
        ready, _, _ = select.select([master], [], [], 0.1)
        if ready:
            try:
                output.extend(os.read(master, 65536))
            except OSError:
                break
        if predicate(output):
            return
        if process.poll() is not None:
            break
    raise RuntimeError(
        f"{description} timed out (bytes={len(output)}, exit={process.poll()})"
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--server", required=True, type=Path)
    parser.add_argument("--client", required=True, type=Path)
    parser.add_argument("--gateway", required=True, type=Path)
    args = parser.parse_args()
    server_binary = args.server.resolve(strict=True)
    client_binary = args.client.resolve(strict=True)
    gateway_binary = args.gateway.resolve(strict=True)
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
        ssh_master = -1
        client: subprocess.Popen[bytes] | None = None
        gateway: subprocess.Popen[bytes] | None = None
        ssh_client: subprocess.Popen[bytes] | None = None
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
            read_pty_until(
                master,
                client,
                output,
                lambda data: b"Inv" in data and "▀".encode() in data,
                timeout=12,
                description="direct release client world render",
            )

            if b"Inv" not in output or "▀".encode() not in output:
                raise RuntimeError(
                    f"client did not render the authenticated world (bytes={len(output)}, exit={client.poll()})"
                )
            if b"\x1b[?1006h" not in output:
                raise RuntimeError("client did not enable SGR mouse reporting")
            if b"\x1b[?1003h" in output:
                raise RuntimeError("client enabled unnecessary any-motion mouse reporting")

            # Click the Skills tab in the fixed 100-column release-smoke PTY.
            os.write(master, b"\x1b[<0;81;1M\x1b[<0;81;1m")
            deadline = time.monotonic() + 3
            while time.monotonic() < deadline and b"Strength" not in output:
                ready, _, _ = select.select([master], [], [], 0.1)
                if ready:
                    output.extend(os.read(master, 65536))
            if b"Strength" not in output:
                raise RuntimeError("freshly built client did not resolve an SGR panel click")
            wait_for_health(port, lambda state: state.get("connections") == 1, 3)
            terminate_group(client)
            wait_for_health(port, lambda state: state.get("connections") == 0, 3)
            print("release client authenticated, resolved an SGR click, rendered the world, and disconnected cleanly")

            client = None
            os.close(master)
            master = -1

            ssh_port = free_port()
            gateway_health_port = free_port()
            host_key = Path(directory) / "gateway-host-key"
            subprocess.run(
                ["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(host_key)],
                check=True,
                timeout=10,
            )
            gateway = subprocess.Popen(
                [
                    str(gateway_binary),
                    "--listen-address", f"127.0.0.1:{ssh_port}",
                    "--health-address", f"127.0.0.1:{gateway_health_port}",
                    "--host-key", str(host_key),
                    "--client", str(client_binary),
                    "--server", f"ws://127.0.0.1:{port}",
                    "--max-connections", "4",
                    "--max-connections-per-ip", "4",
                    "--max-sessions", "2",
                    "--max-sessions-per-ip", "2",
                    "--attempts-per-minute", "20",
                    "--session-timeout", "1m",
                ],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
            wait_for_health(
                gateway_health_port,
                lambda state: state.get("status") == "ok",
                10,
            )

            public_key = Path(str(host_key) + ".pub").read_text().split()
            known_hosts = Path(directory) / "known_hosts"
            known_hosts.write_text(
                f"[127.0.0.1]:{ssh_port} {public_key[0]} {public_key[1]}\n"
            )
            ssh_master, ssh_slave = pty.openpty()
            fcntl.ioctl(
                ssh_slave,
                termios.TIOCSWINSZ,
                struct.pack("HHHH", 40, 100, 0, 0),
            )
            ssh_environment = os.environ.copy()
            ssh_environment.pop("TERMENOR_USER", None)
            ssh_environment.pop("TERMENOR_PASS", None)
            ssh_environment.update({
                "TERM": "xterm-256color",
                "COLORTERM": "truecolor",
            })
            ssh_client = subprocess.Popen(
                [
                    "ssh",
                    "-tt",
                    "-p", str(ssh_port),
                    "-o", "BatchMode=yes",
                    "-o", "StrictHostKeyChecking=yes",
                    "-o", f"UserKnownHostsFile={known_hosts}",
                    "-o", "GlobalKnownHostsFile=/dev/null",
                    "-o", "PreferredAuthentications=none",
                    "-o", "PasswordAuthentication=no",
                    "-o", "KbdInteractiveAuthentication=no",
                    "-o", "LogLevel=ERROR",
                    "127.0.0.1",
                ],
                env=ssh_environment,
                stdin=ssh_slave,
                stdout=ssh_slave,
                stderr=ssh_slave,
                start_new_session=True,
            )
            os.close(ssh_slave)
            ssh_output = bytearray()
            read_pty_until(
                ssh_master,
                ssh_client,
                ssh_output,
                lambda data: b"Username" in data,
                timeout=10,
                description="username-free stock SSH login form",
            )
            os.write(
                ssh_master,
                b"\x1b[Crelease_ssh_smoke\trelease-ssh-password\r",
            )
            read_pty_until(
                ssh_master,
                ssh_client,
                ssh_output,
                lambda data: b"Inv" in data and "▀".encode() in data,
                timeout=12,
                description="stock SSH authenticated world render",
            )
            if b"\x1b[?1006h" not in ssh_output:
                raise RuntimeError("SSH client did not enable SGR mouse reporting")
            if b"\x1b[?1003h" in ssh_output:
                raise RuntimeError("SSH client enabled unnecessary any-motion reporting")
            os.write(ssh_master, b"\x1b[<0;81;1M\x1b[<0;81;1m")
            read_pty_until(
                ssh_master,
                ssh_client,
                ssh_output,
                lambda data: b"Strength" in data,
                timeout=3,
                description="stock SSH SGR panel click",
            )
            wait_for_health(
                gateway_health_port,
                lambda state: state.get("sessions") == 1,
                3,
            )
            wait_for_health(port, lambda state: state.get("connections") == 1, 3)
            terminate_group(ssh_client)
            ssh_client = None
            wait_for_health(
                gateway_health_port,
                lambda state: state.get("sessions") == 0,
                3,
            )
            wait_for_health(port, lambda state: state.get("connections") == 0, 3)
            print(
                "stock SSH without an explicit username authenticated, resolved an SGR click, "
                "and disconnected cleanly"
            )
            return 0
        finally:
            if ssh_master >= 0:
                os.close(ssh_master)
            if ssh_client is not None:
                terminate_group(ssh_client)
            if gateway is not None:
                terminate_group(gateway)
            if master >= 0:
                os.close(master)
            if client is not None:
                terminate_group(client)
            terminate_group(server)


if __name__ == "__main__":
    raise SystemExit(main())

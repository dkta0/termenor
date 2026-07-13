#!/usr/bin/env python3
"""Reusable real-terminal harness for Termenor playtest scenarios.

The harness deliberately drives the production Bun server and client.  It owns
all transient process, PTY, port, SQLite, timing, and diagnostic state so a
scenario only has to express visible conditions and player input.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
import copy
import errno
import fcntl
import json
import os
from pathlib import Path
import pty
import select
import shutil
import signal
import socket
import struct
import subprocess
import tempfile
import termios
import time
import traceback
from typing import BinaryIO, Callable, Mapping, Sequence, TypeVar
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import pyte


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SERVER_COMMAND = ("bun", "run", "packages/server/src/index.ts")
DEFAULT_CLIENT_COMMAND = ("bun", "run", "packages/client/src/index.ts")
DEFAULT_ROWS = 40
DEFAULT_COLS = 100
DEFAULT_TIMEOUT = 8.0
MAX_DRAIN_CHUNKS = 16
POLL_INTERVAL = 0.02

_KEY_SEQUENCES: dict[str, bytes] = {
    "up": b"\x1b[A",
    "down": b"\x1b[B",
    "right": b"\x1b[C",
    "left": b"\x1b[D",
    "enter": b"\r",
    "return": b"\r",
    "tab": b"\t",
    "escape": b"\x1b",
    "esc": b"\x1b",
    "backspace": b"\x7f",
    "space": b" ",
}
_SYNC_BEGIN = b"\x1b[?2026h"
_SYNC_END = b"\x1b[?2026l"
_REPAINT_MARKERS = (
    _SYNC_BEGIN,
    _SYNC_END,
    b"\x1b[H",
    b"\x1b[1;1H",
)
_MAX_MARKER_LENGTH = max(map(len, _REPAINT_MARKERS))
_T = TypeVar("_T")


class HarnessError(RuntimeError):
    """The server/client lifecycle failed before an assertion was reached."""


class WaitTimeout(TimeoutError):
    """A condition did not become true before its monotonic deadline."""


@dataclass(frozen=True)
class Cell:
    """One perceived terminal cell, using pyte's color names or RGB hex."""

    text: str
    fg: str
    bg: str


class TerminalScreen:
    """Incrementally reconstruct a fixed-size terminal while retaining raw bytes."""

    def __init__(self, cols: int, rows: int) -> None:
        if cols <= 0 or rows <= 0:
            raise ValueError("terminal dimensions must be positive")
        self.cols = cols
        self.rows = rows
        self._screen = pyte.Screen(cols, rows)
        self._stream = pyte.ByteStream(self._screen)
        self._visible_screen = self._screen
        self._sync_active = False
        self._perception_tail = b""
        self._raw = bytearray()
        self._scan_tail = b""
        self._marker_counts = {marker: 0 for marker in _REPAINT_MARKERS}

    def feed(self, data: bytes | bytearray | memoryview) -> None:
        """Feed a raw PTY chunk, committing synchronized frames atomically."""
        chunk = bytes(data)
        if not chunk:
            return
        self._raw.extend(chunk)
        self._feed_perception(chunk)
        self._count_repaint_markers(chunk)

    def _feed_perception(self, chunk: bytes) -> None:
        data = self._perception_tail + chunk
        self._perception_tail = b""
        while data:
            marker = _SYNC_END if self._sync_active else _SYNC_BEGIN
            marker_at = data.find(marker)
            if marker_at >= 0:
                prefix = data[:marker_at]
                if prefix:
                    self._stream.feed(prefix)
                if self._sync_active:
                    self._stream.feed(marker)
                    self._sync_active = False
                    self._visible_screen = self._screen
                else:
                    self._visible_screen = copy.deepcopy(self._screen)
                    self._stream.feed(marker)
                    self._sync_active = True
                data = data[marker_at + len(marker) :]
                continue

            pending = self._marker_prefix_suffix_length(data, marker)
            payload = data[:-pending] if pending else data
            if payload:
                self._stream.feed(payload)
            if not self._sync_active:
                self._visible_screen = self._screen
            self._perception_tail = data[-pending:] if pending else b""
            break

    @staticmethod
    def _marker_prefix_suffix_length(data: bytes, marker: bytes) -> int:
        for size in range(min(len(data), len(marker) - 1), 0, -1):
            if data.endswith(marker[:size]):
                return size
        return 0

    def _count_repaint_markers(self, chunk: bytes) -> None:
        combined = self._scan_tail + chunk
        old_boundary = len(self._scan_tail)
        for marker in _REPAINT_MARKERS:
            start = 0
            while True:
                match = combined.find(marker, start)
                if match < 0:
                    break
                if match + len(marker) > old_boundary:
                    self._marker_counts[marker] += 1
                start = match + 1
        self._scan_tail = combined[-(_MAX_MARKER_LENGTH - 1) :]

    @property
    def raw_bytes(self) -> bytes:
        return bytes(self._raw)

    @property
    def byte_count(self) -> int:
        return len(self._raw)

    @property
    def repaint_count(self) -> int:
        if self._marker_counts[_SYNC_BEGIN] or self._marker_counts[_SYNC_END]:
            return self._marker_counts[_SYNC_END]
        return (
            self._marker_counts[b"\x1b[H"]
            + self._marker_counts[b"\x1b[1;1H"]
        )

    def text(self) -> str:
        """Return committed rows with only right-padding normalized away."""
        return "\n".join(row.rstrip() for row in self._visible_screen.display)

    def line(self, row: int) -> str:
        self._check_coordinates(0, row)
        return self._visible_screen.display[row].rstrip()

    def cell(self, col: int, row: int) -> Cell:
        self._check_coordinates(col, row)
        char = self._visible_screen.buffer[row][col]
        return Cell(text=char.data, fg=char.fg, bg=char.bg)

    def contains(self, text: str) -> bool:
        return text in self.text()

    def cells(self) -> tuple[tuple[Cell, ...], ...]:
        return tuple(
            tuple(self.cell(col, row) for col in range(self.cols))
            for row in range(self.rows)
        )

    def _check_coordinates(self, col: int, row: int) -> None:
        if not 0 <= col < self.cols or not 0 <= row < self.rows:
            raise IndexError(
                f"terminal cell ({col}, {row}) outside {self.cols}x{self.rows} screen"
            )


@dataclass(frozen=True)
class ScreenCapture:
    """Immutable visible screen state used by condition-driven change waits."""

    text: str
    cells: tuple[tuple[Cell, ...], ...]
    byte_count: int = field(compare=False)
    repaint_count: int = field(compare=False)
    elapsed: float = field(compare=False)
    _source: object = field(compare=False, repr=False)

    def cell(self, col: int, row: int) -> Cell:
        if row < 0 or row >= len(self.cells):
            raise IndexError(f"terminal row {row} outside capture")
        if col < 0 or col >= len(self.cells[row]):
            raise IndexError(f"terminal column {col} outside capture")
        return self.cells[row][col]

    def contains(self, text: str) -> bool:
        return text in self.text


@dataclass
class PtyClient:
    """One production client attached to a fixed-size pseudo-terminal."""

    harness: "PtyHarness" = field(repr=False)
    name: str
    pid: int
    fd: int
    screen: TerminalScreen
    command: tuple[str, ...]
    returncode: int | None = None
    closed: bool = False
    retired: bool = False
    _capture_token: object = field(default_factory=object, compare=False, repr=False)

    @property
    def byte_count(self) -> int:
        return self.screen.byte_count

    @property
    def repaint_count(self) -> int:
        return self.screen.repaint_count

    @property
    def raw_bytes(self) -> bytes:
        return self.screen.raw_bytes

    def capture(self, label: str | None = None) -> ScreenCapture:
        return self.harness.capture(self, label=label)

    def wait_for_text(
        self,
        text: str,
        *,
        timeout: float = DEFAULT_TIMEOUT,
        timing: str | None = None,
    ) -> ScreenCapture:
        return self.harness.wait_for_text(self, text, timeout=timeout, timing=timing)

    def wait_for_change(
        self,
        before: ScreenCapture,
        *,
        timeout: float = DEFAULT_TIMEOUT,
        timing: str | None = None,
    ) -> ScreenCapture:
        return self.harness.wait_for_change(self, before, timeout=timeout, timing=timing)

    def press(self, key: str | bytes) -> None:
        self.harness.press(self, key)

    def type_text(self, text: str) -> None:
        self.harness.type_text(self, text)

    def click(self, col: int, row: int) -> None:
        self.harness.click(self, col=col, row=row)


class PtyHarness:
    """Own a hermetic Termenor server and any number of real PTY clients."""

    def __init__(
        self,
        *,
        rows: int = DEFAULT_ROWS,
        cols: int = DEFAULT_COLS,
        root: Path | str = ROOT,
        server_command: Sequence[str] | None = None,
        client_command: Sequence[str] | None = None,
        readiness_timeout: float = DEFAULT_TIMEOUT,
        artifact_base: Path | str = Path(tempfile.gettempdir()),
    ) -> None:
        if rows <= 0 or cols <= 0:
            raise ValueError("terminal dimensions must be positive")
        if readiness_timeout <= 0:
            raise ValueError("readiness_timeout must be positive")
        self.rows = rows
        self.cols = cols
        self.root = Path(root).resolve()
        self.server_command = tuple(server_command or DEFAULT_SERVER_COMMAND)
        self.client_command = tuple(client_command or DEFAULT_CLIENT_COMMAND)
        self.readiness_timeout = readiness_timeout
        self.artifact_base = Path(artifact_base)

        self.timings: dict[str, float] = {}
        self.timeline: list[dict[str, object]] = []
        self.clients: list[PtyClient] = []
        self.server_process: subprocess.Popen[bytes] | None = None
        self.failure_artifacts: Path | None = None

        self.port = 0
        self.temp_dir = Path()
        self.db_path = Path()
        self._server_log_path = Path()
        self._server_log_handle: BinaryIO | None = None
        self._captures: list[tuple[str, str, ScreenCapture]] = []
        self._started_at = 0.0
        self._entered = False
        self._finished = False

    def __enter__(self) -> "PtyHarness":
        if self._entered or self._finished:
            raise HarnessError("PtyHarness instances may only be entered once")
        self._started_at = time.monotonic()
        temp_dir: Path | None = None
        try:
            port = self._free_port()
            temp_dir = Path(tempfile.mkdtemp(prefix="termenor-playtest-db-"))
            db_path = temp_dir / "termenor.db"
            server_log_path = temp_dir / "server.log"
            server_log_path.touch()
        except BaseException:
            if temp_dir is not None and temp_dir.exists():
                shutil.rmtree(temp_dir)
            self._started_at = 0.0
            raise

        self.port = port
        self.temp_dir = temp_dir
        self.db_path = db_path
        self._server_log_path = server_log_path
        self._entered = True
        self._record_event("harness-start", port=self.port, db=str(self.db_path))
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        failure = None
        if exc is not None:
            failure = "".join(traceback.format_exception(exc_type, exc, tb))
        self._finish(failure)
        return False

    def start_server(self, *, timeout: float | None = None) -> subprocess.Popen[bytes]:
        self._require_active()
        if self.server_process is not None:
            raise HarnessError("server already started")

        env = dict(os.environ)
        env.pop("DATABASE_URL", None)
        env.update(
            {
                "PORT": str(self.port),
                "HOST": "127.0.0.1",
                "DB_PATH": str(self.db_path),
            }
        )
        command = self._expanded_command(self.server_command)
        self._server_log_handle = self._server_log_path.open("ab", buffering=0)
        try:
            self.server_process = subprocess.Popen(
                command,
                cwd=self.root,
                env=env,
                stdin=subprocess.DEVNULL,
                stdout=self._server_log_handle,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
        except BaseException:
            self._close_server_log()
            raise
        self._record_event("server-start", command=list(command), pid=self.server_process.pid)

        readiness_url = f"http://127.0.0.1:{self.port}/"

        def http_ready() -> bool:
            assert self.server_process is not None
            returncode = self.server_process.poll()
            if returncode is not None:
                raise HarnessError(
                    f"server exited with status {returncode} before HTTP readiness; "
                    f"log tail:\n{self._server_log_tail()}"
                )
            request = Request(readiness_url, headers={"Connection": "close"})
            try:
                with urlopen(request, timeout=0.1) as response:
                    response.read(1)
                    return response.status == 200
            except (HTTPError, URLError, ConnectionError, TimeoutError, OSError):
                return False

        self.wait_for(
            http_ready,
            description=f"HTTP 200 from {readiness_url}",
            timeout=self.readiness_timeout if timeout is None else timeout,
            timing="server-ready",
        )
        return self.server_process

    def spawn_client(
        self,
        name: str,
        *,
        username: str | None = None,
        password: str | None = None,
        command: Sequence[str] | None = None,
        env: Mapping[str, str] | None = None,
    ) -> PtyClient:
        self._require_active()
        if not name or any(ch not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.-" for ch in name):
            raise ValueError("client name must contain only letters, digits, '.', '_' or '-'")
        if any(client.name == name for client in self.clients):
            raise ValueError(f"duplicate client name: {name}")
        if (username is None) != (password is None):
            raise ValueError("username and password must either both be set or both be omitted")

        child_env = dict(os.environ)
        child_env.update(
            {
                "SERVER_URL": f"ws://127.0.0.1:{self.port}",
                "TERM": "xterm-256color",
                "COLORTERM": "truecolor",
            }
        )
        if username is None:
            child_env.pop("TERMENOR_USER", None)
            child_env.pop("TERMENOR_PASS", None)
        else:
            child_env["TERMENOR_USER"] = username
            child_env["TERMENOR_PASS"] = password or ""
        if env:
            child_env.update(env)

        child_command = self._expanded_command(tuple(command or self.client_command))
        screen = TerminalScreen(self.cols, self.rows)
        master_fd, slave_fd = pty.openpty()
        try:
            self._set_winsize(slave_fd, self.rows, self.cols)
            pid = os.fork()
        except BaseException:
            os.close(master_fd)
            os.close(slave_fd)
            raise

        if pid == 0:
            try:
                os.close(master_fd)
                os.setsid()
                fcntl.ioctl(slave_fd, termios.TIOCSCTTY, 0)
                for target_fd in (0, 1, 2):
                    os.dup2(slave_fd, target_fd)
                if slave_fd > 2:
                    os.close(slave_fd)
                os.chdir(self.root)
                os.execvpe(child_command[0], list(child_command), child_env)
            except BaseException as error:
                try:
                    os.write(2, f"client exec failed: {error}\r\n".encode("utf-8", "replace"))
                finally:
                    os._exit(127)

        try:
            os.close(slave_fd)
            os.set_blocking(master_fd, False)
            client = PtyClient(
                harness=self,
                name=name,
                pid=pid,
                fd=master_fd,
                screen=screen,
                command=child_command,
            )
            self.clients.append(client)
        except BaseException:
            for fd in (master_fd, slave_fd):
                try:
                    os.close(fd)
                except OSError:
                    pass
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            try:
                os.waitpid(pid, 0)
            except ChildProcessError:
                pass
            raise
        self._record_event("client-start", client=name, command=list(child_command), pid=pid)
        return client

    def pump(self, timeout: float = 0.0) -> None:
        """Drain all available PTY output, optionally waiting up to ``timeout``."""
        self._require_active()
        if timeout < 0:
            raise ValueError("pump timeout cannot be negative")
        live = [client for client in self.clients if not client.closed]
        fds = [client.fd for client in live]
        try:
            readable, _, _ = select.select(fds, [], [], timeout)
        except InterruptedError:
            readable = []
        by_fd = {client.fd: client for client in live}
        for fd in readable:
            client = by_fd.get(fd)
            if client is not None:
                self._drain_client(client)
        for client in self.clients:
            self._reap_client(client)

    def wait_for(
        self,
        condition: Callable[[], _T],
        *,
        description: str,
        timeout: float = DEFAULT_TIMEOUT,
        timing: str | None = None,
    ) -> _T:
        """Poll ``condition`` until truthy, using a monotonic deadline."""
        self._require_active()
        if timeout <= 0:
            raise ValueError("wait timeout must be positive")
        deadline = time.monotonic() + timeout
        self._record_event("wait-start", description=description, timeout=timeout)

        def timed_out() -> WaitTimeout:
            if timing:
                self.mark_timing(f"{timing}-timeout")
            self._record_event("wait-timeout", description=description)
            return WaitTimeout(
                f"timed out after {timeout:.3f}s waiting for {description}"
            )

        while True:
            self.pump(0.0)
            self._raise_if_process_exited()
            if time.monotonic() >= deadline:
                raise timed_out()
            value = condition()
            if time.monotonic() >= deadline:
                raise timed_out()
            if value:
                if timing:
                    self.mark_timing(timing)
                self._record_event("wait-ready", description=description)
                return value
            remaining = deadline - time.monotonic()
            self.pump(min(POLL_INTERVAL, remaining))

    def wait_for_text(
        self,
        client: PtyClient,
        text: str,
        *,
        timeout: float = DEFAULT_TIMEOUT,
        timing: str | None = None,
    ) -> ScreenCapture:
        self._require_client(client)

        def visible() -> bool:
            if client.screen.contains(text):
                return True
            self._raise_if_client_exited(client, f"visible text {text!r}")
            return False

        self.wait_for(
            visible,
            description=f"{client.name} to show {text!r}",
            timeout=timeout,
            timing=timing,
        )
        return self.capture(client)

    def wait_for_change(
        self,
        client: PtyClient,
        before: ScreenCapture,
        *,
        timeout: float = DEFAULT_TIMEOUT,
        timing: str | None = None,
    ) -> ScreenCapture:
        self._require_client(client)
        if before._source is not client._capture_token:
            raise ValueError("screen capture belongs to a different PTY client")

        def changed() -> ScreenCapture | None:
            current = self._capture(client)
            if current != before:
                return current
            self._raise_if_client_exited(client, "visible screen change")
            return None

        return self.wait_for(
            changed,
            description=f"{client.name} visible screen change",
            timeout=timeout,
            timing=timing,
        )

    def capture(self, client: PtyClient, *, label: str | None = None) -> ScreenCapture:
        self._require_client(client)
        self.pump(0.0)
        snapshot = self._capture(client)
        if label is not None:
            safe_label = self._safe_label(label)
            self._captures.append((client.name, safe_label, snapshot))
            self._record_event("capture", client=client.name, label=safe_label)
        return snapshot

    def press(self, client: PtyClient, key: str | bytes) -> None:
        self._require_client(client)
        if isinstance(key, bytes):
            payload = key
            detail = "raw-key"
        else:
            try:
                payload = _KEY_SEQUENCES[key.lower()]
            except KeyError as error:
                raise ValueError(f"unsupported key {key!r}") from error
            detail = key.lower()
        self._write_client(client, payload)
        self._record_action(client, "press", detail=detail)

    def type_text(self, client: PtyClient, text: str) -> None:
        self._require_client(client)
        payload = text.encode("utf-8")
        if not payload:
            return
        self._write_client(client, payload)
        self._record_action(client, "type-text", detail=f"{len(text)} characters")

    def click(self, client: PtyClient, *, col: int, row: int) -> None:
        self._require_client(client)
        if not 0 <= col < self.cols or not 0 <= row < self.rows:
            raise IndexError(
                f"click cell ({col}, {row}) outside {self.cols}x{self.rows} PTY"
            )
        sgr_col = col + 1
        sgr_row = row + 1
        payload = (
            f"\x1b[<0;{sgr_col};{sgr_row}M"
            f"\x1b[<0;{sgr_col};{sgr_row}m"
        ).encode("ascii")
        self._write_client(client, payload)
        self._record_action(client, "click", col=col, row=row)

    def mark_timing(self, name: str) -> float:
        self._require_active()
        elapsed = self.elapsed
        self.timings.setdefault(name, elapsed)
        return self.timings[name]

    @property
    def elapsed(self) -> float:
        if self._started_at == 0.0:
            return 0.0
        return time.monotonic() - self._started_at

    def metrics(self) -> dict[str, object]:
        clients = {
            client.name: {
                "bytes": client.byte_count,
                "repaints": client.repaint_count,
                "returncode": client.returncode,
            }
            for client in self.clients
        }
        return {
            "bytes": sum(client.byte_count for client in self.clients),
            "repaints": sum(client.repaint_count for client in self.clients),
            "clients": clients,
        }

    def timing_report(self) -> str:
        order = (
            "server-ready",
            "auth-ready",
            "first-world-frame",
            "action-sent",
            "expected-visible",
            "total",
        )
        phases = [
            f"{name}={self.timings[name]:.3f}s"
            for name in order
            if name in self.timings
        ]
        extras = sorted(set(self.timings) - set(order))
        phases.extend(f"{name}={self.timings[name]:.3f}s" for name in extras)
        metrics = self.metrics()
        phases.append(f"bytes={metrics['bytes']}")
        phases.append(f"repaints={metrics['repaints']}")
        return "timings: " + " ".join(phases)

    def close_client(self, client: PtyClient) -> None:
        """Intentionally retire one client while keeping the server and DB alive."""
        self._require_client(client)
        if client.retired:
            return
        self._terminate_client(client)
        client.retired = True
        self._record_event(
            "client-retired", client=client.name, returncode=client.returncode
        )

    def close(self) -> None:
        """Tear down a successful harness early; context management is preferred."""
        self._finish(None)

    def _capture(self, client: PtyClient) -> ScreenCapture:
        return ScreenCapture(
            text=client.screen.text(),
            cells=client.screen.cells(),
            byte_count=client.byte_count,
            repaint_count=client.repaint_count,
            elapsed=self.elapsed,
            _source=client._capture_token,
        )

    def _finish(self, failure: str | None) -> None:
        if self._finished:
            return
        self._finished = True
        if self._entered:
            self.timings.setdefault("total", self.elapsed)
            if failure:
                self._record_event("harness-failure")

        cleanup_errors: list[BaseException] = []
        try:
            self._teardown_processes()
        except BaseException as error:
            cleanup_errors.append(error)
        try:
            self._close_server_log()
        except BaseException as error:
            cleanup_errors.append(error)
        teardown_error = (
            BaseExceptionGroup("PTY harness cleanup failures", cleanup_errors)
            if cleanup_errors
            else None
        )

        effective_failure = failure
        if teardown_error is not None:
            teardown_text = "".join(
                traceback.format_exception(
                    type(teardown_error), teardown_error, teardown_error.__traceback__
                )
            )
            effective_failure = (
                f"{failure}\nTeardown failure:\n{teardown_text}"
                if failure
                else teardown_text
            )

        artifact_error: BaseException | None = None
        if effective_failure and self._entered:
            try:
                self._retain_failure_artifacts(effective_failure)
            except BaseException as error:
                artifact_error = error

        temp_error: BaseException | None = None
        try:
            if self._entered and self.temp_dir.exists():
                try:
                    shutil.rmtree(self.temp_dir)
                except BaseException as error:
                    temp_error = error
                    temp_text = "".join(
                        traceback.format_exception(
                            type(error), error, error.__traceback__
                        )
                    )
                    if self.failure_artifacts is not None:
                        try:
                            with (self.failure_artifacts / "failure.txt").open(
                                "a", encoding="utf-8"
                            ) as failure_log:
                                failure_log.write(
                                    f"\nTemporary DB cleanup failure:\n{temp_text}"
                                )
                        except BaseException as append_error:
                            artifact_error = append_error
                    elif artifact_error is None:
                        try:
                            self._retain_failure_artifacts(
                                f"Temporary DB cleanup failure:\n{temp_text}"
                            )
                        except BaseException as retention_error:
                            artifact_error = retention_error
        finally:
            self._entered = False

        if failure is None:
            final_errors = [
                error
                for error in (teardown_error, temp_error, artifact_error)
                if error is not None
            ]
            if final_errors:
                details = "".join(
                    line
                    for error in final_errors
                    for line in traceback.format_exception(
                        type(error), error, error.__traceback__
                    )
                )
                if temp_error is not None and teardown_error is None:
                    message = f"temporary SQLite cleanup failed:\n{details}"
                else:
                    message = f"PTY harness cleanup failed:\n{details}"
                raise HarnessError(message) from BaseExceptionGroup(
                    "PTY harness finalization failures", final_errors
                )
        elif artifact_error is not None:
            raise HarnessError("failed to retain PTY failure artifacts") from artifact_error

    def _teardown_processes(self) -> None:
        errors: list[BaseException] = []
        for client in reversed(
            [client for client in self.clients if not getattr(client, "retired", False)]
        ):
            try:
                self._terminate_client(client)
            except BaseException as error:
                errors.append(error)
        try:
            self._terminate_server()
        except BaseException as error:
            errors.append(error)
        if errors:
            raise BaseExceptionGroup("process teardown failures", errors)

    @staticmethod
    def _signal_process_group(
        pid: int, requested_signal: int, errors: list[BaseException]
    ) -> bool:
        try:
            os.killpg(pid, requested_signal)
        except ProcessLookupError:
            return False
        except BaseException as error:
            errors.append(error)
            return False
        return True

    def _terminate_server(self) -> None:
        process = self.server_process
        if process is None:
            return
        errors: list[BaseException] = []
        termination_requested = False
        try:
            returncode = process.poll()
        except BaseException as error:
            errors.append(error)
            returncode = None
        exited_before_teardown = returncode is not None

        if returncode is None:
            termination_requested = self._signal_process_group(
                process.pid, signal.SIGTERM, errors
            )
            try:
                returncode = process.wait(timeout=2.0)
            except subprocess.TimeoutExpired:
                termination_requested = (
                    self._signal_process_group(
                        process.pid, signal.SIGKILL, errors
                    )
                    or termination_requested
                )
                try:
                    returncode = process.wait(timeout=2.0)
                except BaseException as error:
                    errors.append(error)
            except BaseException as error:
                errors.append(error)
        else:
            try:
                returncode = process.wait()
            except BaseException as error:
                errors.append(error)

        self._record_event("server-stop", returncode=returncode)
        expected_returncodes = {0, -signal.SIGTERM, -signal.SIGKILL}
        if returncode is not None and (
            exited_before_teardown
            or not termination_requested
            or returncode not in expected_returncodes
        ):
            errors.append(
                HarnessError(
                    f"server exited unexpectedly with status {returncode}; "
                    f"log tail:\n{self._server_log_tail()}"
                )
            )
        if errors:
            raise BaseExceptionGroup("server teardown failures", errors)

    def _terminate_client(self, client: PtyClient) -> None:
        errors: list[BaseException] = []
        termination_requested = False
        drain_failed = False
        try:
            self._reap_client(client)
        except BaseException as error:
            errors.append(error)
        exited_before_teardown = client.returncode is not None

        if client.returncode is None:
            termination_requested = self._signal_process_group(
                client.pid, signal.SIGTERM, errors
            )
            deadline = time.monotonic() + 2.0
            while client.returncode is None and time.monotonic() < deadline:
                if not client.closed and not drain_failed:
                    try:
                        self._drain_client(client)
                    except BaseException as error:
                        errors.append(error)
                        drain_failed = True
                try:
                    self._reap_client(client)
                except BaseException as error:
                    errors.append(error)
                    break
                if client.returncode is None:
                    remaining = deadline - time.monotonic()
                    select.select([], [], [], min(POLL_INTERVAL, max(0.0, remaining)))
            if client.returncode is None:
                termination_requested = (
                    self._signal_process_group(
                        client.pid, signal.SIGKILL, errors
                    )
                    or termination_requested
                )
                try:
                    _, status = os.waitpid(client.pid, 0)
                    client.returncode = os.waitstatus_to_exitcode(status)
                except ChildProcessError:
                    client.returncode = -1
                except BaseException as error:
                    errors.append(error)

        if not client.closed:
            if not drain_failed:
                try:
                    self._drain_client(client)
                except BaseException as error:
                    errors.append(error)
            try:
                self._close_client_fd(client)
            except BaseException as error:
                errors.append(error)
        self._record_event(
            "client-stop", client=client.name, returncode=client.returncode
        )

        expected_returncodes = {0, -signal.SIGTERM, -signal.SIGKILL}
        if client.returncode is not None and (
            exited_before_teardown
            or not termination_requested
            or client.returncode not in expected_returncodes
        ):
            errors.append(
                HarnessError(
                    f"client {client.name!r} exited unexpectedly with status "
                    f"{client.returncode}; screen:\n{client.screen.text()}"
                )
            )
        if errors:
            raise BaseExceptionGroup(
                f"client {client.name!r} teardown failures", errors
            )

    def _drain_client(self, client: PtyClient) -> None:
        if client.closed:
            return
        for _ in range(MAX_DRAIN_CHUNKS):
            try:
                data = os.read(client.fd, 65536)
            except BlockingIOError:
                return
            except OSError as error:
                if error.errno in (errno.EIO, errno.EBADF):
                    self._close_client_fd(client)
                    return
                raise
            if not data:
                self._close_client_fd(client)
                return
            client.screen.feed(data)

    def _write_client(self, client: PtyClient, payload: bytes) -> None:
        self._raise_if_client_exited(client, "input write")
        if client.closed:
            raise HarnessError(f"client {client.name!r} PTY is closed")
        view = memoryview(payload)
        deadline = time.monotonic() + 1.0
        while view:
            try:
                written = os.write(client.fd, view)
                view = view[written:]
            except BlockingIOError:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise WaitTimeout(f"timed out writing input to {client.name}")
                _, writable, _ = select.select(
                    [], [client.fd], [], min(POLL_INTERVAL, remaining)
                )
                if not writable:
                    continue
            except OSError as error:
                raise HarnessError(f"failed writing input to {client.name}: {error}") from error

    def _reap_client(self, client: PtyClient) -> None:
        if client.returncode is not None:
            return
        try:
            pid, status = os.waitpid(client.pid, os.WNOHANG)
        except ChildProcessError:
            client.returncode = -1
            return
        if pid:
            client.returncode = os.waitstatus_to_exitcode(status)

    def _raise_if_client_exited(self, client: PtyClient, expected: str) -> None:
        self._reap_client(client)
        if client.returncode is not None:
            raise HarnessError(
                f"client {client.name!r} exited with status {client.returncode} "
                f"before {expected}; screen:\n{client.screen.text()}"
            )

    def _raise_if_process_exited(self) -> None:
        if self.server_process is not None:
            returncode = self.server_process.poll()
            if returncode is not None:
                raise HarnessError(
                    f"server exited unexpectedly with status {returncode}; "
                    f"log tail:\n{self._server_log_tail()}"
                )
        for client in self.clients:
            if not client.retired:
                self._raise_if_client_exited(client, "the awaited condition")

    def _close_client_fd(self, client: PtyClient) -> None:
        if client.closed:
            return
        try:
            os.close(client.fd)
        except OSError as error:
            if error.errno != errno.EBADF:
                raise
        client.closed = True

    def _record_action(
        self, client: PtyClient, event: str, **details: object
    ) -> None:
        self.timings.setdefault("action-sent", self.elapsed)
        self._record_event(event, client=client.name, **details)

    def _record_event(self, event: str, **details: object) -> None:
        entry: dict[str, object] = {
            "at_seconds": round(self.elapsed, 6),
            "event": event,
        }
        entry.update(details)
        self.timeline.append(entry)

    def _retain_failure_artifacts(self, failure: str) -> None:
        self.artifact_base.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
        artifact_dir = Path(
            tempfile.mkdtemp(
                prefix=f"termenor-playtest-{timestamp}-",
                dir=self.artifact_base,
            )
        )
        self.failure_artifacts = artifact_dir

        if self._server_log_path.is_file():
            shutil.copyfile(self._server_log_path, artifact_dir / "server.log")
        else:
            (artifact_dir / "server.log").touch()
        for client in self.clients:
            (artifact_dir / f"{client.name}.raw").write_bytes(client.raw_bytes)
            (artifact_dir / f"{client.name}.screen.txt").write_text(
                client.screen.text(), encoding="utf-8"
            )
        for client_name, label, snapshot in self._captures:
            (artifact_dir / f"{client_name}.{label}.screen.txt").write_text(
                snapshot.text, encoding="utf-8"
            )
        (artifact_dir / "action-timeline.json").write_text(
            json.dumps(self.timeline, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        timing_payload = {
            "elapsed_seconds": self.timings,
            "metrics": self.metrics(),
        }
        (artifact_dir / "timings.json").write_text(
            json.dumps(timing_payload, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        (artifact_dir / "failure.txt").write_text(failure, encoding="utf-8")

    def _server_log_tail(self, limit: int = 4000) -> str:
        try:
            data = self._server_log_path.read_bytes()
        except OSError:
            return "<server log unavailable>"
        return data[-limit:].decode("utf-8", "replace")

    def _close_server_log(self) -> None:
        handle = self._server_log_handle
        self._server_log_handle = None
        if handle is not None:
            handle.close()

    def _expanded_command(self, command: Sequence[str]) -> tuple[str, ...]:
        replacements = {
            "{port}": str(self.port),
            "{db_path}": str(self.db_path),
            "{root}": str(self.root),
        }
        expanded = []
        for token in command:
            value = str(token)
            for marker, replacement in replacements.items():
                value = value.replace(marker, replacement)
            expanded.append(value)
        if not expanded:
            raise ValueError("process command cannot be empty")
        return tuple(expanded)

    def _require_active(self) -> None:
        if not self._entered or self._finished:
            raise HarnessError("PtyHarness must be used inside an active context")

    def _require_client(self, client: PtyClient) -> None:
        self._require_active()
        if client.harness is not self or client not in self.clients:
            raise ValueError("PTY client does not belong to this harness")

    @staticmethod
    def _free_port() -> int:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind(("127.0.0.1", 0))
            return int(sock.getsockname()[1])

    @staticmethod
    def _set_winsize(fd: int, rows: int, cols: int) -> None:
        fcntl.ioctl(
            fd,
            termios.TIOCSWINSZ,
            struct.pack("HHHH", rows, cols, 0, 0),
        )

    @staticmethod
    def _safe_label(label: str) -> str:
        safe = "".join(
            ch if ch.isalnum() or ch in "_.-" else "-" for ch in label
        ).strip(".-")
        if not safe:
            raise ValueError("capture label must contain a letter, digit, '_' or '-'")
        return safe


def wait_for_text(
    client: PtyClient,
    text: str,
    *,
    timeout: float = DEFAULT_TIMEOUT,
    timing: str | None = None,
) -> ScreenCapture:
    return client.wait_for_text(text, timeout=timeout, timing=timing)


def wait_for_change(
    client: PtyClient,
    before: ScreenCapture,
    *,
    timeout: float = DEFAULT_TIMEOUT,
    timing: str | None = None,
) -> ScreenCapture:
    return client.wait_for_change(before, timeout=timeout, timing=timing)


def press(client: PtyClient, key: str | bytes) -> None:
    client.press(key)


def type_text(client: PtyClient, text: str) -> None:
    client.type_text(text)


def click(client: PtyClient, col: int, row: int) -> None:
    client.click(col, row)


def capture(client: PtyClient, label: str | None = None) -> ScreenCapture:
    return client.capture(label=label)

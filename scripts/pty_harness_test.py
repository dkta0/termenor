#!/usr/bin/env python3
"""Focused tests for the real-terminal playtest harness."""

from __future__ import annotations

import os
import pty
import select
import shutil
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from pty_harness import (  # noqa: E402
    Cell,
    HarnessError,
    PtyHarness,
    TerminalScreen,
    PtyClient,
    WaitTimeout,
    capture,
    click,
    press,
    type_text,
    wait_for_change,
    wait_for_text,
)


class TerminalScreenTest(unittest.TestCase):
    def test_normalizes_utf8_truecolor_cursor_clear_and_sync_output(self) -> None:
        screen = TerminalScreen(cols=8, rows=3)
        chunks = [
            b"stale text",
            b"\x1b[?2026",
            b"h\x1b[2J\x1b[H\x1b[1;3H",
            b"\x1b[38;2;255;210;60;48;2;1;2;3m\xe2",
            b"\x96\x80   \x1b[0m\x1b[2;2HM\xc3",
            b"\xb6ve   \x1b[?2026l",
        ]

        for chunk in chunks:
            screen.feed(chunk)

        self.assertEqual(screen.raw_bytes, b"".join(chunks))
        self.assertEqual(screen.text(), "  ▀\n Möve\n")
        self.assertEqual(screen.line(0), "  ▀")
        self.assertEqual(screen.line(1), " Möve")
        self.assertEqual(screen.line(2), "")
        self.assertTrue(screen.contains("▀\n Möve"))
        self.assertFalse(screen.contains("stale"))
        self.assertEqual(screen.cell(2, 0), Cell(text="▀", fg="ffd23c", bg="010203"))
        self.assertEqual(screen.cell(1, 1).text, "M")
        self.assertEqual(screen.cell(2, 1).text, "ö")
        self.assertEqual(screen.repaint_count, 1)
        self.assertEqual(screen.byte_count, len(b"".join(chunks)))

    def test_synchronized_output_is_not_visible_until_the_commit_marker(self) -> None:
        screen = TerminalScreen(cols=8, rows=2)
        screen.feed(b"\x1b[38;2;1;2;3mold")

        screen.feed(b"\x1b[?2026h\x1b[2J\x1b[Hnew")

        self.assertEqual(screen.line(0), "old")
        self.assertEqual(screen.cell(0, 0), Cell(text="o", fg="010203", bg="default"))
        self.assertEqual(screen.repaint_count, 0)

        screen.feed(b"\x1b[?2026l")

        self.assertEqual(screen.line(0), "new")
        self.assertEqual(screen.repaint_count, 1)

    def test_preserves_blank_cell_coordinates_after_erasing_a_line(self) -> None:
        screen = TerminalScreen(cols=6, rows=2)
        screen.feed(b"abcdef\x1b[2;1Hworld\x1b[1;3H\x1b[2KX")

        self.assertEqual(screen.line(0), "  X")
        self.assertEqual(screen.line(1), "world")
        self.assertEqual(screen.cell(0, 0), Cell(text=" ", fg="default", bg="default"))
        with self.assertRaises(IndexError):
            screen.cell(6, 0)


class PtyHarnessTest(unittest.TestCase):
    def test_condition_waits_and_input_helpers_drive_a_real_pty(self) -> None:
        expected = (
            "é".encode("utf-8")
            + b"\x1b[C"
            + b"\x1b[<0;3;4M"
            + b"\x1b[<0;3;4m"
        )
        child_code = f"""
import os
import time
import tty

tty.setraw(0)
os.write(1, b"READY\\r\\n")
data = b""
while len(data) < {len(expected)}:
    data += os.read(0, {len(expected)} - len(data))
os.write(1, ("HEX:" + data.hex() + "\\r\\n").encode())
time.sleep(0.2)
"""

        with tempfile.TemporaryDirectory() as artifact_base:
            harness = PtyHarness(
                rows=6,
                cols=80,
                client_command=[sys.executable, "-u", "-c", child_code],
                artifact_base=Path(artifact_base),
            )
            with harness:
                temp_dir = harness.temp_dir
                client = harness.spawn_client("input-probe")
                wait_for_text(client, "READY", timeout=1.0, timing="auth-ready")
                before = capture(client)

                type_text(client, "é")
                press(client, "right")
                click(client, col=2, row=3)

                after = wait_for_change(
                    client,
                    before,
                    timeout=1.0,
                    timing="expected-visible",
                )
                wait_for_text(client, "HEX:" + expected.hex(), timeout=1.0)
                self.assertNotEqual(after, before)
                self.assertTrue(client.screen.contains("HEX:" + expected.hex()))
                fd = client.fd
                pid = client.pid

            self.assertFalse(temp_dir.exists())
            self.assertIsNotNone(client.returncode)
            with self.assertRaises(OSError):
                os.fstat(fd)
            with self.assertRaises(ChildProcessError):
                os.waitpid(pid, os.WNOHANG)
            self.assertIn("action-sent", harness.timings)
            self.assertIn("auth-ready", harness.timings)
            self.assertIn("expected-visible", harness.timings)
            self.assertIn("total", harness.timings)
            self.assertIsNone(harness.failure_artifacts)

    def test_wait_for_change_rejects_a_capture_from_another_client(self) -> None:
        client_code = """
import os
import signal

os.write(1, (os.environ["LABEL"] + "\\r\\n").encode())
signal.pause()
"""
        with PtyHarness(
            rows=4,
            cols=20,
            client_command=[sys.executable, "-u", "-c", client_code],
        ) as harness:
            first = harness.spawn_client("first", env={"LABEL": "FIRST"})
            second = harness.spawn_client("second", env={"LABEL": "SECOND"})
            wait_for_text(first, "FIRST", timeout=1.0)
            wait_for_text(second, "SECOND", timeout=1.0)

            with self.assertRaisesRegex(ValueError, "capture"):
                wait_for_change(second, capture(first), timeout=0.1)

    def test_expected_client_retirement_allows_reconnect_in_same_harness(self) -> None:
        client_code = """
import os
import signal

os.write(1, (os.environ["LABEL"] + "\\r\\n").encode())
signal.pause()
"""
        with tempfile.TemporaryDirectory() as artifact_base:
            harness = PtyHarness(
                rows=4,
                cols=30,
                client_command=[sys.executable, "-u", "-c", client_code],
                artifact_base=Path(artifact_base),
            )
            with harness:
                first = harness.spawn_client("first", env={"LABEL": "FIRST"})
                wait_for_text(first, "FIRST", timeout=1.0)

                harness.close_client(first)

                self.assertTrue(first.closed)
                self.assertIsNotNone(first.returncode)
                second = harness.spawn_client("second", env={"LABEL": "SECOND"})
                wait_for_text(second, "SECOND", timeout=1.0)

            self.assertIsNotNone(second.returncode)
            self.assertIn("first", harness.metrics()["clients"])
            self.assertIsNone(harness.failure_artifacts)

    def test_an_unexpected_client_exit_cannot_pass_from_cached_screen_text(self) -> None:
        client_code = """
import os

os.write(1, b"READY-THEN-CRASH\\r\\n")
os._exit(7)
"""
        with tempfile.TemporaryDirectory() as artifact_base:
            harness = PtyHarness(
                rows=4,
                cols=30,
                client_command=[sys.executable, "-u", "-c", client_code],
                artifact_base=Path(artifact_base),
            )
            with self.assertRaisesRegex(HarnessError, "status 7"):
                with harness:
                    client = harness.spawn_client("crasher")
                    wait_for_text(client, "READY-THEN-CRASH", timeout=1.0)

            self.assertIsNotNone(harness.failure_artifacts)

    def test_context_entry_removes_partial_temp_state_when_initialization_fails(self) -> None:
        with tempfile.TemporaryDirectory() as parent:
            allocated = Path(parent) / "allocated-db-dir"
            allocated.mkdir()
            harness = PtyHarness()

            with (
                patch(
                    "pty_harness.tempfile.mkdtemp",
                    return_value=str(allocated),
                ),
                patch(
                    "pty_harness.Path.touch",
                    side_effect=OSError("cannot create server log"),
                ),
                self.assertRaisesRegex(OSError, "server log"),
            ):
                harness.__enter__()

            self.assertFalse(allocated.exists())
            self.assertFalse(harness._entered)

    def test_spawn_client_closes_both_pty_fds_when_winsize_setup_fails(self) -> None:
        with PtyHarness() as harness:
            master_fd, slave_fd = pty.openpty()
            try:
                with (
                    patch(
                        "pty_harness.pty.openpty",
                        return_value=(master_fd, slave_fd),
                    ),
                    patch.object(
                        harness,
                        "_set_winsize",
                        side_effect=OSError("winsize failed"),
                    ),
                    self.assertRaisesRegex(OSError, "winsize failed"),
                ):
                    harness.spawn_client("winsize-failure")

                for fd in (master_fd, slave_fd):
                    with self.assertRaises(OSError):
                        os.fstat(fd)
            finally:
                for fd in (master_fd, slave_fd):
                    try:
                        os.close(fd)
                    except OSError:
                        pass

    def test_teardown_continues_after_one_client_cleanup_error(self) -> None:
        harness = PtyHarness()
        first = object()
        second = object()
        harness.clients = [first, second]  # type: ignore[list-item]
        attempted: list[object] = []

        def terminate(client: object) -> None:
            attempted.append(client)
            if client is second:
                raise OSError("first cleanup failed")

        with (
            patch.object(harness, "_terminate_client", side_effect=terminate),
            patch.object(harness, "_terminate_server", create=True) as terminate_server,
            self.assertRaises(ExceptionGroup),
        ):
            harness._teardown_processes()

        self.assertEqual(attempted, [second, first])
        terminate_server.assert_called_once_with()

    def test_http_readiness_timeout_keeps_log_and_does_not_mark_server_ready(self) -> None:
        server_code = """
import signal

print("readiness-timeout-marker", flush=True)
signal.pause()
"""
        with tempfile.TemporaryDirectory() as artifact_base:
            harness = PtyHarness(
                server_command=[sys.executable, "-u", "-c", server_code],
                artifact_base=Path(artifact_base),
                readiness_timeout=0.25,
            )
            with self.assertRaisesRegex(WaitTimeout, "HTTP 200"):
                with harness:
                    temp_dir = harness.temp_dir
                    harness.start_server()

            self.assertFalse(temp_dir.exists())
            self.assertNotIn("server-ready", harness.timings)
            self.assertIn("server-ready-timeout", harness.timings)
            self.assertIsNotNone(harness.server_process)
            self.assertIsNotNone(harness.server_process.returncode)
            artifacts = harness.failure_artifacts
            self.assertIsNotNone(artifacts)
            assert artifacts is not None
            self.assertIn(
                "readiness-timeout-marker",
                (artifacts / "server.log").read_text(),
            )

    def test_wait_rejects_a_condition_that_turns_true_after_its_deadline(self) -> None:
        with PtyHarness() as harness:
            def slow_true() -> bool:
                select.select([], [], [], 0.05)
                return True

            with self.assertRaises(WaitTimeout):
                harness.wait_for(
                    slow_true,
                    description="late truthy condition",
                    timeout=0.01,
                    timing="late-condition",
                )

            self.assertNotIn("late-condition", harness.timings)
            self.assertIn("late-condition-timeout", harness.timings)

    def test_client_fd_closes_even_when_final_output_drain_fails(self) -> None:
        harness = PtyHarness()
        master_fd, slave_fd = pty.openpty()
        os.close(slave_fd)
        client = PtyClient(
            harness=harness,
            name="drain-failure",
            pid=-1,
            fd=master_fd,
            screen=TerminalScreen(cols=4, rows=2),
            command=("fake-client",),
            returncode=1,
        )
        try:
            with (
                patch.object(
                    harness,
                    "_drain_client",
                    side_effect=OSError("drain failed"),
                ),
                self.assertRaises(BaseExceptionGroup),
            ):
                harness._terminate_client(client)

            with self.assertRaises(OSError):
                os.fstat(master_fd)
        finally:
            try:
                os.close(master_fd)
            except OSError:
                pass

    def test_temp_cleanup_failure_retains_artifacts_before_raising(self) -> None:
        with tempfile.TemporaryDirectory() as artifact_base:
            harness = PtyHarness(artifact_base=Path(artifact_base))
            temp_dir: Path | None = None
            try:
                with (
                    patch(
                        "pty_harness.shutil.rmtree",
                        side_effect=OSError("remove failed"),
                    ),
                    self.assertRaisesRegex(HarnessError, "temporary"),
                ):
                    with harness:
                        temp_dir = harness.temp_dir

                self.assertIsNotNone(harness.failure_artifacts)
                artifacts = harness.failure_artifacts
                assert artifacts is not None
                self.assertTrue((artifacts / "server.log").is_file())
                self.assertTrue((artifacts / "timings.json").is_file())
                self.assertIn(
                    "remove failed",
                    (artifacts / "failure.txt").read_text(),
                )
            finally:
                if temp_dir is not None and temp_dir.exists():
                    shutil.rmtree(temp_dir)

    def test_visibility_timeout_retains_diagnostics_then_cleans_everything(self) -> None:
        server_code = """
from http.server import BaseHTTPRequestHandler, HTTPServer
import sys

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"ready")

print("server-log-marker", flush=True)
HTTPServer(("127.0.0.1", int(sys.argv[1])), Handler).serve_forever()
"""
        client_code = """
import os
import time
import tty

tty.setraw(0)
os.write(1, b"diagnostic-screen\\r\\n")
time.sleep(2)
"""

        with tempfile.TemporaryDirectory() as artifact_base:
            harness = PtyHarness(
                rows=6,
                cols=40,
                server_command=[sys.executable, "-u", "-c", server_code, "{port}"],
                client_command=[sys.executable, "-u", "-c", client_code],
                artifact_base=Path(artifact_base),
                readiness_timeout=2.0,
            )
            with self.assertRaisesRegex(WaitTimeout, "never-visible"):
                with harness:
                    temp_dir = harness.temp_dir
                    self.assertGreater(harness.port, 0)
                    harness.start_server()
                    self.assertIn("server-ready", harness.timings)
                    client = harness.spawn_client("timeout-probe")
                    wait_for_text(client, "diagnostic-screen", timeout=1.0)
                    fd = client.fd
                    pid = client.pid
                    wait_for_text(
                        client,
                        "never-visible",
                        timeout=0.15,
                        timing="expected-visible",
                    )

            self.assertFalse(temp_dir.exists())
            self.assertIsNotNone(harness.server_process)
            self.assertIsNotNone(harness.server_process.returncode)
            self.assertIsNotNone(client.returncode)
            with self.assertRaises(OSError):
                os.fstat(fd)
            with self.assertRaises(ChildProcessError):
                os.waitpid(pid, os.WNOHANG)

            self.assertNotIn("expected-visible", harness.timings)
            self.assertIn("expected-visible-timeout", harness.timings)
            artifacts = harness.failure_artifacts
            self.assertIsNotNone(artifacts)
            assert artifacts is not None
            self.assertTrue(artifacts.name.startswith("termenor-playtest-"))
            self.assertIn("server-log-marker", (artifacts / "server.log").read_text())
            self.assertIn("diagnostic-screen", (artifacts / "timeout-probe.screen.txt").read_text())
            self.assertGreater((artifacts / "timeout-probe.raw").stat().st_size, 0)
            self.assertIn("never-visible", (artifacts / "failure.txt").read_text())
            self.assertTrue((artifacts / "action-timeline.json").is_file())
            self.assertTrue((artifacts / "timings.json").is_file())


if __name__ == "__main__":
    unittest.main()

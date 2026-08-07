#!/usr/bin/env python3
"""End-to-end interactive login verification through the shared PTY harness."""

from __future__ import annotations

import sys

from pty_harness import PtyHarness, capture, press, type_text


ROWS = 40
COLS = 100
HALF_BLOCK = "▀".encode("utf-8")
LOCAL_COLOR = b"255;210;60"


def report_checks(checks: dict[str, bool]) -> bool:
    for name, passed in checks.items():
        print(f"  [{'PASS' if passed else 'FAIL'}] {name}")
    return all(checks.values())


def run() -> tuple[PtyHarness, bool]:
    harness = PtyHarness(rows=ROWS, cols=COLS)
    try:
        with harness:
            harness.start_server()
            client = harness.spawn_client("login")

            harness.wait_for(
                lambda: client.screen.contains("Username")
                and client.screen.contains("Password")
                and client.screen.contains("Enter to play"),
                description="interactive login form",
                timing="login-ready",
            )
            capture(client, label="login-form")

            type_text(client, "ptylogin")
            harness.wait_for_text(client, "ptylogin", timeout=2.0)
            press(client, "tab")
            harness.wait_for_text(client, "› Password", timeout=2.0)
            type_text(client, "secret")
            harness.wait_for_text(client, "••••••", timeout=2.0)
            press(client, "enter")

            harness.wait_for(
                lambda: client.screen.contains("▀")
                and client.screen.contains("Inv")
                and not client.screen.contains("Enter to play"),
                description="successful authentication to replace login with world",
                timing="auth-ready",
            )
            harness.wait_for(
                lambda: "▀" in client.screen.text(),
                description="first normalized world frame",
                timing="first-world-frame",
            )
            world = capture(client, label="world")
            harness.mark_timing("expected-visible")
            raw = client.raw_bytes
            checks = {
                "client emitted output": client.byte_count > 0,
                "world half-block ▀ glyph present (entered game)": HALF_BLOCK in raw
                and "▀" in world.text,
                "local player color rendered": LOCAL_COLOR in raw,
            }
            ok = report_checks(checks)
            if not ok:
                raise AssertionError("login contract failed")
        return harness, True
    except Exception as error:
        print(f"  [FAIL] harness/scenario: {error}")
        return harness, False


def main() -> int:
    harness, ok = run()
    print(harness.timing_report())
    if harness.failure_artifacts is not None:
        print(f"failure artifacts: {harness.failure_artifacts}")
    print("PTY LOGIN OK" if ok else "PTY LOGIN FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""End-to-end production render verification through the shared PTY harness."""

from __future__ import annotations

import sys

from pty_harness import PtyHarness, ScreenCapture, capture, press


ROWS = 40
COLS = 100
HALF_BLOCK = "▀".encode("utf-8")
TRUECOLOR = b"\x1b[38;2;"
LOCAL_COLOR = b"255;210;60"
OTHER_COLOR = b"80;140;255"
OTHER_COLOR_HEX = "508cff"


def color_positions(snapshot: ScreenCapture, color: str) -> set[tuple[int, int]]:
    return {
        (col, row)
        for row, line in enumerate(snapshot.cells)
        for col, cell in enumerate(line)
        if cell.fg == color or cell.bg == color
    }


def report_checks(checks: dict[str, bool]) -> bool:
    for name, passed in checks.items():
        print(f"  [{'PASS' if passed else 'FAIL'}] {name}")
    return all(checks.values())


def run() -> tuple[PtyHarness, bool]:
    harness = PtyHarness(rows=ROWS, cols=COLS)
    try:
        with harness:
            harness.start_server()
            observer = harness.spawn_client(
                "observer", username="observer", password="ptycheck"
            )
            mover = harness.spawn_client(
                "mover", username="mover", password="ptycheck"
            )

            harness.wait_for(
                lambda: observer.screen.contains("observer")
                and observer.screen.contains("Inv")
                and mover.screen.contains("mover")
                and mover.screen.contains("Inv"),
                description="both clients to authenticate and render their local player",
                timing="auth-ready",
            )
            harness.wait_for(
                lambda: observer.screen.contains("▀")
                and mover.screen.contains("▀")
                and any(
                    observer.screen.contains(label)
                    for label in ("observer", "mover")
                ),
                description="both clients' first normalized world frame",
                timing="first-world-frame",
            )
            harness.wait_for(
                lambda: bool(color_positions(capture(observer), OTHER_COLOR_HEX)),
                description="observer to perceive the other-player color",
            )

            before = capture(observer, label="before-move")
            before_positions = color_positions(before, OTHER_COLOR_HEX)
            current_positions = before_positions
            for key in ("right", "right", "down", "down", "right", "down"):
                press(mover, key)
                current_positions = harness.wait_for(
                    lambda previous=current_positions: (
                        positions
                        if (
                            positions := color_positions(
                                capture(observer), OTHER_COLOR_HEX
                            )
                        )
                        and positions != previous
                        else None
                    ),
                    description=f"observer to see mover respond to {key}",
                    timeout=3.0,
                )
            harness.wait_for(
                lambda: observer.repaint_count >= 20,
                description="observer to render at least 20 normalized movement repaints",
                timeout=5.0,
            )

            after = capture(observer, label="after-move")
            harness.mark_timing("expected-visible")
            raw = observer.raw_bytes
            visible_text = after.text
            checks = {
                "client A emitted output": observer.byte_count > 0,
                "truecolor SGR present": TRUECOLOR in raw,
                "half-block ▀ glyph present (primary tier)": HALF_BLOCK in raw,
                "local player color rendered": LOCAL_COLOR in raw,
                "other player color rendered": OTHER_COLOR in raw,
                "frames animate (>=20 normalized repaints)": observer.repaint_count >= 20,
                "frames change after B moves": bool(before_positions)
                and color_positions(after, OTHER_COLOR_HEX) != before_positions,
                "player name labels rendered": "mover" in visible_text
                or "observer" in visible_text,
                "NPC rendered (tutorial/overworld label)": any(
                    label in visible_text
                    for label in ("Cook", "Chef", "Goblin", "Rat")
                ),
            }
            print(
                "client A bytes: "
                f"total={observer.byte_count} repaints={observer.repaint_count}"
            )
            ok = report_checks(checks)
            if not ok:
                raise AssertionError("render contract failed")
        return harness, True
    except Exception as error:
        print(f"  [FAIL] harness/scenario: {error}")
        return harness, False


def main() -> int:
    harness, ok = run()
    print(harness.timing_report())
    if harness.failure_artifacts is not None:
        print(f"failure artifacts: {harness.failure_artifacts}")
    print("PTY RENDER OK" if ok else "PTY RENDER FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

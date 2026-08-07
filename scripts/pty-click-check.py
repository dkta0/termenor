#!/usr/bin/env python3
"""End-to-end click-to-move verification through the shared PTY harness."""

from __future__ import annotations

import sys

from pty_harness import PtyHarness, ScreenCapture, capture, click


ROWS = 40
COLS = 100
HALF_BLOCK = "▀".encode("utf-8")
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
                "observer", username="observer", password="clickcheck"
            )
            mover = harness.spawn_client(
                "mover", username="mover", password="clickcheck"
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
                and mover.screen.contains("▀"),
                description="both clients' first normalized world frame",
                timing="first-world-frame",
            )
            harness.wait_for(
                lambda: bool(color_positions(capture(observer), OTHER_COLOR_HEX)),
                description="observer to perceive the mover",
            )

            observer_before = capture(observer, label="before-clicks")
            mover_before = capture(mover, label="before-clicks")
            before_positions = color_positions(observer_before, OTHER_COLOR_HEX)
            current_positions = before_positions

            center_col = COLS // 2
            center_row = ROWS // 2
            for dx, dy in ((12, 6), (14, 7), (16, 8), (12, 6), (14, 7)):
                click(mover, center_col + dx - 1, center_row + dy - 1)
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
                    description="observer to see mover respond to SGR click",
                    timeout=4.0,
                )

            observer_after = capture(observer, label="after-clicks")
            mover_after = capture(mover, label="after-clicks")

            panel_cols = min(28, max(0, COLS - 20))
            panel_col = COLS - panel_cols
            skills_col = panel_col + 1 + len("Inv") + 2 + 2
            click(mover, skills_col, 0)
            skills = harness.wait_for_text(
                mover,
                "Strength",
                timeout=3.0,
                timing="expected-visible",
            )
            capture(mover, label="skills-tab")

            checks = {
                "mover screen changes after clicks (camera panned → player moved)": (
                    mover_after != mover_before
                ),
                "observer sees mover relocate": bool(before_positions)
                and color_positions(observer_after, OTHER_COLOR_HEX)
                != before_positions,
                "skills tab renders skill rows when clicked": skills.contains("Strength"),
            }
            print(
                "mover bytes/repaints: "
                f"{mover.byte_count}/{mover.repaint_count}  "
                "observer bytes/repaints: "
                f"{observer.byte_count}/{observer.repaint_count}"
            )
            ok = report_checks(checks)
            if not ok:
                raise AssertionError("click contract failed")
        return harness, True
    except Exception as error:
        print(f"  [FAIL] harness/scenario: {error}")
        return harness, False


def main() -> int:
    harness, ok = run()
    print(harness.timing_report())
    if harness.failure_artifacts is not None:
        print(f"failure artifacts: {harness.failure_artifacts}")
    print("CLICK MOVE OK" if ok else "CLICK MOVE FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

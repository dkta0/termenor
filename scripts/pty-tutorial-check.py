#!/usr/bin/env python3
"""Play the complete First Steps tutorial through the production terminal client."""

from __future__ import annotations

import argparse
import select
import sys
from dataclasses import dataclass

from pty_harness import HarnessError, PtyClient, PtyHarness, capture, click, press, type_text


ROWS = 40
COLS = 100
PANEL_COLS = min(28, max(0, COLS - 20))
PANEL_COL = COLS - PANEL_COLS
BODY_COL = PANEL_COL + 1
BODY_BOTTOM = ROWS - 3
USERNAME = "ptytutorial"
PASSWORD = "tutorial-check"
GUIDE_CLICK = (36, 20)
TREE_CLICK = (52, 26)
EXIT_CLICK = (43, 26)


@dataclass
class PhaseClock:
    harness: PtyHarness
    previous: float = 0.0

    def mark(self, name: str) -> None:
        elapsed = self.harness.mark_timing(name)
        print(f"phase {name}: {elapsed:.3f}s (+{elapsed - self.previous:.3f}s)")
        self.previous = elapsed


def wait_for_all(
    harness: PtyHarness,
    client: PtyClient,
    texts: tuple[str, ...],
    *,
    description: str,
    timeout: float = 8.0,
    timing: str | None = None,
) -> None:
    harness.wait_for(
        lambda: all(client.screen.contains(text) for text in texts),
        description=description,
        timeout=timeout,
        timing=timing,
    )


def wait_for_any(
    harness: PtyHarness,
    client: PtyClient,
    texts: tuple[str, ...],
    *,
    description: str,
    timeout: float = 8.0,
) -> str:
    return harness.wait_for(
        lambda: next((text for text in texts if client.screen.contains(text)), ""),
        description=description,
        timeout=timeout,
    )


def panel_row(client: PtyClient, text: str) -> int | None:
    for row in range(2, BODY_BOTTOM):
        if text in client.screen.line(row)[PANEL_COL:]:
            return row
    return None


def action_col(client: PtyClient, label: str) -> int | None:
    col = client.screen.line(BODY_BOTTOM).find(label, PANEL_COL)
    if col < 0:
        return None
    return col + len(label) // 2


def click_tab(harness: PtyHarness, client: PtyClient, label: str) -> None:
    line = client.screen.line(0)
    col = line.find(label, PANEL_COL)
    if col < 0:
        raise AssertionError(f"side-panel tab {label!r} is not visible")
    click(client, col + len(label) // 2, 0)


def select_inventory_item(
    harness: PtyHarness,
    client: PtyClient,
    item: str,
    action: str,
) -> tuple[int, int]:
    click_tab(harness, client, "Inv")
    row = harness.wait_for(
        lambda: panel_row(client, item),
        description=f"Inventory to expose {item}",
        timeout=4.0,
    )
    click(client, BODY_COL + 1, row)
    action_label = f"[{action}]"
    harness.wait_for(
        lambda: (
            action_col(client, action_label)
            if f"▸ {item}" in client.screen.line(row)[PANEL_COL:]
            else None
        ),
        description=f"selected {item} and committed {action_label} action row",
        timeout=3.0,
    )
    col = action_col(client, action_label)
    if col is None:
        raise AssertionError(f"{action_label} disappeared after selecting {item}")
    return row, col


def authenticate(
    harness: PtyHarness,
    name: str,
    *,
    mode: str,
) -> PtyClient:
    client = harness.spawn_client(name)
    wait_for_all(
        harness,
        client,
        ("Username", "Password", "Enter to play"),
        description=f"{name} interactive authentication form",
    )
    if mode == "register":
        harness.wait_for_text(client, "(•) Register", timeout=2.0)
    elif mode == "login":
        press(client, "left")
        harness.wait_for_text(client, "(•) Log in", timeout=2.0)
    else:
        raise ValueError(f"unknown authentication mode: {mode}")
    type_text(client, USERNAME)
    press(client, "tab")
    type_text(client, PASSWORD)
    press(client, "enter")
    return client


def wait_for_initial_world(
    harness: PtyHarness,
    client: PtyClient,
    *,
    timing: str | None = None,
) -> None:
    wait_for_all(
        harness,
        client,
        ("Cook", "Talk to the guide.", "Bronze axe", "Inv", "▀"),
        description="fresh tutorial guide, objective, Inventory, and world",
        timeout=10.0,
        timing=timing,
    )


def print_screen(client: PtyClient) -> None:
    print("\n--- normalized production client ---")
    print(capture(client).text)
    print("--- end screen ---")


def attach_session(harness: PtyHarness, client: PtyClient) -> None:
    print(f"attach session: {harness.temp_dir}")
    print(f"database: {harness.db_path}")
    print("commands: screen | click COL ROW | press KEY | type TEXT | quit")
    print_screen(client)
    sys.stdout.write("tutorial> ")
    sys.stdout.flush()
    try:
        while True:
            harness.pump(0.05)
            if client.returncode is not None:
                raise HarnessError(
                    f"attached client exited with status {client.returncode}"
                )
            readable, _, _ = select.select([sys.stdin], [], [], 0.05)
            if not readable:
                continue
            line = sys.stdin.readline()
            if line == "":
                print("attach input closed")
                return
            command = line.rstrip("\n")
            parts = command.split(maxsplit=2)
            try:
                if not parts or parts[0] == "screen":
                    print_screen(client)
                elif parts[0] in {"quit", "exit"}:
                    return
                elif parts[0] == "click" and len(parts) == 3:
                    click(client, int(parts[1]), int(parts[2]))
                elif parts[0] == "press" and len(parts) == 2:
                    press(client, parts[1])
                elif parts[0] == "type" and len(parts) >= 2:
                    type_text(client, command.split(maxsplit=1)[1])
                else:
                    print("usage: screen | click COL ROW | press KEY | type TEXT | quit")
            except (ValueError, IndexError) as error:
                print(f"action rejected: {error}")
            sys.stdout.write("tutorial> ")
            sys.stdout.flush()
    except KeyboardInterrupt:
        print("\nattach interrupted; cleaning up")


def run(*, attach: bool) -> tuple[PtyHarness, bool]:
    harness = PtyHarness(rows=ROWS, cols=COLS)
    try:
        with harness:
            harness.start_server()
            phases = PhaseClock(harness)
            client = authenticate(harness, "tutorial", mode="register")
            wait_for_initial_world(harness, client, timing="auth-ready")
            harness.mark_timing("first-world-frame")
            phases.mark("initial-world")
            capture(client, label="initial-world")

            if attach:
                attach_session(harness, client)
                return harness, True

            click(client, *GUIDE_CLICK)
            harness.wait_for_text(
                client,
                "Find a tree and gather logs.",
                timeout=4.0,
            )
            phases.mark("guide-complete")
            capture(client, label="guide-complete")

            click(client, *TREE_CLICK)
            wait_for_all(
                harness,
                client,
                ("Logs", "Select the logs and make arrow shafts."),
                description="Gather to produce Logs and advance the objective",
                timeout=10.0,
            )
            click_tab(harness, client, "Skills")
            harness.wait_for(
                lambda: (
                    row
                    if (
                        (row := panel_row(client, "Woodcutting")) is not None
                        and client.screen.line(row)[PANEL_COL:].rstrip().endswith("xp")
                        and "  0xp" not in client.screen.line(row)[PANEL_COL:]
                    )
                    else None
                ),
                description="Skills panel to show earned Woodcutting XP",
                timeout=3.0,
            )
            phases.mark("gather-feedback")
            capture(client, label="skills-after-gather")

            _, make_col = select_inventory_item(harness, client, "Logs", "Make")
            capture(client, label="logs-selected")
            click(client, make_col, BODY_BOTTOM)
            wait_for_all(
                harness,
                client,
                ("Arrow shafts", "Examine the arrow shafts in your Inventory."),
                description="Make to produce Arrow shafts and advance the objective",
                timeout=4.0,
            )
            phases.mark("make-complete")
            capture(client, label="shafts-produced")

            click_tab(harness, client, "Skills")
            harness.wait_for(
                lambda: (
                    row
                    if (
                        (row := panel_row(client, "Fletching")) is not None
                        and client.screen.line(row)[PANEL_COL:].rstrip().endswith("5xp")
                    )
                    else None
                ),
                description="Skills panel to show 5 earned Fletching XP",
                timeout=3.0,
            )
            phases.mark("skills-visible")
            capture(client, label="skills-after-make")

            _, examine_col = select_inventory_item(
                harness,
                client,
                "Arrow shafts",
                "Examine",
            )
            capture(client, label="shafts-selected")
            click(client, examine_col, BODY_BOTTOM)
            wait_for_all(
                harness,
                client,
                ("Arrow shafts — these stack.", "Cross into Termenor."),
                description="authenticated Examine feedback and exit objective",
                timeout=4.0,
            )
            phases.mark("examine-complete")
            capture(client, label="ready-to-exit")

            click(client, *EXIT_CLICK)
            overworld_label = wait_for_any(
                harness,
                client,
                ("Goblin", "Rat"),
                description="visible overworld Goblin or Rat label after portal crossing",
                timeout=10.0,
            )
            wait_for_all(
                harness,
                client,
                ("▀", "[click] move · act"),
                description="overworld map and control guidance",
                timeout=3.0,
            )
            click_tab(harness, client, "Quest")
            wait_for_all(
                harness,
                client,
                ("First Steps", "✓ Complete"),
                description="visible completed First Steps Scenario",
                timeout=3.0,
            )
            completed = capture(client, label="tutorial-complete")
            if "Cross into Termenor." in completed.text:
                raise AssertionError("completed tutorial still renders the exit objective")
            phases.mark("tutorial-complete")
            harness.mark_timing("expected-visible")
            print(f"overworld label: {overworld_label}")

            harness.close_client(client)
            reconnect = authenticate(harness, "tutorial-reconnect", mode="login")
            persisted_label = wait_for_any(
                harness,
                reconnect,
                ("Goblin", "Rat"),
                description="persisted overworld label after explicit reconnect login",
                timeout=10.0,
            )
            click_tab(harness, reconnect, "Quest")
            wait_for_all(
                harness,
                reconnect,
                ("First Steps", "✓ Complete"),
                description="persisted tutorial completion after reconnect",
                timeout=4.0,
            )
            reconnected = capture(reconnect, label="reconnect-complete")
            if "Cross into Termenor." in reconnected.text:
                raise AssertionError("reconnect restored a completed objective as active")
            phases.mark("reconnect-complete")
            print(f"reconnect overworld label: {persisted_label}")
        return harness, True
    except Exception as error:
        print(f"  [FAIL] harness/scenario: {error}")
        return harness, False


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Play First Steps through the production server/client PTY",
    )
    parser.add_argument(
        "--attach",
        action="store_true",
        help="stop at the initial world and accept live harness actions",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    harness, ok = run(attach=args.attach)
    print(harness.timing_report())
    if harness.failure_artifacts is not None:
        print(f"failure artifacts: {harness.failure_artifacts}")
    if args.attach:
        print("PTY TUTORIAL ATTACH CLOSED" if ok else "PTY TUTORIAL ATTACH FAILED")
    else:
        print("PTY TUTORIAL OK" if ok else "PTY TUTORIAL FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

# Termenor — Operating Procedure

How we build "RuneScape in the terminal": a sequence of shippable vertical slices,
driven by `/goal`, one slice at a time.

## The loop (per slice)

1. Pick the next slice from `ROADMAP.md`.
2. Brainstorm → design (skip if already designed).
3. `/spec` — write the slice spec.
4. `/plan` — implementation plan.
5. `/implement` — task by task; commit per task; tests pass before each commit.
6. `/review` — review implementation against the spec.
7. `/ship` — only after review. Never push to main without review.
8. Mark the slice done in `ROADMAP.md`, then `/clear` for fresh context.

## Driving with `/goal`

- `/goal` is set to **one slice's done-criteria**, never the whole game.
- Work until the criteria hold; the Stop hook keeps us honest.
- The criteria should be concrete and checkable (tests green, demo renders, etc.).

## Rules

- **No beads / beads-planner.** Roadmap lives in `ROADMAP.md`.
- Server stays authoritative; renderer stays decoupled.
- Vertical slices, never horizontal layers — each slice is playable when done.
- Patterns before content: build an engine once (skills, NPCs), then author on top.
- Context discipline: `/compact` at 50%, `/clear` between slices, offload to subagents.
- Keep specs lean. Don't overthink.

## Tutorial Scenario verification

Install the pinned normalized-terminal dependency once:

```bash
PIP_BREAK_SYSTEM_PACKAGES=1 python3 -m pip install --user -r scripts/requirements-playtest.txt
# equivalent project recipe
just playtest-deps
```

Run the deterministic simulation and the production terminal journey separately:

```bash
bun run verify:tutorial-headless
bun run verify:tutorial

# equivalent recipes
just tutorial-headless
just tutorial
```

`verify:tutorial-headless` replays the authored `first_steps` inputs with seed `1`.
`verify:tutorial` creates a fresh temporary SQLite database, registers through the
production login screen, clicks through the production client, crosses the real
tutorial portal, then closes that client and explicitly logs in again against the
same database to verify that overworld arrival and `First Steps` completion persist.
Successful runs remove the temporary database.

For a live agent or human session, stop after the fresh initial world with:

```bash
python3 scripts/pty-tutorial-check.py --attach
```

Attach mode prints its live `/tmp/termenor-playtest-db-<suffix>/` session and
database paths plus the available `screen`, `click COL ROW`, `press KEY`,
`type TEXT`, and `quit` actions. `quit`, end-of-input, and Ctrl-C all tear down
the client and server and remove the temporary database.

Any failed PTY check retains diagnostics under
`/tmp/termenor-playtest-<UTC timestamp>-<suffix>/`: server log, raw client
bytes, normalized final and named milestone screens, action timeline, timings,
and the failure traceback. Use those artifacts to fix the production source or
the real interaction; do not weaken a visible assertion.

## State

- Slice 1: ✅ smooth multiplayer movement (merged to main).
- Slice 2: ✅ isometric renderer — elevation + collision, walk-behind, billboards (merged to main).
- Slice 3: ✅ accounts + persistence — login + SQLite save/load on a Docker volume (merged to main).
- Slice 4: ✅ chat + presence — names + public chat (merged to main).
- Slice 5: ✅ inventory + ground items — pickup/drop, persisted inventory (merged to main).
- Slice 6: ✅ NPCs — spawns + wander AI, tick-driven entity system (merged to main).
- Slice 7: ✅ combat v1 — melee, HP, death/respawn, damage splats (merged to main).
- Slice 8: ✅ woodcutting — XP/levels, tool check, tree nodes + respawn, skill engine (merged to main).
- Slice 9: ✅ skill framework — data-driven RESOURCE_TYPES + use() action; mining, fishing, firemaking, cooking (merged to main).
- Slice 10: ✅ banking + shops — persistent per-player bank + general store, server-authoritative, bank/shop panels (merged to main).
- Slice 11: ⏳ equipment + combat v2 — equipment foundation shipped (equip/unequip weapon+armour feeding flat melee combat: weapon→max hit, armour→damage reduction; modal equipment panel). Ranged/magic/prayer + combat skills deferred to follow-up slices (merged to main).
- Slice A: ✅ intent boundary — shared Intent vocabulary + IntentMsg; server intent-executor (typed handler registry + dispatch); client command line (`:` to open, history, verb registry, name resolution, did-you-mean, completions, tiered event-log skeleton). Deferred: hotkey migration onto executor, Tab key binding, standing orders (Slice B), real event tiers + single-key responses (Slice C). (merged to main)
- Slice 12: quests — next.

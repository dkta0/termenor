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

## State

- Slice 1: ✅ smooth multiplayer movement (merged to main).
- Slice 2: isometric renderer — design approved, spec next.

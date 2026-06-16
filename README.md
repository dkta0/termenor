# Termenor

**RuneScape, in your terminal.** An isometric, real-time multiplayer RPG that
renders with truecolor half-blocks over a WebSocket — click to walk, chop trees,
fight goblins, and watch other players move around you, all from a terminal tab.

> **Status: early alpha, actively built.** The engine and the first skills are
> playable today. Banking, quests, equipment, and a hosted public server are on
> the way — see the [roadmap](docs/ROADMAP.md). For now you run your own server
> (one command); it's fully playable solo or with friends on your network.

---

## Quick start

Termenor is a server plus a terminal client. Until the public server is live,
you run both — two terminals, ~10 seconds:

```bash
git clone https://github.com/dkta0/termenor
cd termenor

just server      # terminal 1 — start a local server (ws://localhost:3000)
./play           # terminal 2 — launch the game
```

`./play` checks for [Bun](https://bun.sh), installs dependencies on first run, and
opens a login screen. **Register a name and you're in.** Already running a server
elsewhere? Point at it: `./play ws://host:3000`.

> Use **ghostty** or **kitty** for crisp truecolor half-block rendering. Anything
> else still works — Termenor falls back to a plain ASCII view automatically.

## Controls

| Key | Action |
| --- | --- |
| **Click a tile** | Walk there — the server pathfinds around walls |
| **Arrow keys** | Step one tile |
| **Enter** | Open chat (Enter to send, Esc to cancel) |
| **g** | Pick up the item under you |
| **1**–**9** | Drop that inventory slot |
| **a** | Attack the nearest NPC |
| **c** | Chop / mine / fish the nearest resource |
| **f** | Light a fire (uses logs) |
| **k** | Cook (raw shrimp on a nearby fire) |

## What you can do today

- **Explore** a shared isometric world with rolling terrain, walls, and smooth
  server-authoritative movement you can click-to-path across.
- **Play together** — see other players move in real time, with name labels and
  public chat.
- **Keep your progress** — accounts persist your position, inventory, and skills
  across sessions.
- **Carry stuff** — a 28-slot inventory with items you can pick up off the ground
  and drop.
- **Fight** — NPCs wander, aggro, and hit back; combat has HP, death/respawn, and
  floating damage splats.
- **Train skills** — earn XP and levels in woodcutting, mining, fishing, firemaking,
  and cooking.

## How it works

Three small, independently tested packages talk over one JSON wire protocol:

- **`packages/protocol`** — the message types and codec; the single source of truth
  both sides share.
- **`packages/server`** — an authoritative 15 Hz game loop: A\* pathfinding, combat,
  skills, and SQLite persistence. The client never decides anything that matters.
- **`packages/client`** — netcode → an interpolating game-state model → a tiered
  terminal renderer. Data flows one way: the network layer writes state, the
  renderer only reads it.

Deeper notes live in [`CONTEXT.md`](CONTEXT.md) and [`docs/`](docs/).

## Develop

Requires [Bun](https://bun.sh). [`just`](https://github.com/casey/just) runs the
common tasks:

```bash
bun install
just server      # run the server (PORT overridable: just port=3005 server)
just client      # play normally — shows the login screen
just client-dev  # auto-login as a dev account (skips login), for testing
just check       # full gate: tests + typecheck + render/click/login smoke tests
```

`just check` is the pre-commit gate. Alongside unit and integration tests it drives
real OpenTUI clients inside pseudo-terminals and inspects the actual escape bytes —
the closest automated proxy for "does it look right in a real terminal." (Needs
`python3`.)

The project is built one vertical slice at a time; see
[`docs/OPERATING-PROCEDURE.md`](docs/OPERATING-PROCEDURE.md) and the
[roadmap](docs/ROADMAP.md).

## Rendering

Fidelity is detected from the terminal at startup:

- **halfblock** (truecolor / 256-color): draws two vertical sub-pixels per cell with
  `▀`, so interpolated movement glides instead of stepping.
- **ascii**: a glyph fallback that's always playable.

## Deploy

The server is the deployable; clients run in players' terminals.

```bash
docker compose up -d --build   # server on :3000, SQLite on a persistent volume
```

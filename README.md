# Termenor

**RuneScape, in your terminal.** An isometric, real-time multiplayer RPG that
renders with truecolor half-blocks over a WebSocket — click to walk, chop trees,
fight goblins, and watch other players move around you, all from a terminal tab.

> **Status: early alpha, actively built.** The engine and first skills are playable
> in the shared authoritative world at `termenor.dkta.dev`; see the
> [roadmap](docs/ROADMAP.md) for upcoming slices.

---

## Install & play

**Players — one line:**

```bash
curl -fsSL https://raw.githubusercontent.com/dkta0/termenor/main/install.sh | bash
termenor          # connects to wss://termenor.dkta.dev
```

This verifies and installs the latest prebuilt client from `dkta0/termenor` to
`~/.local/bin/termenor`. Launch it, register a name, and enter the shared world.
No install needed: `ssh termenor@termenor.dkta.dev` launches the same client and
shows the same in-client register/login flow.

**From source (development, or to run your own server):**

```bash
git clone https://github.com/dkta0/termenor
cd termenor && bun install

bun run server                                  # terminal 1 — local server (ws://localhost:3000)
bun run play --server ws://localhost:3000       # terminal 2 — play against it
```

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
  floating damage splats, with melee/ranged/magic styles.
- **Train every skill** — all 23 RuneScape skills carry XP and levels. Gather
  (woodcutting/mining/fishing), fight to raise the combat skills (attack, strength,
  defence, hitpoints, ranged, magic, prayer, slayer), and craft the rest (smithing,
  crafting, fletching, herblore, runecrafting, construction, cooking, firemaking,
  agility, thieving, hunter, farming) from the `:` command line — e.g. `:make bronze bar`.
- **Quest** — accept and complete quests (start with Cook's Assistant: `:talk cook`).
- **Travel** — cross portals between zones (the overworld and a cave to start).

## How it works

Three small, independently tested packages talk over one JSON wire protocol:

- **`packages/protocol`** — the message types and codec; the single source of truth
  both sides share.
- **`packages/server`** — an authoritative 15 Hz game loop: A\* pathfinding, combat,
  skills, quests, multiple zones, and a swappable store (SQLite by default, Postgres in
  production). The client never decides anything that matters.
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

## Deploy (run your own authoritative server)

The server is the deployable; players run the terminal client. One command brings up the
server backed by Postgres:

```bash
docker compose up -d --build   # server on :3000, persistence in Postgres on a volume
```

Persistence is a swappable `PlayerStore`: set `DATABASE_URL=postgres://…` for Postgres
(the compose default) or `DB_PATH=…` for a SQLite file. Bind address/port come from
`HOST` / `PORT`. Point players at your host with `termenor --server wss://your.host`.

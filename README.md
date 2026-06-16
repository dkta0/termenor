# Termenor

A RuneScape-inspired MMO that runs entirely in your terminal — isometric world,
real-time multiplayer movement, combat, gathering skills, inventory, NPCs, and a
shared persistent world. Built to dip into on a break.

## Play

```bash
git clone https://github.com/dkta0/termenor
cd termenor
./play
```

That's it — `./play` checks for [Bun](https://bun.sh), installs dependencies on
first run, connects you to the public server, and shows a login screen. Register a
name and you're in. Use **ghostty** or **kitty** for the best rendering.

Connect to a different server: `./play ws://host:3000`.

### Controls

- **Click a tile** to walk there (the server pathfinds around walls).
- **Arrow keys** step one tile.
- Gather, fight, and manage inventory with the on-screen hotkeys.

## What's in the world

- Smooth, server-authoritative multiplayer movement on an isometric tile map.
- Accounts with persistent state (position, inventory, skills).
- Public chat and nearby-player name labels.
- 28-slot inventory with ground items (pick up / drop).
- NPCs with wander AI, melee combat (HP, death/respawn, damage splats).
- Gathering skills with XP and levels: woodcutting, mining, fishing, cooking, firemaking.

See [`docs/ROADMAP.md`](docs/ROADMAP.md) for what's shipped and what's next.

## Develop

Requires [Bun](https://bun.sh).

```bash
bun install
just server     # run the server locally (ws://localhost:3000)
just client     # run a client against it (dev account via env)
just check      # full gate: tests + typecheck + render/click/login smoke
```

Architecture and contributor notes: see [`CONTEXT.md`](CONTEXT.md) and
[`docs/`](docs/).

## Rendering tiers

Fidelity scales with the terminal, detected at startup from OpenTUI's
capabilities: **halfblock** (truecolor/256-color) renders at sub-cell resolution
for smooth movement; **ascii** is the always-playable glyph fallback.

## Deploy (Docker)

```bash
docker compose up -d --build   # server on :3000
```

The server is the deployable; clients run in players' terminals.

# Termenor

A RuneScape-inspired MMO rendered in the terminal. This vertical slice delivers
smooth, server-authoritative multiplayer **movement** on a tile map — no combat,
skilling, inventory, NPCs, or economy yet. Movement first.

## Run locally

Terminal 1 — server:

```bash
bun install
bun run server                 # ws://localhost:3000  (set PORT to change)
```

Terminals 2 and 3 — two clients (use **ghostty** or **kitty** for best fidelity):

```bash
bun run client                 # connects to ws://localhost:3000
# or point at another host: bun run client ws://host:3000
# or: SERVER_URL=ws://host:3000 bun run client
```

**Click a tile** to walk there (the server pathfinds around walls);
**arrow keys** step one tile. Each client sees the other player move in real time.

## Rendering tiers

Fidelity scales with the terminal, detected at startup from OpenTUI's
capabilities:

- **halfblock** (truecolor / 256-color): sub-cell `▀` rendering at 4 px/tile, so
  interpolated movement glides smoothly.
- **ascii**: glyph fallback (`@` you, `o` others, `#` wall, `·` floor) — always
  playable.

> OpenTUI 0.4.1 reports `kitty_graphics` / `sixel` support but does not yet expose
> APIs to *drive* those protocols, so those terminals use the halfblock tier. The
> tier selector (`packages/client/src/render/tiers.ts`) is structured to add real
> image tiers when OpenTUI matures — this is the graceful degradation the design
> called for.

## Architecture

Three independently testable units, communicating over a shared wire protocol:

- `packages/protocol` — wire types + JSON codec (single source of truth).
- `packages/server` — authoritative 15 Hz game loop, A* pathfinding, `Bun.serve`
  WebSocket. Continuous (float) tile positions stream in snapshots; the static map
  is sent once on join.
- `packages/client` — `Connection` (netcode) → `GameState` (interpolating model) →
  tiered renderer. One-way data flow: the renderer only reads `GameState`; the net
  layer only writes it.

## Test

```bash
bun test                       # unit + integration (protocol, server, client, render)
bun run typecheck              # tsc --noEmit
bun run scripts/smoke.ts       # headless: two clients see each other move
bun run scripts/render-smoke.ts# headless: full render pipeline → ASCII frame
bun run verify:render          # PTY: two real OpenTUI clients, verify the actual
                               #   escape-byte output (truecolor half-block,
                               #   both players, animation on movement)
```

`verify:render` drives two real clients in pseudo-terminals and inspects the
exact bytes a terminal would paint — the closest automated proxy for "looks good
in ghostty/kitty" without a human at the keyboard. (Requires `python3`.)

## Deploy (Docker)

```bash
docker compose up -d --build   # server on :3000
```

The server is the deployable; clients run in players' terminals.

## Manual acceptance checklist

Validate in **ghostty/kitty**, then in **foot** and **Alacritty**:

- [ ] Start server + two clients.
- [ ] Each client renders the map (floor/walls) and both player sprites.
- [ ] Clicking a far tile makes the local player **glide smoothly** (not teleport)
      along a path that routes around walls.
- [ ] The other client sees that movement in real time.
- [ ] Arrow keys step the player one tile.
- [ ] ghostty/kitty show crisp half-block color; foot/Alacritty remain playable.

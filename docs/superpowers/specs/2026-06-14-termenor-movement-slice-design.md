# Termenor — Vertical Slice 1: Smooth Multiplayer Movement

**Date:** 2026-06-14
**Status:** Approved design (pending user spec review)

## Goal

A RuneScape-inspired MMO rendered entirely in the terminal, with high-quality
animation as the headline feature. This first vertical slice delivers **only**:

- A tile-based world the player walks around.
- Smooth, interpolated movement (no teleporting between tiles).
- Server-authoritative MMO core: fixed-tick loop, networked clients, multiple
  players seeing each other move in real time.

Explicitly **out of scope**: combat, skilling, inventory, NPCs, economy, chat,
persistence, accounts. Movement must feel great first.

## Locked Decisions

- **Stack:** Client = OpenTUI (Zig core, TypeScript/Bun). Server = TypeScript/Bun.
  Shared wire protocol package. Deploy = Docker on VPS, docker-compose for dev.
- **Movement model:** Click-to-move (RuneScape-authentic). Player clicks a
  destination tile; the server runs A* pathfinding and walks the player tile-by-tile.
- **Tick cadence:** Server is authoritative at **15 Hz** (~66 ms/tick). One tile
  step glides over ~200 ms. The client renders at up to 60 fps, interpolating
  between server snapshots so motion stays smooth and continuous.

## Architecture

Bun-workspaces monorepo with three independently testable units, each with a clean
interface:

```
termenor/
  packages/
    protocol/   # shared wire types — single source of truth (no runtime deps)
    server/     # authoritative world, fixed-tick loop, A* pathfinding, WS transport
    client/     # netcode + game-state model + tiered renderer (OpenTUI)
  Dockerfile
  docker-compose.yml
```

### Unit 1 — Protocol (`packages/protocol`)

The single source of truth for all messages. Pure TypeScript types plus tiny
encode/decode helpers (JSON over WebSocket for the slice). No I/O.

Client → Server:
- `Hello {}` — request to join.
- `MoveTo { x: number; y: number }` — destination tile (integer coords).

Server → Client:
- `Welcome { playerId: string; map: MapData; tickRate: number }` — sent once on join.
- `Snapshot { tick: number; players: PlayerState[] }` — broadcast each tick.

Shared types:
- `MapData { width, height, tiles: Uint8 grid }` — `0 = walkable`, `1 = blocked`.
- `PlayerState { id, x, y, facing }` — `x/y` are **continuous** tile coords (floats),
  so the client can interpolate. `facing` is a cardinal direction for sprite choice.

### Unit 2 — Server (`packages/server`)

- **World**: loads a static `MapData` (hardcoded/generated grid for the slice, e.g.
  48×48 with some blocked tiles). Static — sent once, never re-streamed.
- **Pathfinding**: A* over the 4-connected walkable grid. Pure function:
  `findPath(map, from, to) -> tile[] | null`. Independently tested.
- **Player model**: each player holds a continuous position, a current path (queue
  of tiles), a facing, and a fixed move speed (tiles/sec, chosen so one step ≈ 200 ms).
- **Game loop**: fixed 15 Hz. Each tick:
  1. Drain queued `MoveTo` intents → run A* → set the player's path (clamps/ignores
     unwalkable or out-of-bounds targets).
  2. Advance each player's continuous position along its path by `speed × dt`.
  3. Build a `Snapshot` and broadcast to all connected clients.
- **Transport**: `Bun.serve` WebSocket. On connect → assign id, send `Welcome`. On
  `MoveTo` → enqueue intent. On disconnect → remove player (next snapshot omits them).
- The game loop is decoupled from transport: the loop calls a `broadcast(snapshot)`
  sink, so it can be driven and asserted in tests with no real sockets.

### Unit 3 — Client (`packages/client`)

Three sub-components with one-way data flow: **net → model → renderer**.

- **Game-state model** (`GameState`): plain in-memory store. Holds the map, the
  local player id, and a per-player **snapshot buffer** (last 2 snapshots + timestamps)
  for interpolation. Pure data + interpolation math; no network or rendering. Method
  `samplePositions(renderTime) -> RenderPlayer[]` lerps each player between buffered
  snapshots (render time held ~1 snapshot behind latest for gap tolerance).
- **Netcode** (`Connection`): owns the WebSocket. Decodes messages and writes them
  into `GameState`. Reconnects with backoff on drop. Sends `Hello`/`MoveTo`. Testable
  against a mock socket.
- **Renderer**: tiered, selected at startup by capability detection. Each frame
  (driven by OpenTUI's render loop, ~60 fps) it reads `GameState.samplePositions(now)`
  and draws. The **static map is drawn/uploaded once**; only player sprites move via
  placement/position updates each frame — never a full-frame re-upload.

#### Renderer tiers (capability detection at startup)

Detection order, falling back on no support:
1. **Kitty graphics protocol** — query terminal; if supported, sprites are real
   images placed by image id, map uploaded once. Best fidelity, primary target
   (ghostty/kitty).
2. **Sixel** — DA query; raster sprites via sixel.
3. **Unicode half-block** — colored half-block cells (2 vertical px per cell).
4. **ASCII** — plain glyphs (`.` floor, `#` wall, `@` you, `o` others).

All four must run; fidelity scales with the terminal. A `Renderer` interface
(`init(map)`, `draw(players, camera)`, `dispose()`) has one implementation per tier.
Detection logic and the ASCII tier's output are unit-tested (render-to-string);
graphics tiers are validated manually in target terminals. For the slice, sprites
are **simple generated art** (colored shapes/glyphs per facing), not authored RS
assets — keeps scope tight while proving the pipeline.

Input: mouse click → map screen cell to tile → send `MoveTo`. SGR mouse reporting
works across all four target terminals (kitty, ghostty, foot, Alacritty). Arrow keys
provide a no-mouse fallback (single-tile `MoveTo`), which also enables headless input
testing.

## Data Flow

```
click → Connection.sendMoveTo(x,y) ──ws──▶ server enqueue
server tick: A* → advance positions → Snapshot ──ws──▶ Connection
Connection writes Snapshot → GameState buffer
render loop (60fps): GameState.samplePositions(now) → Renderer.draw()
```

## Error Handling

- Invalid `MoveTo` (out of bounds / unwalkable / no path): server ignores it; player
  stays put. No error surfaced to the slice UI beyond no movement.
- Client disconnect: server drops the player; others stop seeing it next snapshot.
- Server disconnect: client shows a "reconnecting…" state and retries with backoff;
  on reconnect it re-`Hello`s and repopulates from the next `Welcome`/`Snapshot`.
- Unsupported terminal graphics: silently falls to the next renderer tier.

## Testing Strategy

Tests exist before any unit is claimed working (per project rules).

- **protocol**: encode/decode round-trip for every message type.
- **server**: A* correctness (reachable, unreachable, straight, around obstacles);
  game loop advances a player from A→B over the expected tick count and stops; two
  players tracked independently; invalid `MoveTo` ignored; disconnect removes player.
- **client/game-state**: applying snapshots updates the buffer; `samplePositions`
  interpolates correctly at midpoints and clamps at endpoints.
- **client/netcode**: mock socket — `Hello` on open, `MoveTo` serialization, snapshot
  application, reconnect on close.
- **client/renderer**: capability detection picks the right tier from given
  env/query responses; ASCII tier renders the expected character grid.

Manual acceptance: two clients connect to one server; each watches the other walk
smoothly around the map. Looks good in ghostty/kitty; playable in foot/Alacritty.

## Deploy

- `Dockerfile`: Bun image, runs the **server** (the deployable). The client runs in
  the player's terminal locally.
- `docker-compose.yml`: brings up the server for local dev; documents how to launch
  one or more clients pointed at it.

## Success Criteria

Two clients connect to the server and watch each other walk smoothly around a tile
map — high-fidelity in ghostty/kitty, still playable in foot and Alacritty. No combat,
skilling, inventory, NPCs, or economy. Movement feels great.

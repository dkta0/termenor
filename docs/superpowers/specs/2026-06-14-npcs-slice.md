# Termenor — Vertical Slice 6: NPCs (tick-driven entity system)

Status: **spec** · Branch: `feat/npcs` · Date: 2026-06-14

## 1. Goal

The world has **NPCs** that spawn and wander. This builds the reusable, server-authoritative,
tick-driven **entity system** that later slices (combat, more NPC kinds) extend — so the
engine matters more than the content. NPCs reuse the existing pathfinding + path-following
movement. Clients see NPCs as billboards (with type-name labels), interpolated like players.

"Done" = log in and watch a goblin/rat wander around its spawn area smoothly; NPCs never walk
through walls or off their leash; movement is server-authoritative and interpolated client-side.

### Non-goals
- No combat, aggression, dialogue, or loot (slice 7+). NPCs are passive wanderers.
- No respawn-after-death (nothing dies yet). No NPC persistence (they're world-static spawns).
- No pathfinding to players / following. Pure random wander within a radius.

## 2. Success criteria (concrete & checkable)
1. **NPC types + protocol.** `protocol`: `NpcState {id,type,x,y,facing}`; `NPC_TYPES`
   registry (e.g. `goblin`, `rat`) with display name + render color. `SnapshotMsg` gains
   `npcs: NpcState[]`.
2. **Shared path-follower (tested).** Extract the player path-following math in `Game.step`
   into a pure/shared `advanceAlongPath(entity, budget)` used by BOTH players and NPCs (same
   smooth movement). Refactor must not change player behavior (existing tests stay green).
3. **Wander target selection (pure, tested).** `pickWanderTarget(map, home, radius, rng) ->
   Point | null` picks a random tile within Chebyshev/Manhattan `radius` of `home` that is
   walkable; returns null if none. `rng: () => number` is injectable for deterministic tests.
4. **Entity system in Game (tested).** `Game` holds `npcs`; `spawnNpc(type, x, y, radius)`;
   `step` advances NPC paths and runs wander AI: an idle NPC past its `nextWanderTick` picks a
   reachable wander target (via `pickWanderTarget` + `findPath`) and walks there, then idles a
   random interval. NPCs use `canStep` pathfinding (never cross walls/cliffs) and stay within
   `radius` of home. Tested: an NPC moves over ticks, stays in bounds, respects walls.
5. **Snapshot carries npcs.** `snapshot()` includes `npcs`. Server seeds a few spawns from
   `world.ts`.
6. **Client interpolation + render.** `GameState` buffers NPC snapshots and `sampleNpcs(now)`
   returns interpolated NPCs (same bracketing as players, with elevation attached). Renderer
   draws NPC billboards (type color) + name labels. NPCs occlude/are-occluded correctly
   (depth-tested like players).
7. **No regressions.** Full `bun test` green, `bun run typecheck` clean, `verify:render` green.

## 3. Architecture

### 3.1 Protocol (`packages/protocol/`)
- New `npcs.ts`: `NpcState {id:string; type:string; x:number; y:number; facing:Facing}`;
  `NPC_TYPES: Record<string,{name:string; color:[number,number,number]}>` (goblin, rat).
  Re-export from `index.ts`.
- `index.ts`: `SnapshotMsg` += `npcs: NpcState[]`. (No new client messages — NPCs are
  server-driven.) Update snapshot literals everywhere they're constructed (`game.ts`,
  `connection.ts` seed snapshot, tests) to include `npcs: []`.

### 3.2 Server
- `movement.ts` (new): `advanceAlongPath(e, budget)` where `e` has `{x,y,facing,path}` —
  the extracted path-follower (returns nothing; mutates e). `facingTo` moves here too. Pure
  except the entity mutation; unit-testable on a plain object.
- `npc.ts` (new): `pickWanderTarget(map, home, radius, rng): Point | null`; `NPC_SPEED`.
- `game.ts`:
  - `Player` step loop now calls `advanceAlongPath`.
  - `Npc` interface `{id, type, x, y, facing, path, home: Point, radius, nextWanderTick}`.
  - `npcs: Npc[]`; `spawnNpc(type, x, y, radius)` (deterministic ids `npc-1`…).
  - `step`: advance npc paths via `advanceAlongPath` (NPC_SPEED), then for each idle npc with
    `tick >= nextWanderTick`, `pickWanderTarget` (rng) → `findPath` from current → set path,
    set `nextWanderTick = tick + idle`. Constructor takes an optional `rng = Math.random`.
  - `snapshot()` includes `npcs` mapped to `NpcState`.
- `world.ts`: export `NPC_SPAWNS` (type, x, y, radius near spawn); server calls `spawnNpc` for
  each at startup.

### 3.3 Client
- `game-state.ts`: `Frame` also stores `npcs: Map<string, NpcState>`. `applySnapshot` stores
  them. `sampleNpcs(renderTime): NpcRender[]` interpolates with the SAME bracketing logic as
  players (refactor the bracket/lerp into a shared helper to avoid duplication), attaching
  elevation `h` via `sampleElevation`. `NpcRender {id,type,x,y,facing,h}`.
- `render/rasterize.ts`: `rasterizeIso(..., npcs)` (default `[]`) draws each NPC as a billboard
  in `NPC_TYPES[type].color`, depth `x+y`, with a shadow — reuse `drawBillboard`. New
  `Kind.NPC`.
- `render/renderer.ts`: sample npcs each frame, pass to `rasterizeIso`; draw NPC name labels
  (the type name) above their billboards (reuse the player-label code path).
- `tiers.ts`: add a `Kind.NPC` glyph (e.g. `"&"`).

## 4. Error handling
- `pickWanderTarget` returns null (all tiles blocked in radius) → NPC just stays idle, retries
  next interval. Never throws.
- `findPath` null for a chosen target → skip this wander, idle again.
- NPC at a tile with no valid neighbors → idle. Snapshot/interpolation tolerate npcs appearing
  and (in future) disappearing between frames (missing id → use newest).

## 5. Testing
- **Unit:** protocol round-trip (snapshot with npcs); `advanceAlongPath` (moves toward target,
  arrives, updates facing); `pickWanderTarget` (within radius, walkable, null when boxed in,
  deterministic with seeded rng); NPC type registry.
- **Server:** `Game` with seeded rng — spawn an NPC, run N ticks, assert it moved, stayed
  within radius of home, and never occupied a blocked tile; idle/wander timer transitions.
- **Client:** `sampleNpcs` interpolates between two snapshots (midpoint position); missing-in-
  one-frame npc handled.
- **Visual/PTY:** keep `verify:render` green; optionally assert an NPC color/label renders.

## 6. Sequencing (for `/plan`)
1. Protocol `npcs.ts` + `SnapshotMsg.npcs` (+ fix snapshot literals).  2. Server `movement.ts`
(extract `advanceAlongPath`, refactor player step) + tests.  3. Server `npc.ts`
(`pickWanderTarget`, NPC_SPEED) + tests.  4. `Game` npc entity system (spawn, step wander,
snapshot) + tests.  5. `world.ts` `NPC_SPAWNS` + server seeds at startup.  6. Client
`game-state` npc buffer + `sampleNpcs` + tests.  7. Renderer NPC billboards + labels +
`Kind.NPC`.  8. Integration/visual verify.  9. Review.

**Risk:** the `game-state` interpolation refactor (sharing bracket/lerp between players and
npcs) — keep player behavior identical (existing tests must stay green). And wander
determinism — thread an injectable `rng` so server tests aren't flaky.

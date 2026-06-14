# Termenor — Vertical Slice 2: Isometric Renderer

Status: **spec (approved design)** · Branch: `feat/iso-renderer` · Date: 2026-06-14

## 1. Goal

Replace the top-down pixel rasterizer with a **2:1 dimetric (isometric) renderer** that
gives Termenor its RuneScape-in-the-terminal look, while keeping the server authoritative
and the renderer decoupled. The world gains **terrain elevation**, and — per the project
mandate — elevation **ships with collision**: height and walk/climb rules are one atomic
feature, never separate.

The slice is "done" when two clients connect and walk around a rolling, walled isometric
world: terrain rises and falls, walls/objects stand up with correct walk-behind occlusion,
players are billboards with ground shadows that smoothly rise/fall over terrain, clicking a
tile moves there, and it still degrades from half-block to ASCII.

### Non-goals (explicitly out of this slice)
- No new content (NPCs, items, combat) — slices 5+.
- No kitty/sixel graphics tiers — OpenTUI 0.4.1 can't drive them; half-block + ASCII only.
- No animated terrain, water, or weather. Lighting is **static** directional only.
- No per-tile texture art beyond flat-shaded faces + a small glyph/biome palette.

## 2. Success criteria (concrete & checkable)

1. **Projection is pure + tested.** `iso.ts` maps `(tileX, tileY, height) → screenPx` and a
   ground-plane inverse; unit tests assert round-trip on `h=0` and known reference points.
2. **Elevation collision is server-authoritative + tested.** A move between tiles whose
   height delta exceeds `MAX_CLIMB` is rejected; A* never routes over a non-climbable step.
   Tests cover climb-allowed, climb-blocked, and pathfinding-around-a-cliff.
3. **Walk-behind works.** A tall wall in front of (lower screen-depth than) an entity hides
   the occluded part of that entity. Verified by a depth-buffer unit test + visual smoke.
4. **Face lighting is visible + tested.** Top/left/right faces of an extruded block get
   distinct brightness from a fixed light direction; `shade()` is unit-tested.
5. **Billboards + shadows + z-interp.** Players draw upright at their tile's interpolated
   elevation with an elliptical ground shadow; elevation interpolates smoothly between tiles
   (no popping) — same interpolation discipline as x/y today.
6. **Picking round-trips.** Clicking a rendered tile yields that tile (via a pick buffer);
   unit test asserts `pick(project(tile)) === tile` across the visible field.
7. **Tiers + degradation intact.** Half-block is primary; ASCII fallback still renders a
   legible iso scene. `selectTier` unchanged.
8. **No regressions.** Full suite green, `typecheck` clean, existing `verify:render` PTY
   smoke extended to assert iso output (and a PNG visual check produced for inspection).

## 3. Approaches considered

### A. Pixel-buffer iso — extend the current pipeline *(RECOMMENDED)*
Keep `PixelBuffer → CellGrid → halfblock/ascii → blit` untouched at the output end. Replace
only the *rasterizer*: draw iso geometry (tiles, extruded blocks, billboards, shadows) into
the existing pixel buffer using **painter's order** plus a parallel **depth buffer** (for
walk-behind) and a **pick buffer** (tileId per pixel, for picking).
- **Pros:** Reuses the entire working tier/blit/test infrastructure and the 2-tier
  abstraction. Depth + pick buffers are cheap parallel `Uint*Array`s. Lowest risk.
- **Cons:** Iso geometry rasterized at 4px/tile is coarse; tile diamonds are small. Mitigate
  by raising `PIXELS_PER_TILE` for iso (resolution is a tuning constant, not architecture).

### B. Cell-direct iso — draw diamonds straight to terminal cells
Skip the pixel buffer; emit box-drawing glyphs per cell for diamonds/walls.
- **Pros:** Crisp glyph control.
- **Cons:** Throws away the half-block vertical resolution and the working pipeline; requires
  hand-authored glyph art per face/slope; the halfblock/ascii tier split collapses. **Rejected** —
  abandons working infrastructure for marginal fidelity.

### C. True 3D / software raycaster
- **Rejected** — massive overkill for a tile game; no payoff in a character cell grid.

**Decision: Approach A.**

## 4. Architecture

### 4.1 Protocol (`packages/protocol`)
- Extend `MapData` with `heights: number[]` — row-major per-tile integer elevation (same
  length as `tiles`). Default authoring keeps most terrain at small integer steps.
- Add exported constant `MAX_CLIMB = 1` (max walkable height delta between adjacent tiles).
- `PlayerState` is **unchanged** — players stay `{id, x, y, facing}`. Elevation is derived
  client-side by sampling the heightmap at the player's (interpolated) tile. Server need not
  send z; the heightmap is static and already known to the client from `welcome`.

### 4.2 Server (`packages/server`)
- `world.ts`: author a **rolling heightmap** (smooth low-frequency variation) alongside the
  existing border walls + obstacle blocks; obstacles become raised/extruded tiles.
- `pathfinding.ts`: `isWalkable` keeps the 0/1 blocked check; add a new
  `canStep(map, from, to)` enforcing `abs(height[to] - height[from]) <= MAX_CLIMB`. A* uses
  `canStep` for neighbor expansion so routes never cross cliffs.
- `game.ts`: movement is unchanged in x/y; no z stored server-side (terrain is static).

### 4.3 Client render (`packages/client/src/render`)
New/changed modules:
- **`iso.ts` (new, pure):** `tileToScreen(x, y, h)`, `screenToGroundTile(px, py)`,
  projection constants (`TILE_W`, `TILE_H` for 2:1, `ELEV_PX` per height unit). Pure +
  heavily unit-tested. This is the heart of the slice.
- **`shade.ts` (new, pure):** `shade(rgb, face)` where face ∈ {top,left,right}; applies a
  fixed light-direction brightness multiplier per face normal.
- **`rasterize.ts` (rewrite):** iso rasterizer. Emits into `PixelBuffer` **plus** a depth
  buffer (`Float32Array`, screen-depth = `x+y+h`) and a pick buffer (`Int32Array` of tileId).
  Order: ground diamonds → extruded block faces → entity shadows → entity billboards, each
  depth-tested so nearer geometry overwrites farther (walk-behind). Adds new `Kind`s for
  block faces / shadow as needed.
- **`camera.ts` (rewrite):** iso-aware. Center viewport on the *projected* local player;
  `screenCellToTile` delegates to the **pick buffer** (robust under elevation) rather than
  inverse math.
- **`game-state.ts`:** add interpolated elevation sampling (`sampleElevation(tile)` from the
  heightmap) so billboards rise/fall smoothly — z-interpolation mirrors existing x/y interp.
- **`renderer.ts`:** wire pick buffer into mouse-down; otherwise the frame loop / blit are
  unchanged (still `cellGridFor` + `blit`).
- **`tiers.ts`:** unchanged logic; extend `COLOR`/`GLYPH` for new kinds.

### 4.4 Data flow
```
server world.ts ──heights──▶ MapData ──welcome──▶ client game-state
                                                      │ (static heightmap cached)
client frame: samplePositions(x,y) + sampleElevation ─┤
   └▶ iso rasterize (pixel + depth + pick buffers)
        └▶ cellGridFor(tier) ─▶ blit (unchanged)
mouse down ─▶ pick buffer lookup ─▶ onMoveTo(tile) ─▶ server A*(canStep)
```

## 5. Error handling
- Out-of-bounds / missing height → treat as `0`; never index past arrays.
- Pick miss (click on empty/sky pixel) → pick buffer returns sentinel `-1` → `onMoveTo`
  is not called (silent ignore, matches current unwalkable behavior).
- Degenerate terminal size (tiny/zero) → guard buffer allocation; render nothing rather than
  throw (matches current `if (!buffer || !map) return`).
- Server rejects unreachable/too-steep destinations exactly as today (`findPath` → null).

## 6. Testing approach
- **Unit (vitest, existing runner):** `iso` round-trip + reference points; `shade` per-face
  brightness ordering; `canStep` climb rules; A* routes around a cliff; depth-buffer
  occlusion (near overwrites far); pick round-trip over the field; elevation interpolation
  monotonic between two tiles.
- **Integration:** server `welcome` carries a valid `heights` array; client builds buffers
  without throwing for the default map.
- **Visual/PTY:** extend `verify:render` to boot a PTY, assert iso glyphs/structure present;
  regenerate the PNG frame for manual inspection of terrain + walk-behind.
- **Gate:** full suite green + `typecheck` clean + both smoke scripts pass before `/ship`.

## 7. Sequencing note (for `/plan`)
This is a large slice; plan it as ordered, independently-committable tasks:
1. Protocol `heights` + `MAX_CLIMB`.  2. Server heightmap + `canStep` + A* + tests.
3. `iso.ts` + tests.  4. `shade.ts` + tests.  5. iso `rasterize` w/ depth buffer + tests.
6. pick buffer + `camera`/picking + tests.  7. billboards/shadows + z-interp in game-state.
8. tiers palette + renderer wiring.  9. extend `verify:render` + PNG smoke.  10. review pass.

**Highest-risk items:** (6) height-aware picking and (5) walk-behind occlusion — build the
depth/pick buffers early and test them in isolation before layering visuals on top.

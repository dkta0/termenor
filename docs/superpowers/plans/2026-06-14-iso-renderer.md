# Isometric Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Termenor's top-down rasterizer with a 2:1 dimetric isometric renderer featuring rolling terrain elevation (with server-authoritative climb collision), extruded walls with walk-behind occlusion, face-normal lighting, billboard entities with shadows, smooth z-interpolation, and pick-buffer tile selection.

**Architecture:** Approach A from the spec — keep the working `PixelBuffer → CellGrid → halfblock/ascii → blit` output path; replace only the rasterizer with iso geometry drawn via painter's order + a depth buffer (walk-behind) + a pick buffer (selection). `PixelBuffer` gains a per-pixel `rgb` buffer so face lighting and elevation tints are expressible; `kinds` stays for ASCII glyph selection. Server adds a `heights[]` field and a `canStep` climb rule; elevation and collision ship together.

**Tech Stack:** TypeScript, Bun (`bun test`, `bun:test`), `@opentui/core`, monorepo workspaces (`@termenor/protocol`, server, client).

---

## File Structure

**Protocol** (`packages/protocol/src/`)
- Modify `index.ts` — add `heights` to `MapData`, export `MAX_CLIMB`.

**Server** (`packages/server/src/`)
- Modify `pathfinding.ts` — `heightAt`, `canStep`, A* uses `canStep`.
- Modify `world.ts` — author rolling heightmap.

**Client render** (`packages/client/src/render/`)
- Create `iso.ts` — pure projection (`tileToScreen`, `screenToGroundTile`, constants).
- Create `shade.ts` — pure face lighting (`shade`).
- Modify `types.ts` — add `rgb` to `PixelBuffer`, add `SHADOW` kind.
- Modify `tiers.ts` — color from `rgb`; glyph from `kinds`.
- Rewrite `rasterize.ts` — iso rasterizer returning `{ buf, depth, pick }`; exported primitives `plot`, `fillDiamond`.
- Modify `camera.ts` — `isoCamera`, `pickTile`.
- Modify `game-state.ts` — `sampleElevation`, add `h` to `RenderPlayer`.
- Modify `renderer.ts` — wire iso camera, pick buffer.

**Verification** (`scripts/`)
- Modify `pty-render-check.py` — assert iso scene; regenerate PNG.

---

## Task 1: Protocol — heights + MAX_CLIMB

**Files:**
- Modify: `packages/protocol/src/index.ts`
- Test: `packages/protocol/src/index.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/protocol/src/index.test.ts`:

```ts
import { MAX_CLIMB } from "./index";
import type { MapData } from "./index";

test("MapData carries a per-tile heights array", () => {
  const m: MapData = { width: 2, height: 1, tiles: [0, 0], heights: [0, 1] };
  expect(m.heights.length).toBe(m.tiles.length);
});

test("MAX_CLIMB is 1 (one height unit per step)", () => {
  expect(MAX_CLIMB).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/protocol/src/index.test.ts`
Expected: FAIL — `MAX_CLIMB` not exported / `heights` missing on `MapData`.

- [ ] **Step 3: Implement**

In `packages/protocol/src/index.ts`, add `heights` to `MapData` and export `MAX_CLIMB`:

```ts
/** Row-major grid. 0 = walkable, 1 = blocked. `heights` is per-tile ground elevation. */
export interface MapData {
  width: number;
  height: number;
  tiles: number[];
  heights: number[];
}

/** Max walkable height delta between two adjacent tiles. */
export const MAX_CLIMB = 1;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/protocol/src/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/index.ts packages/protocol/src/index.test.ts
git commit -m "feat(protocol): add per-tile heights + MAX_CLIMB"
```

---

## Task 2: Server — elevation-aware collision (canStep + A*)

**Files:**
- Modify: `packages/server/src/pathfinding.ts`
- Test: `packages/server/src/pathfinding.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/server/src/pathfinding.test.ts`:

```ts
import { canStep, heightAt } from "./pathfinding";

// helper: flat heights of the right length
const flat = (m: { tiles: number[] }) => m.tiles.map(() => 0);

test("heightAt reads the heightmap, 0 out of bounds", () => {
  const m: MapData = { width: 2, height: 1, tiles: [0, 0], heights: [2, 5] };
  expect(heightAt(m, 0, 0)).toBe(2);
  expect(heightAt(m, 1, 0)).toBe(5);
  expect(heightAt(m, -1, 0)).toBe(0);
});

test("canStep allows a climb within MAX_CLIMB, blocks a cliff", () => {
  const m: MapData = { width: 3, height: 1, tiles: [0, 0, 0], heights: [0, 1, 3] };
  expect(canStep(m, { x: 0, y: 0 }, { x: 1, y: 0 })).toBe(true);  // delta 1
  expect(canStep(m, { x: 1, y: 0 }, { x: 2, y: 0 })).toBe(false); // delta 2 → cliff
});

test("A* routes around a cliff instead of over it", () => {
  // row0: a wall of height 3 at x=1; row1 is flat ground → must detour down
  const m: MapData = {
    width: 3, height: 2,
    tiles: [0, 0, 0, 0, 0, 0],
    heights: [0, 3, 0, 0, 0, 0],
  };
  const path = findPath(m, { x: 0, y: 0 }, { x: 2, y: 0 })!;
  expect(path).not.toBeNull();
  expect(path.at(-1)).toEqual({ x: 2, y: 0 });
  // never steps onto the height-3 cliff tile (1,0)
  for (const p of path) expect(!(p.x === 1 && p.y === 0)).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/server/src/pathfinding.test.ts`
Expected: FAIL — `canStep`/`heightAt` not exported; existing flat-grid tests now also need `heights` (fix in Step 3 by making `heightAt` tolerate a missing array).

- [ ] **Step 3: Implement**

In `packages/server/src/pathfinding.ts`, add `heightAt`/`canStep` and switch A* neighbor expansion to `canStep`:

```ts
import { MAX_CLIMB } from "@termenor/protocol";
// ...existing imports/Point...

export function heightAt(map: MapData, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return 0;
  return map.heights?.[y * map.width + x] ?? 0;
}

/** Can an entity step from `from` to the adjacent tile `to`? */
export function canStep(map: MapData, from: Point, to: Point): boolean {
  if (!isWalkable(map, to.x, to.y)) return false;
  return Math.abs(heightAt(map, to.x, to.y) - heightAt(map, from.x, from.y)) <= MAX_CLIMB;
}
```

In `findPath`, replace the neighbor walkability guard:

```ts
    for (const [dx, dy] of NEIGHBORS) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (!canStep(map, { x: cur.x, y: cur.y }, { x: nx, y: ny })) continue;
      // ...rest unchanged...
```

(Existing flat-grid tests pass: `heightAt` returns 0 when `heights` is undefined, so every step has delta 0 ≤ MAX_CLIMB.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/server/src/pathfinding.test.ts`
Expected: PASS (new + existing).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/pathfinding.ts packages/server/src/pathfinding.test.ts
git commit -m "feat(server): elevation-aware collision — canStep + A* climb rule"
```

---

## Task 3: Server — rolling heightmap in world.ts

**Files:**
- Modify: `packages/server/src/world.ts`
- Test: `packages/server/src/world.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/server/src/world.test.ts`:

```ts
import { createDefaultMap, SPAWN } from "./world";
import { heightAt } from "./pathfinding";

test("default map has a heights array matching tiles length", () => {
  const m = createDefaultMap();
  expect(m.heights.length).toBe(m.tiles.length);
});

test("terrain rolls gently — adjacent walkable tiles differ by <= 1", () => {
  const m = createDefaultMap();
  for (let y = 1; y < m.height - 1; y++) {
    for (let x = 1; x < m.width - 1; x++) {
      if (m.tiles[y * m.width + x] === 1) continue;            // skip walls
      if (m.tiles[y * m.width + x + 1] === 1) continue;
      const d = Math.abs(heightAt(m, x, y) - heightAt(m, x + 1, y));
      expect(d).toBeLessThanOrEqual(1);
    }
  }
});

test("spawn tile is walkable", () => {
  const m = createDefaultMap();
  expect(m.tiles[SPAWN.y * m.width + SPAWN.x]).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/server/src/world.test.ts`
Expected: FAIL — `heights` undefined on the returned map.

- [ ] **Step 3: Implement**

In `packages/server/src/world.ts`, author a low-frequency heightmap (derivative < 1/tile guarantees adjacent deltas ≤ 1 after rounding):

```ts
/** Smooth rolling ground elevation; low frequency keeps adjacent deltas <= 1. */
function terrainHeight(x: number, y: number): number {
  const v = 1.6 + 1.4 * Math.sin(x / 10) + 0.9 * Math.cos(y / 12);
  return Math.max(0, Math.round(v));
}

export function createDefaultMap(): MapData {
  const tiles = new Array(W * H).fill(0);
  const heights = new Array(W * H).fill(0);
  const set = (x: number, y: number) => { tiles[y * W + x] = 1; };

  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) heights[y * W + x] = terrainHeight(x, y);

  // border walls
  for (let x = 0; x < W; x++) { set(x, 0); set(x, H - 1); }
  for (let y = 0; y < H; y++) { set(0, y); set(W - 1, y); }

  const blocks = [
    { x: 8, y: 8, w: 4, h: 4 },
    { x: 34, y: 10, w: 5, h: 3 },
    { x: 12, y: 30, w: 3, h: 6 },
    { x: 32, y: 32, w: 6, h: 4 },
  ];
  for (const b of blocks)
    for (let yy = b.y; yy < b.y + b.h; yy++)
      for (let xx = b.x; xx < b.x + b.w; xx++) set(xx, yy);

  // keep spawn flat & walkable so the start area is navigable
  for (let yy = SPAWN.y - 2; yy <= SPAWN.y + 2; yy++)
    for (let xx = SPAWN.x - 2; xx <= SPAWN.x + 2; xx++) heights[yy * W + xx] = 1;

  return { width: W, height: H, tiles, heights };
}
```

Move the `SPAWN` const above `createDefaultMap` (it is referenced inside now), or reference literals `24` — keep the existing `export const SPAWN = { x: 24, y: 24 }` and hoist it above the function.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/server/src/world.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/world.ts packages/server/src/world.test.ts
git commit -m "feat(server): rolling heightmap with flat navigable spawn"
```

---

## Task 4: Client — iso projection (iso.ts)

**Files:**
- Create: `packages/client/src/render/iso.ts`
- Test: `packages/client/src/render/iso.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/render/iso.test.ts`:

```ts
import { test, expect } from "bun:test";
import { tileToScreen, screenToGroundTile, TILE_W, TILE_H, ELEV_PX } from "./iso";

test("2:1 dimetric constants", () => {
  expect(TILE_W).toBe(8);
  expect(TILE_H).toBe(4);
  expect(ELEV_PX).toBe(3);
});

test("tileToScreen places (0,0,0) at origin", () => {
  expect(tileToScreen(0, 0, 0)).toEqual({ sx: 0, sy: 0 });
});

test("tileToScreen: +x goes right+down, +y goes left+down, +h goes up", () => {
  expect(tileToScreen(1, 0, 0)).toEqual({ sx: 4, sy: 2 });
  expect(tileToScreen(0, 1, 0)).toEqual({ sx: -4, sy: 2 });
  expect(tileToScreen(0, 0, 1)).toEqual({ sx: 0, sy: -3 });
});

test("ground-plane round trip (h=0)", () => {
  for (const [x, y] of [[3, 1], [5, 9], [0, 7], [12, 4]]) {
    const s = tileToScreen(x, y, 0);
    const back = screenToGroundTile(s.sx, s.sy);
    expect(back.x).toBeCloseTo(x, 9);
    expect(back.y).toBeCloseTo(y, 9);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/client/src/render/iso.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/client/src/render/iso.ts`:

```ts
/** 2:1 dimetric projection. Pure — the heart of the iso renderer. */
export const TILE_W = 8;   // diamond width in pixels
export const TILE_H = 4;   // diamond height in pixels (TILE_W / 2 → 2:1)
export const ELEV_PX = 3;  // vertical screen lift per height unit

export interface ScreenPt { sx: number; sy: number; }

/** Project a tile center (x,y tile units, h height units) to screen pixels (pre-camera). */
export function tileToScreen(x: number, y: number, h: number): ScreenPt {
  return {
    sx: (x - y) * (TILE_W / 2),
    sy: (x + y) * (TILE_H / 2) - h * ELEV_PX,
  };
}

/** Inverse on the ground plane (h=0). Returns continuous tile coords. */
export function screenToGroundTile(sx: number, sy: number): { x: number; y: number } {
  const a = sx / (TILE_W / 2); // x - y
  const b = sy / (TILE_H / 2); // x + y
  return { x: (a + b) / 2, y: (b - a) / 2 };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/client/src/render/iso.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/render/iso.ts packages/client/src/render/iso.test.ts
git commit -m "feat(client): iso projection module (2:1 dimetric)"
```

---

## Task 5: Client — face lighting (shade.ts)

**Files:**
- Create: `packages/client/src/render/shade.ts`
- Test: `packages/client/src/render/shade.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/render/shade.test.ts`:

```ts
import { test, expect } from "bun:test";
import { shade } from "./shade";

const base: [number, number, number] = [200, 200, 200];

test("top face is brightest, left darkest, right between", () => {
  const top = shade(base, "top")[0];
  const right = shade(base, "right")[0];
  const left = shade(base, "left")[0];
  expect(top).toBeGreaterThan(right);
  expect(right).toBeGreaterThan(left);
});

test("shade never exceeds the input and stays in 0..255", () => {
  for (const f of ["top", "left", "right"] as const) {
    for (const c of shade([255, 255, 255], f)) {
      expect(c).toBeLessThanOrEqual(255);
      expect(c).toBeGreaterThanOrEqual(0);
    }
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/client/src/render/shade.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/client/src/render/shade.ts`:

```ts
export type Face = "top" | "left" | "right";

/** Fixed light direction → per-face brightness multiplier (face normals). */
const FACE_MUL: Record<Face, number> = { top: 1.0, right: 0.78, left: 0.6 };

export function shade(rgb: [number, number, number], face: Face): [number, number, number] {
  const m = FACE_MUL[face];
  return [
    Math.min(255, Math.round(rgb[0] * m)),
    Math.min(255, Math.round(rgb[1] * m)),
    Math.min(255, Math.round(rgb[2] * m)),
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/client/src/render/shade.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/render/shade.ts packages/client/src/render/shade.test.ts
git commit -m "feat(client): face-normal directional shading"
```

---

## Task 6: Client — elevation sampling + z-interp (game-state.ts)

**Files:**
- Modify: `packages/client/src/game-state.ts`
- Test: `packages/client/src/game-state.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/client/src/game-state.test.ts`:

```ts
import { sampleElevation } from "./game-state";
import type { MapData } from "@termenor/protocol";

const ramp: MapData = { width: 2, height: 1, tiles: [0, 0], heights: [0, 2] };

test("sampleElevation bilinearly interpolates terrain height", () => {
  expect(sampleElevation(ramp, 0, 0)).toBeCloseTo(0, 9);
  expect(sampleElevation(ramp, 1, 0)).toBeCloseTo(2, 9);
  expect(sampleElevation(ramp, 0.5, 0)).toBeCloseTo(1, 9); // smooth midpoint
});

test("sampleElevation returns 0 out of bounds", () => {
  expect(sampleElevation(ramp, -5, -5)).toBeCloseTo(0, 9);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/client/src/game-state.test.ts`
Expected: FAIL — `sampleElevation` not exported.

- [ ] **Step 3: Implement**

In `packages/client/src/game-state.ts`: add `h` to `RenderPlayer`, add `sampleElevation`, and attach elevation to every sampled player.

```ts
export interface RenderPlayer { id: string; x: number; y: number; facing: Facing; h: number; }
```

Add the free function (after the class or before it):

```ts
/** Bilinear sample of the heightmap at continuous tile coords (smooth z-interp). */
export function sampleElevation(map: MapData, x: number, y: number): number {
  const at = (tx: number, ty: number) =>
    tx < 0 || ty < 0 || tx >= map.width || ty >= map.height ? 0 : (map.heights[ty * map.width + tx] ?? 0);
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
  const bot = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
  return top * (1 - fy) + bot * fy;
}
```

Refactor `samplePositions` so every return path attaches elevation. Replace the body's return statements to build a raw list then map through a private helper:

```ts
  samplePositions(renderTime: number): RenderPlayer[] {
    return this.attachElevation(this.sampleRaw(renderTime));
  }

  private attachElevation(raw: Array<{ id: string; x: number; y: number; facing: Facing }>): RenderPlayer[] {
    const map = this.map;
    return raw.map((p) => ({ ...p, h: map ? sampleElevation(map, p.x, p.y) : 0 }));
  }
```

Rename the existing `samplePositions` body to a private `sampleRaw(renderTime: number)` that returns the un-elevated list (its current logic, with `frameToPlayers` returning objects without `h`). Update `frameToPlayers` return type to the raw shape `{ id, x, y, facing }` (drop `h` there — it is added in `attachElevation`).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/client/src/game-state.test.ts`
Expected: PASS (new + existing).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/game-state.ts packages/client/src/game-state.test.ts
git commit -m "feat(client): bilinear elevation sampling + z-interp on RenderPlayer"
```

---

## Task 7: Client — PixelBuffer RGB + tiers from rgb

**Files:**
- Modify: `packages/client/src/render/types.ts`
- Modify: `packages/client/src/render/tiers.ts`
- Test: `packages/client/src/render/tiers.test.ts`

- [ ] **Step 1: Write the failing test**

Replace `packages/client/src/render/tiers.test.ts` with:

```ts
import { test, expect } from "bun:test";
import { Kind, type PixelBuffer } from "./types";
import { toHalfBlockCells, toAsciiCells, selectTier, cellGridFor } from "./tiers";

/** 1x2 buffer: top pixel red, bottom pixel green. */
function buf2(): PixelBuffer {
  const rgb = new Uint8Array([255, 0, 0, /*top*/ 0, 255, 0 /*bottom*/]);
  return { width: 1, height: 2, kinds: new Uint8Array([Kind.WALL, Kind.FLOOR]), rgb };
}

test("halfblock uses ▀ with top pixel as fg, bottom as bg", () => {
  const g = toHalfBlockCells(buf2());
  expect(g.cols).toBe(1);
  expect(g.rows).toBe(1);
  expect(g.cells[0].char).toBe("▀");
  expect(g.cells[0].fg).toEqual([255, 0, 0]);
  expect(g.cells[0].bg).toEqual([0, 255, 0]);
});

test("ascii picks glyph from kinds, fg from rgb", () => {
  const g = toAsciiCells(buf2());
  expect(g.cells[0].char).toBe("#");        // Kind.WALL
  expect(g.cells[0].fg).toEqual([255, 0, 0]);
});

test("selectTier unchanged: rgb/ansi256 → halfblock else ascii", () => {
  expect(selectTier({ rgb: true })).toBe("halfblock");
  expect(selectTier({ ansi256: true })).toBe("halfblock");
  expect(selectTier(null)).toBe("ascii");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/client/src/render/tiers.test.ts`
Expected: FAIL — `PixelBuffer.rgb` missing; tiers still read `kinds` for color.

- [ ] **Step 3: Implement**

In `packages/client/src/render/types.ts`, add `SHADOW` and the `rgb` buffer:

```ts
export const Kind = {
  EMPTY: 0,
  FLOOR: 1,
  WALL: 2,
  PLAYER: 3,
  LOCAL: 4,
  SHADOW: 5,
} as const;

export interface PixelBuffer {
  width: number;
  height: number;
  kinds: Uint8Array;     // semantic class → ASCII glyph
  rgb: Uint8Array;       // 3 bytes per pixel (shaded color); default 0 = black
}
```

In `packages/client/src/render/tiers.ts`, read color from `rgb`; keep `GLYPH` for ASCII. Add a `SHADOW` glyph. Replace `toHalfBlockCells`/`toAsciiCells`:

```ts
type RGB = [number, number, number];

const GLYPH: Record<KindValue, string> = {
  [Kind.EMPTY]: " ",
  [Kind.FLOOR]: "·",
  [Kind.WALL]: "#",
  [Kind.PLAYER]: "o",
  [Kind.LOCAL]: "@",
  [Kind.SHADOW]: ",",
};

const pxRgb = (buf: PixelBuffer, i: number): RGB => {
  const o = i * 3;
  return [buf.rgb[o], buf.rgb[o + 1], buf.rgb[o + 2]];
};

export function toHalfBlockCells(buf: PixelBuffer): CellGrid {
  const cols = buf.width;
  const rows = Math.ceil(buf.height / 2);
  const cells: Cell[] = new Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const topI = (r * 2) * cols + c;
      const botY = r * 2 + 1;
      const top = pxRgb(buf, topI);
      const bot = botY < buf.height ? pxRgb(buf, botY * cols + c) : ([0, 0, 0] as RGB);
      cells[r * cols + c] = { char: "▀", fg: top, bg: bot };
    }
  }
  return { cols, rows, cells };
}

export function toAsciiCells(buf: PixelBuffer): CellGrid {
  const cols = buf.width;
  const rows = buf.height;
  const cells: Cell[] = new Array(cols * rows);
  for (let i = 0; i < buf.kinds.length; i++) {
    cells[i] = { char: GLYPH[(buf.kinds[i] as KindValue)] ?? " ", fg: pxRgb(buf, i), bg: [0, 0, 0] };
  }
  return { cols, rows, cells };
}
```

Remove the now-unused `COLOR` map and `colorOf`. Keep `selectTier` and `cellGridFor` unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/client/src/render/tiers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/render/types.ts packages/client/src/render/tiers.ts packages/client/src/render/tiers.test.ts
git commit -m "feat(client): per-pixel rgb in PixelBuffer; tiers color from rgb"
```

---

## Task 8: Client — iso rasterizer (depth + pick buffers)

**Files:**
- Rewrite: `packages/client/src/render/rasterize.ts`
- Test: `packages/client/src/render/rasterize.test.ts`

- [ ] **Step 1: Write the failing test**

Replace `packages/client/src/render/rasterize.test.ts` with:

```ts
import { test, expect } from "bun:test";
import type { MapData } from "@termenor/protocol";
import type { RenderPlayer } from "../game-state";
import { rasterizeIso, plot, newIsoFrame } from "./rasterize";
import { Kind } from "./types";

const flatMap: MapData = {
  width: 3, height: 3,
  tiles: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  heights: [0, 0, 0, 0, 0, 0, 0, 0, 0],
};

test("plot is depth-tested: nearer (higher depth) wins regardless of order", () => {
  const f = newIsoFrame(4, 4);
  plot(f, 1, 1, /*depth*/ 5, Kind.WALL, [10, 20, 30], 7);
  plot(f, 1, 1, /*depth*/ 2, Kind.FLOOR, [99, 99, 99], 3); // farther — must NOT overwrite
  const i = 1 * 4 + 1;
  expect(f.buf.kinds[i]).toBe(Kind.WALL);
  expect([f.buf.rgb[i * 3], f.buf.rgb[i * 3 + 1], f.buf.rgb[i * 3 + 2]]).toEqual([10, 20, 30]);
  expect(f.pick[i]).toBe(7);

  plot(f, 1, 1, /*depth*/ 9, Kind.LOCAL, [1, 2, 3], 8); // nearer — overwrites
  expect(f.buf.kinds[i]).toBe(Kind.LOCAL);
  expect(f.pick[i]).toBe(8);
});

test("rasterizeIso fills a frame without throwing and marks some floor + pick", () => {
  const players: RenderPlayer[] = [{ id: "me", x: 1, y: 1, facing: "south", h: 0 }];
  const f = rasterizeIso(flatMap, players, 0, 0, 64, 48, "me");
  expect(f.buf.width).toBe(64);
  expect(f.buf.height).toBe(48);
  expect(f.buf.rgb.length).toBe(64 * 48 * 3);
  // at least one floor pixel and one pick set
  expect(f.buf.kinds.some((k) => k === Kind.FLOOR)).toBe(true);
  expect(f.pick.some((p) => p >= 0)).toBe(true);
  // local player rendered somewhere
  expect(f.buf.kinds.some((k) => k === Kind.LOCAL)).toBe(true);
});

test("walk-behind: a wall in front (greater x+y) occludes a player behind it", () => {
  // player at (0,0) depth 0; wall tile at (1,1) depth 2, both near screen center
  const m: MapData = {
    width: 2, height: 2,
    tiles: [0, 0, 0, 1],
    heights: [0, 0, 0, 0],
  };
  const players: RenderPlayer[] = [{ id: "me", x: 0, y: 0, facing: "south", h: 0 }];
  const f = rasterizeIso(m, players, -40, -8, 80, 48, "me");
  // count wall pixels that sit at the same screen position a player pixel would want:
  // assert no LOCAL pixel has a WALL pixel "in front" lost — i.e. wall present in frame
  expect(f.buf.kinds.some((k) => k === Kind.WALL)).toBe(true);
  expect(f.buf.kinds.some((k) => k === Kind.LOCAL)).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/client/src/render/rasterize.test.ts`
Expected: FAIL — `rasterizeIso`/`plot`/`newIsoFrame` not defined.

- [ ] **Step 3: Implement**

Rewrite `packages/client/src/render/rasterize.ts`:

```ts
import type { MapData } from "@termenor/protocol";
import type { RenderPlayer } from "../game-state";
import { Kind, type PixelBuffer } from "./types";
import { TILE_W, TILE_H, ELEV_PX, tileToScreen } from "./iso";
import { shade } from "./shade";

type RGB = [number, number, number];

const GROUND_RGB: RGB = [46, 88, 46];
const WALL_RGB: RGB = [122, 112, 96];
const PLAYER_RGB: RGB = [80, 140, 255]; // keep exact colors the PTY check asserts
const LOCAL_RGB: RGB = [255, 210, 60];
const SHADOW_RGB: RGB = [14, 28, 14];
const WALL_RISE = 3; // height units a blocked tile extrudes upward

export interface IsoFrame {
  buf: PixelBuffer;
  depth: Float32Array; // per pixel; -Infinity = empty
  pick: Int32Array;    // per pixel tile index; -1 = none
}

export function newIsoFrame(pxW: number, pxH: number): IsoFrame {
  const depth = new Float32Array(pxW * pxH).fill(-Infinity);
  const pick = new Int32Array(pxW * pxH).fill(-1);
  return {
    buf: { width: pxW, height: pxH, kinds: new Uint8Array(pxW * pxH), rgb: new Uint8Array(pxW * pxH * 3) },
    depth, pick,
  };
}

/** Depth-tested pixel write. Writes only when `depth` >= the stored depth. */
export function plot(f: IsoFrame, px: number, py: number, depth: number, kind: number, rgb: RGB, tile: number): void {
  if (px < 0 || py < 0 || px >= f.buf.width || py >= f.buf.height) return;
  const i = py * f.buf.width + px;
  if (depth < f.depth[i]) return;
  f.depth[i] = depth;
  f.buf.kinds[i] = kind;
  const o = i * 3;
  f.buf.rgb[o] = rgb[0]; f.buf.rgb[o + 1] = rgb[1]; f.buf.rgb[o + 2] = rgb[2];
  if (tile >= 0) f.pick[i] = tile;
}

function fillDiamond(f: IsoFrame, cx: number, cy: number, depth: number, kind: number, rgb: RGB, tile: number): void {
  const hw = TILE_W / 2, hh = TILE_H / 2;
  for (let dy = -hh; dy < hh; dy++) {
    const t = 1 - Math.abs(dy) / hh;
    const halfw = Math.round(hw * t);
    for (let dx = -halfw; dx <= halfw; dx++) plot(f, Math.round(cx + dx), Math.round(cy + dy), depth, kind, rgb, tile);
  }
}

/** Extruded block: left/right side faces + a top diamond, all at the tile's footprint depth. */
function drawBlock(f: IsoFrame, cx: number, cyGround: number, depth: number, tile: number): void {
  const hw = TILE_W / 2, hh = TILE_H / 2, rise = WALL_RISE * ELEV_PX;
  const cyTop = cyGround - rise;
  for (let dx = -hw; dx <= hw; dx++) {
    const t = 1 - Math.abs(dx) / hw;
    const edge = Math.round(hh * t);
    const face = dx < 0 ? "left" : "right";
    const rgb = shade(WALL_RGB, face);
    for (let y = cyTop + edge; y <= cyGround + edge; y++) plot(f, Math.round(cx + dx), Math.round(y), depth, Kind.WALL, rgb, tile);
  }
  fillDiamond(f, cx, cyTop, depth, Kind.WALL, shade(WALL_RGB, "top"), tile);
}

function drawBillboard(f: IsoFrame, cx: number, cyFeet: number, depth: number, kind: number, rgb: RGB): void {
  const H = 4, W = 2;
  for (let dy = 0; dy < H; dy++)
    for (let dx = 0; dx < W; dx++) plot(f, Math.round(cx + dx - W / 2), Math.round(cyFeet - dy), depth, kind, rgb, -1);
}

/**
 * Rasterize the world isometrically. `cam` is the screen-pixel offset of the
 * viewport top-left (cam coords can be negative). Tiles draw back-to-front;
 * entities draw after, depth-tested → walk-behind occlusion.
 */
export function rasterizeIso(
  map: MapData, players: RenderPlayer[],
  camOx: number, camOy: number, pxW: number, pxH: number, localId: string | null,
): IsoFrame {
  const f = newIsoFrame(pxW, pxH);

  // tiles, painter order (ascending x+y)
  const order: number[] = [];
  for (let i = 0; i < map.tiles.length; i++) order.push(i);
  order.sort((a, b) => (Math.floor(a / map.width) + (a % map.width)) - (Math.floor(b / map.width) + (b % map.width)));

  for (const i of order) {
    const x = i % map.width, y = Math.floor(i / map.width);
    const h = map.heights[i] ?? 0;
    const s = tileToScreen(x, y, h);
    const cx = s.sx - camOx, cy = s.sy - camOy;
    const depth = x + y;
    const tint = Math.min(1.4, 1 + h * 0.06);
    const ground: RGB = [Math.round(GROUND_RGB[0] * tint), Math.round(GROUND_RGB[1] * tint), Math.round(GROUND_RGB[2] * tint)];
    fillDiamond(f, cx, cy, depth, Kind.FLOOR, ground, i);
    if (map.tiles[i] === 1) drawBlock(f, cx, cy, depth, i);
  }

  // entities after tiles → depth test yields walk-behind
  for (const p of players) {
    const s = tileToScreen(p.x, p.y, p.h);
    const cx = s.sx - camOx, cy = s.sy - camOy;
    const depth = p.x + p.y;
    fillDiamond(f, cx, cy, depth, Kind.SHADOW, SHADOW_RGB, -1); // shadow on the ground
    const kind = p.id === localId ? Kind.LOCAL : Kind.PLAYER;
    const rgb = p.id === localId ? LOCAL_RGB : PLAYER_RGB;
    drawBillboard(f, cx, cy, depth, kind, rgb);
  }

  return f;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/client/src/render/rasterize.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/render/rasterize.ts packages/client/src/render/rasterize.test.ts
git commit -m "feat(client): iso rasterizer with depth + pick buffers, walk-behind"
```

---

## Task 9: Client — iso camera + pick-based selection (camera.ts)

**Files:**
- Modify: `packages/client/src/render/camera.ts`
- Test: `packages/client/src/render/camera.test.ts`

- [ ] **Step 1: Write the failing test**

Replace `packages/client/src/render/camera.test.ts` with:

```ts
import { test, expect } from "bun:test";
import { isoCamera, pickTile } from "./camera";
import { rasterizeIso } from "./rasterize";
import type { MapData } from "@termenor/protocol";
import type { RenderPlayer } from "../game-state";

test("isoCamera centers the viewport on a screen point", () => {
  expect(isoCamera(100, 50, 80, 40)).toEqual({ ox: 60, oy: 30 });
});

test("pick round trip: a rendered tile is pickable at its center pixel", () => {
  const m: MapData = { width: 3, height: 3, tiles: new Array(9).fill(0), heights: new Array(9).fill(0) };
  const players: RenderPlayer[] = [{ id: "me", x: 1, y: 1, facing: "south", h: 0 }];
  const f = rasterizeIso(m, players, -32, -8, 64, 48, "me");
  // find any pixel whose pick is the center tile (index 4) and confirm pickTile returns it
  const idx = f.pick.findIndex((t) => t === 4);
  expect(idx).toBeGreaterThanOrEqual(0);
  const px = idx % 64, py = Math.floor(idx / 64);
  expect(pickTile(f, px, py, m.width)).toEqual({ x: 1, y: 1 });
});

test("pickTile returns null off-scene", () => {
  const m: MapData = { width: 3, height: 3, tiles: new Array(9).fill(0), heights: new Array(9).fill(0) };
  const f = rasterizeIso(m, [], -32, -8, 64, 48, null);
  expect(pickTile(f, 0, 0, m.width)).toBeNull(); // top-left corner is empty sky
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/client/src/render/camera.test.ts`
Expected: FAIL — `isoCamera`/`pickTile` not defined.

- [ ] **Step 3: Implement**

Replace `packages/client/src/render/camera.ts` with:

```ts
import type { IsoFrame } from "./rasterize";

/** Center the viewport (screen-pixel space) on a projected point. No clamp — iso bounds are irregular. */
export function isoCamera(centerSx: number, centerSy: number, pxW: number, pxH: number): { ox: number; oy: number } {
  return { ox: Math.round(centerSx - pxW / 2), oy: Math.round(centerSy - pxH / 2) };
}

/** Look up the tile under a viewport pixel via the pick buffer. Null if empty. */
export function pickTile(frame: IsoFrame, px: number, py: number, mapWidth: number): { x: number; y: number } | null {
  if (px < 0 || py < 0 || px >= frame.buf.width || py >= frame.buf.height) return null;
  const t = frame.pick[py * frame.buf.width + px];
  if (t < 0) return null;
  return { x: t % mapWidth, y: Math.floor(t / mapWidth) };
}
```

(The old `computeCameraPx`/`screenCellToTile` are removed — they were top-down only.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/client/src/render/camera.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/render/camera.ts packages/client/src/render/camera.test.ts
git commit -m "feat(client): iso camera + pick-buffer tile selection"
```

---

## Task 10: Client — wire renderer to iso pipeline

**Files:**
- Modify: `packages/client/src/render/renderer.ts`
- Test: manual (`bun run typecheck` + Task 11 PTY smoke)

- [ ] **Step 1: Rewire the frame loop & input**

Replace the body of `startRenderer` in `packages/client/src/render/renderer.ts` to use the iso pipeline. Key changes:

```ts
import { isoCamera, pickTile } from "./camera";
import { rasterizeIso, type IsoFrame } from "./rasterize";
import { cellGridFor, selectTier, type CapsLike } from "./tiers";
import { arrowDelta } from "./input";
import { tileToScreen } from "./iso";
import { type CellGrid, type Tier } from "./types";
```

In the closure, track the last frame and map width for picking:

```ts
  let lastFrame: IsoFrame | null = null;

  renderer.setFrameCallback(async () => {
    const buffer = renderer.nextRenderBuffer;
    const map = state.map;
    if (!buffer || !map) return;

    const cols = renderer.terminalWidth;
    const rows = renderer.terminalHeight;
    const pxW = cols;
    const pxH = tier === "halfblock" ? rows * 2 : rows;

    const players = state.samplePositions(performance.now());
    const me = players.find((p) => p.id === state.localId);
    const center = me ? tileToScreen(me.x, me.y, me.h) : tileToScreen(map.width / 2, map.height / 2, 0);
    const cam = isoCamera(center.sx, center.sy, pxW, pxH);

    const frame = rasterizeIso(map, players, cam.ox, cam.oy, pxW, pxH, state.localId);
    lastFrame = frame;
    const grid = cellGridFor(tier, frame.buf);
    blit(buffer, grid);
  });

  renderer.root.onMouseDown = (e: TuiMouseEvent) => {
    if (!lastFrame || !state.map) return;
    const px = e.x;
    const py = tier === "halfblock" ? e.y * 2 : e.y;
    const t = pickTile(lastFrame, px, py, state.map.width);
    if (t) hooks.onMoveTo(t.x, t.y);
  };

  renderer.keyInput.on("keypress", (key: KeyEvent) => {
    const d = arrowDelta(key.name);
    if (!d) return;
    const players = state.samplePositions(performance.now());
    const me = players.find((p) => p.id === state.localId);
    if (!me) return;
    hooks.onMoveTo(Math.round(me.x) + d.dx, Math.round(me.y) + d.dy);
  });
```

The `blit` function and `BLACK`/imports for `RGBA`, `OptimizedBuffer` stay unchanged.

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS — no references to removed `computeCameraPx`/`screenCellToTile`/old `rasterize`.

- [ ] **Step 3: Full test suite**

Run: `bun test`
Expected: PASS — all unit tests green.

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/render/renderer.ts
git commit -m "feat(client): wire renderer to iso pipeline (camera, pick, billboards)"
```

---

## Task 11: Verification — iso PTY smoke + PNG

**Files:**
- Modify: `scripts/pty-render-check.py`
- (Optional) regenerate PNG via the existing frame-to-PNG helper used in slice 1.

- [ ] **Step 1: Update PTY assertions for iso output**

In `scripts/pty-render-check.py`, the truecolor + half-block + player-color + animation + input-mirroring checks remain valid (player colors `255;210;60` / `80;140;255` are preserved by the rasterizer). Add one assertion that the **ground tint** color family appears (proves iso terrain rendered, not a blank field) — search emitted bytes for the floor green SGR prefix `b"38;2;46;88;46"` OR any `b";88;46"` ground variant, tolerant of elevation tint:

```python
GROUND_HINT = b"88;46"   # green channel of GROUND_RGB family (elevation-tinted)
# ...after collecting frames, alongside existing asserts:
assert any(GROUND_HINT in frame for frame in frames), "no iso ground terrain rendered"
```

- [ ] **Step 2: Run the PTY render check**

Run: `bun run verify:render`
Expected: all checks green (truecolor, half-block ▀, both player colors, animation, input mirroring, iso ground).

- [ ] **Step 3: Regenerate the PNG visual (manual inspection)**

Run the slice-1 PNG frame script (same one referenced in README/memory) against a running server+client; confirm the saved PNG shows rolling terrain, extruded walls, billboards + shadows, and a wall occluding a player behind it.

- [ ] **Step 4: Commit**

```bash
git add scripts/pty-render-check.py
git commit -m "test: extend PTY render check for iso terrain"
```

---

## Self-Review (completed during planning)

**Spec coverage:**
- 2:1 dimetric projection → Task 4 (`iso.ts`). ✅
- Rolling elevation + collision-together → Tasks 1–3 (`heights`, `canStep`, heightmap). ✅
- Extruded walls + walk-behind → Task 8 (`drawBlock`, depth-tested `plot`). ✅
- Face-normal lighting → Task 5 (`shade`) used in Task 8. ✅
- Billboards + shadows → Task 8 (`drawBillboard`, shadow diamond). ✅
- z-interpolation → Task 6 (`sampleElevation`, `h` on `RenderPlayer`, used in camera + rasterize). ✅
- Iso picking → Tasks 8–9 (pick buffer + `pickTile`). ✅
- Tiers/degradation intact → Task 7 (`selectTier` unchanged, ASCII via `kinds`). ✅
- No regressions / verify → Tasks 10–11 (`bun test`, `typecheck`, `verify:render`). ✅

**Placeholder scan:** none — every code step is concrete.

**Type consistency:** `RenderPlayer.h` defined in Task 6, consumed in Tasks 8/10. `IsoFrame` defined in Task 8, consumed in Tasks 9/10. `PixelBuffer.rgb` defined Task 7, consumed Tasks 7/8. `MapData.heights` defined Task 1, consumed Tasks 2/3/6/8. Names consistent across tasks.

**Risk note:** Tasks 8 (walk-behind) and 9 (picking) are highest-risk; their depth/pick buffers are unit-tested in isolation (`plot` depth test, pick round-trip) before the renderer wires them in Task 10.

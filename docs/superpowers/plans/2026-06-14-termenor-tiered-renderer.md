# Termenor Tiered Renderer Implementation Plan (Plan B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the networked tile world in the terminal with smooth, interpolated player movement via sub-cell (half-block) rendering, degrading gracefully to ASCII; wire mouse click-to-move and arrow-key input; ship a runnable client + Dockerized server.

**Architecture:** All scene math and rasterization is **pure and headless-testable**: the world is rasterized to an in-memory pixel buffer (4 px/tile) keyed by a `kind` enum, then converted to a terminal cell grid by a per-tier converter (`halfblock` uses `▀` with fg=top-pixel / bg=bottom-pixel for 2× vertical resolution; `ascii` maps kinds to glyphs). OpenTUI is a thin blit layer: a frame callback samples `GameState` at render time, builds the cell grid, and writes it cell-by-cell. Input maps screen cells back to tiles and calls `Connection.sendMoveTo`.

**Tech Stack:** TypeScript, Bun, `@opentui/core@0.4.1` (cell-based renderer; `RGBA`, `createCliRenderer`, `OptimizedBuffer.setCell`, `renderer.capabilities`, mouse/keyboard events). Note: OpenTUI 0.4.1 exposes Kitty-graphics / Sixel only as *capability flags*, not drawing APIs — so image tiers gracefully fall to `halfblock` (documented; ready to extend when OpenTUI matures).

**Reads `GameState` / `Connection` from Plan A (`packages/client/src/game-state.ts`, `connection.ts`).**

---

### Task 1: Render constants, palette, and coordinate/camera math

**Files:**
- Create: `packages/client/src/render/types.ts`
- Create: `packages/client/src/render/camera.ts`
- Test: `packages/client/src/render/camera.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/client/src/render/camera.test.ts
import { test, expect } from "bun:test";
import { PIXELS_PER_TILE } from "./types";
import { computeCameraPx, screenCellToTile } from "./camera";

test("PIXELS_PER_TILE is 4", () => {
  expect(PIXELS_PER_TILE).toBe(4);
});

test("camera centers on target and clamps to map bounds", () => {
  // map 100px wide, viewport 20px → centered at 50 → origin 40
  expect(computeCameraPx(50, 50, 20, 20, 100, 100)).toEqual({ ox: 40, oy: 40 });
  // near left edge clamps origin to 0
  expect(computeCameraPx(2, 2, 20, 20, 100, 100)).toEqual({ ox: 0, oy: 0 });
  // near right edge clamps origin to mapPx - viewport
  expect(computeCameraPx(99, 99, 20, 20, 100, 100)).toEqual({ ox: 80, oy: 80 });
});

test("camera origin is 0 when map smaller than viewport", () => {
  expect(computeCameraPx(5, 5, 40, 40, 20, 20)).toEqual({ ox: 0, oy: 0 });
});

test("screenCellToTile inverts camera for halfblock (row→2px)", () => {
  const cam = { ox: 40, oy: 40 };
  // halfblock: pixelY = oy + row*2
  // cell (col=2,row=3) → px (42, 46) → tile (10, 11) with PPT=4
  expect(screenCellToTile(2, 3, cam, "halfblock")).toEqual({ x: 10, y: 11 });
});

test("screenCellToTile inverts camera for ascii (row→1px)", () => {
  const cam = { ox: 0, oy: 0 };
  // ascii: pixelY = oy + row
  // cell (col=8,row=8) → px (8,8) → tile (2,2)
  expect(screenCellToTile(8, 8, cam, "ascii")).toEqual({ x: 2, y: 2 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/client/src/render/camera.test.ts`
Expected: FAIL — cannot find module `./types`.

- [ ] **Step 3: Write the implementations**

```ts
// packages/client/src/render/types.ts
/** World resolution: each tile is a PIXELS_PER_TILE square of pixels. */
export const PIXELS_PER_TILE = 4;

/** Sprite blob size in pixels, centered within a tile. */
export const SPRITE_PX = 2;

/** Semantic pixel kinds, derived to color (cell tiers) or glyph (ascii). */
export const Kind = {
  EMPTY: 0,
  FLOOR: 1,
  WALL: 2,
  PLAYER: 3,
  LOCAL: 4,
} as const;
export type KindValue = (typeof Kind)[keyof typeof Kind];

/** A pixel buffer: row-major `kinds`, one byte per pixel. */
export interface PixelBuffer {
  width: number;
  height: number;
  kinds: Uint8Array;
}

export type Tier = "halfblock" | "ascii";

export interface Cell {
  char: string;
  fg: [number, number, number];
  bg: [number, number, number];
}
export interface CellGrid {
  cols: number;
  rows: number;
  cells: Cell[]; // row-major, length cols*rows
}

export interface Camera { ox: number; oy: number; } // top-left of viewport, world pixels
```

```ts
// packages/client/src/render/camera.ts
import { PIXELS_PER_TILE, type Camera, type Tier } from "./types";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Center the viewport on (centerPxX, centerPxY), clamped to the map in pixels. */
export function computeCameraPx(
  centerPxX: number, centerPxY: number,
  viewportPxW: number, viewportPxH: number,
  mapPxW: number, mapPxH: number,
): Camera {
  const rawX = Math.round(centerPxX - viewportPxW / 2);
  const rawY = Math.round(centerPxY - viewportPxH / 2);
  const maxX = Math.max(0, mapPxW - viewportPxW);
  const maxY = Math.max(0, mapPxH - viewportPxH);
  return { ox: clamp(rawX, 0, maxX), oy: clamp(rawY, 0, maxY) };
}

/** Map a clicked terminal cell back to a world tile, accounting for tier. */
export function screenCellToTile(col: number, row: number, cam: Camera, tier: Tier): { x: number; y: number } {
  const pixelX = cam.ox + col;
  const pixelY = cam.oy + (tier === "halfblock" ? row * 2 : row);
  return { x: Math.floor(pixelX / PIXELS_PER_TILE), y: Math.floor(pixelY / PIXELS_PER_TILE) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/client/src/render/camera.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/render/types.ts packages/client/src/render/camera.ts packages/client/src/render/camera.test.ts
git commit -m "feat(client/render): pixel-grid constants and camera math"
```

---

### Task 2: Scene rasterizer (world + players → pixel buffer)

**Files:**
- Create: `packages/client/src/render/rasterize.ts`
- Test: `packages/client/src/render/rasterize.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/client/src/render/rasterize.test.ts
import { test, expect } from "bun:test";
import type { MapData } from "@termenor/protocol";
import type { RenderPlayer } from "../game-state";
import { Kind, PIXELS_PER_TILE } from "./types";
import { rasterize } from "./rasterize";

// 4x2 tiles: top row walls, bottom row floor
const map: MapData = { width: 4, height: 2, tiles: [1,1,1,1, 0,0,0,0] };

function at(buf: { width: number; kinds: Uint8Array }, px: number, py: number) {
  return buf.kinds[py * buf.width + px];
}

test("rasterizes floor and wall tiles by pixel", () => {
  const cam = { ox: 0, oy: 0 };
  const buf = rasterize(map, [], cam, 16, 8, null); // whole map (4*4 x 2*4)
  expect(at(buf, 0, 0)).toBe(Kind.WALL);   // tile (0,0) is wall
  expect(at(buf, 0, 4)).toBe(Kind.FLOOR);  // tile (0,1) is floor (py=4)
});

test("draws a player sprite as LOCAL at its interpolated position", () => {
  const cam = { ox: 0, oy: 0 };
  const players: RenderPlayer[] = [{ id: "me", x: 1, y: 1, facing: "south" }];
  const buf = rasterize(map, players, cam, 16, 8, "me");
  // tile (1,1) center px = (1*4+2, 1*4+2) = (6,6); SPRITE_PX=2 centered → px (5..6, 5..6)
  expect(at(buf, 5, 5)).toBe(Kind.LOCAL);
  expect(at(buf, 6, 6)).toBe(Kind.LOCAL);
});

test("non-local players render as PLAYER", () => {
  const cam = { ox: 0, oy: 0 };
  const players: RenderPlayer[] = [{ id: "other", x: 2, y: 1, facing: "south" }];
  const buf = rasterize(map, players, cam, 16, 8, "me");
  // tile (2,1) center px = (10,6)
  expect(at(buf, 9, 5)).toBe(Kind.PLAYER);
});

test("fractional position shifts the sprite (interpolation is visible)", () => {
  const cam = { ox: 0, oy: 0 };
  const a = rasterize(map, [{ id: "me", x: 1.0, y: 1, facing: "east" }], cam, 16, 8, "me");
  const b = rasterize(map, [{ id: "me", x: 1.5, y: 1, facing: "east" }], cam, 16, 8, "me");
  // x shifts by 0.5 tile = 2 px → sprite at px 5 (a) vs px 7 (b)
  expect(a.kinds[5 * a.width + 5]).toBe(Kind.LOCAL);
  expect(b.kinds[5 * b.width + 7]).toBe(Kind.LOCAL);
  expect(PIXELS_PER_TILE).toBe(4);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/client/src/render/rasterize.test.ts`
Expected: FAIL — cannot find module `./rasterize`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/client/src/render/rasterize.ts
import type { MapData } from "@termenor/protocol";
import type { RenderPlayer } from "../game-state";
import { Kind, PIXELS_PER_TILE as PPT, SPRITE_PX, type Camera, type PixelBuffer } from "./types";

/**
 * Rasterize the visible region into a pixel buffer of `pxW`×`pxH` pixels.
 * `cam` is the world-pixel offset of the top-left. `localId` marks the
 * local player's sprite as LOCAL (vs PLAYER for others).
 */
export function rasterize(
  map: MapData, players: RenderPlayer[], cam: Camera,
  pxW: number, pxH: number, localId: string | null,
): PixelBuffer {
  const kinds = new Uint8Array(pxW * pxH); // EMPTY (0) by default

  // tiles
  for (let py = 0; py < pxH; py++) {
    const worldPy = cam.oy + py;
    const tileY = Math.floor(worldPy / PPT);
    for (let px = 0; px < pxW; px++) {
      const worldPx = cam.ox + px;
      const tileX = Math.floor(worldPx / PPT);
      if (tileX < 0 || tileY < 0 || tileX >= map.width || tileY >= map.height) continue;
      const blocked = map.tiles[tileY * map.width + tileX] === 1;
      kinds[py * pxW + px] = blocked ? Kind.WALL : Kind.FLOOR;
    }
  }

  // players on top
  const off = Math.floor((PPT - SPRITE_PX) / 2);
  for (const p of players) {
    const kind = p.id === localId ? Kind.LOCAL : Kind.PLAYER;
    const baseX = Math.round(p.x * PPT) + off - cam.ox;
    const baseY = Math.round(p.y * PPT) + off - cam.oy;
    for (let dy = 0; dy < SPRITE_PX; dy++) {
      for (let dx = 0; dx < SPRITE_PX; dx++) {
        const sx = baseX + dx;
        const sy = baseY + dy;
        if (sx < 0 || sy < 0 || sx >= pxW || sy >= pxH) continue;
        kinds[sy * pxW + sx] = kind;
      }
    }
  }

  return { width: pxW, height: pxH, kinds };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/client/src/render/rasterize.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/render/rasterize.ts packages/client/src/render/rasterize.test.ts
git commit -m "feat(client/render): rasterize world and players to a pixel buffer"
```

---

### Task 3: Tier converters (halfblock + ascii) and tier selection

**Files:**
- Create: `packages/client/src/render/tiers.ts`
- Test: `packages/client/src/render/tiers.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/client/src/render/tiers.test.ts
import { test, expect } from "bun:test";
import { Kind, type PixelBuffer } from "./types";
import { toHalfBlockCells, toAsciiCells, selectTier } from "./tiers";

// 2px wide, 2px tall: top row [FLOOR, WALL], bottom row [LOCAL, EMPTY]
const buf: PixelBuffer = {
  width: 2, height: 2,
  kinds: new Uint8Array([Kind.FLOOR, Kind.WALL, Kind.LOCAL, Kind.EMPTY]),
};

test("halfblock collapses 2 vertical pixels into one ▀ cell (fg=top,bg=bottom)", () => {
  const grid = toHalfBlockCells(buf);
  expect(grid.cols).toBe(2);
  expect(grid.rows).toBe(1); // 2 px tall → 1 cell row
  const c0 = grid.cells[0];
  expect(c0.char).toBe("▀");
  // top pixel FLOOR → fg; bottom pixel LOCAL → bg
  expect(c0.fg).toEqual([34, 68, 34]);   // FLOOR
  expect(c0.bg).toEqual([255, 210, 60]); // LOCAL
});

test("ascii maps each pixel to a glyph (1px per cell)", () => {
  const grid = toAsciiCells(buf);
  expect(grid.cols).toBe(2);
  expect(grid.rows).toBe(2);
  expect(grid.cells[0].char).toBe("·"); // FLOOR → ·
  expect(grid.cells[1].char).toBe("#");      // WALL
  expect(grid.cells[2].char).toBe("@");      // LOCAL
  expect(grid.cells[3].char).toBe(" ");      // EMPTY
});

test("selectTier prefers halfblock when color is available", () => {
  expect(selectTier({ rgb: true } as any)).toBe("halfblock");
  expect(selectTier({ rgb: false, ansi256: true } as any)).toBe("halfblock");
});

test("selectTier falls to ascii without color and on null caps", () => {
  expect(selectTier({ rgb: false, ansi256: false } as any)).toBe("ascii");
  expect(selectTier(null)).toBe("ascii");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/client/src/render/tiers.test.ts`
Expected: FAIL — cannot find module `./tiers`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/client/src/render/tiers.ts
import { Kind, type Cell, type CellGrid, type KindValue, type PixelBuffer, type Tier } from "./types";

type RGB = [number, number, number];

const COLOR: Record<KindValue, RGB> = {
  [Kind.EMPTY]: [0, 0, 0],
  [Kind.FLOOR]: [34, 68, 34],
  [Kind.WALL]: [90, 90, 100],
  [Kind.PLAYER]: [80, 140, 255],
  [Kind.LOCAL]: [255, 210, 60],
};

const GLYPH: Record<KindValue, string> = {
  [Kind.EMPTY]: " ",
  [Kind.FLOOR]: "·", // ·
  [Kind.WALL]: "#",
  [Kind.PLAYER]: "o",
  [Kind.LOCAL]: "@",
};

const colorOf = (k: number): RGB => COLOR[(k as KindValue)] ?? COLOR[Kind.EMPTY];

/** Half-block: each cell = two stacked pixels via ▀ (fg=top, bg=bottom). */
export function toHalfBlockCells(buf: PixelBuffer): CellGrid {
  const cols = buf.width;
  const rows = Math.ceil(buf.height / 2);
  const cells: Cell[] = new Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const topY = r * 2;
      const botY = topY + 1;
      const top = buf.kinds[topY * cols + c];
      const bot = botY < buf.height ? buf.kinds[botY * cols + c] : Kind.EMPTY;
      cells[r * cols + c] = { char: "▀", fg: colorOf(top), bg: colorOf(bot) };
    }
  }
  return { cols, rows, cells };
}

/** ASCII: one glyph per pixel; color carried too for color-capable fallback. */
export function toAsciiCells(buf: PixelBuffer): CellGrid {
  const cols = buf.width;
  const rows = buf.height;
  const cells: Cell[] = new Array(cols * rows);
  for (let i = 0; i < buf.kinds.length; i++) {
    const k = buf.kinds[i];
    cells[i] = { char: GLYPH[(k as KindValue)] ?? " ", fg: colorOf(k), bg: [0, 0, 0] };
  }
  return { cols, rows, cells };
}

/** Minimal capability shape we depend on (subset of OpenTUI TerminalCapabilities). */
export interface CapsLike { rgb?: boolean; ansi256?: boolean; }

/**
 * Pick the best achievable tier. OpenTUI 0.4.1 cannot drive kitty-graphics or
 * sixel even when detected, so those gracefully resolve to halfblock here.
 */
export function selectTier(caps: CapsLike | null): Tier {
  if (caps && (caps.rgb || caps.ansi256)) return "halfblock";
  return "ascii";
}

export function cellGridFor(tier: Tier, buf: PixelBuffer): CellGrid {
  return tier === "halfblock" ? toHalfBlockCells(buf) : toAsciiCells(buf);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/client/src/render/tiers.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/render/tiers.ts packages/client/src/render/tiers.test.ts
git commit -m "feat(client/render): halfblock/ascii tier converters and tier selection"
```

---

### Task 4: Input mapping (arrow-key deltas) — pure

**Files:**
- Create: `packages/client/src/render/input.ts`
- Test: `packages/client/src/render/input.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/client/src/render/input.test.ts
import { test, expect } from "bun:test";
import { arrowDelta } from "./input";

test("maps arrow key names to tile deltas", () => {
  expect(arrowDelta("ArrowUp")).toEqual({ dx: 0, dy: -1 });
  expect(arrowDelta("ArrowDown")).toEqual({ dx: 0, dy: 1 });
  expect(arrowDelta("ArrowLeft")).toEqual({ dx: -1, dy: 0 });
  expect(arrowDelta("ArrowRight")).toEqual({ dx: 1, dy: 0 });
});

test("returns null for non-arrow keys", () => {
  expect(arrowDelta("a")).toBeNull();
  expect(arrowDelta("Enter")).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/client/src/render/input.test.ts`
Expected: FAIL — cannot find module `./input`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/client/src/render/input.ts
export interface Delta { dx: number; dy: number; }

const DELTAS: Record<string, Delta> = {
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
};

/** Tile delta for an arrow-key name, or null if not an arrow. */
export function arrowDelta(name: string): Delta | null {
  return DELTAS[name] ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/client/src/render/input.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/render/input.ts packages/client/src/render/input.test.ts
git commit -m "feat(client/render): arrow-key to tile-delta mapping"
```

---

### Task 5: OpenTUI render glue (blit cell grid, mouse + keys, resize)

**Files:**
- Create: `packages/client/src/render/renderer.ts`

**Note:** This file is the thin OpenTUI integration. The logic it depends on is
already unit-tested (Tasks 1–4). It is validated **manually in a terminal**
(Task 8), since OpenTUI needs a real TTY. Keep it minimal — no logic that isn't
delegated to the tested pure modules.

- [ ] **Step 1: Write the implementation**

```ts
// packages/client/src/render/renderer.ts
import { createCliRenderer, type CliRenderer, RGBA } from "@opentui/core";
import type { GameState } from "../game-state";
import { computeCameraPx, screenCellToTile } from "./camera";
import { rasterize } from "./rasterize";
import { cellGridFor, selectTier, type CapsLike } from "./tiers";
import { PIXELS_PER_TILE as PPT, type Camera, type CellGrid, type Tier } from "./types";

export interface RendererHandle {
  stop(): void;
  tier: Tier;
}

export interface RendererHooks {
  /** Called with a destination tile when the player clicks / presses an arrow. */
  onMoveTo(x: number, y: number): void;
}

/**
 * Boots OpenTUI, drives a 60fps frame callback that samples GameState and
 * blits a cell grid. Returns a handle. Requires a real terminal.
 */
export async function startRenderer(state: GameState, hooks: RendererHooks): Promise<RendererHandle> {
  const renderer: CliRenderer = await createCliRenderer({ targetFps: 60, useMouse: true });
  const tier: Tier = selectTier((renderer.capabilities as CapsLike | null) ?? null);

  let lastCam: Camera = { ox: 0, oy: 0 };

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
    const centerX = me ? me.x * PPT + PPT / 2 : (map.width * PPT) / 2;
    const centerY = me ? me.y * PPT + PPT / 2 : (map.height * PPT) / 2;
    const cam = computeCameraPx(centerX, centerY, pxW, pxH, map.width * PPT, map.height * PPT);
    lastCam = cam;

    const buf = rasterize(map, players, cam, pxW, pxH, state.localId);
    const grid: CellGrid = cellGridFor(tier, buf);
    blit(buffer, grid);
  });

  // mouse click → move
  renderer.root.onMouseDown = (e: { x: number; y: number }) => {
    const t = screenCellToTile(e.x, e.y, lastCam, tier);
    hooks.onMoveTo(t.x, t.y);
  };

  // arrow keys → step one tile from current rounded position
  renderer.keyInput.on("keypress", (key: { name: string }) => {
    const d = arrowToDelta(key.name);
    if (!d) return;
    const players = state.samplePositions(performance.now());
    const me = players.find((p) => p.id === state.localId);
    if (!me) return;
    hooks.onMoveTo(Math.round(me.x) + d.dx, Math.round(me.y) + d.dy);
  });

  renderer.start();
  return { stop: () => renderer.destroy(), tier };
}

function blit(buffer: { setCell(x: number, y: number, ch: string, fg: RGBA, bg: RGBA): void }, grid: CellGrid): void {
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const cell = grid.cells[r * grid.cols + c];
      const fg = RGBA.fromValues(cell.fg[0], cell.fg[1], cell.fg[2], 255);
      const bg = RGBA.fromValues(cell.bg[0], cell.bg[1], cell.bg[2], 255);
      buffer.setCell(c, r, cell.char, fg, bg);
    }
  }
}

// local import to avoid a separate module dependency cycle in tests
import { arrowDelta as arrowToDelta } from "./input";
```

**Note for executor:** Confirm against the installed `@opentui/core@0.4.1` types that the frame buffer is reachable as `renderer.nextRenderBuffer` (the OptimizedBuffer for the frame). If the property name differs, use the documented alternative: add a concrete `Renderable` to `renderer.root` with a `renderBefore: (buffer, dt) => blit(buffer, grid)` option and compute `grid` in the frame callback into a shared variable. Either way, the only change is *where* `blit` is called; the pure logic is unchanged. Adjust `onMouseDown`/`keypress` registration to the exact event API if needed (see Plan B research notes: `renderer.root.onMouseDown`, `renderer.keyInput.on("keypress", ...)`).

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit`
Expected: exit 0 (fix any signature mismatches against the real OpenTUI types).

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/render/renderer.ts
git commit -m "feat(client/render): OpenTUI glue — blit cell grid, mouse and key input"
```

---

### Task 6: Client entry point

**Files:**
- Create: `packages/client/src/index.ts`

- [ ] **Step 1: Write the implementation**

```ts
// packages/client/src/index.ts
import { GameState } from "./game-state";
import { Connection } from "./connection";
import { startRenderer } from "./render/renderer";

const url = process.env.SERVER_URL ?? process.argv[2] ?? "ws://localhost:3000";

const state = new GameState();
const conn = new Connection(url, state);
conn.connect();

const handle = await startRenderer(state, {
  onMoveTo: (x, y) => conn.sendMoveTo(x, y),
});

const shutdown = () => { handle.stop(); conn.disconnect(); process.exit(0); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
```

- [ ] **Step 2: Add client run script**

In root `package.json` `scripts`, add:
```json
"client": "bun run packages/client/src/index.ts"
```

- [ ] **Step 3: Typecheck**

Run: `bunx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/index.ts package.json
git commit -m "feat(client): entry point wiring net + state + renderer"
```

---

### Task 7: Docker + docker-compose for the server

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `.dockerignore`

- [ ] **Step 1: Write the Dockerfile**

```dockerfile
# Dockerfile
FROM oven/bun:1.3.10-alpine
WORKDIR /app

# install workspace deps
COPY package.json bun.lock ./
COPY packages/protocol/package.json packages/protocol/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN bun install --frozen-lockfile --production

# source
COPY packages/protocol ./packages/protocol
COPY packages/server ./packages/server

ENV PORT=3000
EXPOSE 3000
CMD ["bun", "run", "packages/server/src/index.ts"]
```

- [ ] **Step 2: Write .dockerignore**

```
node_modules
**/node_modules
docs
.git
*.log
```

- [ ] **Step 3: Write docker-compose.yml**

```yaml
services:
  server:
    build: .
    ports:
      - "3000:3000"
    environment:
      - PORT=3000
    restart: unless-stopped
```

- [ ] **Step 4: Build and run, verify server answers**

Run: `docker compose build && docker compose up -d && sleep 3 && curl -s localhost:3000`
Expected: prints `termenor server`. Then `docker compose down`.

(If Docker is unavailable in this environment, note it and verify the server runs directly: `PORT=3000 bun run packages/server/src/index.ts &` then `curl -s localhost:3000` → `termenor server`; kill the process after.)

- [ ] **Step 5: Commit**

```bash
git add Dockerfile docker-compose.yml .dockerignore
git commit -m "build: dockerize server with docker-compose"
```

---

### Task 8: Full verification, README, and manual acceptance checklist

**Files:**
- Create: `README.md`

- [ ] **Step 1: Run the full test suite + typecheck**

Run: `bun test && bunx tsc --noEmit`
Expected: all tests PASS; tsc exit 0.

- [ ] **Step 2: Run the headless smoke (from Plan A)**

Run: `bun run scripts/smoke.ts`
Expected: prints two players, at least one off spawn, `SMOKE OK`, exit 0.

- [ ] **Step 3: Write README with run + acceptance instructions**

````markdown
# Termenor

A RuneScape-inspired MMO rendered in the terminal. Vertical slice: smooth,
server-authoritative multiplayer movement on a tile map.

## Run locally

Terminal 1 — server:
```bash
bun install
bun run server                 # ws://localhost:3000
```

Terminals 2 and 3 — two clients (use ghostty or kitty for best fidelity):
```bash
bun run client                 # connects to ws://localhost:3000
# or: bun run client ws://host:3000
```

Click a tile to walk there; arrow keys step one tile. Each client sees the
other player move in real time.

## Rendering tiers

Fidelity scales with the terminal, detected at startup:
- **halfblock** (truecolor / 256-color): sub-cell `▀` rendering, smooth motion.
- **ascii**: glyph fallback, always playable.

OpenTUI 0.4.1 reports kitty-graphics / sixel support but does not yet expose
APIs to drive them; those terminals use the halfblock tier. The tier selector
is ready to add image tiers when OpenTUI matures.

## Architecture

- `packages/protocol` — shared wire types (single source of truth).
- `packages/server` — authoritative 15 Hz loop, A* pathfinding, WebSocket.
- `packages/client` — netcode + interpolating game-state + tiered renderer.

## Test

```bash
bun test            # unit + integration
bunx tsc --noEmit   # typecheck
bun run scripts/smoke.ts   # headless two-client movement check
```
````

- [ ] **Step 4: Manual acceptance (record results in the PR/commit message)**

Checklist — run in **ghostty or kitty**, then in **foot** and **Alacritty**:
- [ ] Start server + two clients.
- [ ] Each client renders the map (floor/walls) and both players.
- [ ] Clicking a far tile makes the local player **glide smoothly** (not teleport) along a path that routes around walls.
- [ ] The other client sees that movement in real time.
- [ ] Arrow keys step the player one tile.
- [ ] ghostty/kitty show crisp half-block color; foot/Alacritty remain playable.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: README with run instructions and acceptance checklist"
```

---

## Self-Review

**Spec coverage (renderer half of the slice):**
- Tiered renderer with runtime capability detection → Task 3 (`selectTier`) + Task 5 (reads `renderer.capabilities`). Kitty/Sixel gracefully fall to halfblock — documented deviation forced by OpenTUI 0.4.1. ✅
- Runs on all tiers, fidelity scales → halfblock + ascii both implemented; selection by caps. ✅
- Smooth interpolated movement (not teleporting) → sub-cell pixel rendering at 4 px/tile + half-block (Tasks 1–3); fractional-position test proves visibility. ✅
- Never re-upload full frames every tick → static map + moving sprites are both drawn from the in-memory pixel buffer each frame via cell writes; no per-tick image upload (no image protocol in use). Map is not re-fetched (sent once in Welcome). ✅
- Decouple rendering from networking → renderer reads only from `GameState`; net writes to `GameState`; no coupling (Task 5/6). ✅
- Mouse click-to-move + arrow fallback → Task 4 (pure) + Task 5 (glue). ✅
- Renderer independently testable → Tasks 1–4 are pure and unit-tested; OpenTUI glue is the only manual-validated piece. ✅
- Deploy: Docker + docker-compose → Task 7. ✅
- Success criteria (two clients watch each other walk smoothly; great in ghostty/kitty, playable in foot/Alacritty) → Task 8 manual checklist + headless smoke. ✅

**Placeholder scan:** none — pure modules have complete code. The single glue file (Task 5) carries an explicit executor note about confirming the OpenTUI frame-buffer accessor, which is a real integration check, not a placeholder for missing logic.

**Type consistency:** `PixelBuffer`, `Cell`, `CellGrid`, `Camera`, `Tier`, `Kind` all defined in `types.ts` and used consistently across `camera.ts`, `rasterize.ts`, `tiers.ts`, `renderer.ts`. `RenderPlayer` imported from Plan A's `game-state.ts`. `selectTier`/`cellGridFor`/`screenCellToTile`/`computeCameraPx`/`rasterize`/`arrowDelta` signatures match between definition and use. `GameState` (`map`, `localId`, `samplePositions`) and `Connection` (`connect`, `sendMoveTo`, `disconnect`) match Plan A.

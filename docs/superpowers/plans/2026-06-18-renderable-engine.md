# Renderable Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded sprite/wall special-casing with one data-driven `Model`/`Scenery` engine through which buildings, props, and environment are authored as catalog data, rendered through one path, and collide via the existing tile-blocking.

**Architecture:** A shared `MODELS` catalog in `@termenor/protocol` holds two model kinds behind one interface — `billboard` (data version of the current `getSpritePixels` switch) and `block` (multi-cell volumetric structures). Models are authored as **glyph grids + palettes** (agent-readable, not RGB arrays), schema-validated at load. `MapData` gains `scenery: Scenery[]` sent at join; the server stamps each scenery's `solid` footprint into `map.tiles` so existing pathfinding blocks it for free. The client draws scenery in the tile pass with per-cell depth (`x+y`) for automatic walk-behind.

**Tech Stack:** TypeScript, Bun (test runner + workspace), monorepo packages `protocol` / `client` / `server`. Tests are `bun test`. Gate is `just check`.

## Global Constraints

- Runtime/test: `bun test`; full gate `just check` (must stay green: full suite + typecheck + 3 PTY smokes).
- Commit per task (per `CLAUDE.md`: "Commit per completed task"). Work stays on branch `feat/renderable-engine`; never push to `main`.
- Follow existing patterns: catalogs are `Record<string, Kind>` keyed by string (see `NPC_KINDS`, `RESOURCE_KINDS`); types follow ADR-0001 `*State`/`*Kind` naming.
- Glossary discipline (`CONTEXT.md`): the word "object" is banned; placed instances are **Scenery**, definitions are **Model**.
- Projection constants (do not change): `TILE_W=8`, `TILE_H=4`, `ELEV_PX=3`, `WALL_RISE=3` (in `packages/client/src/render/iso.ts` and `rasterize.ts`). Depth = `x+y`; `ENTITY_DEPTH_BIAS=2`, `WALL_DEPTH_BIAS=3`.
- No new per-tick `Snapshot` field — scenery is static, carried in `MapData` (in `WelcomeMsg`) only.
- Block models ignore `facing` in v1 (rotation deferred). `Scenery.facing` field is still kept (pre-wired seam).

---

### Task 1: Protocol — Model/Scenery types, catalog, validation

Introduces the shared data layer: types, the `MODELS` catalog (migrating every existing sprite type to a `billboard` model + adding the proof-set block/billboard models), schema validation, the collision-footprint helper, and the `MapData.scenery` field. No rendering yet.

**Files:**
- Create: `packages/protocol/src/models.ts`
- Create: `packages/protocol/src/models.test.ts`
- Modify: `packages/protocol/src/index.ts` (add `scenery` to `MapData`; re-export models)

**Interfaces:**
- Consumes: `Facing` from `./index`.
- Produces:
  - `type RGB = [number, number, number]`
  - `type PaletteEntry = RGB | "transparent" | "tint"`; `type Palette = Record<string, PaletteEntry>`
  - `interface BillboardModel { kind: "billboard"; palette: Palette; facings: { south: string[]; north?: string[]; east?: string[]; west?: string[] }; anim?: "bob" | "flicker"; flickerAlt?: string[] }`
  - `interface BlockCell { height: number; color: RGB; solid: boolean }`
  - `interface BlockModel { kind: "block"; cells: Record<string, BlockCell>; footprint: string[] }`
  - `type Model = BillboardModel | BlockModel`
  - `interface Scenery { model: string; x: number; y: number; facing?: Facing }`
  - `const MODELS: Record<string, Model>`
  - `function validateModel(key: string, m: Model): string[]`
  - `function validateAllModels(): string[]`
  - `function solidFootprint(m: Model, x: number, y: number): { x: number; y: number }[]`
  - `MapData` gains `scenery?: Scenery[]` (optional: the server always sets it; existing `MapData` literals/fixtures and `map.scenery ?? []` readers tolerate absence — avoids churning ~40 fixtures)

- [ ] **Step 1: Write the failing test** — `packages/protocol/src/models.test.ts`

```ts
import { describe, expect, test } from "bun:test";
import { MODELS, validateAllModels, validateModel, solidFootprint, type BlockModel } from "./models";

describe("MODELS catalog", () => {
  test("every existing sprite type has a model", () => {
    for (const k of ["player", "goblin", "rat", "tree", "rock", "fishing_spot", "fire", "bank_booth", "general_store"])
      expect(MODELS[k]).toBeDefined();
  });

  test("catalog passes validation", () => {
    expect(validateAllModels()).toEqual([]);
  });

  test("validateModel rejects ragged billboard rows", () => {
    const errs = validateModel("bad", { kind: "billboard", palette: { A: [1, 2, 3] }, facings: { south: ["AA", "A"] } });
    expect(errs.length).toBeGreaterThan(0);
  });

  test("validateModel rejects a footprint glyph with no cell", () => {
    const m: BlockModel = { kind: "block", cells: { W: { height: 3, color: [1, 1, 1], solid: true } }, footprint: ["WX"] };
    expect(validateModel("bad", m).length).toBeGreaterThan(0);
  });
});

describe("solidFootprint", () => {
  test("returns solid block cells offset by anchor; skips non-solid and '.'", () => {
    const m: BlockModel = {
      kind: "block",
      cells: { W: { height: 3, color: [1, 1, 1], solid: true }, r: { height: 1, color: [2, 2, 2], solid: false } },
      footprint: ["W.", "rW"],
    };
    expect(solidFootprint(m, 10, 20).sort((a, b) => a.x - b.x || a.y - b.y)).toEqual([
      { x: 10, y: 20 },
      { x: 11, y: 21 },
    ]);
  });

  test("billboard models contribute no collision", () => {
    expect(solidFootprint(MODELS.tree, 5, 5)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/protocol/src/models.test.ts`
Expected: FAIL — cannot find module `./models`.

- [ ] **Step 3: Create `packages/protocol/src/models.ts`**

```ts
import type { Facing } from "./index";

export type RGB = [number, number, number];

/** A palette maps single-char glyphs to a color, transparency, or a runtime tint.
 *  "tint" = the caller's color; "tint2" = the caller's color at 0.8 brightness
 *  (the shaded far side of a tinted body, e.g. the player torso). */
export type PaletteEntry = RGB | "transparent" | "tint" | "tint2";
export type Palette = Record<string, PaletteEntry>;

/**
 * HOW TO ADD A MODEL:
 *  - billboard: a flat sprite. `facings.south` is required; add north/east/west to
 *    differ by direction. Each entry is an array of equal-length glyph strings (top row
 *    first). Map every glyph in `palette`. "." = transparent. "tint" = caller's color
 *    (e.g. player local/other). anim "bob" = walk/idle; "flicker" + flickerAlt = 2-frame.
 *  - block: a volumetric structure. `footprint` rows are a tile grid (row = +dy, col =
 *    +dx). Each non-"." glyph maps via `cells` to {height, color, solid}. height is in
 *    ELEV_PX units (a normal wall = 3). solid:true stamps collision.
 * Then place it in the world via Scenery {model, x, y} in packages/server/src/world.ts.
 * Validation runs at server start (validateAllModels) — a bad model fails fast.
 */
export interface BillboardModel {
  kind: "billboard";
  palette: Palette;
  facings: { south: string[]; north?: string[]; east?: string[]; west?: string[] };
  anim?: "bob" | "flicker";
  flickerAlt?: string[];
  flickerMs?: number; // flicker half-period (default 150; fishing spot uses 300)
}

export interface BlockCell { height: number; color: RGB; solid: boolean }

export interface BlockModel {
  kind: "block";
  cells: Record<string, BlockCell>;
  footprint: string[];
}

export type Model = BillboardModel | BlockModel;

/** A placed instance of a Model in the world. `facing` is honored for billboards;
 *  block models ignore it in v1 (rotation deferred — field kept as a seam). */
export interface Scenery { model: string; x: number; y: number; facing?: Facing }

// ---- named colors (shared palette vocabulary) ----
const C = {
  trunk: [110, 70, 40], leaf: [40, 120, 40], lightLeaf: [40, 160, 40],
  green: [80, 160, 60], darkGreen: [50, 110, 40], eyesRed: [220, 40, 40], loincloth: [110, 70, 40],
  fur: [140, 120, 100], darkFur: [100, 85, 70], nose: [220, 120, 120],
  grey1: [120, 120, 130], grey2: [100, 100, 110], grey3: [140, 140, 150], grey4: [80, 80, 90],
  blue1: [60, 120, 200], blue2: [100, 160, 255], blue3: [40, 80, 160],
  orange: [240, 140, 30], yellow: [240, 200, 40], red: [180, 80, 20], coal: [100, 60, 30],
  gold: [240, 200, 40], brown: [110, 70, 40], darkBrown: [80, 50, 30],
  purple: [200, 120, 200], pink: [220, 150, 220],
  hair: [110, 70, 40], skin: [240, 180, 140], eyes: [40, 40, 40], boots: [60, 50, 40],
  wood: [120, 85, 50], plank: [95, 65, 38], roof: [150, 60, 50], stone: [115, 110, 105],
} as const satisfies Record<string, RGB>;

export const MODELS: Record<string, Model> = {
  // ---- migrated billboards (pixel-for-pixel equivalents of getSpritePixels) ----
  player: {
    kind: "billboard", anim: "bob",
    palette: { H: C.hair, S: C.skin, T: "tint", t: "tint2", E: C.eyes, B: C.boots, ".": "transparent" },
    facings: {
      south: ["HH", "SE", "Tt", "BB"],
      north: ["HH", "HH", "Tt", "BB"],
      east:  ["HH", "HS", "Tt", "BB"],
      west:  ["HH", "SH", "tT", "BB"],
    },
  },
  goblin: {
    kind: "billboard", anim: "bob",
    palette: { g: C.green, L: C.loincloth, E: C.eyesRed, ".": "transparent" },
    facings: {
      south: ["gg", "gE", "LL", "gg"],
      north: ["gg", "gg", "LL", "gg"],
      east:  ["gg", "gE", "LL", "gg"],
      west:  ["gg", "Eg", "LL", "gg"],
    },
  },
  rat: {
    kind: "billboard", anim: "bob",
    palette: { f: C.fur, d: C.darkFur, n: C.nose, ".": "transparent" },
    facings: {
      south: ["ff", "nf"],
      north: ["ff", "dd"],
      east:  ["fn", "df"],
      west:  ["nf", "fd"],
    },
  },
  tree: {
    kind: "billboard",
    palette: { L: C.leaf, l: C.lightLeaf, T: C.trunk },
    facings: { south: ["lL", "Ll", "LL", "TT"] },
  },
  rock: {
    kind: "billboard",
    palette: { a: C.grey1, b: C.grey2, c: C.grey3, d: C.grey4 },
    facings: { south: ["ab", "bc", "aa", "dd"] },
  },
  fishing_spot: {
    kind: "billboard", anim: "flicker", flickerMs: 300,
    palette: { a: C.blue1, b: C.blue2, c: C.blue3 },
    facings: { south: ["ab", "ba", "aa", "cc"] },
    flickerAlt: ["ba", "ab", "bb", "cc"],
  },
  fire: {
    kind: "billboard", anim: "flicker",
    palette: { o: C.orange, y: C.yellow, r: C.red, c: C.coal },
    facings: { south: ["oy", "yo", "rr", "cc"] },
    flickerAlt: ["yo", "ry", "or", "cc"],
  },
  bank_booth: {
    kind: "billboard",
    palette: { g: C.gold, b: C.brown, d: C.darkBrown },
    facings: { south: ["gg", "bb", "bb", "dd"] },
  },
  general_store: {
    kind: "billboard",
    palette: { p: C.purple, k: C.pink, b: C.brown, d: C.darkBrown },
    facings: { south: ["pk", "bb", "bb", "dd"] },
  },

  // ---- proof-set props (billboard) ----
  crate: {
    kind: "billboard",
    palette: { w: C.wood, p: C.plank, ".": "transparent" },
    facings: { south: ["ww", "pp"] },
  },
  fence: {
    kind: "billboard",
    palette: { p: C.plank, w: C.wood, ".": "transparent" },
    facings: { south: ["p.p", "www", "p.p"] },
  },

  // ---- proof-set building (block): 3x3 walls + roof with a south doorway gap ----
  small_house: {
    kind: "block",
    cells: {
      W: { height: 3, color: C.plank, solid: true },  // wall
      r: { height: 4, color: C.roof, solid: true },    // roof ridge (taller, solid)
      ".": { height: 0, color: [0, 0, 0], solid: false }, // unused (kept for clarity)
    },
    footprint: [
      "WrW",
      "W.W",
      "W.W",
    ],
  },

  // ---- proof-set environment feature (block): a raised rock cliff cluster ----
  cliff: {
    kind: "block",
    cells: { s: { height: 2, color: C.stone, solid: true }, S: { height: 3, color: C.stone, solid: true } },
    footprint: [
      "sS",
      "Ss",
    ],
  },
};

/** Validate one model. Returns an array of human-readable error strings (empty = ok). */
export function validateModel(key: string, m: Model): string[] {
  const errs: string[] = [];
  if (m.kind === "billboard") {
    const variants = Object.entries(m.facings) as [string, string[] | undefined][];
    if (!m.facings.south) errs.push(`${key}: billboard missing required 'south' facing`);
    for (const [name, rows] of variants) {
      if (!rows) continue;
      if (rows.length === 0) { errs.push(`${key}.${name}: empty`); continue; }
      const w = rows[0].length;
      for (const row of rows) {
        if (row.length !== w) errs.push(`${key}.${name}: ragged rows (expected width ${w}, got "${row}")`);
        for (const g of row) if (!(g in m.palette)) errs.push(`${key}.${name}: glyph '${g}' not in palette`);
      }
    }
  } else {
    if (m.footprint.length === 0) errs.push(`${key}: block has empty footprint`);
    const w = m.footprint[0]?.length ?? 0;
    for (const row of m.footprint) {
      if (row.length !== w) errs.push(`${key}: ragged footprint (expected width ${w}, got "${row}")`);
      for (const g of row) {
        if (g === ".") continue;
        const cell = m.cells[g];
        if (!cell) { errs.push(`${key}: footprint glyph '${g}' has no cell`); continue; }
        if (cell.height < 0) errs.push(`${key}: cell '${g}' has negative height`);
      }
    }
  }
  return errs;
}

/** Validate the whole catalog (run at server start). */
export function validateAllModels(): string[] {
  return Object.entries(MODELS).flatMap(([k, m]) => validateModel(k, m));
}

/** Tiles that block movement for a placed model at (x,y). Block-only; billboards none. */
export function solidFootprint(m: Model, x: number, y: number): { x: number; y: number }[] {
  if (m.kind !== "block") return [];
  const out: { x: number; y: number }[] = [];
  for (let r = 0; r < m.footprint.length; r++)
    for (let c = 0; c < m.footprint[r].length; c++) {
      const g = m.footprint[r][c];
      if (g === ".") continue;
      if (m.cells[g]?.solid) out.push({ x: x + c, y: y + r });
    }
  return out;
}
```

- [ ] **Step 4: Add `scenery` to `MapData` and re-export models** — `packages/protocol/src/index.ts`

Change the `MapData` interface (around line 16) to add `scenery`:

```ts
/** Row-major grid. 0 = walkable, 1 = blocked. `heights` is per-tile ground elevation. */
export interface MapData {
  width: number;
  height: number;
  tiles: number[];
  heights: number[];
  scenery?: Scenery[]; // optional: server always sets it; readers use `map.scenery ?? []`
}
```

Add the `Scenery` import at the top alongside the other type imports:

```ts
import type { Scenery } from "./models";
```

Add this re-export at the bottom next to the other `export * from` lines:

```ts
export * from "./models";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test packages/protocol/src/models.test.ts`
Expected: PASS (6 tests).

Run: `bunx tsc --noEmit -p packages/protocol` (or `just check` typecheck portion)
Expected: clean. `scenery` is optional, so existing `MapData` literals/fixtures are unaffected — no downstream typecheck cascade.

- [ ] **Step 6: Commit**

```bash
git add packages/protocol/src/models.ts packages/protocol/src/models.test.ts packages/protocol/src/index.ts
git commit -m "feat(protocol): Model/Scenery catalog + validation + MapData.scenery"
```

---

### Task 2: Client — billboard resolver + migrate `rasterize.ts` off `getSpritePixels`

Pure refactor: add a catalog-backed billboard resolver, route the existing player/NPC/resource/booth rendering through it, and delete the hardcoded `getSpritePixels` switch. No visual change — the migrated models are pixel-equivalent.

**Files:**
- Create: `packages/client/src/render/model.ts`
- Create: `packages/client/src/render/model.test.ts`
- Modify: `packages/client/src/render/rasterize.ts` (delete `getSpritePixels`; `drawBillboard` calls the resolver; pass tint)

**Interfaces:**
- Consumes: `MODELS`, `BillboardModel`, `RGB`, `Facing` from `@termenor/protocol`; `Kind`, `IsoFrame`, `plotEntity` (exported from `rasterize.ts`).
- Produces:
  - `function resolveBillboard(m: BillboardModel, facing: Facing, now: number, tint: RGB): { H: number; W: number; pixels: (RGB | null)[] }`

- [ ] **Step 1: Write the failing test** — `packages/client/src/render/model.test.ts`

```ts
import { describe, expect, test } from "bun:test";
import { MODELS, type BillboardModel } from "@termenor/protocol";
import { resolveBillboard } from "./model";

describe("resolveBillboard", () => {
  test("resolves a glyph grid to pixels, top-left first", () => {
    const m: BillboardModel = { kind: "billboard", palette: { A: [1, 2, 3], B: [4, 5, 6] }, facings: { south: ["AB"] } };
    const { H, W, pixels } = resolveBillboard(m, "south", 0, [9, 9, 9]);
    expect([H, W]).toEqual([1, 2]);
    expect(pixels).toEqual([[1, 2, 3], [4, 5, 6]]);
  });

  test("'tint' resolves to the caller color; '.' to null (transparent)", () => {
    const m = MODELS.player as BillboardModel;
    const { pixels } = resolveBillboard(m, "south", 0, [80, 140, 255]);
    expect(pixels).toContainEqual([80, 140, 255]); // tint glyph T
  });

  test("falls back to south when a facing variant is absent", () => {
    const m = MODELS.tree as BillboardModel;
    const south = resolveBillboard(m, "south", 0, [0, 0, 0]);
    const north = resolveBillboard(m, "north", 0, [0, 0, 0]);
    expect(north.pixels).toEqual(south.pixels);
  });

  test("flicker alternates frame on the time window", () => {
    const m = MODELS.fire as BillboardModel;
    const a = resolveBillboard(m, "south", 0, [0, 0, 0]);
    const b = resolveBillboard(m, "south", 150, [0, 0, 0]);
    expect(a.pixels).not.toEqual(b.pixels);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/client/src/render/model.test.ts`
Expected: FAIL — cannot find module `./model`.

- [ ] **Step 3: Create `packages/client/src/render/model.ts`**

```ts
import { type BillboardModel, type Facing, type RGB } from "@termenor/protocol";

/** Resolve a billboard model's glyph grid to a flat pixel array (row-major, top row
 *  first). null = transparent (skipped by the plotter). `tint` fills any "tint" glyph. */
export function resolveBillboard(
  m: BillboardModel, facing: Facing, now: number, tint: RGB,
): { H: number; W: number; pixels: (RGB | null)[] } {
  let rows = m.facings[facing] ?? m.facings.south;
  if (m.anim === "flicker" && m.flickerAlt && Math.floor(now / (m.flickerMs ?? 150)) % 2 === 1) rows = m.flickerAlt;
  const tint2: RGB = [Math.round(tint[0] * 0.8), Math.round(tint[1] * 0.8), Math.round(tint[2] * 0.8)];
  const H = rows.length, W = rows[0].length;
  const pixels: (RGB | null)[] = [];
  for (let r = 0; r < H; r++)
    for (let c = 0; c < W; c++) {
      const e = m.palette[rows[r][c]];
      pixels.push(
        e === undefined || e === "transparent" ? null : e === "tint" ? tint : e === "tint2" ? tint2 : e,
      );
    }
  return { H, W, pixels };
}
```

- [ ] **Step 4: Run the new test to verify it passes**

Run: `bun test packages/client/src/render/model.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Migrate `rasterize.ts` — delete `getSpritePixels`, use the resolver**

In `packages/client/src/render/rasterize.ts`:

1. Add to the imports from `@termenor/protocol` (top of file): `type BillboardModel`, `MODELS`, `type RGB` (RGB may already be a local `type RGB = [number,number,number]` — keep the local one; just import `MODELS` and `BillboardModel`).
2. Add at the top of the file (so other render modules can reuse it): `export { plot, plotEntity } from` — they are already module-local; add `export` to the `function plotEntity` declaration (`export function plotEntity(...)`).
3. **Delete** the entire `function getSpritePixels(...)` (the large switch).
4. Replace the body of `drawBillboard` so it pulls pixels from the catalog and skips null (transparent) pixels:

```ts
function drawBillboard(
  f: IsoFrame, cx: number, cyFeet: number, depth: number, kind: number, rgb: RGB,
  type: string, facing: Facing = "south", isMoving: boolean = false, now: number = 0,
): { H: number; bobY: number } {
  const model = MODELS[type];
  const bb: BillboardModel = model && model.kind === "billboard"
    ? model
    : { kind: "billboard", palette: { X: rgb }, facings: { south: ["XX", "XX", "XX", "XX"] } };
  const { H, W, pixels } = resolveBillboard(bb, facing, now, rgb);

  let bobY = 0;
  let swayX = 0;
  if (bb.anim === "bob") {
    if (isMoving) {
      const walkCycle = now * 0.015;
      bobY = -Math.abs(Math.round(Math.sin(walkCycle) * 1.0));
      swayX = Math.round(Math.cos(walkCycle) * 0.5);
    } else if (now > 0) {
      bobY = Math.round(Math.sin(now * 0.005) * 0.4);
    }
  }

  const animCx = cx + swayX;
  const animCy = cyFeet + bobY;

  let top = Math.round(animCy) - (H - 1);
  top -= top & 1; // round down to an even row (cell top)
  for (let dy = 0; dy < H; dy++) {
    for (let dx = 0; dx < W; dx++) {
      const pixelRgb = pixels[dy * W + dx];
      if (pixelRgb === null) continue; // transparent
      plotEntity(f, Math.round(animCx + dx - W / 2), top + dy, depth, kind, pixelRgb, -1);
    }
  }

  return { H, bobY };
}
```

5. Add the import at the top of `rasterize.ts`: `import { resolveBillboard } from "./model";`
6. Note: the previous `bob` gate keyed on `type === "player" || "goblin" || "rat"`. Those three models carry `anim: "bob"` in the catalog (Task 1), so behavior is identical. `fishing_spot`/`fire` carry `anim: "flicker"` (handled inside `resolveBillboard`).

- [ ] **Step 6: Run the full render suite + smokes to verify no regression**

Run: `bun test packages/client/src/render/`
Expected: PASS — including `rasterize.test.ts` (migrated sprites are pixel-equivalent).

Run: `just check`
Expected: PASS — full suite, typecheck (protocol error from Task 1 Step 5 is still pending until Task 5; if `just check` blocks, do Task 5 before this gate — see Task 1 Step 5 note), and the 3 PTY smokes (player colors `[80,140,255]`/local preserved via the `tint` glyph).

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/render/model.ts packages/client/src/render/model.test.ts packages/client/src/render/rasterize.ts
git commit -m "refactor(client): route billboards through MODELS catalog; delete getSpritePixels"
```

---

### Task 3: Client — block-model rendering + ASCII preview

Add the volumetric `block` rendering primitive (per-cell extrusion at each cell's own tile depth) and the `renderModelToAscii` text-preview helper with golden snapshots, so block models can be authored and verified without a screen.

**Files:**
- Modify: `packages/client/src/render/model.ts` (add `drawBlockModel`)
- Create: `packages/client/src/render/model-preview.ts`
- Create: `packages/client/src/render/model-preview.test.ts`
- Modify: `packages/client/src/render/model.test.ts` (add block-depth test)

**Interfaces:**
- Consumes: `MODELS`, `BlockModel`, `Model` from `@termenor/protocol`; `IsoFrame`, `plot`, `Kind` from `rasterize.ts`/`types.ts`; `tileToScreen`, `TILE_W`, `TILE_H`, `ELEV_PX` from `iso.ts`; `shade` from `shade.ts`; `MapData` from protocol.
- Produces:
  - `function drawBlockModel(f: IsoFrame, m: BlockModel, ax: number, ay: number, map: MapData, camOx: number, camOy: number): void`
  - `function renderModelToAscii(m: Model, facing?: Facing): string`

- [ ] **Step 1: Write the failing tests** — append to `packages/client/src/render/model.test.ts`

```ts
import { newIsoFrame } from "./rasterize";
import { drawBlockModel } from "./model";
import { Kind } from "./types";
import type { BlockModel, MapData } from "@termenor/protocol";

function flatMap(w: number, h: number): MapData {
  return { width: w, height: h, tiles: new Array(w * h).fill(0), heights: new Array(w * h).fill(0), scenery: [] };
}

describe("drawBlockModel", () => {
  test("writes WALL-kind pixels for a two-cell column", () => {
    const m: BlockModel = {
      kind: "block",
      cells: { W: { height: 3, color: [120, 120, 120], solid: true } },
      footprint: ["W", "W"], // a back cell (dy0) and a front cell (dy1)
    };
    const f = newIsoFrame(64, 64);
    drawBlockModel(f, m, 4, 4, flatMap(16, 16), -32, -8);
    let wallPixels = 0;
    for (const k of f.buf.kinds) if (k === Kind.WALL) wallPixels++;
    expect(wallPixels).toBeGreaterThan(0);
  });

  test("the front cell (greater x+y) wins the depth test where columns overlap", () => {
    const m: BlockModel = {
      kind: "block",
      cells: { W: { height: 3, color: [120, 120, 120], solid: true } },
      footprint: ["W", "W"],
    };
    const f = newIsoFrame(64, 64);
    drawBlockModel(f, m, 4, 4, flatMap(16, 16), -32, -8);
    // max stored depth equals the front cell's depth (4+5 + BLOCK_DEPTH_BIAS=3 = 12)
    let maxDepth = -Infinity;
    for (const d of f.depth) if (d > maxDepth) maxDepth = d;
    expect(maxDepth).toBe(12);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test packages/client/src/render/model.test.ts`
Expected: FAIL — `drawBlockModel` is not exported.

- [ ] **Step 3: Implement `drawBlockModel`** — append to `packages/client/src/render/model.ts`

Add imports at the top of `model.ts`:

```ts
import { type BlockModel, type Model, type MapData } from "@termenor/protocol";
import { TILE_W, TILE_H, ELEV_PX, tileToScreen } from "./iso";
import { shade } from "./shade";
import { Kind } from "./types";
import { newIsoFrame, plot, type IsoFrame } from "./rasterize";
```

(`newIsoFrame`, `plot` must be exported from `rasterize.ts` — add `export` to both if not already. `plot` currently is `export function plot`; confirm and add `export` to `newIsoFrame` if missing — it is already exported.)

Then add:

```ts
const BLOCK_DEPTH_BIAS = 3; // matches WALL_DEPTH_BIAS so scenery occludes like walls

/** Draw a single extruded cell column at tile (tx,ty), ground at screen (cx,cyGround). */
function drawCellColumn(
  f: IsoFrame, cx: number, cyGround: number, depth: number, height: number, color: RGB, tile: number,
): void {
  const hw = TILE_W / 2, hh = TILE_H / 2, rise = height * ELEV_PX;
  const cyTop = cyGround - rise;
  for (let dx = -hw; dx <= hw; dx++) {
    const t = 1 - Math.abs(dx) / hw;
    const edge = Math.round(hh * t);
    const face = dx < 0 ? "left" : "right";
    const faceRgb = shade(color, face);
    for (let y = cyTop + edge; y <= cyGround + edge; y++) plot(f, Math.round(cx + dx), Math.round(y), depth, Kind.WALL, faceRgb, tile);
  }
  // top diamond
  for (let dy = -hh; dy <= hh; dy++) {
    const tt = 1 - Math.abs(dy) / hh;
    const halfw = Math.ceil(hw * tt);
    for (let dx = -halfw; dx <= halfw; dx++) plot(f, Math.round(cx + dx), Math.round(cyTop + dy), depth, Kind.WALL, shade(color, "top"), tile);
  }
}

/** Draw a block model placed with its top-left footprint cell anchored at tile (ax,ay). */
export function drawBlockModel(
  f: IsoFrame, m: BlockModel, ax: number, ay: number, map: MapData, camOx: number, camOy: number,
): void {
  for (let r = 0; r < m.footprint.length; r++)
    for (let c = 0; c < m.footprint[r].length; c++) {
      const g = m.footprint[r][c];
      if (g === ".") continue;
      const cell = m.cells[g];
      if (!cell) continue;
      const tx = ax + c, ty = ay + r;
      const h = map.heights[ty * map.width + tx] ?? 0;
      const s = tileToScreen(tx, ty, h);
      drawCellColumn(f, s.sx - camOx, s.sy - camOy, tx + ty + BLOCK_DEPTH_BIAS, cell.height, cell.color, ty * map.width + tx);
    }
}
```

- [ ] **Step 4: Run to verify the block test passes**

Run: `bun test packages/client/src/render/model.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the ASCII-preview failing test** — `packages/client/src/render/model-preview.test.ts`

```ts
import { describe, expect, test } from "bun:test";
import { MODELS } from "@termenor/protocol";
import { renderModelToAscii } from "./model-preview";

describe("renderModelToAscii", () => {
  test("billboard renders a glyph block with '.' for transparent", () => {
    const out = renderModelToAscii(MODELS.fence, "south");
    expect(out).toBe("#.#\n###\n#.#");
  });

  test("block renders its footprint with cell glyphs and '.' gaps", () => {
    const out = renderModelToAscii(MODELS.small_house);
    expect(out).toBe("###\n#.#\n#.#");
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `bun test packages/client/src/render/model-preview.test.ts`
Expected: FAIL — cannot find module `./model-preview`.

- [ ] **Step 7: Implement `renderModelToAscii`** — `packages/client/src/render/model-preview.ts`

```ts
import { type Model, type Facing } from "@termenor/protocol";

/** Text dump of a model so an agent can SEE what it authored without a screen.
 *  '#' = a drawn pixel/cell, '.' = transparent/empty. Newline-separated rows. */
export function renderModelToAscii(m: Model, facing: Facing = "south"): string {
  const rows = m.kind === "billboard" ? (m.facings[facing] ?? m.facings.south) : m.footprint;
  return rows
    .map((row) => Array.from(row).map((g) => (g === "." ? "." : "#")).join(""))
    .join("\n");
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `bun test packages/client/src/render/model-preview.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 9: Commit**

```bash
git add packages/client/src/render/model.ts packages/client/src/render/model.test.ts packages/client/src/render/model-preview.ts packages/client/src/render/model-preview.test.ts
git commit -m "feat(client): block-model rendering + renderModelToAscii preview"
```

---

### Task 4: Client — render `MapData.scenery` in the tile pass

Wire scenery into `rasterizeIso`: draw block + billboard scenery after the terrain pass with per-cell depth, and suppress the generic grey wall block on tiles a block scenery covers (so the model owns its footprint visually).

**Files:**
- Modify: `packages/client/src/render/rasterize.ts` (draw scenery; suppress wall block on covered tiles)
- Modify: `packages/client/src/render/rasterize.test.ts` (scenery render test)

**Interfaces:**
- Consumes: `MODELS`, `MapData` (now with `scenery`) from protocol; `drawBlockModel` from `model.ts`; existing `drawBillboard`, `tileToScreen`.
- Produces: `rasterizeIso` now renders `map.scenery` (no signature change — reads from `map`).

- [ ] **Step 1: Write the failing test** — append to `packages/client/src/render/rasterize.test.ts`

```ts
import { MODELS } from "@termenor/protocol";

test("scenery: a block building renders wall pixels and suppresses the grey wall block under it", () => {
  // a 1x1 map region with the house placed; tiles under the footprint are marked blocked
  const W = 8, H = 8;
  const tiles = new Array(W * H).fill(0);
  // stamp the small_house solid footprint (3x3, anchor 2,2) as blocked
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    if (MODELS.small_house.kind === "block" && MODELS.small_house.footprint[r][c] !== ".") tiles[(2 + r) * W + (2 + c)] = 1;
  }
  const map = { width: W, height: H, tiles, heights: new Array(W * H).fill(0), scenery: [{ model: "small_house", x: 2, y: 2 }] };
  const frame = rasterizeIso(map as any, [], 0, 0, 96, 96, null);
  let wall = 0;
  for (const k of frame.buf.kinds) if (k === 2 /* Kind.WALL */) wall++;
  expect(wall).toBeGreaterThan(0); // the house drew
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test packages/client/src/render/rasterize.test.ts`
Expected: FAIL — `rasterizeIso` does not yet read `map.scenery` (or scenery type mismatch).

- [ ] **Step 3: Implement scenery rendering in `rasterizeIso`** — `packages/client/src/render/rasterize.ts`

1. Add import: `import { drawBlockModel } from "./model";` and ensure `MODELS` is imported from protocol.
2. Before the tile loop, build the set of tiles a block scenery covers:

```ts
  // tiles owned by a block scenery — suppress the generic grey wall block there
  const sceneryTiles = new Set<number>();
  for (const sc of map.scenery ?? []) {
    const model = MODELS[sc.model];
    if (model?.kind !== "block") continue;
    for (let r = 0; r < model.footprint.length; r++)
      for (let c = 0; c < model.footprint[r].length; c++)
        if (model.footprint[r][c] !== ".") sceneryTiles.add((sc.y + r) * map.width + (sc.x + c));
  }
```

3. In the tile loop, change the wall-block line to skip suppressed tiles:

```ts
    if (map.tiles[i] === 1 && !sceneryTiles.has(i)) drawBlock(f, cx, cy, depth + WALL_DEPTH_BIAS, i);
    else if (map.tiles[i] !== 1) drawSkirt(f, cx, cy, ELEV_PX, shade(ground, "left"), depth, i);
```

4. After the tile loop and BEFORE the players loop, draw scenery:

```ts
  // scenery — static world geometry, drawn after terrain so depth test gives walk-behind
  for (const sc of map.scenery ?? []) {
    const model = MODELS[sc.model];
    if (!model) continue;
    if (model.kind === "block") {
      drawBlockModel(f, model, sc.x, sc.y, map, camOx, camOy);
    } else {
      const h = map.heights[sc.y * map.width + sc.x] ?? 0;
      const s = tileToScreen(sc.x, sc.y, h);
      drawBillboard(f, s.sx - camOx, s.sy - camOy, sc.x + sc.y + ENTITY_DEPTH_BIAS, Kind.NPC, [200, 200, 200], sc.model, sc.facing ?? "south", false, now);
    }
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test packages/client/src/render/rasterize.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full render suite + gate**

Run: `bun test packages/client/src/render/` then `just check`
Expected: PASS (scenery defaults to `[]` everywhere it's not set; no regression).

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/render/rasterize.ts packages/client/src/render/rasterize.test.ts
git commit -m "feat(client): render MapData.scenery with walk-behind; suppress wall block under scenery"
```

---

### Task 5: Server — place the proof set, stamp collision, validate at start

Define the proof-set `Scenery` in the world, stamp each `solid` footprint into `map.tiles` (reusing existing pathfinding collision), include `scenery` in the returned `MapData`, and validate the catalog at server start. This is the end-to-end gate: scenery reaches the client and blocks movement.

**Files:**
- Modify: `packages/server/src/world.ts` (add `SCENERY`; stamp footprints; return `scenery`)
- Modify: `packages/server/src/world.test.ts` (footprint-blocks-movement test)
- Modify: `packages/server/src/server.ts` (call `validateAllModels()` at start; fail fast)

**Interfaces:**
- Consumes: `MODELS`, `solidFootprint`, `validateAllModels`, `type Scenery`, `MapData` from `@termenor/protocol`.
- Produces: `createDefaultMap()` returns a `MapData` whose `scenery` is populated and whose `tiles` include the stamped solid footprints; exported `SCENERY: Scenery[]`.

- [ ] **Step 1: Write the failing test** — append to `packages/server/src/world.test.ts`

```ts
import { MODELS, solidFootprint } from "@termenor/protocol";

test("createDefaultMap places scenery and stamps solid footprints as blocked tiles", () => {
  const map = createDefaultMap();
  expect(map.scenery.length).toBeGreaterThan(0);
  // every solid footprint cell of every block scenery is blocked (tiles === 1)
  for (const sc of map.scenery) {
    for (const cell of solidFootprint(MODELS[sc.model], sc.x, sc.y)) {
      expect(map.tiles[cell.y * map.width + cell.x]).toBe(1);
    }
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test packages/server/src/world.test.ts`
Expected: FAIL — `map.scenery` is undefined.

- [ ] **Step 3: Add scenery + stamping to `world.ts`**

Add the import at the top:

```ts
import type { MapData, Scenery } from "@termenor/protocol";
import { MODELS, solidFootprint } from "@termenor/protocol";
```

Add the proof-set placements (kept clear of spawn at 24,24 and the seeded entities):

```ts
/** Static scenery placed in the world (proof set for the renderable engine). */
export const SCENERY: Scenery[] = [
  { model: "small_house", x: 28, y: 26 }, // 3x3 building, walk-behind + collision
  { model: "cliff",       x: 18, y: 18 }, // environment feature (raised rock cluster)
  { model: "crate",       x: 26, y: 23 }, // prop (decorative)
  { model: "fence",       x: 27, y: 23 }, // prop (decorative)
];
```

In `createDefaultMap`, after the `heights` array is built and before `return`, stamp solid footprints and attach scenery:

```ts
  // stamp scenery solid footprints into tiles so existing pathfinding blocks them
  for (const sc of SCENERY)
    for (const cell of solidFootprint(MODELS[sc.model], sc.x, sc.y))
      if (cell.x >= 0 && cell.y >= 0 && cell.x < W && cell.y < H) tiles[cell.y * W + cell.x] = 1;

  return { width: W, height: H, tiles, heights, scenery: SCENERY };
```

- [ ] **Step 4: Validate the catalog at server start** — `packages/server/src/server.ts`

Add near the top of the server bootstrap (after imports, before the world/listen setup). First find where the server starts (e.g. the top-level setup). Add:

```ts
import { validateAllModels } from "@termenor/protocol";

const modelErrors = validateAllModels();
if (modelErrors.length > 0) {
  console.error("Invalid models in catalog:\n" + modelErrors.join("\n"));
  throw new Error(`Model catalog validation failed (${modelErrors.length} error(s))`);
}
```

(Place this as a module-level guard so a bad model crashes startup with a clear message rather than rendering wrong.)

- [ ] **Step 5: Run to verify tests pass**

Run: `bun test packages/server/src/world.test.ts`
Expected: PASS.

- [ ] **Step 6: Full gate**

Run: `just check`
Expected: PASS — full suite + typecheck (the Task 1 `MapData.scenery` requirement is now satisfied in `world.ts`) + 3 PTY smokes. The PTY smokes now also render scenery; if a smoke asserts an exact full-screen frame that scenery shifts, update that golden expectation in the smoke to include the building (scenery placements above are kept away from the smoke's asserted player-color pixels).

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/world.ts packages/server/src/world.test.ts packages/server/src/server.ts
git commit -m "feat(server): place proof-set scenery, stamp collision footprints, validate catalog at start"
```

---

### Task 6: Docs — glossary terms + ADR

Ratify the `Model`/`Scenery` vocabulary into `CONTEXT.md` and record the architectural decision in a new ADR. (Docs span the whole slice, so they land last as their own reviewable gate.)

**Files:**
- Modify: `CONTEXT.md` (add Model + Scenery to the glossary)
- Create: `docs/adr/0003-renderable-models.md`

**Interfaces:** none (documentation).

- [ ] **Step 1: Add glossary entries to `CONTEXT.md`**

Under the appropriate section (alongside Resource/Fire in the "Entities" or a new "World objects" subsection), add:

```markdown
**Model**:
A reusable render + collision definition in the shared catalog (`MODELS`), keyed by a
string. Two kinds: a `billboard` (flat glyph-grid sprite) or a `block` (footprint of
extruded cells). A Model is a *definition*, never a placed thing.
_Avoid_: sprite, mesh, asset.

**Scenery**:
A placed instance of a Model in the world — a building, prop, or environment feature.
Carried in `MapData` at join (static). A block Scenery's solid cells block movement.
_Avoid_: object, prop (as a type name), entity (Scenery is not server-ticked).
```

- [ ] **Step 2: Write the ADR** — `docs/adr/0003-renderable-models.md`

```markdown
# ADR-0003: Renderable Models and Scenery

## Status
Accepted (2026-06-18)

## Context
World objects were special-cased: a thing was either a single-tile extruded wall block
or a flat billboard whose pixels lived in a hardcoded `getSpritePixels` switch. There
was no shared, data-driven way to author buildings, props, or environment features, and
agents (the primary change vector) could not add one without editing the rasterizer.

## Decision
Introduce one catalog of `Model` definitions (`@termenor/protocol`) with two kinds behind
one interface: `billboard` (data-driven glyph-grid sprite) and `block` (footprint of
extruded cells). Placed instances are `Scenery`, carried in `MapData` at join. Models are
authored as glyph grids + palettes (agent-readable), schema-validated at server start,
and previewable as text via `renderModelToAscii`. A block Scenery's `solid` footprint is
stamped into `map.tiles` so existing pathfinding handles collision unchanged.

## Consequences
- Adding a building/prop/environment piece is a single catalog edit + a `Scenery`
  placement — no rasterizer changes.
- Deferred (additive) seams: voxel stacks (extensible block-cell), block-model rotation
  (`Scenery.facing` kept), in-game editor (mutates `Scenery[]`).
- Deferred (needs new plumbing): stateful objects require a per-tick scenery-state
  channel in `Snapshot`; the Model/Scenery abstraction itself is reused unchanged.
- Interaction is unchanged: scenery reuses the existing proximity + intent path.
```

- [ ] **Step 3: Verify the gate is still green**

Run: `just check`
Expected: PASS (docs-only change).

- [ ] **Step 4: Commit**

```bash
git add CONTEXT.md docs/adr/0003-renderable-models.md
git commit -m "docs: ratify Model/Scenery glossary terms + ADR-0003"
```

---

## Self-Review

**Spec coverage:**
- Core abstraction (`Model`/`Scenery`, two kinds) → Task 1. ✓
- Data flow (`MapData.scenery` at join, server stamps collision) → Task 1 (field) + Task 5 (stamp). ✓
- Interaction unchanged → no task touches the intent/proximity path. ✓ (asserted, not modified)
- Glyph-grid + palette authoring → Task 1 catalog format. ✓
- Renderer integration (delete `getSpritePixels`, new files, draw scenery, anchor-tile pick) → Tasks 2/3/4. ✓ (pick: scenery cells/billboards write their tile index via `plot`'s `tile` arg.)
- Validation at load → Task 1 (`validateAllModels`) + Task 5 (called at start). ✓
- `renderModelToAscii` + golden tests → Task 3. ✓
- Future-proof seams (`Scenery.facing`, extensible block-cell) → Task 1 types. ✓
- Proof set (1 building + 2 props + 1 environment feature + migrate existing) → catalog (Task 1) + placements (Task 5); migration (Task 2). ✓
- File split (don't bloat `rasterize.ts`/`renderer.ts`) → new `model.ts`, `model-preview.ts`; catalog in protocol. ✓
- Tests + `just check` gate → every task. ✓
- Docs (CONTEXT.md + ADR + recipe-in-header) → Task 6 + recipe comment in `models.ts` (Task 1). ✓
- YAGNI cuts honored (no voxel stacks, no block rotation, no stateful objects, no editor). ✓

**Placeholder scan:** No TBD/TODO; every code step has real code. The one soft spot — `rasterize.test.ts`/PTY-smoke golden expectations may shift when scenery is added (Task 4 Step 1 / Task 5 Step 6) — is called out with the exact remediation (placements are kept away from asserted pixels; update goldens if a full-frame assertion shifts).

**Type consistency:** `resolveBillboard`/`drawBlockModel`/`renderModelToAscii`/`solidFootprint`/`validateAllModels` signatures match across the tasks that define and consume them. `MapData.scenery` is added in Task 1 and consumed in Tasks 4/5. `MODELS` keys used in placements (`small_house`, `cliff`, `crate`, `fence`) are all defined in Task 1's catalog. `plot`/`plotEntity`/`newIsoFrame` are exported from `rasterize.ts` for `model.ts` to consume (Task 2 Step 5.2 / Task 3 Step 3).

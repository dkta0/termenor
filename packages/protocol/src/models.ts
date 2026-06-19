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

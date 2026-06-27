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
  walk?: { south: string[]; north?: string[]; east?: string[]; west?: string[] }; // 2nd frame shown while moving
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
  trunk: [92, 63, 40], leaf: [63, 107, 46], lightLeaf: [86, 134, 62],
  green: [111, 158, 74], darkGreen: [70, 118, 46], eyesRed: [200, 60, 50], loincloth: [120, 86, 48],
  fur: [150, 124, 96], darkFur: [108, 88, 68], nose: [206, 150, 140],
  grey1: [138, 130, 118], grey2: [116, 108, 98], grey3: [156, 148, 134], grey4: [92, 86, 78],
  blue1: [47, 106, 122], blue2: [86, 150, 168], blue3: [36, 86, 104],
  orange: [232, 146, 46], yellow: [240, 200, 70], red: [176, 74, 36], coal: [90, 58, 34],
  gold: [216, 176, 74], brown: [120, 86, 48], darkBrown: [88, 60, 36],
  purple: [150, 96, 168], pink: [196, 150, 190],
  hair: [96, 64, 40], skin: [224, 188, 150], eyes: [40, 36, 30], boots: [70, 56, 40],
  wood: [120, 86, 48], plank: [95, 65, 38], roof: [150, 66, 52], stone: [122, 112, 98],
  white: [236, 236, 228], apron: [224, 216, 202],
} as const satisfies Record<string, RGB>;

export const MODELS: Record<string, Model> = {
  player: {
    kind: "billboard", anim: "bob",
    palette: { H: C.hair, S: C.skin, T: "tint", t: "tint2", E: C.eyes, B: C.boots, ".": "transparent" },
    facings: {
      south: ["..HHH..", ".HHHHH.", ".HSSSH.", "..SES..", ".TTTTT.", ".TTTTT.", "TTTTTTT", "TtTTTtT", ".TTTTT.", ".TTTTT.", ".TT.TT.", ".BB.BB."],
    },
    walk: {
      south: ["..HHH..", ".HHHHH.", ".HSSSH.", "..SES..", ".TTTTT.", ".TTTTT.", "TTTTTTT", "TtTTTtT", ".TTTTT.", ".TTTTT.", "TT.TT..", "BB.BB.."],
    },
  },
  goblin: {
    kind: "billboard", anim: "bob",
    palette: { g: C.green, d: C.darkGreen, L: C.loincloth, E: C.eyesRed, ".": "transparent" },
    facings: {
      south: ["g.....g", "gg...gg", ".ggggg.", ".gEgEg.", ".ddddd.", "ggggggg", ".gLLLg.", ".LLLLL.", ".gg.gg.", ".dd.dd."],
    },
    walk: {
      south: ["g.....g", "gg...gg", ".ggggg.", ".gEgEg.", ".ddddd.", "ggggggg", ".gLLLg.", ".LLLLL.", "gg...gg", "dd...dd"],
    },
  },
  rat: {
    kind: "billboard", anim: "bob",
    palette: { f: C.fur, d: C.darkFur, n: C.nose, ".": "transparent" },
    facings: {
      south: ["f......f", ".ffffff.", "nffffffd", ".ffffff.", "..f..f.."],
    },
    walk: {
      south: ["f......f", ".ffffff.", "nffffffd", ".ffffff.", ".f....f."],
    },
  },
  chef: {
    kind: "billboard", anim: "bob",
    palette: { W: C.white, S: C.skin, E: C.eyes, A: C.apron, b: C.red, B: C.boots, ".": "transparent" },
    facings: {
      south: [".WWWWW.", ".WWWWW.", "..WWW..", ".SSSSS.", ".SESES.", "..SSS..", ".AAAAA.", "bAAAAAb", ".AAAAA.", ".AA.AA.", ".BB.BB."],
    },
  },
  tree: {
    kind: "billboard",
    palette: { L: C.leaf, l: C.lightLeaf, T: C.trunk, ".": "transparent" },
    facings: {
      south: ["..lll..", ".lLLLl.", "lLLLLLl", "lLLlLLl", ".lLLLl.", "..lLl..", "...T...", "...T...", "..TTT.."],
    },
  },
  rock: {
    kind: "billboard",
    palette: { a: C.grey3, b: C.grey1, c: C.grey2, d: C.grey4, ".": "transparent" },
    facings: {
      south: ["..aaa..", ".aabba.", "aabbbba", "abccccb", ".ccccd.", "..ddd.."],
    },
  },
  fishing_spot: {
    kind: "billboard", anim: "flicker", flickerMs: 300,
    palette: { a: C.blue1, b: C.blue2, c: C.blue3, ".": "transparent" },
    facings: { south: ["..b..", ".bab.", "baaab", ".ccc."] },
    flickerAlt: ["..b..", ".aba.", "baaab", ".ccc."],
  },
  fire: {
    kind: "billboard", anim: "flicker",
    palette: { o: C.orange, y: C.yellow, r: C.red, c: C.coal, ".": "transparent" },
    facings: { south: ["..y..", ".yoy.", "roror", ".ccc."] },
    flickerAlt: [".y.y.", "yo.oy", "roror", ".ccc."],
  },
  bank_booth: {
    kind: "billboard",
    palette: { g: C.gold, b: C.brown, w: C.wood, d: C.darkBrown, ".": "transparent" },
    facings: { south: ["gggggg", "b....b", "wwwwww", "bwwwwb", "d....d"] },
  },
  general_store: {
    kind: "billboard",
    palette: { p: C.purple, k: C.pink, b: C.brown, w: C.wood, d: C.darkBrown, ".": "transparent" },
    facings: { south: ["pkpkpk", "b....b", "wwwwww", "bwwwwb", "d....d"] },
  },
  crate: {
    kind: "billboard",
    palette: { w: C.wood, p: C.plank, ".": "transparent" },
    facings: { south: ["wpw", "ppp", "wpw"] },
  },
  fence: {
    kind: "billboard",
    palette: { p: C.plank, w: C.wood, ".": "transparent" },
    facings: { south: ["p.p", "www", "p.p"] },
  },

  // ---- buildings / environment (block) ----
  small_house: {
    kind: "block",
    cells: {
      W: { height: 3, color: C.plank, solid: true },
      r: { height: 4, color: C.roof, solid: true },
      ".": { height: 0, color: [0, 0, 0], solid: false },
    },
    footprint: ["WrW", "W.W", "W.W"],
  },
  cliff: {
    kind: "block",
    cells: { s: { height: 2, color: C.stone, solid: true }, S: { height: 3, color: C.stone, solid: true } },
    footprint: ["sS", "Ss"],
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

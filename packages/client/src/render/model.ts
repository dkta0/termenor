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

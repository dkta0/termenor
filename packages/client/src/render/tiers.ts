import { Kind, type Cell, type CellGrid, type KindValue, type PixelBuffer, type Tier } from "./types";

type RGB = [number, number, number];

const GLYPH: Record<KindValue, string> = {
  [Kind.EMPTY]: " ",
  [Kind.FLOOR]: "·",
  [Kind.WALL]: "#",
  [Kind.PLAYER]: "o",
  [Kind.LOCAL]: "@",
  [Kind.SHADOW]: ",",
  [Kind.ITEM]: "$",
};

const pxRgb = (buf: PixelBuffer, i: number): RGB => {
  const o = i * 3;
  return [buf.rgb[o], buf.rgb[o + 1], buf.rgb[o + 2]];
};

/** Half-block: each cell = two stacked pixels via ▀ (fg=top, bg=bottom). */
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

/** ASCII: one glyph per pixel; glyph from kinds, color from rgb. */
export function toAsciiCells(buf: PixelBuffer): CellGrid {
  const cols = buf.width;
  const rows = buf.height;
  const cells: Cell[] = new Array(cols * rows);
  for (let i = 0; i < buf.kinds.length; i++) {
    cells[i] = { char: GLYPH[(buf.kinds[i] as KindValue)] ?? " ", fg: pxRgb(buf, i), bg: [0, 0, 0] };
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

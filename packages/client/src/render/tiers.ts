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
  [Kind.FLOOR]: "·",
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

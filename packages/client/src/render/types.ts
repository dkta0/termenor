/** World resolution: each tile is a PIXELS_PER_TILE square of pixels. */
export const PIXELS_PER_TILE = 4;

/** Sprite blob size in pixels, centered within a tile. */
export const SPRITE_PX = 2;

/** Semantic pixel kinds. Used for ASCII glyph selection only; color comes from `rgb`. */
export const Kind = {
  EMPTY: 0,
  FLOOR: 1,
  WALL: 2,
  PLAYER: 3,
  LOCAL: 4,
  SHADOW: 5,
  ITEM: 6,
  NPC: 7,
} as const;
export type KindValue = (typeof Kind)[keyof typeof Kind];

/**
 * A pixel buffer: row-major, one entry per pixel.
 * - `kinds` — semantic kind for ASCII glyph selection
 * - `rgb`   — 3 bytes per pixel (R,G,B), default 0 = black; drives halfblock/ascii color
 */
export interface PixelBuffer {
  width: number;
  height: number;
  kinds: Uint8Array;
  rgb: Uint8Array;
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

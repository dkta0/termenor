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

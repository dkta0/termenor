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

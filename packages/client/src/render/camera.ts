import type { IsoFrame } from "./rasterize";

/**
 * Center the viewport (screen-pixel space) on a projected point. No clamp — iso bounds
 * are irregular. Use a whole-pixel half-extent (`floor`) so the centered (camera-followed)
 * entity lands on a stable pixel: with an ODD `pxW`, `pxW/2` is a half-integer and the
 * rounded offset makes the pinned player oscillate around col x.5, flipping its pixel
 * column every frame → a 1px horizontal jitter that strobes the local player. `floor`
 * keeps the half-extent integral so the player column is stable regardless of parity.
 */
export function isoCamera(centerSx: number, centerSy: number, pxW: number, pxH: number): { ox: number; oy: number } {
  return { ox: Math.round(centerSx - Math.floor(pxW / 2)), oy: Math.round(centerSy - Math.floor(pxH / 2)) };
}

/** Look up the tile under a viewport pixel via the pick buffer. Null if empty. */
export function pickTile(frame: IsoFrame, px: number, py: number, mapWidth: number): { x: number; y: number } | null {
  if (px < 0 || py < 0 || px >= frame.buf.width || py >= frame.buf.height) return null;
  const t = frame.pick[py * frame.buf.width + px];
  if (t < 0) return null;
  return { x: t % mapWidth, y: Math.floor(t / mapWidth) };
}

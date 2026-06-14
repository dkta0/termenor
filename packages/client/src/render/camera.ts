import { PIXELS_PER_TILE, type Camera, type Tier } from "./types";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Center the viewport on (centerPxX, centerPxY), clamped to the map in pixels. */
export function computeCameraPx(
  centerPxX: number, centerPxY: number,
  viewportPxW: number, viewportPxH: number,
  mapPxW: number, mapPxH: number,
): Camera {
  const rawX = Math.round(centerPxX - viewportPxW / 2);
  const rawY = Math.round(centerPxY - viewportPxH / 2);
  const maxX = Math.max(0, mapPxW - viewportPxW);
  const maxY = Math.max(0, mapPxH - viewportPxH);
  return { ox: clamp(rawX, 0, maxX), oy: clamp(rawY, 0, maxY) };
}

/** Map a clicked terminal cell back to a world tile, accounting for tier. */
export function screenCellToTile(col: number, row: number, cam: Camera, tier: Tier): { x: number; y: number } {
  const pixelX = cam.ox + col;
  const pixelY = cam.oy + (tier === "halfblock" ? row * 2 : row);
  return { x: Math.floor(pixelX / PIXELS_PER_TILE), y: Math.floor(pixelY / PIXELS_PER_TILE) };
}

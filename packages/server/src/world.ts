import type { MapData } from "@termenor/protocol";

const W = 48;
const H = 48;

/** Static map for the slice: walled border plus a few rectangular obstacles. */
export function createDefaultMap(): MapData {
  const tiles = new Array(W * H).fill(0);
  const set = (x: number, y: number) => { tiles[y * W + x] = 1; };

  // border walls
  for (let x = 0; x < W; x++) { set(x, 0); set(x, H - 1); }
  for (let y = 0; y < H; y++) { set(0, y); set(W - 1, y); }

  // a few interior obstacle blocks (kept away from spawn at 24,24)
  const blocks = [
    { x: 8, y: 8, w: 4, h: 4 },
    { x: 34, y: 10, w: 5, h: 3 },
    { x: 12, y: 30, w: 3, h: 6 },
    { x: 32, y: 32, w: 6, h: 4 },
  ];
  for (const b of blocks)
    for (let yy = b.y; yy < b.y + b.h; yy++)
      for (let xx = b.x; xx < b.x + b.w; xx++) set(xx, yy);

  return { width: W, height: H, tiles };
}

/** Default spawn — guaranteed walkable in the map above. */
export const SPAWN = { x: 24, y: 24 };

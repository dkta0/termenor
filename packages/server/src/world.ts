import type { MapData } from "@termenor/protocol";

const W = 48;
const H = 48;

/** Smooth rolling ground elevation; low frequency keeps adjacent deltas <= 1. */
function terrainHeight(x: number, y: number): number {
  const v = 1.6 + 1.4 * Math.sin(x / 10) + 0.9 * Math.cos(y / 12);
  return Math.max(0, Math.round(v));
}

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

  const heights = new Array(W * H).fill(0);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) heights[y * W + x] = terrainHeight(x, y);

  return { width: W, height: H, tiles, heights };
}

/** Default spawn — guaranteed walkable in the map above. */
export const SPAWN = { x: 24, y: 24 };

export interface SeedItem { item: string; qty: number; x: number; y: number; }

/** Ground items to seed near spawn at server start. */
export const SEED_ITEMS: SeedItem[] = [
  { item: "coins",  qty: 25, x: 25, y: 24 },
  { item: "logs",   qty: 3,  x: 23, y: 24 },
  { item: "shrimp", qty: 5,  x: 24, y: 25 },
];

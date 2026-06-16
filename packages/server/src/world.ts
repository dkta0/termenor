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
  { item: "coins",           qty: 25, x: 25, y: 24 },
  { item: "logs",            qty: 3,  x: 23, y: 24 },
  { item: "shrimp",          qty: 5,  x: 24, y: 25 },
  // starter kit for new skills (mining, fishing, firemaking, cooking)
  { item: "bronze_pickaxe",  qty: 1,  x: 26, y: 24 },
  { item: "small_net",       qty: 1,  x: 24, y: 23 },
  { item: "tinderbox",       qty: 1,  x: 26, y: 25 },
  { item: "logs",            qty: 5,  x: 22, y: 25 },
  { item: "raw_shrimp",      qty: 3,  x: 23, y: 25 },
];

export interface NpcSpawn { type: string; x: number; y: number; radius: number; }

/** NPC spawns near the player start so they're visible immediately. */
export const NPC_SPAWNS: NpcSpawn[] = [
  { type: "goblin", x: 28, y: 22, radius: 4 },
  { type: "rat",    x: 21, y: 27, radius: 3 },
];

export interface ResourceSpawn { type: string; x: number; y: number; }

/** Resource node spawns near the player start. */
export const RESOURCE_SPAWNS: ResourceSpawn[] = [
  { type: "tree",          x: 26, y: 26 },
  { type: "tree",          x: 22, y: 23 },
  { type: "rock",          x: 27, y: 25 },
  { type: "fishing_spot",  x: 23, y: 26 },
  { type: "bank_booth",    x: 25, y: 22 },
  { type: "general_store", x: 22, y: 24 },
];

/** Starter axe item seeded on the ground near spawn so any player can grab one. */
export const STARTER_AXE: SeedItem = { item: "bronze_axe", qty: 1, x: 25, y: 23 };

/** Starter gear seeded on the ground near spawn so any player can equip. */
export const STARTER_GEAR: SeedItem[] = [
  { item: "bronze_sword",     qty: 1, x: 23, y: 23 },
  { item: "bronze_platebody", qty: 1, x: 23, y: 22 },
  { item: "bronze_shield",    qty: 1, x: 24, y: 22 },
];

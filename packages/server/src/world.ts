import type { MapData, Scenery } from "@termenor/protocol";
import { MODELS, solidFootprint } from "@termenor/protocol";

const W = 48;
const H = 48;

/** Static scenery placed in the world (proof set for the renderable engine). */
export const SCENERY: Scenery[] = [
  { model: "small_house", x: 6,  y: 14 }, // 3x3 building, walk-behind + collision (NW open ground; clear of the click-smoke SE corridor)
  { model: "cliff",       x: 18, y: 18 }, // environment feature (raised rock cluster)
  { model: "crate",       x: 26, y: 23 }, // prop (decorative)
  { model: "fence",       x: 27, y: 23 }, // prop (decorative)
];

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

  // stamp scenery solid footprints into tiles so existing pathfinding blocks them
  for (const sc of SCENERY)
    for (const cell of solidFootprint(MODELS[sc.model], sc.x, sc.y))
      if (cell.x >= 0 && cell.y >= 0 && cell.x < W && cell.y < H) tiles[cell.y * W + cell.x] = 1;

  return { width: W, height: H, tiles, heights, scenery: SCENERY };
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
  { type: "chef",   x: 22, y: 22, radius: 0 }, // quest giver (Cook's Assistant)
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

// --- Multi-zone world ------------------------------------------------------

/** A one-way teleport: standing on tile (x,y) in this zone moves you to (toX,toY) in toZone. */
export interface Portal { x: number; y: number; toZone: string; toX: number; toY: number; }

/** A self-contained zone: its own map, spawn, seeded content, and portals out. */
export interface ZoneDef {
  id: string;
  map: MapData;
  spawn: { x: number; y: number };
  seedItems: SeedItem[];
  npcs: NpcSpawn[];
  resources: ResourceSpawn[];
  portals: Portal[];
}

export const DEFAULT_ZONE = "overworld";

const CW = 24;
const CH = 24;

/** A small enclosed cave: open floor inside a walled border, reached via the overworld portal. */
export function createCaveMap(): MapData {
  const tiles = new Array(CW * CH).fill(0);
  for (let x = 0; x < CW; x++) { tiles[x] = 1; tiles[(CH - 1) * CW + x] = 1; }
  for (let y = 0; y < CH; y++) { tiles[y * CW] = 1; tiles[y * CW + (CW - 1)] = 1; }
  const heights = new Array(CW * CH).fill(0);
  return { width: CW, height: CH, tiles, heights, scenery: [] };
}

/**
 * The world's zones. Overworld is the spawn region; the cave is a second region reached
 * by stepping onto the overworld portal at (28,24). Each zone is simulated by its own
 * GameWorld (see zones.ts); players see and interact only within their current zone.
 */
export const ZONE_DEFS: ZoneDef[] = [
  {
    id: DEFAULT_ZONE,
    map: createDefaultMap(),
    spawn: SPAWN,
    seedItems: [...SEED_ITEMS, STARTER_AXE, ...STARTER_GEAR],
    npcs: NPC_SPAWNS,
    resources: RESOURCE_SPAWNS,
    portals: [{ x: 30, y: 30, toZone: "cave", toX: 12, toY: 12 }],
  },
  {
    id: "cave",
    map: createCaveMap(),
    spawn: { x: 12, y: 12 },
    seedItems: [{ item: "bones", qty: 2, x: 13, y: 12 }],
    npcs: [{ type: "goblin", x: 8, y: 8, radius: 3 }],
    resources: [{ type: "rock", x: 10, y: 10 }, { type: "tree", x: 15, y: 15 }],
    portals: [{ x: 12, y: 18, toZone: DEFAULT_ZONE, toX: 28, toY: 25 }],
  },
];

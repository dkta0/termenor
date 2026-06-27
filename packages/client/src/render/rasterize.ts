import { ITEM_KINDS, NPC_KINDS, RESOURCE_KINDS, MODELS } from "@termenor/protocol";
import type { BillboardModel, Facing, GroundItem, MapData, ResourceState } from "@termenor/protocol";
import type { NpcRender, RenderPlayer } from "../game-state";
import { resolveBillboard, drawBlockModel } from "./model";
import { Kind, type PixelBuffer } from "./types";
import { TILE_W, TILE_H, ELEV_PX, tileToScreen } from "./iso";
import { shade } from "./shade";

type RGB = [number, number, number];

const GROUND_RGB: RGB = [70, 112, 50];
const WALL_RGB: RGB = [122, 112, 96];
const PLAYER_RGB: RGB = [80, 140, 255]; // exact colors the PTY check asserts
const LOCAL_RGB: RGB = [255, 210, 60];
const SHADOW_RGB: RGB = [18, 34, 18];
const WALL_RISE = 3; // height units a blocked tile extrudes upward

// Depth = x + y; higher wins the depth test. Floor tiles use x+y exactly, so an
// entity at a *fractional* position (mid-move) had a lower depth than the front
// floor tiles around it and got clipped by the ground. The bias must also clear
// terrain elevation: a tile one step ahead that's raised (ELEV_PX) reaches up
// into the sprite's body, so +1 wasn't enough on rolling hills — the player's
// feet got eaten and flickered while walking. +2 keeps an actor in front of the
// adjacent ground even up a 1-height step (adjacent terrain deltas are <= 1).
// Walls get +3 so a real wall one tile ahead still occludes (walk-behind kept).
const ENTITY_DEPTH_BIAS = 2;
const WALL_DEPTH_BIAS = 3;

export interface IsoFrame {
  buf: PixelBuffer;
  depth: Float32Array; // per pixel; -Infinity = empty
  pick: Int32Array;    // per pixel tile index; -1 = none
}

export function newIsoFrame(pxW: number, pxH: number): IsoFrame {
  const depth = new Float32Array(pxW * pxH).fill(-Infinity);
  const pick = new Int32Array(pxW * pxH).fill(-1);
  return {
    buf: { width: pxW, height: pxH, kinds: new Uint8Array(pxW * pxH), rgb: new Uint8Array(pxW * pxH * 3) },
    depth, pick,
  };
}

/** Depth-tested pixel write. Writes only when `depth` >= the stored depth. */
export function plot(f: IsoFrame, px: number, py: number, depth: number, kind: number, rgb: RGB, tile: number): void {
  if (px < 0 || py < 0 || px >= f.buf.width || py >= f.buf.height) return;
  const i = py * f.buf.width + px;
  if (depth < f.depth[i]) return;
  f.depth[i] = depth;
  f.buf.kinds[i] = kind;
  const o = i * 3;
  f.buf.rgb[o] = rgb[0]; f.buf.rgb[o + 1] = rgb[1]; f.buf.rgb[o + 2] = rgb[2];
  if (tile >= 0) f.pick[i] = tile;
}

/**
 * Pixel write for actors (sprites + their shadows). An actor stands ON the ground, so it
 * ALWAYS draws over floor/skirt/shadow/empty regardless of depth. This is what stops the
 * ground flickering through it: the camera-pinned local player's shadow sits at the
 * ground depth (x+y), so a plain depth test made it win/lose against the scrolling tiles
 * pixel-by-pixel every frame. Against walls and other actors it still depth-tests, so
 * walk-behind and entity ordering hold.
 */
export function plotEntity(f: IsoFrame, px: number, py: number, depth: number, kind: number, rgb: RGB, _tile: number): void {
  if (px < 0 || py < 0 || px >= f.buf.width || py >= f.buf.height) return;
  const i = py * f.buf.width + px;
  const existing = f.buf.kinds[i];
  const overGround = existing === Kind.EMPTY || existing === Kind.FLOOR || existing === Kind.SHADOW;
  if (!overGround && depth < f.depth[i]) return;
  f.depth[i] = depth;
  f.buf.kinds[i] = kind;
  const o = i * 3;
  f.buf.rgb[o] = rgb[0]; f.buf.rgb[o + 1] = rgb[1]; f.buf.rgb[o + 2] = rgb[2];
}

type Plotter = (f: IsoFrame, px: number, py: number, depth: number, kind: number, rgb: RGB, tile: number) => void;

function fillDiamond(f: IsoFrame, cx: number, cy: number, depth: number, kind: number, rgb: RGB, tile: number, write: Plotter = plot): void {
  const hw = TILE_W / 2, hh = TILE_H / 2;
  for (let dy = -hh; dy <= hh; dy++) {
    const t = 1 - Math.abs(dy) / hh;
    const halfw = Math.ceil(hw * t); // ceil + inclusive range → diamonds overlap, no seams
    for (let dx = -halfw; dx <= halfw; dx++) write(f, Math.round(cx + dx), Math.round(cy + dy), depth, kind, rgb, tile);
  }
}

/** Extruded block: left/right side faces + a top diamond, all at the tile's footprint depth. */
function drawBlock(f: IsoFrame, cx: number, cyGround: number, depth: number, tile: number): void {
  const hw = TILE_W / 2, hh = TILE_H / 2, rise = WALL_RISE * ELEV_PX;
  const cyTop = cyGround - rise;
  for (let dx = -hw; dx <= hw; dx++) {
    const t = 1 - Math.abs(dx) / hw;
    const edge = Math.round(hh * t);
    const face = dx < 0 ? "left" : "right";
    const rgb = shade(WALL_RGB, face);
    for (let y = cyTop + edge; y <= cyGround + edge; y++) plot(f, Math.round(cx + dx), Math.round(y), depth, Kind.WALL, rgb, tile);
  }
  fillDiamond(f, cx, cyTop, depth, Kind.WALL, shade(WALL_RGB, "top"), tile);
}

/** Short shaded skirt below a ground tile's front edges — fills the vertical face of a
 * height step so adjacent tiles at different elevations don't leave black seams.
 * Overdraw on flat ground is harmless: the front tile's top (greater depth) covers it. */
function drawSkirt(f: IsoFrame, cx: number, cyGround: number, skirtPx: number, rgb: RGB, depth: number, tile: number): void {
  const hw = TILE_W / 2, hh = TILE_H / 2;
  for (let dx = -hw; dx <= hw; dx++) {
    const edge = Math.round(hh * (1 - Math.abs(dx) / hw));
    const top = cyGround + edge;
    for (let y = top; y < top + skirtPx; y++) plot(f, Math.round(cx + dx), y, depth, Kind.FLOOR, rgb, tile);
  }
}

function drawBillboard(
  f: IsoFrame, cx: number, cyFeet: number, depth: number, kind: number, rgb: RGB,
  type: string, facing: Facing = "south", isMoving: boolean = false, now: number = 0,
): { H: number; bobY: number } {
  const model = MODELS[type];
  const bb: BillboardModel = model && model.kind === "billboard"
    ? model
    : { kind: "billboard", palette: { X: rgb }, facings: { south: ["XX", "XX", "XX", "XX"] } };
  const { H, W, pixels } = resolveBillboard(bb, facing, now, rgb, isMoving);

  let bobY = 0;
  let swayX = 0;
  if (bb.anim === "bob") {
    if (isMoving) {
      const walkCycle = now * 0.015;
      bobY = -Math.abs(Math.round(Math.sin(walkCycle) * 1.0));
      swayX = Math.round(Math.cos(walkCycle) * 0.5);
    } else if (now > 0) {
      bobY = Math.round(Math.sin(now * 0.005) * 0.4);
    }
  }

  const animCx = cx + swayX;
  const animCy = cyFeet + bobY;

  let top = Math.round(animCy) - (H - 1);
  top -= top & 1; // round down to an even row (cell top)
  for (let dy = 0; dy < H; dy++) {
    for (let dx = 0; dx < W; dx++) {
      const pixelRgb = pixels[dy * W + dx];
      if (pixelRgb === null) continue; // transparent
      plotEntity(f, Math.round(animCx + dx - W / 2), top + dy, depth, kind, pixelRgb, -1);
    }
  }

  return { H, bobY };
}


const BAR_W = 5;
const HP_GREEN: RGB = [40, 200, 40];
const HP_RED: RGB = [200, 40, 40];

/** Draw a small HP bar one pixel above the billboard head (cyFeet - billboardH - 1). */
function drawHpBar(f: IsoFrame, cx: number, cyFeet: number, depth: number, hp: number, maxHp: number, H: number = 4, bobY: number = 0): void {
  if (maxHp <= 0) return;
  // Snap to a cell boundary and fill the whole 2px cell. A 1px-tall bar always
  // half-filled a cell, so scrolling terrain in the other half strobed it during
  // movement; a full-cell bar is stable (anti-shimmer).
  let barTop = Math.round(cyFeet + bobY) - H - 1; // billboard height H; 1px gap above head
  barTop -= barTop & 1; // round down to an even row (cell top)
  const filled = Math.round((hp / maxHp) * BAR_W);
  const startX = Math.round(cx) - Math.floor(BAR_W / 2);
  for (let dx = 0; dx < BAR_W; dx++) {
    const rgb = dx < filled ? HP_GREEN : HP_RED;
    const px = startX + dx;
    if (px < 0 || px >= f.buf.width) continue;
    for (let dy = 0; dy < 2; dy++) {
      const by = barTop + dy;
      if (by < 0 || by >= f.buf.height) continue;
      const i = by * f.buf.width + px;
      f.buf.kinds[i] = Kind.FLOOR; // neutral kind for UI overlay
      f.depth[i] = Infinity; // keep on top so later entities can't overwrite it
      const o = i * 3;
      f.buf.rgb[o] = rgb[0]; f.buf.rgb[o + 1] = rgb[1]; f.buf.rgb[o + 2] = rgb[2];
    }
  }
}

/**
 * Per-map render constants that never change after join: the painter draw order
 * (tile indices sorted back-to-front by x+y) and the set of tiles owned by a block
 * scenery (where the generic grey wall block is suppressed). Both depend only on the
 * map, so we compute them once and cache by map identity instead of rebuilding +
 * re-sorting all tiles every frame. The WeakMap evicts automatically if the map
 * object is replaced (e.g. a future streamed/large world), so nothing leaks.
 */
interface MapPrecomp { order: number[]; sceneryTiles: Set<number>; }
const mapPrecompCache = new WeakMap<MapData, MapPrecomp>();

function mapPrecomp(map: MapData): MapPrecomp {
  const cached = mapPrecompCache.get(map);
  if (cached) return cached;

  const sceneryTiles = new Set<number>();
  for (const sc of map.scenery ?? []) {
    const model = MODELS[sc.model];
    if (model?.kind !== "block") continue;
    for (let r = 0; r < model.footprint.length; r++)
      for (let c = 0; c < model.footprint[r].length; c++)
        if (model.footprint[r][c] !== ".") sceneryTiles.add((sc.y + r) * map.width + (sc.x + c));
  }

  const order: number[] = [];
  for (let i = 0; i < map.tiles.length; i++) order.push(i);
  order.sort((a, b) => (Math.floor(a / map.width) + (a % map.width)) - (Math.floor(b / map.width) + (b % map.width)));

  const precomp: MapPrecomp = { order, sceneryTiles };
  mapPrecompCache.set(map, precomp);
  return precomp;
}

/**
 * Rasterize the world isometrically. `camOx/camOy` is the screen-pixel offset of the
 * viewport top-left (can be negative). Tiles draw back-to-front; entities draw after,
 * depth-tested → walk-behind occlusion.
 */
export function rasterizeIso(
  map: MapData, players: RenderPlayer[],
  camOx: number, camOy: number, pxW: number, pxH: number, localId: string | null,
  ground: GroundItem[] = [],
  npcs: NpcRender[] = [],
  resources: (ResourceState & { h: number })[] = [],
  now: number = 0,
): IsoFrame {
  const f = newIsoFrame(pxW, pxH);

  // Painter order + block-scenery tiles are static per map — computed once, cached.
  const { order, sceneryTiles } = mapPrecomp(map);

  for (const i of order) {
    const x = i % map.width, y = Math.floor(i / map.width);
    const h = map.heights[i] ?? 0;
    const s = tileToScreen(x, y, h);
    const cx = s.sx - camOx, cy = s.sy - camOy;
    const depth = x + y; // higher x+y = lower on screen = nearer viewer (front) wins depth test
    const heightTint = Math.min(1.4, 1 + h * 0.06);
    const grassTile = map.tiles[i] !== 1;
    // subtle per-tile variation so grass reads as textured turf, not a flat slab
    const checker = grassTile && (((x + y) & 1) === 0) ? 1.08 : 1;
    const jitter = grassTile ? 1 + (((x * 7 + y * 13) % 5) - 2) * 0.02 : 1;
    const m = heightTint * checker * jitter;
    const ground: RGB = [Math.min(255, Math.round(GROUND_RGB[0] * m)), Math.min(255, Math.round(GROUND_RGB[1] * m)), Math.min(255, Math.round(GROUND_RGB[2] * m))];
    fillDiamond(f, cx, cy, depth, Kind.FLOOR, ground, i);
    if (map.tiles[i] === 1 && !sceneryTiles.has(i)) drawBlock(f, cx, cy, depth + WALL_DEPTH_BIAS, i);
    else if (map.tiles[i] !== 1) drawSkirt(f, cx, cy, ELEV_PX, shade(ground, "left"), depth, i); // fill elevation steps
  }

  // scenery — static world geometry, drawn after terrain so depth test gives walk-behind
  for (const sc of map.scenery ?? []) {
    const model = MODELS[sc.model];
    if (!model) continue;
    if (model.kind === "block") {
      drawBlockModel(f, model, sc.x, sc.y, map, camOx, camOy);
    } else {
      const h = map.heights[sc.y * map.width + sc.x] ?? 0;
      const s = tileToScreen(sc.x, sc.y, h);
      drawBillboard(f, s.sx - camOx, s.sy - camOy, sc.x + sc.y + ENTITY_DEPTH_BIAS, Kind.NPC, [200, 200, 200], sc.model, sc.facing ?? "south", false, now);
    }
  }

  // entities after tiles → depth test yields walk-behind
  for (const p of players) {
    const s = tileToScreen(p.x, p.y, p.h);
    const cx = s.sx - camOx, cy = s.sy - camOy;
    const groundDepth = p.x + p.y;             // shadow stays on the ground plane
    const depth = groundDepth + ENTITY_DEPTH_BIAS; // billboard sorts in front of straddled floor
    fillDiamond(f, cx, cy, groundDepth, Kind.SHADOW, SHADOW_RGB, -1, plotEntity); // shadow on the ground
    const kind = p.id === localId ? Kind.LOCAL : Kind.PLAYER;
    const rgb = p.id === localId ? LOCAL_RGB : PLAYER_RGB;
    const isMoving = Math.abs(p.x - Math.round(p.x)) > 0.01 || Math.abs(p.y - Math.round(p.y)) > 0.01;
    const { H, bobY } = drawBillboard(f, cx, cy, depth, kind, rgb, "player", p.facing, isMoving, now);
    drawHpBar(f, cx, cy, depth, p.hp, p.maxHp, H, bobY);
  }

  // ground items — render as small colored sprites, depth = x+y (sits on ground)
  for (const gi of ground) {
    const h = map.heights[Math.round(gi.y) * map.width + Math.round(gi.x)] ?? 0;
    const s = tileToScreen(gi.x, gi.y, h);
    const cx = s.sx - camOx, cy = s.sy - camOy;
    const depth = gi.x + gi.y + ENTITY_DEPTH_BIAS;
    const entry = ITEM_KINDS[gi.item];
    const rgb: RGB = entry ? entry.color : [200, 200, 200];
    // draw a 2x2 pixel sprite at the tile center
    for (let dy = 0; dy < 2; dy++)
      for (let dx = 0; dx < 2; dx++)
        plot(f, Math.round(cx + dx - 1), Math.round(cy + dy - 1), depth, Kind.ITEM, rgb, -1);
  }

  // NPCs — depth-tested billboards with shadow, same as players
  for (const npc of npcs) {
    const s = tileToScreen(npc.x, npc.y, npc.h);
    const cx = s.sx - camOx, cy = s.sy - camOy;
    const groundDepth = npc.x + npc.y;
    const depth = groundDepth + ENTITY_DEPTH_BIAS;
    fillDiamond(f, cx, cy, groundDepth, Kind.SHADOW, SHADOW_RGB, -1, plotEntity);
    const entry = NPC_KINDS[npc.type];
    const rgb: RGB = entry ? entry.color : [200, 200, 200];
    const isMoving = Math.abs(npc.x - Math.round(npc.x)) > 0.01 || Math.abs(npc.y - Math.round(npc.y)) > 0.01;
    const { H, bobY } = drawBillboard(f, cx, cy, depth, Kind.NPC, rgb, npc.type, npc.facing, isMoving, now);
    drawHpBar(f, cx, cy, depth, npc.hp, npc.maxHp, H, bobY);
  }

  // Resources — static billboards (no HP bar)
  for (const res of resources) {
    const s = tileToScreen(res.x, res.y, res.h);
    const cx = s.sx - camOx, cy = s.sy - camOy;
    const depth = res.x + res.y + ENTITY_DEPTH_BIAS;
    const entry = RESOURCE_KINDS[res.type];
    const rgb: RGB = entry ? entry.color : [40, 120, 40];
    drawBillboard(f, cx, cy, depth, Kind.NPC, rgb, res.type, "south", false, now);
  }

  return f;
}

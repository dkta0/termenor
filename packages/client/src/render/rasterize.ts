import { ITEMS, NPC_TYPES } from "@termenor/protocol";
import type { GroundItem, MapData } from "@termenor/protocol";
import type { NpcRender, RenderPlayer } from "../game-state";
import { Kind, type PixelBuffer } from "./types";
import { TILE_W, TILE_H, ELEV_PX, tileToScreen } from "./iso";
import { shade } from "./shade";

type RGB = [number, number, number];

const GROUND_RGB: RGB = [46, 88, 46];
const WALL_RGB: RGB = [122, 112, 96];
const PLAYER_RGB: RGB = [80, 140, 255]; // exact colors the PTY check asserts
const LOCAL_RGB: RGB = [255, 210, 60];
const SHADOW_RGB: RGB = [14, 28, 14];
const WALL_RISE = 3; // height units a blocked tile extrudes upward

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

function fillDiamond(f: IsoFrame, cx: number, cy: number, depth: number, kind: number, rgb: RGB, tile: number): void {
  const hw = TILE_W / 2, hh = TILE_H / 2;
  for (let dy = -hh; dy <= hh; dy++) {
    const t = 1 - Math.abs(dy) / hh;
    const halfw = Math.ceil(hw * t); // ceil + inclusive range → diamonds overlap, no seams
    for (let dx = -halfw; dx <= halfw; dx++) plot(f, Math.round(cx + dx), Math.round(cy + dy), depth, kind, rgb, tile);
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

function drawBillboard(f: IsoFrame, cx: number, cyFeet: number, depth: number, kind: number, rgb: RGB): void {
  const H = 4, W = 2;
  for (let dy = 0; dy < H; dy++)
    for (let dx = 0; dx < W; dx++) plot(f, Math.round(cx + dx - W / 2), Math.round(cyFeet - dy), depth, kind, rgb, -1);
}

const BAR_W = 5;
const HP_GREEN: RGB = [40, 200, 40];
const HP_RED: RGB = [200, 40, 40];

/** Draw a small HP bar one pixel above the billboard head (cyFeet - billboardH - 1). */
function drawHpBar(f: IsoFrame, cx: number, cyFeet: number, depth: number, hp: number, maxHp: number): void {
  if (maxHp <= 0) return;
  const barY = Math.round(cyFeet) - 4 - 1; // billboard H=4; 1px gap above head
  const filled = Math.round((hp / maxHp) * BAR_W);
  const startX = Math.round(cx) - Math.floor(BAR_W / 2);
  for (let dx = 0; dx < BAR_W; dx++) {
    const rgb = dx < filled ? HP_GREEN : HP_RED;
    const px = startX + dx;
    if (px < 0 || px >= f.buf.width || barY < 0 || barY >= f.buf.height) continue;
    const i = barY * f.buf.width + px;
    f.buf.kinds[i] = Kind.FLOOR; // neutral kind for UI overlay
    const o = i * 3;
    f.buf.rgb[o] = rgb[0]; f.buf.rgb[o + 1] = rgb[1]; f.buf.rgb[o + 2] = rgb[2];
  }
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
): IsoFrame {
  const f = newIsoFrame(pxW, pxH);

  // tiles, painter order (ascending x+y)
  const order: number[] = [];
  for (let i = 0; i < map.tiles.length; i++) order.push(i);
  order.sort((a, b) => (Math.floor(a / map.width) + (a % map.width)) - (Math.floor(b / map.width) + (b % map.width)));

  for (const i of order) {
    const x = i % map.width, y = Math.floor(i / map.width);
    const h = map.heights[i] ?? 0;
    const s = tileToScreen(x, y, h);
    const cx = s.sx - camOx, cy = s.sy - camOy;
    const depth = x + y; // higher x+y = lower on screen = nearer viewer (front) wins depth test
    const tint = Math.min(1.4, 1 + h * 0.06);
    const ground: RGB = [Math.round(GROUND_RGB[0] * tint), Math.round(GROUND_RGB[1] * tint), Math.round(GROUND_RGB[2] * tint)];
    fillDiamond(f, cx, cy, depth, Kind.FLOOR, ground, i);
    if (map.tiles[i] === 1) drawBlock(f, cx, cy, depth, i);
    else drawSkirt(f, cx, cy, ELEV_PX, shade(ground, "left"), depth, i); // fill elevation steps
  }

  // entities after tiles → depth test yields walk-behind
  for (const p of players) {
    const s = tileToScreen(p.x, p.y, p.h);
    const cx = s.sx - camOx, cy = s.sy - camOy;
    const depth = p.x + p.y; // entity occluded by walls of greater x+y (in front)
    fillDiamond(f, cx, cy, depth, Kind.SHADOW, SHADOW_RGB, -1); // shadow on the ground
    const kind = p.id === localId ? Kind.LOCAL : Kind.PLAYER;
    const rgb = p.id === localId ? LOCAL_RGB : PLAYER_RGB;
    drawBillboard(f, cx, cy, depth, kind, rgb);
    drawHpBar(f, cx, cy, depth, p.hp, p.maxHp);
  }

  // ground items — render as small colored sprites, depth = x+y (sits on ground)
  for (const gi of ground) {
    const h = map.heights[Math.round(gi.y) * map.width + Math.round(gi.x)] ?? 0;
    const s = tileToScreen(gi.x, gi.y, h);
    const cx = s.sx - camOx, cy = s.sy - camOy;
    const depth = gi.x + gi.y;
    const entry = ITEMS[gi.item];
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
    const depth = npc.x + npc.y;
    fillDiamond(f, cx, cy, depth, Kind.SHADOW, SHADOW_RGB, -1);
    const entry = NPC_TYPES[npc.type];
    const rgb: RGB = entry ? entry.color : [200, 200, 200];
    drawBillboard(f, cx, cy, depth, Kind.NPC, rgb);
    drawHpBar(f, cx, cy, depth, npc.hp, npc.maxHp);
  }

  return f;
}

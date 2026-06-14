import type { MapData } from "@termenor/protocol";
import type { RenderPlayer } from "../game-state";
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
  for (let dy = -hh; dy < hh; dy++) {
    const t = 1 - Math.abs(dy) / hh;
    const halfw = Math.round(hw * t);
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

function drawBillboard(f: IsoFrame, cx: number, cyFeet: number, depth: number, kind: number, rgb: RGB): void {
  const H = 4, W = 2;
  for (let dy = 0; dy < H; dy++)
    for (let dx = 0; dx < W; dx++) plot(f, Math.round(cx + dx - W / 2), Math.round(cyFeet - dy), depth, kind, rgb, -1);
}

/**
 * Rasterize the world isometrically. `camOx/camOy` is the screen-pixel offset of the
 * viewport top-left (can be negative). Tiles draw back-to-front; entities draw after,
 * depth-tested → walk-behind occlusion.
 */
export function rasterizeIso(
  map: MapData, players: RenderPlayer[],
  camOx: number, camOy: number, pxW: number, pxH: number, localId: string | null,
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
  }

  return f;
}

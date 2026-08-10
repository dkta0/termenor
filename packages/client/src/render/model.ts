import type { BillboardModel, BlockCell, BlockGlyphStyle, BlockModel, MapData, Facing, RGB } from "@termenor/protocol";
import { TILE_W, TILE_H, ELEV_PX, tileToScreen } from "./iso";
import { shade } from "./shade";
import { Kind } from "./types";
import { plot, type IsoFrame } from "./rasterize";

/** Resolve a billboard model's glyph grid to a flat pixel array (row-major, top row
 *  first). null = transparent (skipped by the plotter). `tint` fills any "tint" glyph. */
export function resolveBillboard(
  m: BillboardModel, facing: Facing, now: number, tint: RGB, moving = false,
): { H: number; W: number; pixels: (RGB | null)[] } {
  let rows = m.facings[facing] ?? m.facings.south;
  if (m.anim === "flicker" && m.flickerAlt && Math.floor(now / (m.flickerMs ?? 150)) % 2 === 1) rows = m.flickerAlt;
  else if (moving && m.walk && Math.floor(now / 160) % 2 === 1) rows = m.walk[facing] ?? m.walk.south;
  const tint2: RGB = [Math.round(tint[0] * 0.8), Math.round(tint[1] * 0.8), Math.round(tint[2] * 0.8)];
  const H = rows.length, W = rows[0].length;
  const pixels: (RGB | null)[] = [];
  for (let r = 0; r < H; r++)
    for (let c = 0; c < W; c++) {
      const e = m.palette[rows[r][c]];
      pixels.push(
        e === undefined || e === "transparent" ? null : e === "tint" ? tint : e === "tint2" ? tint2 : e,
      );
    }
  return { H, W, pixels };
}

const BLOCK_DEPTH_BIAS = 3; // matches WALL_DEPTH_BIAS so scenery occludes like walls
function resolveBlockColor(cell: BlockCell, activated: boolean, now: number): RGB {
  if (!activated || !cell.activated) return cell.color;
  if (!cell.activated.pulse) return cell.activated.color;
  const phase = (1 - Math.cos((Math.PI * 2 * now) / (cell.activated.periodMs ?? 1_200))) / 2;
  return [
    Math.round(cell.activated.color[0] + (cell.activated.pulse[0] - cell.activated.color[0]) * phase),
    Math.round(cell.activated.color[1] + (cell.activated.pulse[1] - cell.activated.color[1]) * phase),
    Math.round(cell.activated.color[2] + (cell.activated.pulse[2] - cell.activated.color[2]) * phase),
  ];
}
function resolveGlyphColor(style: BlockGlyphStyle, index: number, now: number): RGB {
  const stepMs = (style.periodMs ?? 1_200) / style.count;
  const head = Math.floor(now / stepMs) % style.count;
  const distance = (head - index + style.count) % style.count;
  const intensity = distance === 0 ? 1 : distance === 1 ? 0.55 : 0.15;
  return [
    Math.round(style.color[0] + (style.highlight[0] - style.color[0]) * intensity),
    Math.round(style.color[1] + (style.highlight[1] - style.color[1]) * intensity),
    Math.round(style.color[2] + (style.highlight[2] - style.color[2]) * intensity),
  ];
}



/** Draw a single extruded cell column at tile (tx,ty), ground at screen (cx,cyGround). */
function drawCellColumn(
  f: IsoFrame, cx: number, cyGround: number, depth: number, cell: BlockCell, color: RGB,
  activated: boolean, now: number, tile: number,
): void {
  const hw = TILE_W / 2, hh = TILE_H / 2, rise = cell.height * ELEV_PX;
  const cyTop = cyGround - rise;
  for (let dx = -hw; dx <= hw; dx++) {
    const t = 1 - Math.abs(dx) / hw;
    const edge = Math.round(hh * t);
    const face = dx < 0 ? "left" : "right";
    const faceRgb = shade(color, face);
    for (let y = cyTop + edge; y <= cyGround + edge; y++) plot(f, Math.round(cx + dx), Math.round(y), depth, Kind.WALL, faceRgb, tile);
  }
  // top diamond
  for (let dy = -hh; dy <= hh; dy++) {
    const tt = 1 - Math.abs(dy) / hh;
    const halfw = Math.ceil(hw * tt);
    for (let dx = -halfw; dx <= halfw; dx++) plot(f, Math.round(cx + dx), Math.round(cyTop + dy), depth, Kind.WALL, shade(color, "top"), tile);
  }
  if (activated && cell.activatedGlyphs) {
    const spacing = rise / (cell.activatedGlyphs.count + 1);
    for (let index = 0; index < cell.activatedGlyphs.count; index++) {
      const y = Math.round(cyGround - (index + 1) * spacing);
      const glyphColor = resolveGlyphColor(cell.activatedGlyphs, index, now);
      plot(f, Math.round(cx - 1), y, depth, Kind.WALL, glyphColor, tile);
      plot(f, Math.round(cx + 1), y, depth, Kind.WALL, glyphColor, tile);
      plot(f, Math.round(cx), y - 1, depth, Kind.WALL, glyphColor, tile);
    }
  }
}

/** Draw a block model placed with its top-left footprint cell anchored at tile (ax,ay). */
export function drawBlockModel(
  f: IsoFrame, m: BlockModel, ax: number, ay: number, map: MapData, camOx: number, camOy: number,
  activated = false, now = 0,
): void {
  for (let r = 0; r < m.footprint.length; r++)
    for (let c = 0; c < m.footprint[r].length; c++) {
      const g = m.footprint[r][c];
      if (g === ".") continue;
      const cell = m.cells[g];
      if (!cell) continue;
      const tx = ax + c, ty = ay + r;
      const h = map.heights[ty * map.width + tx] ?? 0;
      const s = tileToScreen(tx, ty, h);
      drawCellColumn(
        f, s.sx - camOx, s.sy - camOy, tx + ty + BLOCK_DEPTH_BIAS,
        cell, resolveBlockColor(cell, activated, now), activated, now, ty * map.width + tx,
      );
    }
}

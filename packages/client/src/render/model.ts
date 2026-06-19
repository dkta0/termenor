import { type BillboardModel, type BlockModel, type Model, type MapData, type Facing, type RGB } from "@termenor/protocol";
import { TILE_W, TILE_H, ELEV_PX, tileToScreen } from "./iso";
import { shade } from "./shade";
import { Kind } from "./types";
import { plot, type IsoFrame } from "./rasterize";

/** Resolve a billboard model's glyph grid to a flat pixel array (row-major, top row
 *  first). null = transparent (skipped by the plotter). `tint` fills any "tint" glyph. */
export function resolveBillboard(
  m: BillboardModel, facing: Facing, now: number, tint: RGB,
): { H: number; W: number; pixels: (RGB | null)[] } {
  let rows = m.facings[facing] ?? m.facings.south;
  if (m.anim === "flicker" && m.flickerAlt && Math.floor(now / (m.flickerMs ?? 150)) % 2 === 1) rows = m.flickerAlt;
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

/** Draw a single extruded cell column at tile (tx,ty), ground at screen (cx,cyGround). */
function drawCellColumn(
  f: IsoFrame, cx: number, cyGround: number, depth: number, height: number, color: RGB, tile: number,
): void {
  const hw = TILE_W / 2, hh = TILE_H / 2, rise = height * ELEV_PX;
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
}

/** Draw a block model placed with its top-left footprint cell anchored at tile (ax,ay). */
export function drawBlockModel(
  f: IsoFrame, m: BlockModel, ax: number, ay: number, map: MapData, camOx: number, camOy: number,
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
      drawCellColumn(f, s.sx - camOx, s.sy - camOy, tx + ty + BLOCK_DEPTH_BIAS, cell.height, cell.color, ty * map.width + tx);
    }
}

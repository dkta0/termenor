import { describe, expect, test } from "bun:test";
import { MODELS, type BillboardModel } from "@termenor/protocol";
import { resolveBillboard } from "./model";
import { newIsoFrame } from "./rasterize";
import { drawBlockModel } from "./model";
import { Kind } from "./types";
import type { BlockModel, MapData } from "@termenor/protocol";

function flatMap(w: number, h: number): MapData {
  return { width: w, height: h, tiles: new Array(w * h).fill(0), heights: new Array(w * h).fill(0), scenery: [] };
}

describe("resolveBillboard", () => {
  test("resolves a glyph grid to pixels, top-left first", () => {
    const m: BillboardModel = { kind: "billboard", palette: { A: [1, 2, 3], B: [4, 5, 6] }, facings: { south: ["AB"] } };
    const { H, W, pixels } = resolveBillboard(m, "south", 0, [9, 9, 9]);
    expect([H, W]).toEqual([1, 2]);
    expect(pixels).toEqual([[1, 2, 3], [4, 5, 6]]);
  });

  test("'tint' resolves to the caller color; '.' to null (transparent)", () => {
    const m = MODELS.player as BillboardModel;
    const { pixels } = resolveBillboard(m, "south", 0, [80, 140, 255]);
    expect(pixels).toContainEqual([80, 140, 255]); // tint glyph T
  });

  test("falls back to south when a facing variant is absent", () => {
    const m = MODELS.tree as BillboardModel;
    const south = resolveBillboard(m, "south", 0, [0, 0, 0]);
    const north = resolveBillboard(m, "north", 0, [0, 0, 0]);
    expect(north.pixels).toEqual(south.pixels);
  });

  test("flicker alternates frame on the time window", () => {
    const m = MODELS.fire as BillboardModel;
    const a = resolveBillboard(m, "south", 0, [0, 0, 0]);
    const b = resolveBillboard(m, "south", 150, [0, 0, 0]);
    expect(a.pixels).not.toEqual(b.pixels);
  });
});

describe("drawBlockModel", () => {
  test("writes WALL-kind pixels for a two-cell column", () => {
    const m: BlockModel = {
      kind: "block",
      cells: { W: { height: 3, color: [120, 120, 120], solid: true } },
      footprint: ["W", "W"], // a back cell (dy0) and a front cell (dy1)
    };
    const f = newIsoFrame(64, 64);
    drawBlockModel(f, m, 4, 4, flatMap(16, 16), -32, -8);
    let wallPixels = 0;
    for (const k of f.buf.kinds) if (k === Kind.WALL) wallPixels++;
    expect(wallPixels).toBeGreaterThan(0);
  });

  test("the front cell (greater x+y) wins the depth test where columns overlap", () => {
    const m: BlockModel = {
      kind: "block",
      cells: { W: { height: 3, color: [120, 120, 120], solid: true } },
      footprint: ["W", "W"],
    };
    const f = newIsoFrame(64, 64);
    drawBlockModel(f, m, 4, 4, flatMap(16, 16), -32, -8);
    // max stored depth equals the front cell's depth (4+5 + BLOCK_DEPTH_BIAS=3 = 12)
    let maxDepth = -Infinity;
    for (const d of f.depth) if (d > maxDepth) maxDepth = d;
    expect(maxDepth).toBe(12);
  });
});

import { describe, expect, test } from "bun:test";
import { MODELS, type BillboardModel } from "@termenor/protocol";
import { resolveBillboard } from "./model";

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

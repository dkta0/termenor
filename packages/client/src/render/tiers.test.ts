import { test, expect } from "bun:test";
import { Kind, type PixelBuffer } from "./types";
import { toHalfBlockCells, toAsciiCells, selectTier, cellGridFor } from "./tiers";

/** 1x2 buffer: top pixel red, bottom pixel green. */
function buf2(): PixelBuffer {
  const rgb = new Uint8Array([255, 0, 0, /*top*/ 0, 255, 0 /*bottom*/]);
  return { width: 1, height: 2, kinds: new Uint8Array([Kind.WALL, Kind.FLOOR]), rgb };
}

test("halfblock uses ▀ with top pixel as fg, bottom as bg", () => {
  const g = toHalfBlockCells(buf2());
  expect(g.cols).toBe(1);
  expect(g.rows).toBe(1);
  expect(g.cells[0].char).toBe("▀");
  expect(g.cells[0].fg).toEqual([255, 0, 0]);
  expect(g.cells[0].bg).toEqual([0, 255, 0]);
});

test("ascii picks glyph from kinds, fg from rgb", () => {
  const g = toAsciiCells(buf2());
  expect(g.cells[0].char).toBe("#");        // Kind.WALL
  expect(g.cells[0].fg).toEqual([255, 0, 0]);
});

test("selectTier unchanged: rgb/ansi256 → halfblock else ascii", () => {
  expect(selectTier({ rgb: true })).toBe("halfblock");
  expect(selectTier({ ansi256: true })).toBe("halfblock");
  expect(selectTier(null)).toBe("ascii");
});

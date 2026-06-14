import { test, expect } from "bun:test";
import { Kind, type PixelBuffer } from "./types";
import { toHalfBlockCells, toAsciiCells, selectTier } from "./tiers";

// 2px wide, 2px tall: top row [FLOOR, WALL], bottom row [LOCAL, EMPTY]
const buf: PixelBuffer = {
  width: 2, height: 2,
  kinds: new Uint8Array([Kind.FLOOR, Kind.WALL, Kind.LOCAL, Kind.EMPTY]),
};

test("halfblock collapses 2 vertical pixels into one ▀ cell (fg=top,bg=bottom)", () => {
  const grid = toHalfBlockCells(buf);
  expect(grid.cols).toBe(2);
  expect(grid.rows).toBe(1); // 2 px tall → 1 cell row
  const c0 = grid.cells[0];
  expect(c0.char).toBe("▀");
  // top pixel FLOOR → fg; bottom pixel LOCAL → bg
  expect(c0.fg).toEqual([34, 68, 34]);   // FLOOR
  expect(c0.bg).toEqual([255, 210, 60]); // LOCAL
});

test("ascii maps each pixel to a glyph (1px per cell)", () => {
  const grid = toAsciiCells(buf);
  expect(grid.cols).toBe(2);
  expect(grid.rows).toBe(2);
  expect(grid.cells[0].char).toBe("·"); // FLOOR → ·
  expect(grid.cells[1].char).toBe("#");      // WALL
  expect(grid.cells[2].char).toBe("@");      // LOCAL
  expect(grid.cells[3].char).toBe(" ");      // EMPTY
});

test("selectTier prefers halfblock when color is available", () => {
  expect(selectTier({ rgb: true } as any)).toBe("halfblock");
  expect(selectTier({ rgb: false, ansi256: true } as any)).toBe("halfblock");
});

test("selectTier falls to ascii without color and on null caps", () => {
  expect(selectTier({ rgb: false, ansi256: false } as any)).toBe("ascii");
  expect(selectTier(null)).toBe("ascii");
});

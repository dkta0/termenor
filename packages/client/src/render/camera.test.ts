import { test, expect } from "bun:test";
import { PIXELS_PER_TILE } from "./types";
import { computeCameraPx, screenCellToTile } from "./camera";

test("PIXELS_PER_TILE is 4", () => {
  expect(PIXELS_PER_TILE).toBe(4);
});

test("camera centers on target and clamps to map bounds", () => {
  // map 100px wide, viewport 20px → centered at 50 → origin 40
  expect(computeCameraPx(50, 50, 20, 20, 100, 100)).toEqual({ ox: 40, oy: 40 });
  // near left edge clamps origin to 0
  expect(computeCameraPx(2, 2, 20, 20, 100, 100)).toEqual({ ox: 0, oy: 0 });
  // near right edge clamps origin to mapPx - viewport
  expect(computeCameraPx(99, 99, 20, 20, 100, 100)).toEqual({ ox: 80, oy: 80 });
});

test("camera origin is 0 when map smaller than viewport", () => {
  expect(computeCameraPx(5, 5, 40, 40, 20, 20)).toEqual({ ox: 0, oy: 0 });
});

test("screenCellToTile inverts camera for halfblock (row→2px)", () => {
  const cam = { ox: 40, oy: 40 };
  // halfblock: pixelY = oy + row*2
  // cell (col=2,row=3) → px (42, 46) → tile (10, 11) with PPT=4
  expect(screenCellToTile(2, 3, cam, "halfblock")).toEqual({ x: 10, y: 11 });
});

test("screenCellToTile inverts camera for ascii (row→1px)", () => {
  const cam = { ox: 0, oy: 0 };
  // ascii: pixelY = oy + row
  // cell (col=8,row=8) → px (8,8) → tile (2,2)
  expect(screenCellToTile(8, 8, cam, "ascii")).toEqual({ x: 2, y: 2 });
});

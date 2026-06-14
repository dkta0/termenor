import { test, expect } from "bun:test";
import { tileToScreen, screenToGroundTile, TILE_W, TILE_H, ELEV_PX } from "./iso";

test("2:1 dimetric constants", () => {
  expect(TILE_W).toBe(8);
  expect(TILE_H).toBe(4);
  expect(ELEV_PX).toBe(3);
});

test("tileToScreen places (0,0,0) at origin", () => {
  expect(tileToScreen(0, 0, 0)).toEqual({ sx: 0, sy: 0 });
});

test("tileToScreen: +x goes right+down, +y goes left+down, +h goes up", () => {
  expect(tileToScreen(1, 0, 0)).toEqual({ sx: 4, sy: 2 });
  expect(tileToScreen(0, 1, 0)).toEqual({ sx: -4, sy: 2 });
  expect(tileToScreen(0, 0, 1)).toEqual({ sx: 0, sy: -3 });
});

test("ground-plane round trip (h=0)", () => {
  for (const [x, y] of [[3, 1], [5, 9], [0, 7], [12, 4]]) {
    const s = tileToScreen(x, y, 0);
    const back = screenToGroundTile(s.sx, s.sy);
    expect(back.x).toBeCloseTo(x, 9);
    expect(back.y).toBeCloseTo(y, 9);
  }
});

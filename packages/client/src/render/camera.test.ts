import { test, expect } from "bun:test";
import { isoCamera, pickTile } from "./camera";
import { rasterizeIso } from "./rasterize";
import type { MapData } from "@termenor/protocol";
import type { RenderPlayer } from "../game-state";

test("isoCamera centers the viewport on a screen point", () => {
  expect(isoCamera(100, 50, 80, 40)).toEqual({ ox: 60, oy: 30 });
});

test("pick round trip: a rendered tile is pickable at its center pixel", () => {
  const m: MapData = { width: 3, height: 3, tiles: new Array(9).fill(0), heights: new Array(9).fill(0) };
  const players: RenderPlayer[] = [{ id: "me", x: 1, y: 1, facing: "south", h: 0 }];
  const f = rasterizeIso(m, players, -32, -8, 64, 48, "me");
  const idx = f.pick.findIndex((t) => t === 4); // center tile (1,1) → index 4
  expect(idx).toBeGreaterThanOrEqual(0);
  const px = idx % 64, py = Math.floor(idx / 64);
  expect(pickTile(f, px, py, m.width)).toEqual({ x: 1, y: 1 });
});

test("pickTile returns null off-scene", () => {
  const m: MapData = { width: 3, height: 3, tiles: new Array(9).fill(0), heights: new Array(9).fill(0) };
  const f = rasterizeIso(m, [], -32, -8, 64, 48, null);
  expect(pickTile(f, 0, 0, m.width)).toBeNull(); // top-left corner is empty sky
});

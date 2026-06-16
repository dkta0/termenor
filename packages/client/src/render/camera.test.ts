import { test, expect } from "bun:test";
import { isoCamera, pickTile } from "./camera";
import { rasterizeIso } from "./rasterize";
import type { MapData } from "@termenor/protocol";
import type { RenderPlayer } from "../game-state";

test("isoCamera centers the viewport on a screen point", () => {
  expect(isoCamera(100, 50, 80, 40)).toEqual({ ox: 60, oy: 30 });
});

test("camera pins the followed entity to a stable column on an ODD-width viewport (no 1px jitter)", () => {
  // Regression: with pxW odd, pxW/2 is a half-integer, so the rounded camera offset made
  // the camera-centered player oscillate around col x.5 → its pixel column flipped every
  // frame as it moved sub-pixel, strobing the local player. The followed entity's screen
  // column must stay constant across smooth movement regardless of width parity.
  for (const [pxW, pxH] of [[197, 108], [101, 60], [99, 41]]) {
    const cols = new Set<number>(), rows = new Set<number>();
    for (let t = 0; t < 24; t++) {
      const centerSx = 392 + t * 0.4, centerSy = 200 + t * 0.4; // smooth sub-pixel drift
      const { ox, oy } = isoCamera(centerSx, centerSy, pxW, pxH);
      cols.add(Math.round(centerSx - ox)); // followed entity's screen column
      rows.add(Math.round(centerSy - oy)); // and row
    }
    expect(cols.size).toBe(1); // pinned horizontally — no per-frame flip
    expect(rows.size).toBe(1); // pinned vertically
  }
});

test("pick round trip: a rendered tile is pickable at its center pixel", () => {
  const m: MapData = { width: 3, height: 3, tiles: new Array(9).fill(0), heights: new Array(9).fill(0) };
  const players: RenderPlayer[] = [{ id: "me", x: 1, y: 1, facing: "south", h: 0, hp: 10, maxHp: 10 }];
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

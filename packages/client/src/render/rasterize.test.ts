import { test, expect } from "bun:test";
import type { MapData } from "@termenor/protocol";
import type { RenderPlayer } from "../game-state";
import { Kind, PIXELS_PER_TILE } from "./types";
import { rasterize } from "./rasterize";

// 4x2 tiles: top row walls, bottom row floor
const map: MapData = { width: 4, height: 2, tiles: [1,1,1,1, 0,0,0,0] };

function at(buf: { width: number; kinds: Uint8Array }, px: number, py: number) {
  return buf.kinds[py * buf.width + px];
}

test("rasterizes floor and wall tiles by pixel", () => {
  const cam = { ox: 0, oy: 0 };
  const buf = rasterize(map, [], cam, 16, 8, null); // whole map (4*4 x 2*4)
  expect(at(buf, 0, 0)).toBe(Kind.WALL);   // tile (0,0) is wall
  expect(at(buf, 0, 4)).toBe(Kind.FLOOR);  // tile (0,1) is floor (py=4)
});

test("draws a player sprite as LOCAL at its interpolated position", () => {
  const cam = { ox: 0, oy: 0 };
  const players: RenderPlayer[] = [{ id: "me", x: 1, y: 1, facing: "south" }];
  const buf = rasterize(map, players, cam, 16, 8, "me");
  // tile (1,1) center px = (1*4+2, 1*4+2) = (6,6); SPRITE_PX=2 centered → px (5..6, 5..6)
  expect(at(buf, 5, 5)).toBe(Kind.LOCAL);
  expect(at(buf, 6, 6)).toBe(Kind.LOCAL);
});

test("non-local players render as PLAYER", () => {
  const cam = { ox: 0, oy: 0 };
  const players: RenderPlayer[] = [{ id: "other", x: 2, y: 1, facing: "south" }];
  const buf = rasterize(map, players, cam, 16, 8, "me");
  // tile (2,1) center px = (10,6)
  expect(at(buf, 9, 5)).toBe(Kind.PLAYER);
});

test("fractional position shifts the sprite (interpolation is visible)", () => {
  const cam = { ox: 0, oy: 0 };
  const a = rasterize(map, [{ id: "me", x: 1.0, y: 1, facing: "east" }], cam, 16, 8, "me");
  const b = rasterize(map, [{ id: "me", x: 1.5, y: 1, facing: "east" }], cam, 16, 8, "me");
  // x shifts by 0.5 tile = 2 px → sprite at px 5 (a) vs px 7 (b)
  expect(a.kinds[5 * a.width + 5]).toBe(Kind.LOCAL);
  expect(b.kinds[5 * b.width + 7]).toBe(Kind.LOCAL);
  expect(PIXELS_PER_TILE).toBe(4);
});

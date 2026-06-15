import { test, expect } from "bun:test";
import type { MapData } from "@termenor/protocol";
import type { RenderPlayer } from "../game-state";
import { rasterizeIso, plot, newIsoFrame } from "./rasterize";
import { Kind } from "./types";

const flatMap: MapData = {
  width: 3, height: 3,
  tiles: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  heights: [0, 0, 0, 0, 0, 0, 0, 0, 0],
};

test("plot is depth-tested: nearer (higher depth) wins regardless of order", () => {
  const f = newIsoFrame(4, 4);
  plot(f, 1, 1, /*depth*/ 5, Kind.WALL, [10, 20, 30], 7);
  plot(f, 1, 1, /*depth*/ 2, Kind.FLOOR, [99, 99, 99], 3); // farther — must NOT overwrite
  const i = 1 * 4 + 1;
  expect(f.buf.kinds[i]).toBe(Kind.WALL);
  expect([f.buf.rgb[i * 3], f.buf.rgb[i * 3 + 1], f.buf.rgb[i * 3 + 2]]).toEqual([10, 20, 30]);
  expect(f.pick[i]).toBe(7);

  plot(f, 1, 1, /*depth*/ 9, Kind.LOCAL, [1, 2, 3], 8); // nearer — overwrites
  expect(f.buf.kinds[i]).toBe(Kind.LOCAL);
  expect(f.pick[i]).toBe(8);
});

test("rasterizeIso fills a frame without throwing and marks some floor + pick", () => {
  const players: RenderPlayer[] = [{ id: "me", x: 1, y: 1, facing: "south", h: 0 }];
  const f = rasterizeIso(flatMap, players, 0, 0, 64, 48, "me");
  expect(f.buf.width).toBe(64);
  expect(f.buf.height).toBe(48);
  expect(f.buf.rgb.length).toBe(64 * 48 * 3);
  expect(f.buf.kinds.some((k) => k === Kind.FLOOR)).toBe(true);
  expect(f.pick.some((p) => p >= 0)).toBe(true);
  expect(f.buf.kinds.some((k) => k === Kind.LOCAL)).toBe(true);
});

test("walk-behind: a wall in front (greater x+y) occludes the player behind it", () => {
  const players: RenderPlayer[] = [{ id: "me", x: 0, y: 0, facing: "south", h: 0 }];
  const flat: MapData = { width: 2, height: 2, tiles: [0, 0, 0, 0], heights: [0, 0, 0, 0] };
  const walled: MapData = { width: 2, height: 2, tiles: [0, 0, 0, 1], heights: [0, 0, 0, 0] };
  const localPixels = (f: ReturnType<typeof rasterizeIso>) =>
    f.buf.kinds.reduce((n, k) => n + (k === Kind.LOCAL ? 1 : 0), 0);
  const open = rasterizeIso(flat, players, -40, -8, 80, 48, "me");
  const behind = rasterizeIso(walled, players, -40, -8, 80, 48, "me");
  // On open ground the player is visible; a tall wall on the (1,1) tile in front of
  // the (0,0) player hides part or all of the billboard — fewer LOCAL pixels survive.
  expect(localPixels(open)).toBeGreaterThan(0);
  expect(localPixels(behind)).toBeLessThan(localPixels(open));
});

import type { GroundItem } from "@termenor/protocol";

test("rasterizeIso with ground item produces ITEM pixels at item tile", () => {
  const map: import("@termenor/protocol").MapData = {
    width: 5, height: 5,
    tiles: new Array(25).fill(0),
    heights: new Array(25).fill(0),
  };
  const ground: GroundItem[] = [{ id: 1, item: "coins", qty: 5, x: 2, y: 2 }];
  const frame = rasterizeIso(map, [], 0, 0, 200, 200, null, ground);
  const hasItem = frame.buf.kinds.some((k) => k === Kind.ITEM);
  expect(hasItem).toBe(true);
});

test("rasterizeIso with no ground items produces no ITEM pixels", () => {
  const map: import("@termenor/protocol").MapData = {
    width: 5, height: 5,
    tiles: new Array(25).fill(0),
    heights: new Array(25).fill(0),
  };
  const frame = rasterizeIso(map, [], 0, 0, 200, 200, null, []);
  const hasItem = frame.buf.kinds.some((k) => k === Kind.ITEM);
  expect(hasItem).toBe(false);
});

import { NPC_TYPES } from "@termenor/protocol";
import type { NpcRender } from "../game-state";

test("rasterizeIso with npcs produces NPC pixels", () => {
  const map: MapData = {
    width: 5, height: 5,
    tiles: new Array(25).fill(0),
    heights: new Array(25).fill(0),
  };
  const npc: NpcRender = { id: "npc-1", type: "goblin", x: 2, y: 2, facing: "south", h: 0 };
  const frame = rasterizeIso(map, [], 0, 0, 200, 200, null, [], [npc]);
  expect(frame.buf.kinds.some((k) => k === Kind.NPC)).toBe(true);
});

test("rasterizeIso with no npcs produces no NPC pixels", () => {
  const map: MapData = {
    width: 5, height: 5,
    tiles: new Array(25).fill(0),
    heights: new Array(25).fill(0),
  };
  const frame = rasterizeIso(map, [], 0, 0, 200, 200, null, [], []);
  expect(frame.buf.kinds.some((k) => k === Kind.NPC)).toBe(false);
});

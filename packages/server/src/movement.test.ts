import { test, expect } from "bun:test";
import type { MapData } from "@termenor/protocol";
import { advanceAlongPath, facingTo } from "./movement";

const corridor: MapData = { width: 10, height: 1, tiles: new Array(10).fill(0), heights: new Array(10).fill(0) };

test("facingTo returns east for positive dx dominant", () => {
  expect(facingTo(3, 1, "south")).toBe("east");
});

test("facingTo returns west for negative dx dominant", () => {
  expect(facingTo(-3, 1, "south")).toBe("west");
});

test("facingTo returns south for positive dy dominant", () => {
  expect(facingTo(0, 2, "south")).toBe("south");
});

test("facingTo returns north for negative dy", () => {
  expect(facingTo(0, -2, "north")).toBe("north");
});

test("facingTo returns fallback when both zero", () => {
  expect(facingTo(0, 0, "east")).toBe("east");
});

test("advanceAlongPath moves entity toward waypoint within budget", () => {
  const e = { x: 0, y: 0, facing: "east" as const, path: [{ x: 1, y: 0 }] };
  advanceAlongPath(e, 0.3); // budget < 1 tile
  expect(e.x).toBeGreaterThan(0);
  expect(e.x).toBeLessThan(1);
  expect(e.path).toHaveLength(1); // not yet arrived
});

test("advanceAlongPath arrives at waypoint and removes it from path", () => {
  const e = { x: 0, y: 0, facing: "east" as const, path: [{ x: 1, y: 0 }] };
  advanceAlongPath(e, 2); // budget > 1 tile
  expect(e.x).toBeCloseTo(1, 9);
  expect(e.path).toHaveLength(0);
});

test("advanceAlongPath updates facing toward target", () => {
  const e: { x: number; y: number; facing: import("@termenor/protocol").Facing; path: import("./pathfinding").Point[] } = { x: 0, y: 0, facing: "north", path: [{ x: 3, y: 0 }] };
  advanceAlongPath(e, 0.1);
  expect(e.facing).toBe("east");
});

test("advanceAlongPath with empty path is a no-op", () => {
  const e = { x: 5, y: 5, facing: "south" as const, path: [] };
  advanceAlongPath(e, 1);
  expect(e.x).toBe(5);
  expect(e.y).toBe(5);
});

test("advanceAlongPath chains through multiple waypoints in a single budget", () => {
  const e = { x: 0, y: 0, facing: "east" as const, path: [{ x: 1, y: 0 }, { x: 2, y: 0 }] };
  advanceAlongPath(e, 3); // budget covers both
  expect(e.x).toBeCloseTo(2, 9);
  expect(e.path).toHaveLength(0);
});

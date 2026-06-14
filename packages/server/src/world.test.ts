import { test, expect } from "bun:test";
import { createDefaultMap } from "./world";
import { isWalkable } from "./pathfinding";

test("default map has expected dimensions", () => {
  const map = createDefaultMap();
  expect(map.width).toBe(48);
  expect(map.height).toBe(48);
  expect(map.tiles.length).toBe(48 * 48);
});

test("borders are blocked", () => {
  const map = createDefaultMap();
  expect(isWalkable(map, 0, 0)).toBe(false);
  expect(isWalkable(map, 47, 47)).toBe(false);
});

test("center is walkable", () => {
  const map = createDefaultMap();
  expect(isWalkable(map, 24, 24)).toBe(true);
});

test("tiles are only 0 or 1", () => {
  const map = createDefaultMap();
  for (const t of map.tiles) expect(t === 0 || t === 1).toBe(true);
});

import { test, expect } from "bun:test";
import { createDefaultMap, SPAWN } from "./world";
import { isWalkable, heightAt } from "./pathfinding";

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

test("default map has a heights array matching tiles length", () => {
  const m = createDefaultMap();
  expect(m.heights.length).toBe(m.tiles.length);
});

test("terrain rolls gently — adjacent walkable tiles differ by <= 1", () => {
  const m = createDefaultMap();
  for (let y = 1; y < m.height - 1; y++) {
    for (let x = 1; x < m.width - 1; x++) {
      if (m.tiles[y * m.width + x] === 1) continue;            // skip walls
      if (m.tiles[y * m.width + x + 1] === 1) continue;
      const d = Math.abs(heightAt(m, x, y) - heightAt(m, x + 1, y));
      expect(d).toBeLessThanOrEqual(1);
    }
  }
});

test("spawn tile is walkable", () => {
  const m = createDefaultMap();
  expect(m.tiles[SPAWN.y * m.width + SPAWN.x]).toBe(0);
});

import { MODELS, solidFootprint } from "@termenor/protocol";

test("createDefaultMap places scenery and stamps solid footprints as blocked tiles", () => {
  const map = createDefaultMap();
  expect(map.scenery!.length).toBeGreaterThan(0);
  // every solid footprint cell of every block scenery is blocked (tiles === 1)
  for (const sc of map.scenery!) {
    for (const cell of solidFootprint(MODELS[sc.model], sc.x, sc.y)) {
      expect(map.tiles[cell.y * map.width + cell.x]).toBe(1);
    }
  }
});

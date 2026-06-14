import { test, expect } from "bun:test";
import type { MapData } from "@termenor/protocol";
import { findPath, isWalkable, canStep, heightAt } from "./pathfinding";

// 3x3 open grid
const open: MapData = { width: 3, height: 3, tiles: [0,0,0, 0,0,0, 0,0,0], heights: new Array(9).fill(0) };

test("straight path returns steps excluding origin, including target", () => {
  const path = findPath(open, { x: 0, y: 0 }, { x: 2, y: 0 });
  expect(path).toEqual([{ x: 1, y: 0 }, { x: 2, y: 0 }]);
});

test("path routes around a wall", () => {
  // wall down the middle column except bottom row
  const map: MapData = { width: 3, height: 3, tiles: [0,1,0, 0,1,0, 0,0,0], heights: new Array(9).fill(0) };
  const path = findPath(map, { x: 0, y: 0 }, { x: 2, y: 0 })!;
  expect(path.at(-1)).toEqual({ x: 2, y: 0 });
  // every step must be walkable
  for (const p of path) expect(isWalkable(map, p.x, p.y)).toBe(true);
});

test("unreachable target returns null", () => {
  // target fully walled off
  const map: MapData = { width: 3, height: 3, tiles: [0,1,0, 1,1,0, 0,1,0], heights: new Array(9).fill(0) };
  expect(findPath(map, { x: 0, y: 0 }, { x: 2, y: 0 })).toBeNull();
});

test("blocked target returns null", () => {
  const map: MapData = { width: 3, height: 3, tiles: [0,0,0, 0,1,0, 0,0,0], heights: new Array(9).fill(0) };
  expect(findPath(map, { x: 0, y: 0 }, { x: 1, y: 1 })).toBeNull();
});

test("same-tile target returns empty path", () => {
  expect(findPath(open, { x: 1, y: 1 }, { x: 1, y: 1 })).toEqual([]);
});

test("heightAt reads the heightmap, 0 out of bounds", () => {
  const m: MapData = { width: 2, height: 1, tiles: [0, 0], heights: [2, 5] };
  expect(heightAt(m, 0, 0)).toBe(2);
  expect(heightAt(m, 1, 0)).toBe(5);
  expect(heightAt(m, -1, 0)).toBe(0);
});

test("canStep allows a climb within MAX_CLIMB, blocks a cliff", () => {
  const m: MapData = { width: 3, height: 1, tiles: [0, 0, 0], heights: [0, 1, 3] };
  expect(canStep(m, { x: 0, y: 0 }, { x: 1, y: 0 })).toBe(true);  // delta 1
  expect(canStep(m, { x: 1, y: 0 }, { x: 2, y: 0 })).toBe(false); // delta 2 → cliff
});

test("A* routes around a cliff instead of over it", () => {
  const m: MapData = {
    width: 3, height: 2,
    tiles: [0, 0, 0, 0, 0, 0],
    heights: [0, 3, 0, 0, 0, 0],
  };
  const path = findPath(m, { x: 0, y: 0 }, { x: 2, y: 0 })!;
  expect(path).not.toBeNull();
  expect(path.at(-1)).toEqual({ x: 2, y: 0 });
  for (const p of path) expect(!(p.x === 1 && p.y === 0)).toBe(true);
});

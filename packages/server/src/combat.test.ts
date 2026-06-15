import { test, expect } from "bun:test";
import { rollDamage, isAdjacent } from "./combat";

test("rollDamage stays within 0..maxHit", () => {
  for (const r of [0, 0.25, 0.5, 0.99]) {
    const d = rollDamage(2, () => r);
    expect(d).toBeGreaterThanOrEqual(0);
    expect(d).toBeLessThanOrEqual(2);
    expect(Number.isInteger(d)).toBe(true);
  }
});

test("rollDamage is deterministic for a fixed rng", () => {
  expect(rollDamage(4, () => 0)).toBe(0);
  expect(rollDamage(4, () => 0.999)).toBe(4);
});

test("isAdjacent: same tile and 8-neighbours are in range, distance 2 is not", () => {
  expect(isAdjacent({ x: 3, y: 3 }, { x: 3, y: 3 })).toBe(true);
  expect(isAdjacent({ x: 3, y: 3 }, { x: 4, y: 4 })).toBe(true);
  expect(isAdjacent({ x: 3, y: 3 }, { x: 3, y: 5 })).toBe(false);
});

test("isAdjacent rounds fractional positions", () => {
  expect(isAdjacent({ x: 3.4, y: 3 }, { x: 4.1, y: 3 })).toBe(true);
});

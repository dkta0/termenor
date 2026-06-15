import type { Point } from "./pathfinding";

/** Integer damage in [0, maxHit]. */
export function rollDamage(maxHit: number, rng: () => number): number {
  return Math.floor(rng() * (maxHit + 1));
}

/** Chebyshev distance <= 1 (same tile or 8-neighbour), positions rounded to tiles. */
export function isAdjacent(a: Point, b: Point): boolean {
  const dx = Math.abs(Math.round(a.x) - Math.round(b.x));
  const dy = Math.abs(Math.round(a.y) - Math.round(b.y));
  return Math.max(dx, dy) <= 1;
}

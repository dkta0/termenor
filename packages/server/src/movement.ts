import type { Facing } from "@termenor/protocol";
import type { Point } from "./pathfinding";

export interface Movable {
  x: number;
  y: number;
  facing: Facing;
  path: Point[];
}

/** Returns the dominant facing direction between two points. Falls back to `fallback` when stationary. */
export function facingTo(dx: number, dy: number, fallback: Facing): Facing {
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "east" : "west";
  if (dy !== 0) return dy > 0 ? "south" : "north";
  return fallback;
}

/**
 * Advance `e` along its path by `budget` tiles. Mutates e in place.
 * The path is consumed waypoint-by-waypoint; no-op if path is empty.
 */
export function advanceAlongPath(e: Movable, budget: number): void {
  while (budget > 0 && e.path.length > 0) {
    const target = e.path[0];
    const dx = target.x - e.x;
    const dy = target.y - e.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= budget) {
      e.x = target.x;
      e.y = target.y;
      e.facing = facingTo(dx, dy, e.facing);
      e.path.shift();
      budget -= dist;
    } else {
      e.x += (dx / dist) * budget;
      e.y += (dy / dist) * budget;
      e.facing = facingTo(dx, dy, e.facing);
      budget = 0;
    }
  }
}

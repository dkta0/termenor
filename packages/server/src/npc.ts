import type { MapData } from "@termenor/protocol";
import { isWalkable } from "./pathfinding";
import type { Point } from "./pathfinding";

/** NPC movement speed in tiles per second. Slower than player (SPEED=5). */
export const NPC_SPEED = 2;

/**
 * Pick a random walkable tile within Chebyshev `radius` of `home`.
 * Uses injectable `rng` for deterministic tests. Returns null if no
 * walkable tile (other than home itself) is found within `maxAttempts`.
 */
export function pickWanderTarget(
  map: MapData,
  home: Point,
  radius: number,
  rng: () => number,
  maxAttempts = 20,
): Point | null {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const dx = Math.floor(rng() * (radius * 2 + 1)) - radius;
    const dy = Math.floor(rng() * (radius * 2 + 1)) - radius;
    const tx = home.x + dx;
    const ty = home.y + dy;
    if (tx === home.x && ty === home.y) continue; // don't pick home itself
    if (!isWalkable(map, tx, ty)) continue;
    return { x: tx, y: ty };
  }
  return null;
}

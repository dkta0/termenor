import { findPath, type Point } from "./pathfinding";
import { advanceAlongPath } from "./movement";
import { pickWanderTarget, NPC_SPEED } from "./npc";
import type { GameWorld } from "./game";

const SPEED = 5; // tiles per second  → ~200ms per tile

export function queueMove(w: GameWorld, id: string, x: number, y: number): void {
  const p = w.players.get(id);
  if (!p) return;
  // tiles are integer-addressed; floor any fractional client input
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  const path = findPath(w.map, { x: Math.round(p.x), y: Math.round(p.y) }, { x: tx, y: ty });
  if (path === null) return; // unwalkable / unreachable — ignore
  p.path = path;
}

export function stepMovement(w: GameWorld, dt: number): void {
  // Movement
  for (const p of w.players.values()) {
    advanceAlongPath(p, SPEED * dt);
  }
  for (const npc of w.npcs) {
    if (npc.respawnAt >= 0) continue;
    advanceAlongPath(npc, NPC_SPEED * dt);
  }

  // NPC wander AI: idle NPCs past their wander timer pick a new target
  // Skip dead NPCs and NPCs that have a combat target
  for (const npc of w.npcs) {
    if (npc.respawnAt >= 0) continue;
    if (npc.target) continue;          // combat overrides wander
    if (npc.path.length > 0) continue; // still walking
    if (w.tick < npc.nextWanderTick) continue; // still idling
    const target = pickWanderTarget(w.map, npc.home, npc.radius, w.rng);
    if (target === null) {
      // no reachable tile found — idle for a short interval then retry
      npc.nextWanderTick = w.tick + Math.floor(w.rng() * 15) + 5;
      continue;
    }
    const path = findPath(w.map, { x: Math.round(npc.x), y: Math.round(npc.y) }, target);
    if (path === null) {
      npc.nextWanderTick = w.tick + Math.floor(w.rng() * 15) + 5;
      continue;
    }
    npc.path = path;
    // idle interval after arriving: 1-4 seconds at 15Hz = 15-60 ticks
    npc.nextWanderTick = w.tick + Math.floor(w.rng() * 45) + 15;
  }
}

export function stepToward(w: GameWorld, actor: { x: number; y: number; path: Point[] }, tx: number, ty: number): void {
  if (actor.path.length === 0) {
    const path = findPath(w.map, { x: Math.round(actor.x), y: Math.round(actor.y) }, { x: Math.round(tx), y: Math.round(ty) });
    if (path && path.length > 0) { path.pop(); actor.path = path; }
  }
}

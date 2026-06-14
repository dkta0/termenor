import type { Facing, MapData, PlayerState, SnapshotMsg } from "@termenor/protocol";
import { findPath, type Point } from "./pathfinding";

const SPEED = 5; // tiles per second  → ~200ms per tile

interface Player {
  id: string;
  x: number;
  y: number;
  facing: Facing;
  path: Point[]; // remaining waypoints (tile centers)
}

function facingTo(dx: number, dy: number, fallback: Facing): Facing {
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "east" : "west";
  if (dy !== 0) return dy > 0 ? "south" : "north";
  return fallback;
}

export class Game {
  readonly map: MapData;
  private spawn: Point;
  private players = new Map<string, Player>();
  private tick = 0;

  constructor(map: MapData, spawn: Point) {
    this.map = map;
    this.spawn = spawn;
  }

  addPlayer(id: string): void {
    this.players.set(id, {
      id, x: this.spawn.x, y: this.spawn.y, facing: "south", path: [],
    });
  }

  removePlayer(id: string): void {
    this.players.delete(id);
  }

  queueMove(id: string, x: number, y: number): void {
    const p = this.players.get(id);
    if (!p) return;
    // tiles are integer-addressed; floor any fractional client input
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    const path = findPath(this.map, { x: Math.round(p.x), y: Math.round(p.y) }, { x: tx, y: ty });
    if (path === null) return; // unwalkable / unreachable — ignore
    p.path = path;
  }

  /** Advance the world by dt seconds. */
  step(dt: number): void {
    this.tick++;
    for (const p of this.players.values()) {
      let budget = SPEED * dt;
      while (budget > 0 && p.path.length > 0) {
        const target = p.path[0];
        const dx = target.x - p.x;
        const dy = target.y - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= budget) {
          p.x = target.x;
          p.y = target.y;
          p.facing = facingTo(dx, dy, p.facing);
          p.path.shift();
          budget -= dist;
        } else {
          p.x += (dx / dist) * budget;
          p.y += (dy / dist) * budget;
          p.facing = facingTo(dx, dy, p.facing);
          budget = 0;
        }
      }
    }
  }

  snapshot(): SnapshotMsg {
    const players: PlayerState[] = [...this.players.values()].map((p) => ({
      id: p.id, x: p.x, y: p.y, facing: p.facing,
    }));
    return { t: "snapshot", tick: this.tick, players };
  }
}

import type { Facing, MapData, PlayerState, SnapshotMsg, GroundItem, ItemStack } from "@termenor/protocol";
import { findPath, type Point } from "./pathfinding";
import { emptyInventory, addToInventory, removeSlot } from "./inventory";

const SPEED = 5; // tiles per second  → ~200ms per tile

interface Player {
  id: string;
  x: number;
  y: number;
  facing: Facing;
  path: Point[]; // remaining waypoints (tile centers)
  inventory: (ItemStack | null)[];
}

function facingTo(dx: number, dy: number, fallback: Facing): Facing {
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "east" : "west";
  if (dy !== 0) return dy > 0 ? "south" : "north";
  return fallback;
}

export interface RestoredState {
  x: number;
  y: number;
  facing: Facing;
  inventory?: (ItemStack | null)[];
}

export class Game {
  readonly map: MapData;
  private spawn: Point;
  private players = new Map<string, Player>();
  private tick = 0;
  private groundItems: GroundItem[] = [];
  private nextItemId = 1;

  constructor(map: MapData, spawn: Point) {
    this.map = map;
    this.spawn = spawn;
  }

  addPlayer(id: string, state?: RestoredState): void {
    const x = state?.x ?? this.spawn.x;
    const y = state?.y ?? this.spawn.y;
    const facing = state?.facing ?? "south";
    const inventory = state?.inventory ?? emptyInventory();
    this.players.set(id, { id, x, y, facing, path: [], inventory });
  }

  removePlayer(id: string): void {
    this.players.delete(id);
  }

  getPlayerState(id: string): RestoredState | null {
    const p = this.players.get(id);
    if (!p) return null;
    return { x: p.x, y: p.y, facing: p.facing, inventory: p.inventory };
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

  addGroundItem(item: string, qty: number, x: number, y: number): void {
    this.groundItems.push({ id: this.nextItemId++, item, qty, x, y });
  }

  getInventory(id: string): (ItemStack | null)[] | null {
    const p = this.players.get(id);
    if (!p) return null;
    return p.inventory;
  }

  pickup(id: string): boolean {
    const p = this.players.get(id);
    if (!p) return false;

    const px = Math.round(p.x);
    const py = Math.round(p.y);
    const matches = this.groundItems.filter(
      (gi) => Math.round(gi.x) === px && Math.round(gi.y) === py,
    );
    if (matches.length === 0) return false;

    let changed = false;
    for (const gi of matches) {
      const { slots, leftover } = addToInventory(p.inventory, { item: gi.item, qty: gi.qty });
      if (leftover === null) {
        // fully picked up
        p.inventory = slots;
        this.groundItems = this.groundItems.filter((g) => g.id !== gi.id);
        changed = true;
      } else if (leftover.qty < gi.qty) {
        // partially picked up
        p.inventory = slots;
        gi.qty = leftover.qty;
        changed = true;
        break;
      } else {
        // nothing could be taken (inventory full for this item)
        break;
      }
    }
    return changed;
  }

  drop(id: string, slot: number): boolean {
    const p = this.players.get(id);
    if (!p) return false;

    const { slots, removed } = removeSlot(p.inventory, slot);
    if (removed === null) return false;

    p.inventory = slots;
    this.groundItems.push({
      id: this.nextItemId++,
      item: removed.item,
      qty: removed.qty,
      x: Math.round(p.x),
      y: Math.round(p.y),
    });
    return true;
  }

  snapshot(): SnapshotMsg {
    const players: PlayerState[] = [...this.players.values()].map((p) => ({
      id: p.id, x: p.x, y: p.y, facing: p.facing,
    }));
    return { t: "snapshot", tick: this.tick, players, ground: this.groundItems.slice() };
  }
}

import type { Facing, MapData, PlayerState, SnapshotMsg, GroundItem, ItemStack, NpcState } from "@termenor/protocol";
import { findPath, type Point } from "./pathfinding";
import { advanceAlongPath } from "./movement";
import { pickWanderTarget, NPC_SPEED } from "./npc";
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

interface Npc {
  id: string;
  type: string;
  x: number;
  y: number;
  facing: Facing;
  path: Point[];
  home: Point;
  radius: number;
  nextWanderTick: number;
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
  private npcs: Npc[] = [];
  private nextNpcId = 1;
  private rng: () => number;

  constructor(map: MapData, spawn: Point, rng: () => number = Math.random) {
    this.map = map;
    this.spawn = spawn;
    this.rng = rng;
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

  spawnNpc(type: string, x: number, y: number, radius: number): void {
    this.npcs.push({
      id: `npc-${this.nextNpcId++}`,
      type, x, y,
      facing: "south",
      path: [],
      home: { x, y },
      radius,
      nextWanderTick: 0,
    });
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
      advanceAlongPath(p, SPEED * dt);
    }
    // Advance NPC paths
    for (const npc of this.npcs) {
      advanceAlongPath(npc, NPC_SPEED * dt);
    }
    // NPC wander AI: idle NPCs past their wander timer pick a new target
    for (const npc of this.npcs) {
      if (npc.path.length > 0) continue; // still walking
      if (this.tick < npc.nextWanderTick) continue; // still idling
      const target = pickWanderTarget(this.map, npc.home, npc.radius, this.rng);
      if (target === null) {
        // no reachable tile found — idle for a short interval then retry
        npc.nextWanderTick = this.tick + Math.floor(this.rng() * 15) + 5;
        continue;
      }
      const path = findPath(this.map, { x: Math.round(npc.x), y: Math.round(npc.y) }, target);
      if (path === null) {
        npc.nextWanderTick = this.tick + Math.floor(this.rng() * 15) + 5;
        continue;
      }
      npc.path = path;
      // idle interval after arriving: 1-4 seconds at 15Hz = 15-60 ticks
      npc.nextWanderTick = this.tick + Math.floor(this.rng() * 45) + 15;
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
    const npcs: NpcState[] = this.npcs.map((n) => ({
      id: n.id, type: n.type, x: n.x, y: n.y, facing: n.facing,
    }));
    return { t: "snapshot", tick: this.tick, players, ground: this.groundItems.slice(), npcs };
  }
}

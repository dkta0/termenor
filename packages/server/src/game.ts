import type { Facing, MapData, PlayerState, SnapshotMsg, GroundItem, ItemStack, NpcState, HitEvent } from "@termenor/protocol";
import { NPC_TYPES, PLAYER_MAX_HP, PLAYER_MAX_HIT, ATTACK_COOLDOWN_TICKS, RESPAWN_TICKS } from "@termenor/protocol";
import { findPath, type Point } from "./pathfinding";
import { advanceAlongPath } from "./movement";
import { pickWanderTarget, NPC_SPEED } from "./npc";
import { emptyInventory, addToInventory, removeSlot } from "./inventory";
import { rollDamage, isAdjacent } from "./combat";

const SPEED = 5; // tiles per second  → ~200ms per tile

interface Player {
  id: string;
  x: number;
  y: number;
  facing: Facing;
  path: Point[]; // remaining waypoints (tile centers)
  inventory: (ItemStack | null)[];
  hp: number;
  maxHp: number;
  target: string | null;
  attackCd: number;
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
  hp: number;
  maxHp: number;
  maxHit: number;
  target: string | null;
  attackCd: number;
  deadUntil: number; // -1 = alive; >= 0 = respawn at this tick
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
  private hits: HitEvent[] = [];

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
    this.players.set(id, { id, x, y, facing, path: [], inventory, hp: PLAYER_MAX_HP, maxHp: PLAYER_MAX_HP, target: null, attackCd: 0 });
  }

  removePlayer(id: string): void {
    this.players.delete(id);
  }

  spawnNpc(type: string, x: number, y: number, radius: number): void {
    const stats = NPC_TYPES[type];
    const maxHp = stats?.maxHp ?? 3;
    const maxHit = stats?.maxHit ?? 1;
    this.npcs.push({
      id: `npc-${this.nextNpcId++}`,
      type, x, y,
      facing: "south",
      path: [],
      home: { x, y },
      radius,
      nextWanderTick: 0,
      hp: maxHp,
      maxHp,
      maxHit,
      target: null,
      attackCd: 0,
      deadUntil: -1,
    });
  }

  attack(playerId: string, targetId: string): void {
    const p = this.players.get(playerId);
    if (!p) return;
    const npc = this.npcs.find((n) => n.id === targetId && n.deadUntil < 0);
    if (!npc) return;
    p.target = targetId;
    npc.target = playerId;   // aggro: a targeted NPC pursues + stops wandering (spec 2.4)
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

    // Respawn dead NPCs whose timer has expired
    for (const npc of this.npcs) {
      if (npc.deadUntil >= 0 && this.tick >= npc.deadUntil) {
        npc.x = npc.home.x; npc.y = npc.home.y; npc.path = [];
        npc.hp = npc.maxHp; npc.target = null; npc.attackCd = 0; npc.deadUntil = -1;
      }
    }

    // Movement
    for (const p of this.players.values()) {
      advanceAlongPath(p, SPEED * dt);
    }
    for (const npc of this.npcs) {
      if (npc.deadUntil >= 0) continue;
      advanceAlongPath(npc, NPC_SPEED * dt);
    }

    // NPC wander AI: idle NPCs past their wander timer pick a new target
    // Skip dead NPCs and NPCs that have a combat target
    for (const npc of this.npcs) {
      if (npc.deadUntil >= 0) continue;
      if (npc.target) continue;          // combat overrides wander
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

    // Combat pass: players attack npcs, npcs attack their target
    for (const p of this.players.values()) {
      if (p.attackCd > 0) p.attackCd--;
      this.combatStep(p, (id) => this.npcs.find((n) => n.id === id && n.deadUntil < 0) ?? null, PLAYER_MAX_HIT);
    }
    for (const npc of this.npcs) {
      if (npc.deadUntil >= 0) continue;
      if (npc.attackCd > 0) npc.attackCd--;
      this.combatStep(npc, (id) => this.players.get(id) ?? null, npc.maxHit);
    }

    this.resolveDeaths();
  }

  private combatStep(
    actor: { x: number; y: number; facing: Facing; path: Point[]; target: string | null; attackCd: number },
    findTarget: (id: string) => { id: string; x: number; y: number; hp: number } | null,
    maxHit: number,
  ): void {
    if (!actor.target) return;
    const tgt = findTarget(actor.target);
    if (!tgt) { actor.target = null; return; }

    if (isAdjacent(actor, tgt)) {
      actor.path = [];
      if (actor.attackCd === 0) {
        const dmg = rollDamage(maxHit, this.rng);
        tgt.hp = Math.max(0, tgt.hp - dmg);
        actor.attackCd = ATTACK_COOLDOWN_TICKS;
        this.hits.push({ targetId: tgt.id, amount: dmg, tick: this.tick });
        // If the victim is an NPC, make it retaliate against the player attacker
        const victimNpc = this.npcs.find((n) => n.id === tgt.id);
        if (victimNpc && !victimNpc.target) {
          const attackerId = this.idOf(actor);
          if (attackerId) victimNpc.target = attackerId;
        }
      }
    } else if (actor.path.length === 0) {
      const path = findPath(this.map, { x: Math.round(actor.x), y: Math.round(actor.y) }, { x: Math.round(tgt.x), y: Math.round(tgt.y) });
      if (path && path.length > 0) { path.pop(); actor.path = path; }
    }
  }

  // Returns the player id for a player actor, or null for NPC actors.
  private idOf(actor: object): string | null {
    for (const [id, p] of this.players) if (p === actor) return id;
    return null;
  }

  private resolveDeaths(): void {
    for (const npc of this.npcs) {
      if (npc.deadUntil < 0 && npc.hp <= 0) {
        npc.deadUntil = this.tick + RESPAWN_TICKS;
        npc.path = []; npc.target = null;
        for (const p of this.players.values()) if (p.target === npc.id) p.target = null;
        for (const other of this.npcs) if (other.target === npc.id) other.target = null;
      }
    }
    for (const p of this.players.values()) {
      if (p.hp <= 0) {
        p.x = this.spawn.x; p.y = this.spawn.y; p.path = [];
        p.hp = p.maxHp; p.target = null; p.attackCd = 0;
        for (const npc of this.npcs) if (npc.target === p.id) npc.target = null;
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
      id: p.id, x: p.x, y: p.y, facing: p.facing, hp: p.hp, maxHp: p.maxHp,
    }));
    const npcs: NpcState[] = this.npcs.filter((n) => n.deadUntil < 0).map((n) => ({
      id: n.id, type: n.type, x: n.x, y: n.y, facing: n.facing, hp: n.hp, maxHp: n.maxHp,
    }));
    const hits = this.hits; this.hits = [];
    return { t: "snapshot", tick: this.tick, players, ground: this.groundItems.slice(), npcs, hits };
  }
}

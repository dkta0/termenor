import type { Facing, MapData, PlayerState, SnapshotMsg, GroundItem, ItemStack, NpcState, HitEvent, ResourceState } from "@termenor/protocol";
import { NPC_KINDS, PLAYER_MAX_HP, PLAYER_MAX_HIT, ATTACK_COOLDOWN_TICKS, RESPAWN_TICKS, WOODCUTTING_XP_PER_LOG, TREE_CHARGES, RESOURCE_RESPAWN_TICKS, levelForXp, RESOURCE_KINDS, FIRE_LIFETIME_TICKS, SKILLS } from "@termenor/protocol";
import { findPath, type Point } from "./pathfinding";
import { advanceAlongPath } from "./movement";
import { pickWanderTarget, NPC_SPEED } from "./npc";
import { emptyInventory, addToInventory, removeSlot } from "./inventory";
import { rollDamage, isAdjacent } from "./combat";
import type { PlayerEntity, NpcEntity, ResourceEntity, FireEntity, GameEvents } from "./entities";

const SPEED = 5; // tiles per second  → ~200ms per tile
const GATHER_COOLDOWN_TICKS = 30;
const FIREMAKING_XP = 40;
const COOKING_XP = 30;

export interface RestoredState {
  x: number;
  y: number;
  facing: Facing;
  inventory?: (ItemStack | null)[];
  skills?: Record<string, number>;
}

export class GameWorld {
  readonly map: MapData;
  private spawn: Point;
  private players = new Map<string, PlayerEntity>();
  private tick = 0;
  private groundItems: GroundItem[] = [];
  private nextItemId = 1;
  private npcs: NpcEntity[] = [];
  private nextNpcId = 1;
  private rng: () => number;
  private hits: HitEvent[] = [];
  private resources: ResourceEntity[] = [];
  private fires: FireEntity[] = [];
  private nextResourceId = 1;
  events: GameEvents = { skillChanged: new Set(), levelUps: [], gatherNotices: [] };

  constructor(map: MapData, spawn: Point, rng: () => number = Math.random) {
    this.map = map;
    this.spawn = spawn;
    this.rng = rng;
  }

  addPlayer(id: string, state?: RestoredState): void {
    const x = state?.x ?? this.spawn.x;
    const y = state?.y ?? this.spawn.y;
    const facing = state?.facing ?? "south";
    const skills = state?.skills ?? {};
    let inventory: (ItemStack | null)[];
    if (state !== undefined) {
      // restoring a saved player — use provided inventory (or empty if not persisted), no starter axe
      inventory = state.inventory ?? emptyInventory();
    } else {
      // brand-new player: seed bronze_axe
      const { slots } = addToInventory(emptyInventory(), { item: "bronze_axe", qty: 1 });
      inventory = slots;
    }
    this.players.set(id, { id, x, y, facing, path: [], inventory, hp: PLAYER_MAX_HP, maxHp: PLAYER_MAX_HP, target: null, attackCd: 0, skills, gatherTarget: null, gatherCd: 0 });
  }

  removePlayer(id: string): void {
    this.players.delete(id);
  }

  spawnNpc(type: string, x: number, y: number, radius: number): void {
    const stats = NPC_KINDS[type];
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
      respawnAt: -1,
    });
  }

  attack(playerId: string, targetId: string): void {
    const p = this.players.get(playerId);
    if (!p) return;
    const npc = this.npcs.find((n) => n.id === targetId && n.respawnAt < 0);
    if (!npc) return;
    p.target = targetId;
    npc.target = playerId;   // aggro: a targeted NPC pursues + stops wandering (spec 2.4)
  }

  getPlayerState(id: string): RestoredState | null {
    const p = this.players.get(id);
    if (!p) return null;
    return { x: p.x, y: p.y, facing: p.facing, inventory: p.inventory, skills: p.skills };
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
      if (npc.respawnAt >= 0 && this.tick >= npc.respawnAt) {
        npc.x = npc.home.x; npc.y = npc.home.y; npc.path = [];
        npc.hp = npc.maxHp; npc.target = null; npc.attackCd = 0; npc.respawnAt = -1;
      }
    }

    // Movement
    for (const p of this.players.values()) {
      advanceAlongPath(p, SPEED * dt);
    }
    for (const npc of this.npcs) {
      if (npc.respawnAt >= 0) continue;
      advanceAlongPath(npc, NPC_SPEED * dt);
    }

    // NPC wander AI: idle NPCs past their wander timer pick a new target
    // Skip dead NPCs and NPCs that have a combat target
    for (const npc of this.npcs) {
      if (npc.respawnAt >= 0) continue;
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
      this.combatStep(p, (id) => this.npcs.find((n) => n.id === id && n.respawnAt < 0) ?? null, PLAYER_MAX_HIT);
    }
    for (const npc of this.npcs) {
      if (npc.respawnAt >= 0) continue;
      if (npc.attackCd > 0) npc.attackCd--;
      this.combatStep(npc, (id) => this.players.get(id) ?? null, npc.maxHit);
    }

    this.resolveDeaths();

    // Respawn depleted gatherables
    for (const res of this.resources) {
      if (res.respawnAt >= 0 && this.tick >= res.respawnAt) {
        res.charges = res.maxCharges;
        res.respawnAt = -1;
      }
    }
    // Expire fires
    this.fires = this.fires.filter((f) => this.tick < f.expiresAt);

    // Gather pass
    for (const p of this.players.values()) {
      if (!p.gatherTarget) continue;
      if (p.gatherCd > 0) p.gatherCd--;
      const res = this.resources.find((r) => r.id === p.gatherTarget && r.respawnAt < 0);
      if (!res) { p.gatherTarget = null; continue; }
      const cfg = RESOURCE_KINDS[res.type];
      if (!cfg || cfg.gatherable === false) { p.gatherTarget = null; continue; }
      if (isAdjacent(p, res)) {
        p.path = [];
        if (p.gatherCd === 0) {
          if (cfg.tool && !this.hasItem(p, cfg.tool)) {
            p.gatherTarget = null;
            this.events.gatherNotices.push({ id: p.id, text: "You need the right tool." });
            continue;
          }
          const { slots, leftover } = addToInventory(p.inventory, { item: cfg.yield, qty: 1 });
          if (leftover !== null) {
            // inventory full — could not add item
            p.gatherTarget = null;
            this.events.gatherNotices.push({ id: p.id, text: "Your inventory is full." });
            continue;
          }
          p.inventory = slots;
          this.awardXp(p, cfg.skill, cfg.xp);
          p.gatherCd = cfg.cooldownTicks;
          if (!cfg.infinite) {
            res.charges--;
            if (res.charges <= 0) {
              res.respawnAt = this.tick + cfg.respawnTicks;
              // clear all players targeting this depleted resource
              for (const other of this.players.values()) {
                if (other.gatherTarget === res.id) other.gatherTarget = null;
              }
            }
          }
        }
      } else {
        this.stepToward(p, res.x, res.y);
      }
    }
  }

  private stepToward(actor: { x: number; y: number; path: Point[] }, tx: number, ty: number): void {
    if (actor.path.length === 0) {
      const path = findPath(this.map, { x: Math.round(actor.x), y: Math.round(actor.y) }, { x: Math.round(tx), y: Math.round(ty) });
      if (path && path.length > 0) { path.pop(); actor.path = path; }
    }
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
    } else {
      this.stepToward(actor, tgt.x, tgt.y);
    }
  }

  // Returns the player id for a player actor, or null for NPC actors.
  private idOf(actor: object): string | null {
    for (const [id, p] of this.players) if (p === actor) return id;
    return null;
  }

  private resolveDeaths(): void {
    for (const npc of this.npcs) {
      if (npc.respawnAt < 0 && npc.hp <= 0) {
        npc.respawnAt = this.tick + RESPAWN_TICKS;
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

  spawnResource(type: string, x: number, y: number): string {
    const id = `res-${this.nextResourceId++}`;
    const cfg = RESOURCE_KINDS[type];
    const charges = cfg?.charges ?? 0;
    this.resources.push({ id, type, x, y, home: { x, y }, charges, maxCharges: charges, respawnAt: -1 });
    return id;
  }

  private spawnFire(x: number, y: number): void {
    const id = `res-${this.nextResourceId++}`;
    this.fires.push({ id, x, y, expiresAt: this.tick + FIRE_LIFETIME_TICKS });
  }

  gather(playerId: string, targetId: string): void {
    const p = this.players.get(playerId);
    if (!p) return;
    const res = this.resources.find((r) => r.id === targetId && r.respawnAt < 0);
    if (!res) return;
    p.gatherTarget = targetId;
  }

  use(playerId: string, action: string, slot: number): void {
    const p = this.players.get(playerId);
    if (!p) return;
    if (slot < 0 || slot >= p.inventory.length) return;
    const stack = p.inventory[slot];

    if (action === "firemaking") {
      if (stack?.item !== "logs") {
        this.events.gatherNotices.push({ id: p.id, text: "You need logs to make a fire." });
        return;
      }
      if (!this.hasItem(p, "tinderbox")) {
        this.events.gatherNotices.push({ id: p.id, text: "You need a tinderbox to make a fire." });
        return;
      }
      const px = Math.round(p.x);
      const py = Math.round(p.y);
      const fireAlreadyHere = this.fires.some(
        (f) => f.x === px && f.y === py && this.tick < f.expiresAt,
      );
      if (fireAlreadyHere) {
        this.events.gatherNotices.push({ id: p.id, text: "There is already a fire here." });
        return;
      }
      // Consume one log
      if (stack.qty === 1) {
        const { slots } = removeSlot(p.inventory, slot);
        p.inventory = slots;
      } else {
        p.inventory[slot] = { item: stack.item, qty: stack.qty - 1 };
      }
      this.spawnFire(px, py);
      this.awardXp(p, "firemaking", FIREMAKING_XP);
      return;
    }

    if (action === "cooking") {
      if (stack?.item !== "raw_shrimp") {
        this.events.gatherNotices.push({ id: p.id, text: "You need raw shrimp to cook." });
        return;
      }
      const hasAdjacentFire = this.fires.some(
        (f) => this.tick < f.expiresAt && isAdjacent(p, f),
      );
      if (!hasAdjacentFire) {
        this.events.gatherNotices.push({ id: p.id, text: "You need to be next to a fire to cook." });
        return;
      }
      const { slots: cookedSlots, leftover } = addToInventory(p.inventory, { item: "cooked_shrimp", qty: 1 });
      if (leftover !== null) {
        this.events.gatherNotices.push({ id: p.id, text: "Your inventory is full." });
        return;
      }
      // Consume one raw_shrimp from the updated slots (cooked_shrimp already added)
      const rawIdx = cookedSlots.findIndex((s) => s?.item === "raw_shrimp");
      if (rawIdx !== -1) {
        const rawStack = cookedSlots[rawIdx]!;
        if (rawStack.qty === 1) {
          const { slots: finalSlots } = removeSlot(cookedSlots, rawIdx);
          p.inventory = finalSlots;
        } else {
          cookedSlots[rawIdx] = { item: rawStack.item, qty: rawStack.qty - 1 };
          p.inventory = cookedSlots;
        }
      } else {
        p.inventory = cookedSlots;
      }
      this.awardXp(p, "cooking", COOKING_XP);
      return;
    }
    // unknown action: ignore
  }

  private awardXp(p: PlayerEntity, skill: string, amount: number): void {
    const oldXp = p.skills[skill] ?? 0;
    const newXp = oldXp + amount;
    p.skills = { ...p.skills, [skill]: newXp };
    if (levelForXp(newXp) > levelForXp(oldXp)) {
      this.events.levelUps.push({ id: p.id, skill, level: levelForXp(newXp) });
    }
    this.events.skillChanged.add(p.id);
  }

  private hasItem(p: PlayerEntity, item: string): boolean {
    return p.inventory.some((s) => s !== null && s.item === item);
  }

  getPlayerSkills(id: string): Record<string, { xp: number; level: number }> {
    const p = this.players.get(id);
    const rawSkills = p?.skills ?? {};
    const result: Record<string, { xp: number; level: number }> = {};
    for (const skill of SKILLS) {
      const xp = rawSkills[skill] ?? 0;
      result[skill] = { xp, level: levelForXp(xp) };
    }
    return result;
  }

  consumeSkillChanges(): string[] {
    const ids = [...this.events.skillChanged];
    this.events.skillChanged.clear();
    return ids;
  }

  consumeLevelUps(): { id: string; skill: string; level: number }[] {
    const ups = this.events.levelUps;
    this.events.levelUps = [];
    return ups;
  }

  consumeGatherNotices(): { id: string; text: string }[] {
    const notices = this.events.gatherNotices;
    this.events.gatherNotices = [];
    return notices;
  }

  snapshot(): SnapshotMsg {
    const players: PlayerState[] = [...this.players.values()].map((p) => ({
      id: p.id, x: p.x, y: p.y, facing: p.facing, hp: p.hp, maxHp: p.maxHp,
    }));
    const npcs: NpcState[] = this.npcs.filter((n) => n.respawnAt < 0).map((n) => ({
      id: n.id, type: n.type, x: n.x, y: n.y, facing: n.facing, hp: n.hp, maxHp: n.maxHp,
    }));
    const resources: ResourceState[] = [
      ...this.resources
        .filter((r) => r.respawnAt < 0)
        .map((r) => ({ id: r.id, type: r.type, x: r.x, y: r.y })),
      ...this.fires.map((f) => ({ id: f.id, type: "fire", x: f.x, y: f.y })),
    ];
    const hits = this.hits; this.hits = [];
    return { t: "snapshot", tick: this.tick, players, ground: this.groundItems.slice(), npcs, hits, resources };
  }
}

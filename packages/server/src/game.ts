import type { Facing, MapData, PlayerState, SnapshotMsg, GroundItem, ItemStack, NpcState, HitEvent, ResourceState } from "@termenor/protocol";
import { NPC_KINDS, PLAYER_MAX_HP, WOODCUTTING_XP_PER_LOG, TREE_CHARGES, RESOURCE_RESPAWN_TICKS, levelForXp, RESOURCE_KINDS, SKILLS } from "@termenor/protocol";
import { type Point } from "./pathfinding";
import { emptyInventory, addToInventory } from "./inventory";
import type { PlayerEntity, NpcEntity, ResourceEntity, FireEntity, GameEvents } from "./entities";
import * as invSys from "./inventory-system";
import * as moveSys from "./movement-system";
import * as combatSys from "./combat-system";
import * as resourceSys from "./resource-system";
import * as gatherSys from "./gather-system";
import * as actionSys from "./action-system";

const GATHER_COOLDOWN_TICKS = 30;

export interface RestoredState {
  x: number;
  y: number;
  facing: Facing;
  inventory?: (ItemStack | null)[];
  skills?: Record<string, number>;
}

export class GameWorld {
  readonly map: MapData;
  spawn: Point;
  players = new Map<string, PlayerEntity>();
  tick = 0;
  groundItems: GroundItem[] = [];
  nextItemId = 1;
  npcs: NpcEntity[] = [];
  private nextNpcId = 1;
  rng: () => number;
  hits: HitEvent[] = [];
  resources: ResourceEntity[] = [];
  fires: FireEntity[] = [];
  nextResourceId = 1;
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
    combatSys.setTarget(this, playerId, targetId);
  }

  getPlayerState(id: string): RestoredState | null {
    const p = this.players.get(id);
    if (!p) return null;
    return { x: p.x, y: p.y, facing: p.facing, inventory: p.inventory, skills: p.skills };
  }

  queueMove(id: string, x: number, y: number): void {
    moveSys.queueMove(this, id, x, y);
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

    moveSys.stepMovement(this, dt);

    combatSys.stepCombat(this);

    combatSys.resolveDeaths(this);

    resourceSys.stepResources(this);

    gatherSys.stepGather(this);
  }

  addGroundItem(item: string, qty: number, x: number, y: number): void {
    invSys.addGroundItem(this, item, qty, x, y);
  }

  getInventory(id: string): (ItemStack | null)[] | null {
    const p = this.players.get(id);
    if (!p) return null;
    return p.inventory;
  }

  pickup(id: string): boolean {
    return invSys.pickup(this, id);
  }

  drop(id: string, slot: number): boolean {
    return invSys.drop(this, id, slot);
  }

  spawnResource(type: string, x: number, y: number): string {
    const id = `res-${this.nextResourceId++}`;
    const cfg = RESOURCE_KINDS[type];
    const charges = cfg?.charges ?? 0;
    this.resources.push({ id, type, x, y, home: { x, y }, charges, maxCharges: charges, respawnAt: -1 });
    return id;
  }

  gather(playerId: string, targetId: string): void {
    gatherSys.setGatherTarget(this, playerId, targetId);
  }

  use(playerId: string, action: string, slot: number): void {
    actionSys.use(this, playerId, action, slot);
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

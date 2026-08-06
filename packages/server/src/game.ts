import type { Facing, MapData, PlayerState, SnapshotMsg, GroundItem, ItemStack, NpcState, HitEvent, ResourceState, ShopEntry, Equipment, StopCondition } from "@termenor/protocol";
import { NPC_KINDS, PLAYER_MAX_HP, WOODCUTTING_XP_PER_LOG, TREE_CHARGES, RESOURCE_RESPAWN_TICKS, levelForXp, RESOURCE_KINDS, SKILLS, SHOPS, emptyEquipment } from "@termenor/protocol";
import { type Point } from "./pathfinding";
import { emptyInventory, addToInventory } from "./inventory";
import type { PlayerEntity, PlayerTransferState, NpcEntity, ResourceEntity, FireEntity, GameEvents } from "./entities";
import type { FactDraft, GameplayFact } from "./gameplay-facts";
import * as invSys from "./inventory-system";
import * as moveSys from "./movement-system";
import * as combatSys from "./combat-system";
import * as resourceSys from "./resource-system";
import * as gatherSys from "./gather-system";
import * as orderSys from "./order-system";
import * as actionSys from "./action-system";
import * as bankSys from "./bank-system";
import * as shopSys from "./shop-system";
import * as equipSys from "./equipment-system";
import * as trainSys from "./train-system";
import * as questSys from "./quest-system";

const GATHER_COOLDOWN_TICKS = 30;

export interface RestoredState {
  x: number;
  y: number;
  facing: Facing;
  inventory?: (ItemStack | null)[];
  skills?: Record<string, number>;
  bank?: ItemStack[];
  equipment?: Equipment;
  zone?: string;
  quests?: Record<string, number>;
}

export class GameWorld {
  /**
   * @internal — shared mutable surface for the System modules (movement, combat,
   * resource, gather, inventory, action). These fields are read/written by the
   * `*-system.ts` modules and are NOT part of the public command API. External
   * callers should go through the command methods below, not these fields.
   */
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
  events: GameEvents = {
    skillChanged: new Set(),
    levelUps: [],
    gatherNotices: [],
    orderNotices: [],
    facts: [],
    factSequence: 0,
  };
  /** @internal — in-memory shop stock; a deep copy of the SHOPS catalog so stock mutates without touching the imported constant. Read/written by shop-system. */
  shops: Record<string, { name: string; entries: ShopEntry[] }>;

  constructor(map: MapData, spawn: Point, rng: () => number = Math.random) {
    this.map = map;
    this.spawn = spawn;
    this.rng = rng;
    this.shops = {};
    for (const [id, shop] of Object.entries(SHOPS)) {
      this.shops[id] = { name: shop.name, entries: shop.entries.map((e) => ({ ...e })) };
    }
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
    const bank = state?.bank ?? [];
    const equipment = state?.equipment ?? emptyEquipment();
    this.players.set(id, { id, x, y, facing, path: [], inventory, hp: PLAYER_MAX_HP, maxHp: PLAYER_MAX_HP, target: null, attackCd: 0, skills, gatherTarget: null, gatherCd: 0, bank, equipment, order: null, trainReadyTick: 0, quests: state?.quests ?? {} });
  }

  removePlayer(id: string): void {
    this.players.delete(id);
  }

  removePlayerForTransfer(id: string): PlayerTransferState | null {
    const player = this.players.get(id);
    if (!player) return null;
    this.players.delete(id);
    const { id: _id, ...state } = player;
    return structuredClone(state);
  }

  addTransferredPlayer(id: string, state: PlayerTransferState, x: number, y: number): void {
    this.players.set(id, {
      ...state,
      id,
      x,
      y,
      path: [],
      target: null,
      gatherTarget: null,
    });
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
    return { x: p.x, y: p.y, facing: p.facing, inventory: p.inventory, skills: p.skills, bank: p.bank, equipment: p.equipment, quests: p.quests };
  }

  queueMove(id: string, x: number, y: number): void {
    moveSys.queueMove(this, id, x, y);
  }

  /** Advance the world by dt seconds. Pure orchestration of the System modules. */
  step(dt: number): void {
    this.tick++;
    orderSys.stepOrders(this);
    combatSys.stepNpcRespawn(this);
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

  inventoryAction(id: string, action: "examine", slot: number): boolean {
    if (!Number.isInteger(slot)) return false;
    const stack = this.players.get(id)?.inventory[slot];
    if (!stack) return false;
    this.emitFact({
      kind: "inventoryActionPerformed",
      playerId: id,
      action,
      item: stack.item,
    });
    return true;
  }

  viewPanel(id: string, panel: "skills"): boolean {
    if (!this.players.has(id)) return false;
    this.emitFact({ kind: "panelViewed", playerId: id, panel });
    return true;
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

  train(playerId: string, recipe: string): void {
    trainSys.train(this, playerId, recipe);
  }

  talk(playerId: string, npcId: string): void {
    questSys.talk(this, playerId, npcId);
  }

  getQuests(id: string): Record<string, number> {
    return this.players.get(id)?.quests ?? {};
  }

  // --- Banking (delegates to bank-system) ---
  openBank(id: string, boothId: string): boolean {
    return bankSys.openBank(this, id, boothId);
  }
  getBank(id: string): ItemStack[] {
    return bankSys.getBank(this, id);
  }
  deposit(id: string, invSlot: number, qty: number): boolean {
    return bankSys.deposit(this, id, invSlot, qty);
  }
  withdraw(id: string, bankIndex: number, qty: number): boolean {
    return bankSys.withdraw(this, id, bankIndex, qty);
  }

  // --- Shops (delegates to shop-system) ---
  openShop(id: string, npcId: string): string | null {
    return shopSys.openShop(this, id, npcId);
  }
  getShop(shopId: string): { name: string; entries: ShopEntry[] } | null {
    return shopSys.getShop(this, shopId);
  }
  buy(id: string, shopId: string, item: string, qty: number): boolean {
    return shopSys.buy(this, id, shopId, item, qty);
  }
  sell(id: string, shopId: string, item: string, qty: number): boolean {
    return shopSys.sell(this, id, shopId, item, qty);
  }

  // --- Equipment (delegates to equipment-system) ---
  getEquipment(id: string): Equipment {
    return equipSys.getEquipment(this, id);
  }
  equip(id: string, invSlot: number): boolean {
    const item = this.players.get(id)?.inventory[invSlot]?.item;
    const changed = equipSys.equip(this, id, invSlot);
    if (changed && item) {
      this.emitFact({ kind: "inventoryActionPerformed", playerId: id, action: "equip", item });
    }
    return changed;
  }
  unequip(id: string, equipIndex: number): boolean {
    return equipSys.unequip(this, id, equipIndex);
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

  emitFact(draft: FactDraft): void {
    this.events.facts.push({ ...draft, tick: this.tick, sequence: this.events.factSequence++ });
  }

  consumeFacts(): GameplayFact[] {
    const facts = this.events.facts;
    this.events.facts = [];
    this.events.factSequence = 0;
    return facts;
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

  // --- Standing orders (delegates to order-system) ---
  setOrder(id: string, activity: "gather" | "combat", targetType: string, stop: StopCondition): string {
    return orderSys.setOrder(this, id, activity, targetType, stop);
  }
  clearOrder(id: string): string {
    return orderSys.clearOrder(this, id);
  }
  consumeOrderNotices(): { id: string; text: string }[] {
    const notices = this.events.orderNotices;
    this.events.orderNotices = [];
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

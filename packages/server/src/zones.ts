import type { Facing, MapData } from "@termenor/protocol";
import { GameWorld, type RestoredState } from "./game";
import type { FactDraft, GameplayFact } from "./gameplay-facts";
import {
  advanceScenario,
  initialScenarioProgress,
  type ScenarioDef,
  type ScenarioProgress,
} from "./scenario";
import { ZONE_DEFS, DEFAULT_ZONE, type ZoneDef, type Portal } from "./world";

/** A player who crossed into a new zone this tick — used to push a ZoneMsg + reset their view. */
export interface ZoneTransition { id: string; zone: string; x: number; y: number; facing: Facing; }

export interface ZonesOptions {
  rngForZone?: (zoneId: string) => () => number;
  scenario?: ScenarioDef;
}

/**
 * The multi-zone world. Each zone is an independent `GameWorld` (its own map, entities, and
 * tick); a player lives in exactly one zone at a time and sees/interacts only within it.
 * Stepping onto a portal tile moves the player — carrying full state — into the target zone.
 * This is the natural sharding seam: a zone could later run in its own process untouched.
 */
export class Zones {
  private readonly worlds = new Map<string, GameWorld>();
  private readonly defs = new Map<string, ZoneDef>();
  private readonly location = new Map<string, string>(); // playerId -> zoneId
  private pending: ZoneTransition[] = [];
  private readonly scenario: ScenarioDef | undefined;
  private readonly progress = new Map<string, ScenarioProgress>();
  private readonly scenarioChanges = new Set<string>();
  private tick = 0;

  constructor(defs: ZoneDef[] = ZONE_DEFS, opts: ZonesOptions = {}) {
    this.scenario = opts.scenario;
    for (const def of defs) {
      this.defs.set(def.id, def);
      const world = new GameWorld(def.map, def.spawn, opts.rngForZone?.(def.id));
      for (const seed of def.seedItems) {
        world.addGroundItem(seed.item, seed.qty, seed.x, seed.y);
      }
      for (const npc of def.npcs) {
        world.spawnNpc(npc.type, npc.x, npc.y, npc.radius);
      }
      for (const resource of def.resources) {
        world.spawnResource(resource.type, resource.x, resource.y);
      }
      this.worlds.set(def.id, world);
    }
  }

  private resolve(zone: string | undefined): string {
    return zone && this.worlds.has(zone) ? zone : DEFAULT_ZONE;
  }

  world(zone: string): GameWorld {
    const w = this.worlds.get(zone);
    if (!w) throw new Error(`unknown zone: ${zone}`);
    return w;
  }
  worldOf(playerId: string): GameWorld { return this.world(this.zoneOf(playerId)); }
  zoneOf(playerId: string): string { return this.location.get(playerId) ?? DEFAULT_ZONE; }
  zoneIds(): string[] { return [...this.worlds.keys()]; }
  mapOf(zone: string): MapData { return this.world(zone).map; }
  addPlayer(id: string, state?: RestoredState): void {
    const requestedZone = state === undefined ? this.scenario?.startZone : state.zone;
    const zone = this.resolve(requestedZone);
    this.location.set(id, zone);
    this.world(zone).addPlayer(id, state);
    if (this.scenario) {
      this.progress.set(id, initialScenarioProgress(this.scenario));
    }
  }

  removePlayer(id: string): void {
    const zone = this.location.get(id);
    if (zone) this.world(zone).removePlayer(id);
    this.location.delete(id);
    this.progress.delete(id);
    this.scenarioChanges.delete(id);
  }

  /** Full restorable state including current zone, for persistence. */
  stateOf(id: string): (RestoredState & { zone: string }) | null {
    const s = this.worldOf(id).getPlayerState(id);
    return s ? { ...s, zone: this.zoneOf(id) } : null;
  }

  /** Step every zone, then move any player standing on a portal into the target zone. */
  step(dt: number): GameplayFact[] {
    this.tick++;
    const facts: GameplayFact[] = [];
    for (const world of this.worlds.values()) {
      world.step(dt);
      for (const fact of world.consumeFacts()) {
        facts.push({ ...fact, tick: this.tick, sequence: facts.length });
      }
    }
    facts.push(...this.applyTransitions(facts.length));
    this.advanceScenario(facts);
    return facts;
  }

  private applyTransitions(firstSequence: number): GameplayFact[] {
    const moves: { id: string; fromZone: string; world: GameWorld; portal: Portal }[] = [];
    for (const [zoneId, world] of this.worlds) {
      const portals = this.defs.get(zoneId)!.portals;
      for (const player of world.players.values()) {
        const portal = portals.find(
          (candidate) => Math.round(player.x) === candidate.x
            && Math.round(player.y) === candidate.y,
        );
        if (portal) {
          moves.push({ id: player.id, fromZone: zoneId, world, portal });
        }
      }
    }

    const transitionFacts: GameplayFact[] = [];
    const append = (fact: FactDraft) => {
      transitionFacts.push({
        ...fact,
        tick: this.tick,
        sequence: firstSequence + transitionFacts.length,
      });
    };

    for (const { id, fromZone, world, portal } of moves) {
      const state = world.removePlayerForTransfer(id);
      if (!state) continue;
      this.world(portal.toZone).addTransferredPlayer(
        id,
        state,
        portal.toX,
        portal.toY,
      );
      this.location.set(id, portal.toZone);
      this.pending.push({
        id,
        zone: portal.toZone,
        x: portal.toX,
        y: portal.toY,
        facing: state.facing,
      });
      append({ kind: "playerEnteredZone", playerId: id, zone: portal.toZone });
      if (
        this.scenario
        && this.scenario.exit.fromZone === fromZone
        && this.scenario.exit.toZone === portal.toZone
      ) {
        append({
          kind: "scenarioExitCrossed",
          playerId: id,
          scenarioId: this.scenario.id,
          fromZone,
          toZone: portal.toZone,
        });
      }
    }
    return transitionFacts;
  }

  private advanceScenario(facts: readonly GameplayFact[]): void {
    if (!this.scenario) return;
    const affected = new Set(facts.map((fact) => fact.playerId));
    for (const id of affected) {
      const progress = this.progress.get(id);
      if (!progress) continue;
      const next = advanceScenario(this.scenario, progress, facts, id);
      if (next === progress) continue;
      this.progress.set(id, next);
      this.scenarioChanges.add(id);
    }
  }

  progressOf(id: string): ScenarioProgress | null {
    return this.progress.get(id) ?? null;
  }

  consumeScenarioChanges(): string[] {
    const changed = [...this.scenarioChanges];
    this.scenarioChanges.clear();
    return changed;
  }
  consumeTransitions(): ZoneTransition[] {
    const t = this.pending;
    this.pending = [];
    return t;
  }
}

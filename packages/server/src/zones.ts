import type { Facing, MapData } from "@termenor/protocol";
import { GameWorld, type RestoredState } from "./game";
import type { PlayerTransferState } from "./entities";
import type { FactDraft, GameplayFact } from "./gameplay-facts";
import {
  advanceScenario,
  initialScenarioProgress,
  type ScenarioDef,
  type ScenarioProgress,
} from "./scenario";
import { ZONE_DEFS, DEFAULT_ZONE, type ZoneDef, type Portal } from "./world";
export type ZoneRestoredState = RestoredState & {
  scenario?: ScenarioProgress | null;
};
export type PersistablePlayerState = RestoredState & {
  zone: string;
  scenario: ScenarioProgress | null;
};

/** A player who crossed into a new zone this tick — used to push a ZoneMsg + reset their view. */
interface ZoneTransitionDestination {
  readonly id: string;
  readonly zone: string;
  readonly x: number;
  readonly y: number;
  readonly facing: Facing;
}
export interface CommittedZoneTransition extends ZoneTransitionDestination {
  readonly pending?: false;
}
export interface PendingZoneTransition extends ZoneTransitionDestination {
  readonly pending: true;
  readonly fromZone: string;
  readonly token: number;
}
export type ZoneTransition = CommittedZoneTransition | PendingZoneTransition;

interface DeferredTransition {
  transition: PendingZoneTransition;
  portal: Portal;
  state: PlayerTransferState;
  progressBefore: ScenarioProgress | null;
  scenarioChangedBeforeTransition: boolean;
}

function isRestorableProgress(
  definition: ScenarioDef,
  progress: ScenarioProgress | null | undefined,
): progress is ScenarioProgress {
  if (
    !progress
    || progress.scenarioId !== definition.id
    || progress.version !== definition.version
  ) {
    return false;
  }
  const objectiveIds = definition.objectives.map((objective) => objective.id);
  if (
    progress.completed.length > objectiveIds.length
    || progress.completed.some((objectiveId, index) => objectiveId !== objectiveIds[index])
  ) {
    return false;
  }
  const evidenceIds = new Set<string>();
  for (const evidence of progress.evidence) {
    if (
      !objectiveIds.includes(evidence.objectiveId)
      || evidenceIds.has(evidence.objectiveId)
    ) {
      return false;
    }
    evidenceIds.add(evidence.objectiveId);
  }
  return progress.completed.every((objectiveId) => evidenceIds.has(objectiveId))
    && progress.done === (progress.completed.length === objectiveIds.length);
}

export interface ZonesOptions {
  rngForZone?: (zoneId: string) => () => number;
  scenario?: ScenarioDef;
  deferTransitions?: boolean;
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
  private readonly staged = new Map<string, DeferredTransition>();
  private readonly suppressedPortals = new Map<
    string,
    { zone: string; x: number; y: number }
  >();
  private nextTransitionToken = 1;
  private readonly deferTransitions: boolean;
  private readonly scenario: ScenarioDef | undefined;
  private readonly progress = new Map<string, ScenarioProgress>();
  private readonly scenarioChanges = new Set<string>();
  private tick = 0;

  constructor(defs: ZoneDef[] = ZONE_DEFS, opts: ZonesOptions = {}) {
    this.scenario = opts.scenario;
    this.deferTransitions = opts.deferTransitions ?? false;
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
  addPlayer(id: string, state?: ZoneRestoredState): void {
    const requestedZone = state === undefined ? this.scenario?.startZone : state.zone;
    const zone = this.resolve(requestedZone);
    this.location.set(id, zone);
    this.world(zone).addPlayer(id, state);
    if (this.scenario) {
      const restored = state?.scenario;
      this.progress.set(
        id,
        isRestorableProgress(this.scenario, restored)
          ? structuredClone(restored)
          : initialScenarioProgress(this.scenario),
      );
    }
  }

  removePlayer(id: string): void {
    const zone = this.location.get(id);
    if (zone) this.world(zone).removePlayer(id);
    this.location.delete(id);
    this.progress.delete(id);
    this.scenarioChanges.delete(id);
    this.staged.delete(id);
    this.suppressedPortals.delete(id);
    this.pending = this.pending.filter((transition) => transition.id !== id);
  }

  stateOf(id: string): PersistablePlayerState | null {
    const s = this.worldOf(id).getPlayerState(id);
    return s
      ? {
          ...s,
          zone: this.zoneOf(id),
          scenario: this.progress.get(id) ?? null,
        }
      : null;
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
    this.advanceScenario(facts);
    const transitionFacts = this.applyTransitions(facts.length);
    facts.push(...transitionFacts);
    this.advanceScenario(transitionFacts);
    return facts;
  }

  private applyTransitions(firstSequence: number): GameplayFact[] {
    const moves: { id: string; fromZone: string; world: GameWorld; portal: Portal }[] = [];
    for (const [zoneId, world] of this.worlds) {
      const portals = this.defs.get(zoneId)!.portals;
      for (const player of world.players.values()) {
        const x = Math.round(player.x);
        const y = Math.round(player.y);
        const suppressed = this.suppressedPortals.get(player.id);
        if (
          suppressed
          && suppressed.zone === zoneId
          && suppressed.x === x
          && suppressed.y === y
        ) {
          continue;
        }
        if (suppressed) this.suppressedPortals.delete(player.id);
        const portal = portals.find(
          (candidate) => x === candidate.x && y === candidate.y,
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
      const destination = {
        id,
        zone: portal.toZone,
        x: portal.toX,
        y: portal.toY,
        facing: state.facing,
      };
      const isScenarioExit = this.scenario?.exit.fromZone === fromZone
        && this.scenario.exit.toZone === portal.toZone;
      let transition: ZoneTransition;
      if (this.deferTransitions && isScenarioExit) {
        const pending: PendingZoneTransition = {
          ...destination,
          fromZone,
          pending: true,
          token: this.nextTransitionToken++,
        };
        transition = pending;
        this.staged.set(id, {
          transition: pending,
          portal,
          state,
          progressBefore: this.progress.get(id) ?? null,
          scenarioChangedBeforeTransition: this.scenarioChanges.has(id),
        });
      } else {
        transition = destination;
        this.world(portal.toZone).addTransferredPlayer(
          id,
          state,
          portal.toX,
          portal.toY,
        );
        this.location.set(id, portal.toZone);
      }
      this.pending.push(transition);
      append({ kind: "playerEnteredZone", playerId: id, zone: portal.toZone });
      if (this.scenario && isScenarioExit) {
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

  private deferredFor(
    transition: PendingZoneTransition,
  ): DeferredTransition | null {
    const staged = this.staged.get(transition.id);
    return staged?.transition.token === transition.token ? staged : null;
  }

  pendingStateOf(
    transition: PendingZoneTransition,
  ): PersistablePlayerState | null {
    const staged = this.deferredFor(transition);
    if (!staged) return null;
    return {
      x: staged.transition.x,
      y: staged.transition.y,
      facing: staged.state.facing,
      inventory: staged.state.inventory,
      skills: staged.state.skills,
      bank: staged.state.bank,
      equipment: staged.state.equipment,
      zone: staged.transition.zone,
      quests: staged.state.quests,
      scenario: this.progress.get(transition.id) ?? null,
    };
  }

  commitTransition(transition: PendingZoneTransition): boolean {
    const staged = this.deferredFor(transition);
    if (!staged) return false;
    this.world(staged.transition.zone).addTransferredPlayer(
      transition.id,
      staged.state,
      staged.transition.x,
      staged.transition.y,
    );
    this.location.set(transition.id, staged.transition.zone);
    this.staged.delete(transition.id);
    return true;
  }

  rollbackTransition(transition: PendingZoneTransition): boolean {
    const staged = this.deferredFor(transition);
    if (!staged) return false;
    const rollback = this.rollbackPoint(staged);
    this.world(staged.transition.fromZone).addTransferredPlayer(
      transition.id,
      staged.state,
      rollback.point.x,
      rollback.point.y,
    );
    this.location.set(transition.id, staged.transition.fromZone);
    this.staged.delete(transition.id);
    if (rollback.suppressPortal) {
      this.suppressedPortals.set(transition.id, {
        zone: staged.transition.fromZone,
        x: rollback.point.x,
        y: rollback.point.y,
      });
    }
    if (staged.progressBefore) this.progress.set(transition.id, staged.progressBefore);
    else this.progress.delete(transition.id);
    if (staged.scenarioChangedBeforeTransition) {
      this.scenarioChanges.add(transition.id);
    } else {
      this.scenarioChanges.delete(transition.id);
    }
    return true;
  }

  private rollbackPoint(
    staged: DeferredTransition,
  ): { point: { x: number; y: number }; suppressPortal: boolean } {
    const fromZone = staged.transition.fromZone;
    const def = this.defs.get(fromZone);
    if (!def) throw new Error(`unknown rollback zone: ${fromZone}`);
    const candidates = [
      { x: staged.portal.x - 1, y: staged.portal.y },
      { x: staged.portal.x + 1, y: staged.portal.y },
      { x: staged.portal.x, y: staged.portal.y - 1 },
      { x: staged.portal.x, y: staged.portal.y + 1 },
    ];
    const walkable = ({ x, y }: { x: number; y: number }) =>
      x >= 0
      && y >= 0
      && x < def.map.width
      && y < def.map.height
      && def.map.tiles[y * def.map.width + x] === 0
      && !def.portals.some((portal) => portal.x === x && portal.y === y);
    const adjacent = candidates.find(walkable);
    return adjacent
      ? { point: adjacent, suppressPortal: false }
      : {
          point: { x: staged.portal.x, y: staged.portal.y },
          suppressPortal: true,
        };
  }

  consumeScenarioChanges(): string[] {
    const changed: string[] = [];
    for (const id of this.scenarioChanges) {
      if (this.staged.has(id)) continue;
      changed.push(id);
      this.scenarioChanges.delete(id);
    }
    return changed;
  }
  consumeTransitions(): ZoneTransition[] {
    const t = this.pending;
    this.pending = [];
    return t;
  }
}

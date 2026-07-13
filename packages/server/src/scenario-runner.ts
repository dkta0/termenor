import type { Intent } from "@termenor/protocol";
import type { GameplayFact } from "./gameplay-facts";
import { executeIntent, type IntentSession } from "./intent-executor";
import type { ScenarioDef, ScenarioProgress } from "./scenario";
import type { ZoneDef } from "./world";
import { Zones, type ZoneRestoredState, type ZoneTransition } from "./zones";

const TICK_SECONDS = 1 / 15;

export type ScenarioInput =
  | {
      tick: number;
      playerId: string;
      intent: Intent;
      inventoryAction?: never;
    }
  | {
      tick: number;
      playerId: string;
      intent?: never;
      inventoryAction: { action: "examine"; slot: number };
    };

export interface ScenarioTrace {
  scenarioId: string;
  version: number;
  seed: number;
  facts: GameplayFact[];
  transitions: ZoneTransition[];
  digests: { tick: number; digest: string }[];
  progress: Partial<Record<string, ScenarioProgress>>;
}

interface RunScenarioArgs {
  scenario: ScenarioDef;
  zones: ZoneDef[];
  seed: number;
  players: { id: string; state?: ZoneRestoredState; newScenarioPlayer?: boolean }[];
  inputs: ScenarioInput[];
  ticks: number;
}

interface RngState {
  seed: number;
  calls: number;
}

function seededRng(
  seed: number,
  zoneId: string,
  states: Map<string, RngState>,
): () => number {
  const tracked = { seed: seed >>> 0, calls: 0 };
  states.set(zoneId, tracked);
  let state = tracked.seed ^ 2166136261;
  for (let index = 0; index < zoneId.length; index++) {
    state ^= zoneId.charCodeAt(index);
    state = Math.imul(state, 16777619) >>> 0;
  }
  return () => {
    tracked.calls++;
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function compareIds(
  left: { id: string | number },
  right: { id: string | number },
): number {
  const a = String(left.id);
  const b = String(right.id);
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortedEntries<T>(map: ReadonlyMap<string, T>): [string, T][] {
  return [...map].sort(
    ([left], [right]) => left < right ? -1 : left > right ? 1 : 0,
  );
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== "object") return value;
  const object = value as Record<string, unknown>;
  const canonical: Record<string, unknown> = {};
  for (const key of Object.keys(object).sort()) {
    canonical[key] = canonicalize(object[key]);
  }
  return canonical;
}

function stateDigest(
  zones: Zones,
  playerIds: readonly string[],
  rngStates: ReadonlyMap<string, RngState>,
  sessions: ReadonlyMap<string, IntentSession>,
): string {
  const state = {
    zones: zones.zoneIds().sort().map((zoneId) => {
      const world = zones.world(zoneId);
      return {
        id: zoneId,
        tick: world.tick,
        spawn: world.spawn,
        players: [...world.players.values()].sort(compareIds),
        groundItems: [...world.groundItems].sort(compareIds),
        nextItemId: world.nextItemId,
        npcs: [...world.npcs].sort(compareIds),
        nextNpcId: world.npcs.length + 1,
        resources: [...world.resources].sort(compareIds),
        nextResourceId: world.nextResourceId,
        fires: [...world.fires].sort(compareIds),
        shops: world.shops,
      };
    }),
    progress: [...playerIds]
      .sort()
      .map((id) => ({ id, progress: zones.progressOf(id) })),
    rng: sortedEntries(rngStates)
      .map(([zoneId, rng]) => ({ zoneId, ...rng })),
    sessions: sortedEntries(sessions)
      .map(([id, session]) => ({ id, ...session })),
  };
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(JSON.stringify(canonicalize(state)));
  return hasher.digest("hex");
}

export function runScenario(args: RunScenarioArgs): ScenarioTrace {
  const rngStates = new Map<string, RngState>();
  const zones = new Zones(args.zones, {
    rngForZone: (zoneId) => seededRng(args.seed, zoneId, rngStates),
    scenario: args.scenario,
  });
  const sessions = new Map<string, IntentSession>();
  for (const player of args.players) {
    zones.addPlayer(player.id, player.state, {
      newScenarioPlayer: player.newScenarioPlayer ?? player.state?.scenario == null,
    });
    sessions.set(player.id, {});
  }

  const inputsByTick = new Map<number, ScenarioInput[]>();
  for (const input of args.inputs) {
    const scheduled = inputsByTick.get(input.tick);
    if (scheduled) scheduled.push(input);
    else inputsByTick.set(input.tick, [input]);
  }

  const facts: GameplayFact[] = [];
  const transitions: ZoneTransition[] = [];
  const digests: ScenarioTrace["digests"] = [];
  const playerIds = args.players.map((player) => player.id);
  for (let tick = 1; tick <= args.ticks; tick++) {
    for (const input of inputsByTick.get(tick) ?? []) {
      if (input.intent !== undefined) {
        executeIntent(
          zones.worldOf(input.playerId),
          input.playerId,
          input.intent,
          sessions.get(input.playerId) ?? {},
        );
      } else {
        const { action, slot } = input.inventoryAction;
        zones.worldOf(input.playerId).inventoryAction(input.playerId, action, slot);
      }
    }
    facts.push(...zones.step(TICK_SECONDS));
    transitions.push(...zones.consumeTransitions());
    digests.push({
      tick,
      digest: stateDigest(zones, playerIds, rngStates, sessions),
    });
  }

  const progress: Partial<Record<string, ScenarioProgress>> = {};
  for (const id of playerIds) {
    const playerProgress = zones.progressOf(id);
    if (playerProgress) progress[id] = playerProgress;
  }

  return {
    scenarioId: args.scenario.id,
    version: args.scenario.version,
    seed: args.seed,
    facts,
    transitions,
    progress,
    digests,
  };
}

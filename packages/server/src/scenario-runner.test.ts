import { expect, test } from "bun:test";
import type { MapData } from "@termenor/protocol";
import { runScenario } from "./scenario-runner";
import type { ScenarioDef } from "./scenario";
import type { ZoneDef } from "./world";
import { Zones } from "./zones";

function openMap(width = 8, height = 5): MapData {
  return {
    width,
    height,
    tiles: Array(width * height).fill(0),
    heights: Array(width * height).fill(0),
    scenery: [],
  };
}

const zones: ZoneDef[] = [
  {
    id: "tutorial",
    map: openMap(),
    spawn: { x: 1, y: 2 },
    seedItems: [],
    npcs: [{ type: "chef", x: 2, y: 2, radius: 0 }],
    resources: [{ type: "general_store", x: 1, y: 1 }],
    portals: [{ x: 3, y: 2, toZone: "overworld", toX: 6, toY: 2 }],
  },
  {
    id: "overworld",
    map: openMap(),
    spawn: { x: 6, y: 2 },
    seedItems: [],
    npcs: [],
    resources: [],
    portals: [],
  },
];

const scenario: ScenarioDef = {
  id: "deterministic_transfer",
  version: 3,
  startZone: "tutorial",
  initialItems: [],
  objectives: [
    { id: "meet", text: "Meet the guide.", when: { kind: "talkedTo", npcType: "chef" } },
    { id: "enter", text: "Enter the world.", when: { kind: "enteredZone", zone: "overworld" } },
  ],
  exit: { fromZone: "tutorial", toZone: "overworld" },
};

const inputs = [
  { tick: 1, playerId: "p", intent: { kind: "talk", targetId: "npc-1" } as const },
  { tick: 2, playerId: "p", intent: { kind: "move", x: 3, y: 2 } as const },
];

function deterministicRun() {
  return runScenario({
    scenario,
    zones,
    seed: 0x5eed,
    players: [{ id: "p", state: { x: 1, y: 2, facing: "east", zone: "tutorial" } }],
    inputs,
    ticks: 10,
  });
}

test("the same Scenario seed and inputs produce a byte-identical complete trace", () => {
  const first = deterministicRun();
  const second = deterministicRun();

  expect(first).toEqual(second);
  expect(first.facts).toEqual(second.facts);
  expect(first.transitions).toEqual(second.transitions);
  expect(first.digests).toEqual(second.digests);
  expect(first).toMatchObject({
    scenarioId: "deterministic_transfer",
    version: 3,
    seed: 0x5eed,
  });
  expect(first.facts.map((fact) => fact.kind)).toEqual([
    "playerTalked",
    "playerEnteredZone",
    "scenarioExitCrossed",
  ]);
  expect(first.transitions).toEqual([
    { id: "p", zone: "overworld", x: 6, y: 2, facing: "east" },
  ]);
  expect(first.digests).toHaveLength(10);
  expect(first.digests.every(({ digest }) => /^[0-9a-f]{64}$/.test(digest))).toBe(true);
  expect(first.facts[0]).toMatchObject({ tick: 1, sequence: 0 });
  const orderingKeys = first.facts.map((fact) => `${fact.tick}:${fact.sequence}`);
  expect(new Set(orderingKeys).size).toBe(orderingKeys.length);
});

test("a portal transfer advances each World exactly once in its outer Tick", () => {
  const simulation = new Zones(zones, { scenario });
  simulation.addPlayer("p", { x: 3, y: 2, facing: "east", zone: "tutorial" });

  const facts = simulation.step(1 / 15);

  expect(simulation.zoneOf("p")).toBe("overworld");
  expect(simulation.world("tutorial").tick).toBe(1);
  expect(simulation.world("overworld").tick).toBe(1);
  expect(facts.filter((fact) => fact.kind === "playerEnteredZone")).toEqual([
    { kind: "playerEnteredZone", playerId: "p", zone: "overworld", tick: 1, sequence: 0 },
  ]);
});

test("state digests canonicalize Zone, entity, and object-key insertion order", () => {
  const common = {
    scenario,
    seed: 41,
    inputs: [],
    ticks: 1,
  };
  const first = runScenario({
    ...common,
    zones,
    players: [
      {
        id: "b",
        state: {
          x: 1,
          y: 2,
          facing: "east" as const,
          zone: "tutorial",
          skills: { mining: 7, fishing: 11 },
          quests: { alpha: 1, beta: 2 },
        },
      },
      {
        id: "a",
        state: {
          x: 1,
          y: 3,
          facing: "west" as const,
          zone: "tutorial",
          skills: { mining: 13, fishing: 17 },
          quests: { alpha: 3, beta: 4 },
        },
      },
    ],
  });
  const second = runScenario({
    ...common,
    zones: [...zones].reverse(),
    players: [
      {
        id: "a",
        state: {
          x: 1,
          y: 3,
          facing: "west" as const,
          zone: "tutorial",
          skills: { fishing: 17, mining: 13 },
          quests: { beta: 4, alpha: 3 },
        },
      },
      {
        id: "b",
        state: {
          x: 1,
          y: 2,
          facing: "east" as const,
          zone: "tutorial",
          skills: { fishing: 11, mining: 7 },
          quests: { beta: 2, alpha: 1 },
        },
      },
    ],
  });

  expect(first.digests).toEqual(second.digests);
});

test("an omitted restored state starts the headless Player in the Scenario start Zone", () => {
  const trace = runScenario({
    scenario,
    zones,
    seed: 1,
    players: [{ id: "new-player" }],
    inputs: [{ tick: 1, playerId: "new-player", intent: { kind: "talk", targetId: "npc-1" } }],
    ticks: 1,
  });

  expect(trace.facts.map((fact) => fact.kind)).toEqual(["playerTalked"]);
});

test("state digests include future-affecting Intent session state", () => {
  const common = {
    scenario,
    zones,
    seed: 73,
    players: [{ id: "p", state: { x: 1, y: 2, facing: "east" as const, zone: "tutorial" } }],
    ticks: 1,
  };
  const closed = runScenario({ ...common, inputs: [] });
  const opened = runScenario({
    ...common,
    inputs: [
      {
        tick: 1,
        playerId: "p",
        intent: { kind: "openShop", targetId: "res-1" },
      },
    ],
  });

  expect(opened.digests).not.toEqual(closed.digests);
});

test("state digests include the deterministic RNG stream before visible divergence", () => {
  const quietZones = zones.map((zone) => ({
    ...zone,
    npcs: [],
    resources: [],
  }));
  const common = {
    scenario,
    zones: quietZones,
    players: [{ id: "p", state: { x: 1, y: 2, facing: "east" as const, zone: "tutorial" } }],
    inputs: [],
    ticks: 1,
  };
  const firstSeed = runScenario({ ...common, seed: 1 });
  const secondSeed = runScenario({ ...common, seed: 2 });

  expect(firstSeed.digests).not.toEqual(secondSeed.digests);
});

test("runScenario validates Scenario and runner boundaries before simulation", () => {
  expect(() => runScenario({
    scenario: { ...scenario, startZone: "missing" },
    zones,
    seed: 1,
    players: [{ id: "p" }],
    inputs: [],
    ticks: 1,
  })).toThrow("scenario deterministic_transfer: unknown start Zone missing");

  expect(() => runScenario({ scenario, zones, seed: 1.5, players: [{ id: "p" }], inputs: [], ticks: 1 }))
    .toThrow("Scenario seed must be a safe integer");
  expect(() => runScenario({ scenario, zones, seed: 1, players: [{ id: "p" }], inputs: [], ticks: 0 }))
    .toThrow("Scenario ticks must be a positive integer");
  expect(() => runScenario({ scenario, zones, seed: 1, players: [{ id: "p" }], inputs: [], ticks: 1.5 }))
    .toThrow("Scenario ticks must be a positive integer");
  expect(() => runScenario({ scenario, zones, seed: 1, players: [{ id: " " }], inputs: [], ticks: 1 }))
    .toThrow('Scenario Player at index 0 has a blank id');
  expect(() => runScenario({ scenario, zones, seed: 1, players: [{ id: "p" }, { id: "p" }], inputs: [], ticks: 1 }))
    .toThrow('Scenario Player at index 1 duplicates id "p"');
  expect(() => runScenario({
    scenario,
    zones,
    seed: 1,
    players: [{ id: "p" }],
    inputs: [{ tick: 2, playerId: "p", intent: { kind: "pickup" } }],
    ticks: 1,
  })).toThrow("Scenario input at index 0: Tick 2 is outside registered range 1..1");
});

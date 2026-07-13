import { expect, test } from "bun:test";
import type { MapData } from "@termenor/protocol";
import { emptyEquipment } from "@termenor/protocol";
import type { PlayerTransferState } from "./entities";
import type { ScenarioDef } from "./scenario";
import type { ZoneDef } from "./world";
import { Zones } from "./zones";

test("a new player starts in the overworld", () => {
  const z = new Zones();
  z.addPlayer("p1");
  expect(z.zoneOf("p1")).toBe("overworld");
  expect(z.worldOf("p1").players.has("p1")).toBe(true);
});

test("a saved cave player is restored into the cave, not the overworld", () => {
  const z = new Zones();
  z.addPlayer("p1", { x: 12, y: 12, facing: "south", zone: "cave" });
  expect(z.zoneOf("p1")).toBe("cave");
  expect(z.world("cave").players.has("p1")).toBe(true);
  expect(z.world("overworld").players.has("p1")).toBe(false);
});

test("an unknown saved zone falls back to the overworld", () => {
  const z = new Zones();
  z.addPlayer("p1", { x: 0, y: 0, facing: "south", zone: "atlantis" });
  expect(z.zoneOf("p1")).toBe("overworld");
});

test("stepping onto a portal moves the player to the target zone, carrying state", () => {
  const z = new Zones();
  z.addPlayer("p1");
  const p = z.worldOf("p1").players.get("p1")!;
  p.x = 30; p.y = 30;            // overworld portal tile → cave (12,12)
  p.skills = { mining: 100 };
  z.step(1 / 15);
  expect(z.zoneOf("p1")).toBe("cave");
  const moved = z.world("cave").players.get("p1")!;
  expect(Math.round(moved.x)).toBe(12);
  expect(Math.round(moved.y)).toBe(12);
  expect(moved.skills.mining).toBe(100); // full state carried across the boundary
  expect(z.world("overworld").players.has("p1")).toBe(false);
  const tr = z.consumeTransitions();
  expect(tr).toHaveLength(1);
  expect(tr[0]).toMatchObject({ id: "p1", zone: "cave" });
});

test("the destination tile is not itself a portal (no immediate bounce-back)", () => {
  const z = new Zones();
  z.addPlayer("p1");
  const p = z.worldOf("p1").players.get("p1")!;
  p.x = 30; p.y = 30;
  z.step(1 / 15);              // → cave
  z.consumeTransitions();
  z.step(1 / 15);              // a second step must NOT bounce back to overworld
  expect(z.zoneOf("p1")).toBe("cave");
});

test("stateOf includes the current zone for persistence", () => {
  const z = new Zones();
  z.addPlayer("p1", { x: 12, y: 12, facing: "south", zone: "cave" });
  expect(z.stateOf("p1")?.zone).toBe("cave");
});

test("zones have distinct maps", () => {
  const z = new Zones();
  expect(z.zoneIds()).toContain("overworld");
  expect(z.zoneIds()).toContain("cave");
  expect(z.mapOf("overworld").width).not.toBe(z.mapOf("cave").width);
});

function openMap(width = 8, height = 5): MapData {
  return {
    width,
    height,
    tiles: Array(width * height).fill(0),
    heights: Array(width * height).fill(0),
    scenery: [],
  };
}

const transferZones: ZoneDef[] = [
  {
    id: "tutorial",
    map: openMap(),
    spawn: { x: 1, y: 2 },
    seedItems: [],
    npcs: [],
    resources: [],
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

const transferScenario: ScenarioDef = {
  id: "transfer",
  version: 1,
  startZone: "tutorial",
  initialItems: [],
  objectives: [
    { id: "meet", text: "Meet the guide.", when: { kind: "talkedTo", npcType: "chef" } },
    { id: "enter", text: "Enter the world.", when: { kind: "enteredZone", zone: "overworld" } },
  ],
  exit: { fromZone: "tutorial", toZone: "overworld" },
};

function seededRng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

test("simulation transfer preserves every Player field except Zone-local references", () => {
  const zones = new Zones(transferZones);
  const source = zones.world("tutorial");
  const destination = zones.world("overworld");
  const original: PlayerTransferState = {
    x: 1,
    y: 2,
    facing: "east",
    path: [{ x: 2, y: 2 }],
    inventory: [{ item: "coins", qty: 17 }, null],
    hp: 3,
    maxHp: 12,
    target: "npc-7",
    attackCd: 5,
    skills: { mining: 101, fishing: 4 },
    gatherTarget: "res-3",
    gatherCd: 7,
    bank: [{ item: "logs", qty: 9 }],
    equipment: { ...emptyEquipment(), weapon: "bronze_sword" },
    order: {
      activity: "gather",
      targetType: "tree",
      stop: { kind: "count", n: 4 },
      unitsDone: 2,
      baselineYield: 6,
      engagedNpcId: null,
    },
    trainReadyTick: 9,
    quests: { cooks_assistant: 2 },
  };
  source.players.set("p", { id: "p", ...structuredClone(original) });

  const state = source.removePlayerForTransfer("p");
  expect(Object.keys(state!).sort()).toEqual([
    "attackCd",
    "bank",
    "equipment",
    "facing",
    "gatherCd",
    "gatherTarget",
    "hp",
    "inventory",
    "maxHp",
    "order",
    "path",
    "quests",
    "skills",
    "target",
    "trainReadyTick",
    "x",
    "y",
  ]);
  expect(state).toEqual(original);

  destination.addTransferredPlayer("p", state!, 6, 2);
  expect(destination.players.get("p")).toEqual({
    id: "p",
    ...original,
    x: 6,
    y: 2,
    path: [],
    target: null,
    gatherTarget: null,
  });
});

test("portal transfer keeps transient state and Scenario progress while clearing local targets", () => {
  const zones = new Zones(transferZones, {
    rngForZone: (zone) => seededRng(zone === "tutorial" ? 1 : 2),
    scenario: transferScenario,
  });
  zones.addPlayer("p", { x: 1, y: 2, facing: "east", zone: "tutorial" });
  const source = zones.worldOf("p");
  const player = source.players.get("p")!;
  player.hp = 3;
  player.gatherCd = 7;
  player.trainReadyTick = 9;
  source.emitFact({ kind: "playerTalked", playerId: "p", npcType: "chef" });

  const talkFacts = zones.step(1 / 15);
  expect(talkFacts.map((fact) => fact.kind)).toEqual(["playerTalked"]);
  expect(zones.progressOf("p")?.completed).toEqual(["meet"]);
  expect(zones.consumeScenarioChanges()).toEqual(["p"]);
  expect(zones.consumeScenarioChanges()).toEqual([]);

  zones.worldOf("p").queueMove("p", 3, 2);
  let steps = 0;
  let transitionFacts = talkFacts;
  while (zones.zoneOf("p") === "tutorial" && steps++ < 20) {
    transitionFacts = zones.step(1 / 15);
  }

  const moved = zones.worldOf("p").players.get("p")!;
  expect(zones.zoneOf("p")).toBe("overworld");
  expect({
    hp: moved.hp,
    gatherCd: moved.gatherCd,
    trainReadyTick: moved.trainReadyTick,
    target: moved.target,
    gatherTarget: moved.gatherTarget,
    path: moved.path,
  }).toEqual({
    hp: 3,
    gatherCd: 7,
    trainReadyTick: 9,
    target: null,
    gatherTarget: null,
    path: [],
  });
  expect(transitionFacts.map((fact) => fact.kind)).toEqual([
    "playerEnteredZone",
    "scenarioExitCrossed",
  ]);
  expect(zones.progressOf("p")).toMatchObject({
    completed: ["meet", "enter"],
    done: true,
  });
  expect(zones.consumeScenarioChanges()).toEqual(["p"]);
  expect(zones.consumeTransitions()).toEqual([
    { id: "p", zone: "overworld", x: 6, y: 2, facing: "east" },
  ]);
});

test("facts receive one stable outer-Tick sequence across Zones", () => {
  const simulation = new Zones(transferZones);
  simulation.addPlayer("tutorial-player", {
    x: 1,
    y: 2,
    facing: "east",
    zone: "tutorial",
  });
  simulation.addPlayer("world-player", {
    x: 6,
    y: 2,
    facing: "west",
    zone: "overworld",
  });
  simulation.world("tutorial").emitFact({
    kind: "playerTalked",
    playerId: "tutorial-player",
    npcType: "chef",
  });
  simulation.world("overworld").emitFact({
    kind: "playerTalked",
    playerId: "world-player",
    npcType: "chef",
  });

  expect(
    simulation.step(1 / 15).map((fact) => [
      fact.playerId,
      fact.tick,
      fact.sequence,
    ]),
  ).toEqual([
    ["tutorial-player", 1, 0],
    ["world-player", 1, 1],
  ]);
});

test("Zone RNG factories and World iteration preserve definition order", () => {
  const requested: string[] = [];
  const zones = new Zones([...transferZones].reverse(), {
    rngForZone: (zone) => {
      requested.push(zone);
      return seededRng(zone === "tutorial" ? 1 : 2);
    },
  });

  expect(zones.zoneIds()).toEqual(["overworld", "tutorial"]);
  expect(requested).toEqual(["overworld", "tutorial"]);
  expect(zones.world("tutorial").rng()).not.toBe(zones.world("overworld").rng());
});

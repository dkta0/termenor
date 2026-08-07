import { expect, test } from "bun:test";
import type { MapData } from "@termenor/protocol";
import { emptyEquipment } from "@termenor/protocol";
import type { PlayerTransferState } from "./entities";
import { initialScenarioProgress, type ScenarioDef } from "./scenario";
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
  zones.addPlayer("p", { x: 1, y: 2, facing: "east", zone: "tutorial" }, { newScenarioPlayer: true });
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

test("actor-specific Scenario facts only advance that Player and notify that Player", () => {
  const scenario: ScenarioDef = {
    ...deferredScenario,
    objectives: [{
      id: "meet",
      text: "Meet the guide.",
      when: { kind: "talkedTo", npcType: "chef" },
    }],
  };
  const zones = new Zones(transferZones, { scenario });
  zones.addPlayer("actor", { x: 1, y: 2, facing: "east", zone: "tutorial" }, { newScenarioPlayer: true });
  zones.addPlayer("observer", { x: 1, y: 2, facing: "east", zone: "tutorial" }, { newScenarioPlayer: true });
  zones.world("tutorial").emitFact({ kind: "playerTalked", playerId: "actor", npcType: "chef" });

  expect(zones.step(1 / 15).map((fact) => fact.kind)).toEqual(["playerTalked"]);
  expect(zones.progressOf("actor")?.completed).toEqual(["meet"]);
  expect(zones.progressOf("observer")?.completed).toEqual([]);
  expect(zones.consumeScenarioChanges()).toEqual(["actor"]);
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

const deferredScenario: ScenarioDef = {
  id: "first_steps",
  version: 1,
  startZone: "tutorial",
  initialItems: [],
  objectives: [
    { id: "enter_world", text: "Enter the world.", when: { kind: "enteredZone", zone: "overworld" } },
  ],
  exit: { fromZone: "tutorial", toZone: "overworld" },
};

test("deferred portal transition stays hidden until explicit commit", () => {
  const zones = new Zones(transferZones, {
    scenario: deferredScenario,
    deferTransitions: true,
  });
  zones.addPlayer("p", { x: 3, y: 2, facing: "east", zone: "tutorial" });

  zones.step(1 / 15);
  const [transition] = zones.consumeTransitions();

  expect(transition).toMatchObject({
    pending: true,
    id: "p",
    zone: "overworld",
    x: 6,
    y: 2,
    facing: "east",
  });
  if (!transition || transition.pending !== true) {
    throw new Error("expected a pending transition");
  }
  expect(transition.token).toBeNumber();
  expect(zones.zoneOf("p")).toBe("tutorial");
  expect(zones.world("tutorial").players.has("p")).toBe(false);
  expect(zones.world("overworld").players.has("p")).toBe(false);
  expect(zones.pendingStateOf(transition)).toMatchObject({
    x: 6,
    y: 2,
    facing: "east",
    zone: "overworld",
  });

  expect(zones.commitTransition(transition)).toBe(true);
  expect(zones.zoneOf("p")).toBe("overworld");
  expect(zones.world("overworld").players.get("p")).toMatchObject({ x: 6, y: 2 });
});

test("rejected deferred transition rolls back beside the source portal without retriggering", () => {
  const zones = new Zones(transferZones, {
    scenario: deferredScenario,
    deferTransitions: true,
  });
  zones.addPlayer("p", {
    x: 3,
    y: 2,
    facing: "east",
    zone: "tutorial",
    scenario: initialScenarioProgress(deferredScenario),
  });

  zones.step(1 / 15);
  const [transition] = zones.consumeTransitions();
  if (!transition || transition.pending !== true) {
    throw new Error("expected a pending transition");
  }
  expect(zones.progressOf("p")?.done).toBe(true);

  expect(zones.rollbackTransition(transition)).toBe(true);
  expect(zones.zoneOf("p")).toBe("tutorial");
  expect(zones.world("tutorial").players.get("p")).toMatchObject({ x: 2, y: 2 });
  expect(zones.progressOf("p")).toMatchObject({
    completed: [],
    evidence: [],
    done: false,
  });
  expect(zones.consumeScenarioChanges()).toEqual([]);

  zones.worldOf("p").queueMove("p", 1, 2);
  for (let tick = 0; tick < 10; tick++) zones.step(1 / 15);

  expect(zones.consumeTransitions()).toEqual([]);
  expect(zones.worldOf("p").players.get("p")!.x).toBeLessThan(2);
});

test("an old pending handle cannot finalize a newer transition for the same Player", () => {
  const zones = new Zones(transferZones, {
    scenario: deferredScenario,
    deferTransitions: true,
  });
  zones.addPlayer("p", { x: 3, y: 2, facing: "east", zone: "tutorial" });
  zones.step(1 / 15);
  const [oldTransition] = zones.consumeTransitions();
  if (!oldTransition || oldTransition.pending !== true) {
    throw new Error("expected the first pending transition");
  }

  zones.removePlayer("p");
  zones.addPlayer("p", { x: 3, y: 2, facing: "east", zone: "tutorial" });
  zones.step(1 / 15);
  const [newTransition] = zones.consumeTransitions();
  if (!newTransition || newTransition.pending !== true) {
    throw new Error("expected the replacement pending transition");
  }

  expect(zones.commitTransition(oldTransition)).toBe(false);
  expect(zones.pendingStateOf(newTransition)).not.toBeNull();
  expect(zones.rollbackTransition(newTransition)).toBe(true);
  expect(zones.zoneOf("p")).toBe("tutorial");
});

test("same-version impossible persisted progress resets without touching Player state", () => {
  const zones = new Zones(transferZones, { scenario: deferredScenario });
  const inventory = [{ item: "logs", qty: 3 }, null];
  zones.addPlayer("p", {
    x: 2,
    y: 3,
    facing: "west",
    zone: "tutorial",
    inventory,
    skills: { woodcutting: 42 },
    scenario: {
      scenarioId: deferredScenario.id,
      version: deferredScenario.version,
      completed: ["bogus"],
      evidence: [],
      done: true,
    },
  });

  expect(zones.progressOf("p")).toEqual({
    scenarioId: "first_steps",
    version: 1,
    completed: [],
    evidence: [],
    done: false,
  });
  expect(zones.stateOf("p")).toMatchObject({
    x: 2,
    y: 3,
    facing: "west",
    inventory,
    skills: { woodcutting: 42 },
    zone: "tutorial",
  });
});

test("rollback keeps non-transition evidence produced in the exit Tick", () => {
  const evidenceScenario: ScenarioDef = {
    ...deferredScenario,
    objectives: [
      {
        id: "gain_xp",
        text: "Gain Woodcutting experience.",
        when: { kind: "gainedSkillXp", skill: "woodcutting", atLeast: 5 },
      },
      deferredScenario.objectives[0],
    ],
  };
  const zones = new Zones(transferZones, {
    scenario: evidenceScenario,
    deferTransitions: true,
  });
  zones.addPlayer("p", {
    x: 3,
    y: 2,
    facing: "east",
    zone: "tutorial",
    scenario: initialScenarioProgress(evidenceScenario),
  });
  zones.worldOf("p").emitFact({
    kind: "skillXpGained",
    playerId: "p",
    skill: "woodcutting",
    amount: 5,
  });

  zones.step(1 / 15);
  const [transition] = zones.consumeTransitions();
  if (!transition || transition.pending !== true) {
    throw new Error("expected a pending transition");
  }
  expect(zones.progressOf("p")?.done).toBe(true);

  zones.rollbackTransition(transition);

  expect(zones.progressOf("p")).toMatchObject({
    completed: ["gain_xp"],
    evidence: [{ objectiveId: "gain_xp", tick: 1 }],
    done: false,
  });
});

test("rollback without an adjacent safe tile suppresses automatic portal retry", () => {
  const trappedZones: ZoneDef[] = [
    {
      id: "tutorial",
      map: {
        width: 3,
        height: 3,
        tiles: [1, 1, 1, 1, 0, 1, 1, 1, 1],
        heights: Array(9).fill(0),
        scenery: [],
      },
      spawn: { x: 1, y: 1 },
      seedItems: [],
      npcs: [],
      resources: [],
      portals: [{ x: 1, y: 1, toZone: "overworld", toX: 1, toY: 1 }],
    },
    {
      id: "overworld",
      map: openMap(3, 3),
      spawn: { x: 1, y: 1 },
      seedItems: [],
      npcs: [],
      resources: [],
      portals: [],
    },
  ];
  const zones = new Zones(trappedZones, {
    scenario: deferredScenario,
    deferTransitions: true,
  });
  zones.addPlayer("p", { x: 1, y: 1, facing: "east", zone: "tutorial" });
  zones.step(1 / 15);
  const [transition] = zones.consumeTransitions();
  if (!transition || transition.pending !== true) {
    throw new Error("expected a pending transition");
  }

  zones.rollbackTransition(transition);
  for (let tick = 0; tick < 5; tick++) zones.step(1 / 15);

  expect(zones.zoneOf("p")).toBe("tutorial");
  expect(zones.worldOf("p").players.get("p")).toMatchObject({ x: 1, y: 1 });
  expect(zones.consumeTransitions()).toEqual([]);
});

test("only the authored Scenario exit is deferred", () => {
  const zonesWithTravel: ZoneDef[] = [
    transferZones[0],
    {
      ...transferZones[1],
      portals: [{ x: 6, y: 2, toZone: "cave", toX: 2, toY: 2 }],
    },
    {
      id: "cave",
      map: openMap(),
      spawn: { x: 2, y: 2 },
      seedItems: [],
      npcs: [],
      resources: [],
      portals: [],
    },
  ];
  const zones = new Zones(zonesWithTravel, {
    scenario: deferredScenario,
    deferTransitions: true,
  });
  zones.addPlayer("p", { x: 6, y: 2, facing: "east", zone: "overworld" });

  zones.step(1 / 15);
  const [transition] = zones.consumeTransitions();

  expect(transition).toEqual({
    id: "p",
    zone: "cave",
    x: 2,
    y: 2,
    facing: "east",
  });
  expect(zones.zoneOf("p")).toBe("cave");
  expect(zones.world("cave").players.has("p")).toBe(true);
});

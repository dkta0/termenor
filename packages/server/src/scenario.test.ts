import { describe, expect, test } from "bun:test";
import type { MapData } from "@termenor/protocol";
import { advanceScenario, currentObjective, initialScenarioProgress, validateScenario, type ObjectiveWhen, type ScenarioDef } from "./scenario";
import type { ZoneDef } from "./world";
import type { GameplayFact } from "./gameplay-facts";

const map: MapData = { width: 5, height: 5, tiles: Array(25).fill(0), heights: Array(25).fill(0), scenery: [] };
const zones: ZoneDef[] = [
  { id: "tutorial", map, spawn: { x: 1, y: 1 }, seedItems: [], npcs: [{ type: "chef", x: 1, y: 2, radius: 0 }], resources: [{ type: "tree", x: 2, y: 2 }], portals: [{ x: 3, y: 3, toZone: "overworld", toX: 1, toY: 1 }] },
  { id: "overworld", map, spawn: { x: 1, y: 1 }, seedItems: [], npcs: [], resources: [], portals: [] },
];

const valid: ScenarioDef = {
  id: "first_steps",
  version: 1,
  startZone: "tutorial",
  initialItems: [],
  objectives: [
    { id: "meet_guide", text: "Talk to the guide.", when: { kind: "talkedTo", npcType: "chef" } },
    { id: "gather_logs", text: "Gather logs from a tree.", when: { kind: "gathered", resourceType: "tree", item: "logs" } },
    { id: "leave", text: "Cross into Termenor.", when: { kind: "enteredZone", zone: "overworld" } },
  ],
  exit: { fromZone: "tutorial", toZone: "overworld" },
};

describe("validateScenario", () => {
  test("accepts a reachable typed scenario", () => expect(validateScenario(valid, zones)).toEqual([]));

  test("reports the exact missing reference path", () => {
    const broken = structuredClone(valid);
    broken.objectives[1] = { id: "gather_logs", text: "Gather.", when: { kind: "gathered", resourceType: "missing", item: "logs" } };
    expect(validateScenario(broken, zones)).toContain("scenario first_steps objective gather_logs: unknown Resource missing");
  });

  test("rejects duplicate objective ids", () => {
    const broken = { ...valid, objectives: [valid.objectives[0], valid.objectives[0]] };
    expect(validateScenario(broken, zones)).toContain("scenario first_steps: duplicate objective meet_guide");
  });

  test("rejects exit referencing unknown destination Zone", () => {
    const broken = { ...valid, exit: { fromZone: "tutorial", toZone: "missing" } };
    expect(validateScenario(broken, zones)).toContain("scenario first_steps exit: unknown destination Zone missing");
  });

  test("rejects exit not backed by a matching portal", () => {
    const noPortalZones = structuredClone(zones);
    noPortalZones[0].portals = [];
    expect(validateScenario(valid, noPortalZones)).toEqual(["scenario first_steps exit: no portal from tutorial to overworld"]);
  });

  test("rejects a blocked Zone spawn tile", () => {
    const blockedSpawnZones = structuredClone(zones);
    blockedSpawnZones[0].map = structuredClone(map);
    blockedSpawnZones[0].map.tiles[blockedSpawnZones[0].spawn.y * blockedSpawnZones[0].map.width + blockedSpawnZones[0].spawn.x] = 1;
    expect(validateScenario(valid, blockedSpawnZones)).toEqual(["Zone tutorial spawn: tile is blocked or out of bounds"]);
  });

  test("rejects a portal referencing an unknown destination Zone", () => {
    const unknownPortalZones = structuredClone(zones);
    unknownPortalZones[0].portals.push({ x: 4, y: 4, toZone: "missing", toX: 1, toY: 1 });
    expect(validateScenario(valid, unknownPortalZones)).toEqual(["Zone tutorial portal 1: unknown destination Zone missing"]);
  });

  test("validates initial Item ids", () => {
    const broken = { ...valid, initialItems: [{ item: "missing", qty: 1 }] };
    expect(validateScenario(broken, zones)).toContain("scenario first_steps initialItems 0: unknown Item missing");
  });

  test.each([0, -1, 1.5])("rejects initial Item quantity %p", (qty) => {
    const broken = { ...valid, initialItems: [{ item: "logs", qty }] };
    expect(validateScenario(broken, zones)).toContain("scenario first_steps initialItems 0: qty must be a positive integer");
  });
});

test("new progress presents the first objective", () => {
  const progress = initialScenarioProgress(valid);
  expect(progress).toEqual({ scenarioId: "first_steps", version: 1, completed: [], evidence: [], done: false });
  expect(currentObjective(valid, progress)?.id).toBe("meet_guide");
});

test("early facts are retained and objectives advance once in authored order", () => {
  const def: ScenarioDef = {
    id: "ordered",
    version: 1,
    startZone: "tutorial",
    initialItems: [],
    objectives: [
      { id: "talk", text: "Talk.", when: { kind: "talkedTo", npcType: "chef" } },
      { id: "gather", text: "Gather.", when: { kind: "gathered", resourceType: "tree", item: "logs" } },
    ],
    exit: { fromZone: "tutorial", toZone: "overworld" },
  };
  const progress = initialScenarioProgress(def);
  const gather = [
    { kind: "resourceGathered", tick: 4, sequence: 0, playerId: "p", resourceType: "tree", item: "logs", qty: 1 },
  ] as const;

  const waiting = advanceScenario(def, progress, gather, "p");
  expect(waiting.completed).toEqual([]);
  expect(waiting.evidence).toEqual([{ objectiveId: "gather", tick: 4 }]);

  const next = advanceScenario(def, waiting, [
    { kind: "playerTalked", tick: 5, sequence: 0, playerId: "p", npcType: "chef" },
  ], "p");
  expect(next.completed).toEqual(["talk", "gather"]);
  expect(next.done).toBe(true);
  expect(advanceScenario(def, next, [...gather], "p")).toBe(next);
});

test("facts from another player do not provide objective evidence", () => {
  const progress = initialScenarioProgress(valid);
  const facts = [
    { kind: "playerTalked", tick: 1, sequence: 0, playerId: "other", npcType: "chef" },
  ] as const;

  expect(advanceScenario(valid, progress, facts, "p")).toBe(progress);
});

const matcherCases: {
  name: string;
  when: ObjectiveWhen;
  fact: GameplayFact;
  nearMiss: GameplayFact;
}[] = [
  {
    name: "talked-to NPC",
    when: { kind: "talkedTo", npcType: "chef" },
    fact: { kind: "playerTalked", playerId: "p", npcType: "chef", tick: 1, sequence: 0 },
    nearMiss: { kind: "playerTalked", playerId: "p", npcType: "goblin", tick: 1, sequence: 0 },
  },
  {
    name: "gathered resource type",
    when: { kind: "gathered", resourceType: "tree", item: "logs" },
    fact: { kind: "resourceGathered", playerId: "p", resourceType: "tree", item: "logs", qty: 1, tick: 1, sequence: 0 },
    nearMiss: { kind: "resourceGathered", playerId: "p", resourceType: "copper_rock", item: "logs", qty: 1, tick: 1, sequence: 0 },
  },
  {
    name: "gathered item",
    when: { kind: "gathered", resourceType: "tree", item: "logs" },
    fact: { kind: "resourceGathered", playerId: "p", resourceType: "tree", item: "logs", qty: 1, tick: 1, sequence: 0 },
    nearMiss: { kind: "resourceGathered", playerId: "p", resourceType: "tree", item: "copper_ore", qty: 1, tick: 1, sequence: 0 },
  },
  {
    name: "produced item",
    when: { kind: "produced", source: "recipe", operation: "fletch_arrow_shafts", item: "arrow_shafts" },
    fact: { kind: "itemProduced", playerId: "p", source: "recipe", operation: "fletch_arrow_shafts", item: "arrow_shafts", qty: 15, tick: 1, sequence: 0 },
    nearMiss: { kind: "itemProduced", playerId: "p", source: "action", operation: "fletch_arrow_shafts", item: "arrow_shafts", qty: 15, tick: 1, sequence: 0 },
  },
  {
    name: "inventory action",
    when: { kind: "inventoryAction", action: "examine", item: "arrow_shafts" },
    fact: { kind: "inventoryActionPerformed", playerId: "p", action: "examine", item: "arrow_shafts", tick: 2, sequence: 0 },
    nearMiss: { kind: "inventoryActionPerformed", playerId: "p", action: "drop", item: "arrow_shafts", tick: 2, sequence: 0 },
  },
  {
    name: "skill XP at the threshold",
    when: { kind: "gainedSkillXp", skill: "fletching", atLeast: 5 },
    fact: { kind: "skillXpGained", playerId: "p", skill: "fletching", amount: 5, tick: 3, sequence: 0 },
    nearMiss: { kind: "skillXpGained", playerId: "p", skill: "fletching", amount: 4, tick: 3, sequence: 0 },
  },
  {
    name: "entered Zone",
    when: { kind: "enteredZone", zone: "overworld" },
    fact: { kind: "playerEnteredZone", playerId: "p", zone: "overworld", tick: 4, sequence: 0 },
    nearMiss: { kind: "playerEnteredZone", playerId: "p", zone: "tutorial", tick: 4, sequence: 0 },
  },
];

for (const { name, when, fact, nearMiss } of matcherCases) {
  test(`scenario evaluation matches ${name} and rejects its near miss`, () => {
    const def: ScenarioDef = {
      id: "matcher",
      version: 1,
      startZone: "tutorial",
      initialItems: [],
      objectives: [{ id: "objective", text: "Do it.", when }],
      exit: { fromZone: "tutorial", toZone: "overworld" },
    };
    const progress = initialScenarioProgress(def);

    expect(advanceScenario(def, progress, [nearMiss], "p")).toBe(progress);
    expect(advanceScenario(def, progress, [fact], "p")).toEqual({
      ...progress,
      completed: ["objective"],
      evidence: [{ objectiveId: "objective", tick: fact.tick }],
      done: true,
    });
  });
}

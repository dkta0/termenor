import { describe, expect, test } from "bun:test";
import type { MapData } from "@termenor/protocol";
import { currentObjective, initialScenarioProgress, validateScenario, type ScenarioDef } from "./scenario";
import type { ZoneDef } from "./world";

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

  test("rejects an exit that is not backed by a matching portal", () => {
    const broken = { ...valid, exit: { fromZone: "tutorial", toZone: "missing" } };
    expect(validateScenario(broken, zones)).toContain("scenario first_steps exit: unknown destination Zone missing");
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

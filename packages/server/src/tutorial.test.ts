import { expect, test } from "bun:test";
import { NPC_KINDS, RESOURCE_KINDS } from "@termenor/protocol";
import { emptyInventory } from "./inventory";
import { findPath } from "./pathfinding";
import { runScenario } from "./scenario-runner";
import { validateScenario, type ScenarioDef } from "./scenario";
import { TUTORIAL_SCENARIO, TUTORIAL_ZONE } from "./tutorial";
import { SPAWN, ZONE_DEFS } from "./world";
import { Zones } from "./zones";

const tutorialZones = [TUTORIAL_ZONE, ...ZONE_DEFS];

function restoredEmptyAccount() {
  return {
    x: SPAWN.x,
    y: SPAWN.y,
    facing: "south" as const,
    zone: "overworld",
    inventory: emptyInventory(),
  };
}

test("the First Steps content validates against the live Zone and catalogs", () => {
  expect(validateScenario(TUTORIAL_SCENARIO, tutorialZones)).toEqual([]);
  expect(TUTORIAL_SCENARIO).toMatchObject({
    id: "first_steps",
    version: 1,
    startZone: "tutorial",
    initialItems: [{ item: "bronze_axe", qty: 1 }],
    exit: { fromZone: "tutorial", toZone: "overworld" },
  });
  expect(TUTORIAL_SCENARIO.objectives).toEqual([
    { id: "meet_guide", text: "Talk to the guide.", when: { kind: "talkedTo", npcType: "chef" } },
    { id: "gather_logs", text: "Find a tree and gather logs.", when: { kind: "gathered", resourceType: "tree", item: "logs" } },
    { id: "fletch_logs", text: "Select the logs and make arrow shafts.", when: { kind: "produced", source: "recipe", operation: "fletch_arrow_shafts", item: "arrow_shafts" } },
    { id: "use_inventory", text: "Examine the arrow shafts in your Inventory.", when: { kind: "inventoryAction", action: "examine", item: "arrow_shafts" } },
    { id: "gain_fletching_xp", text: "Review your new Fletching experience.", when: { kind: "gainedSkillXp", skill: "fletching", atLeast: 5 } },
    { id: "enter_world", text: "Cross into Termenor.", when: { kind: "enteredZone", zone: "overworld" } },
  ]);
});

test("the nonlethal map exposes three readable, navigable beats", () => {
  expect(TUTORIAL_ZONE.map).toMatchObject({ width: 16, height: 12 });
  expect(TUTORIAL_ZONE.npcs).toContainEqual({ type: "chef", x: 3, y: 3, radius: 0 });
  expect(TUTORIAL_ZONE.npcs.every((npc) => (NPC_KINDS[npc.type]?.maxHit ?? 1) === 0)).toBe(true);
  expect(TUTORIAL_ZONE.resources.filter((resource) => resource.type === "tree")).toHaveLength(2);

  const scenery = TUTORIAL_ZONE.map.scenery ?? [];
  const work = scenery.find((placed) => placed.model === "crate");
  const overlook = scenery.find((placed) => placed.model === "cliff");
  const exit = TUTORIAL_ZONE.portals.find((portal) => portal.toZone === "overworld");
  expect(work).toBeDefined();
  expect(overlook).toBeDefined();
  expect(exit).toMatchObject({ toX: SPAWN.x, toY: SPAWN.y });

  const targets = [
    ...TUTORIAL_ZONE.npcs,
    ...TUTORIAL_ZONE.resources,
    work!,
    exit!,
  ];
  for (const target of targets) {
    expect(findPath(TUTORIAL_ZONE.map, TUTORIAL_ZONE.spawn, target)).not.toBeNull();
  }
});

test("new Scenario Players receive independent loadouts and two Players can gather", () => {
  const zones = new Zones(tutorialZones, {
    scenario: TUTORIAL_SCENARIO,
    rngForZone: () => () => 0,
  });
  zones.addPlayer("one", restoredEmptyAccount(), { newScenarioPlayer: true });
  zones.addPlayer("two", restoredEmptyAccount(), { newScenarioPlayer: true });

  expect(zones.zoneOf("one")).toBe("tutorial");
  expect(zones.zoneOf("two")).toBe("tutorial");
  expect(zones.worldOf("one").getInventory("one")?.filter((stack) => stack?.item === "bronze_axe")).toEqual([
    { item: "bronze_axe", qty: 1 },
  ]);
  expect(zones.worldOf("two").getInventory("two")?.filter((stack) => stack?.item === "bronze_axe")).toEqual([
    { item: "bronze_axe", qty: 1 },
  ]);
  expect(zones.worldOf("one").getInventory("one")).not.toBe(zones.worldOf("two").getInventory("two"));

  const world = zones.world("tutorial");
  expect(world.resources).toHaveLength(2);
  const axeSlot = world.getInventory("one")!.findIndex((stack) => stack?.item === "bronze_axe");
  expect(world.drop("one", axeSlot)).toBe(true);
  expect(world.pickup("one")).toBe(true);
  expect(world.getInventory("one")?.some((stack) => stack?.item === "bronze_axe")).toBe(true);
  world.gather("one", world.resources[0].id);
  world.gather("two", world.resources[1].id);
  const facts = [];
  for (let tick = 0; tick < 60; tick++) facts.push(...zones.step(1 / 15));

  expect(facts.filter((fact) => fact.kind === "resourceGathered").map((fact) => fact.playerId)).toEqual([
    "one",
    "two",
    "one",
    "two",
  ]);
  expect(world.getInventory("one")?.some((stack) => stack?.item === "logs")).toBe(true);
  expect(world.getInventory("two")?.some((stack) => stack?.item === "logs")).toBe(true);
  expect(RESOURCE_KINDS.tree.respawnTicks).toBeGreaterThan(0);
});

test("a restored active Scenario Player reacquires a required loadout after another Player picks it up", () => {
  const zones = new Zones(tutorialZones, { scenario: TUTORIAL_SCENARIO });
  zones.addPlayer("owner", restoredEmptyAccount(), { newScenarioPlayer: true });
  zones.addPlayer("other", restoredEmptyAccount(), { newScenarioPlayer: true });
  const world = zones.world("tutorial");
  const axeSlot = world.getInventory("owner")!.findIndex((stack) => stack?.item === "bronze_axe");

  expect(world.drop("owner", axeSlot)).toBe(true);
  expect(world.pickup("other")).toBe(true);
  expect(world.getInventory("owner")?.some((stack) => stack?.item === "bronze_axe")).toBe(false);
  const restored = structuredClone(zones.stateOf("owner")!);
  zones.removePlayer("owner");

  zones.addPlayer("owner", restored, { newScenarioPlayer: false });

  expect(zones.progressOf("owner")).toEqual(restored.scenario);
  expect(world.getInventory("owner")?.filter((stack) => stack?.item === "bronze_axe")).toEqual([
    { item: "bronze_axe", qty: 1 },
  ]);
  expect(world.groundItems.some((stack) => stack.item === "bronze_axe")).toBe(false);
});

test("an existing account without Scenario progress stays unenrolled", () => {
  const inventory = emptyInventory();
  inventory[4] = { item: "logs", qty: 3 };
  const zones = new Zones(tutorialZones, { scenario: TUTORIAL_SCENARIO });
  zones.addPlayer("returner", {
    ...restoredEmptyAccount(),
    x: 25,
    y: 24,
    inventory,
    scenario: null,
  }, { newScenarioPlayer: false });

  expect(zones.zoneOf("returner")).toBe("overworld");
  expect(zones.worldOf("returner").getInventory("returner")?.[4]).toEqual({ item: "logs", qty: 3 });
  expect(zones.progressOf("returner")).toBeNull();
});

test("the Scenario exit rejects a premature crossing with the current objective", () => {
  const zones = new Zones(tutorialZones, { scenario: TUTORIAL_SCENARIO });
  zones.addPlayer("learner", restoredEmptyAccount(), { newScenarioPlayer: true });
  zones.worldOf("learner").queueMove("learner", 14, 9);
  for (let tick = 0; tick < 100; tick++) zones.step(1 / 15);

  expect(zones.zoneOf("learner")).toBe("tutorial");
  expect(zones.consumeTransitions()).toEqual([]);
  expect(zones.progressOf("learner")).toMatchObject({
    completed: [],
    evidence: [],
    done: false,
  });
  expect(zones.worldOf("learner").consumeGatherNotices()).toEqual([
    { id: "learner", text: "Finish your current objective: Talk to the guide." },
  ]);
});

test("finishing the last prerequisite on a suppressed exit crosses without stepping away", () => {
  const zones = new Zones(tutorialZones, { scenario: TUTORIAL_SCENARIO });
  zones.addPlayer("learner", restoredEmptyAccount(), { newScenarioPlayer: true });
  const world = zones.worldOf("learner");

  world.talk("learner", "npc-1");
  zones.step(1 / 15);
  world.gather("learner", "res-1");
  for (let tick = 0; tick < 60; tick++) zones.step(1 / 15);
  expect(world.getInventory("learner")?.some((stack) => stack?.item === "logs")).toBe(true);
  world.train("learner", "fletch_arrow_shafts");
  zones.step(1 / 15);
  expect(zones.progressOf("learner")?.completed).toEqual([
    "meet_guide",
    "gather_logs",
    "fletch_logs",
  ]);

  world.queueMove("learner", 14, 9);
  let reachedExit = false;
  for (let tick = 0; tick < 100; tick++) {
    zones.step(1 / 15);
    const player = world.players.get("learner");
    if (player && Math.round(player.x) === 14 && Math.round(player.y) === 9) {
      reachedExit = true;
      break;
    }
  }
  expect(reachedExit).toBe(true);
  expect(zones.consumeTransitions()).toEqual([]);

  const shaftSlot = world.getInventory("learner")!.findIndex(
    (stack) => stack?.item === "arrow_shafts",
  );
  expect(world.inventoryAction("learner", "examine", shaftSlot)).toBe(true);
  zones.step(1 / 15);

  expect(zones.zoneOf("learner")).toBe("overworld");
  expect(zones.progressOf("learner")?.done).toBe(true);
  expect(zones.consumeTransitions()).toContainEqual({
    id: "learner",
    zone: "overworld",
    x: SPAWN.x,
    y: SPAWN.y,
    facing: "south",
  });
});

test("Inventory Examine derives its authoritative fact from the current server slot", () => {
  const zones = new Zones(tutorialZones, { scenario: TUTORIAL_SCENARIO });
  zones.addPlayer("examiner", restoredEmptyAccount(), { newScenarioPlayer: true });
  const world = zones.worldOf("examiner");
  const inventory = world.getInventory("examiner")!;
  inventory[4] = { item: "logs", qty: 1 };

  expect(world.inventoryAction("examiner", "examine", 4)).toBe(true);
  expect(world.consumeFacts()).toEqual([
    {
      kind: "inventoryActionPerformed",
      playerId: "examiner",
      action: "examine",
      item: "logs",
      tick: 0,
      sequence: 0,
    },
  ]);
  expect(world.inventoryAction("examiner", "examine", 5)).toBe(false);
  expect(world.inventoryAction("examiner", "examine", 4.5)).toBe(false);
  expect(world.consumeFacts()).toEqual([]);
});

test("the headless trace needs Scenario initialItems to supplement an explicitly empty restored Inventory", () => {
  const withoutInitialAxe: ScenarioDef = {
    ...TUTORIAL_SCENARIO,
    initialItems: [],
  };
  const trace = runScenario({
    scenario: withoutInitialAxe,
    zones: tutorialZones,
    seed: 0x5eed,
    players: [{
      id: "learner",
      state: restoredEmptyAccount(),
      newScenarioPlayer: true,
    }],
    inputs: [
      { tick: 1, playerId: "learner", intent: { kind: "talk", targetId: "npc-1" } },
      { tick: 2, playerId: "learner", intent: { kind: "gather", targetId: "res-1" } },
    ],
    ticks: 40,
  });

  expect(trace.facts.some((fact) => fact.kind === "resourceGathered")).toBe(false);
  expect(trace.progress.learner).toMatchObject({
    completed: ["meet_guide"],
    done: false,
  });
});

test("a deterministic headless trace completes through normal gameplay rules", () => {
  const trace = runScenario({
    scenario: TUTORIAL_SCENARIO,
    zones: tutorialZones,
    seed: 0x5eed,
    players: [{
      id: "learner",
      state: restoredEmptyAccount(),
      newScenarioPlayer: true,
    }],
    inputs: [
      { tick: 1, playerId: "learner", intent: { kind: "talk", targetId: "npc-1" } },
      { tick: 2, playerId: "learner", intent: { kind: "gather", targetId: "res-1" } },
      { tick: 30, playerId: "learner", intent: { kind: "train", recipe: "fletch_arrow_shafts" } },
      { tick: 31, playerId: "learner", inventoryAction: { action: "examine", slot: 2 } },
      { tick: 32, playerId: "learner", intent: { kind: "move", x: 14, y: 9 } },
    ],
    ticks: 100,
  });

  const tutorialFacts = trace.facts.filter((fact) =>
    fact.kind === "playerTalked"
      || fact.kind === "resourceGathered"
      || fact.kind === "itemProduced"
      || fact.kind === "inventoryActionPerformed"
      || (fact.kind === "skillXpGained" && fact.skill === "fletching")
      || fact.kind === "playerEnteredZone",
  );
  expect(tutorialFacts.map((fact) => fact.kind)).toEqual([
    "playerTalked",
    "resourceGathered",
    "skillXpGained",
    "itemProduced",
    "inventoryActionPerformed",
    "playerEnteredZone",
  ]);
  expect(tutorialFacts.find((fact) => fact.kind === "itemProduced")).toMatchObject({
    source: "recipe",
    operation: "fletch_arrow_shafts",
    item: "arrow_shafts",
  });
  expect(trace.progress.learner).toMatchObject({
    completed: TUTORIAL_SCENARIO.objectives.map((objective) => objective.id),
    done: true,
  });
  expect(trace.transitions).toContainEqual({
    id: "learner",
    zone: "overworld",
    x: SPAWN.x,
    y: SPAWN.y,
    facing: "south",
  });
});

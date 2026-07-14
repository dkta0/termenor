import { test, expect } from "bun:test";
import { GameWorld } from "./game";
import { RESOURCE_KINDS, levelForXp, type MapData } from "@termenor/protocol";

const MAP: MapData = { width: 3, height: 3, tiles: Array(9).fill(0), heights: Array(9).fill(0) };

test("gathering an adjacent tree yields logs and woodcutting xp", () => {
  const w = new GameWorld(MAP, { x: 1, y: 1 });
  w.addPlayer("chopper"); // gets bronze_axe
  const treeId = w.spawnResource("tree", 2, 1); // adjacent to (1,1)
  w.gather("chopper", treeId);
  w.step(1 / 15);
  const inv = w.getInventory("chopper");
  expect(inv?.some((s) => s?.item === "logs" && s.qty >= 1)).toBe(true);
  expect(w.getPlayerSkills("chopper").woodcutting.xp).toBe(RESOURCE_KINDS.tree.xp);
});

test("a successful gather emits XP before the resource fact", () => {
  const w = new GameWorld(MAP, { x: 1, y: 1 });
  w.addPlayer("chopper");
  const treeId = w.spawnResource("tree", 2, 1);

  w.gather("chopper", treeId);
  w.step(1 / 15);

  expect(w.consumeFacts()).toEqual([
    {
      kind: "skillXpGained",
      playerId: "chopper",
      skill: "woodcutting",
      amount: RESOURCE_KINDS.tree.xp,
      tick: 1,
      sequence: 0,
    },
    {
      kind: "resourceGathered",
      playerId: "chopper",
      resourceType: "tree",
      item: "logs",
      qty: 1,
      tick: 1,
      sequence: 1,
    },
  ]);
});

test("a level-crossing gather emits XP, level, then resource facts", () => {
  const w = new GameWorld(MAP, { x: 1, y: 1 });
  w.addPlayer("chopper");
  const startingXp = 60;
  w.players.get("chopper")!.skills.woodcutting = startingXp;
  const treeId = w.spawnResource("tree", 2, 1);

  w.gather("chopper", treeId);
  w.step(1 / 15);

  const facts = w.consumeFacts();
  expect(facts.map((fact) => fact.kind)).toEqual([
    "skillXpGained",
    "skillLevelGained",
    "resourceGathered",
  ]);
  expect(facts[1]).toEqual({
    kind: "skillLevelGained",
    playerId: "chopper",
    skill: "woodcutting",
    level: levelForXp(startingXp + RESOURCE_KINDS.tree.xp),
    tick: 1,
    sequence: 1,
  });
});

test("a nonexistent gather target emits no fact", () => {
  const w = new GameWorld(MAP, { x: 1, y: 1 });
  w.addPlayer("chopper");
  w.gather("chopper", "missing");
  w.step(1 / 15);
  expect(w.consumeFacts()).toEqual([]);
});

test("missing gather tool emits no resource fact or charge consumption", () => {
  const w = new GameWorld(MAP, { x: 1, y: 1 });
  w.addPlayer("chopper", {
    x: 1,
    y: 1,
    facing: "south",
    inventory: new Array(28).fill(null),
  });
  const treeId = w.spawnResource("tree", 2, 1);
  const resource = w.resources.find((entry) => entry.id === treeId)!;
  const charges = resource.charges;
  w.gather("chopper", treeId);
  w.step(1 / 15);
  expect(w.consumeFacts()).toEqual([]);
  expect(resource.charges).toBe(charges);
});

test("full Inventory emits no resource fact or charge consumption", () => {
  const w = new GameWorld(MAP, { x: 1, y: 1 });
  w.addPlayer("chopper", {
    x: 1,
    y: 1,
    facing: "south",
    inventory: [{ item: "bronze_axe", qty: 1 }, ...Array.from({ length: 27 }, () => ({ item: "bronze_sword", qty: 1 }))],
  });
  const treeId = w.spawnResource("tree", 2, 1);
  const resource = w.resources.find((entry) => entry.id === treeId)!;
  const charges = resource.charges;
  w.gather("chopper", treeId);
  w.step(1 / 15);
  expect(w.consumeFacts()).toEqual([]);
  expect(resource.charges).toBe(charges);
});

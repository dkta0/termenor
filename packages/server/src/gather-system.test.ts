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

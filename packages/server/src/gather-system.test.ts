import { test, expect } from "bun:test";
import { GameWorld } from "./game";
import { RESOURCE_KINDS, type MapData } from "@termenor/protocol";

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

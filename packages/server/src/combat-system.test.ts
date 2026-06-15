import { test, expect } from "bun:test";
import { GameWorld } from "./game";
import type { MapData } from "@termenor/protocol";

const MAP: MapData = { width: 3, height: 1, tiles: [0, 0, 0], heights: [0, 0, 0] };

test("attack damages an adjacent npc and triggers retaliation", () => {
  const w = new GameWorld(MAP, { x: 0, y: 0 }, () => 0.99); // high roll = nonzero damage
  w.addPlayer("p1");
  w.spawnNpc("rat", 1, 0, 0);
  const npcId = w.snapshot().npcs[0].id;
  w.attack("p1", npcId);
  for (let i = 0; i < 3; i++) w.step(1 / 15);
  const npc = w.snapshot().npcs.find((n) => n.id === npcId);
  expect(npc!.hp).toBeLessThan(npc!.maxHp); // took damage
});

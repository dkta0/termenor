import { test, expect } from "bun:test";
import { GameWorld } from "./game";
import { PLAYER_MAX_HIT, PLAYER_MAX_HP } from "@termenor/protocol";
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

test("an equipped weapon raises the player's landed damage above the unarmed cap", () => {
  const w = new GameWorld(MAP, { x: 0, y: 0 }, () => 0.999); // pin roll to max
  w.addPlayer("p1");
  w.getInventory("p1")![1] = { item: "bronze_sword", qty: 1 };
  w.equip("p1", 1); // weapon bonus +2
  w.spawnNpc("goblin", 1, 0, 0); // maxHp 5, adjacent
  const npcId = w.snapshot().npcs[0].id;
  w.attack("p1", npcId);
  w.step(1 / 15); // one swing lands
  const npc = w.snapshot().npcs.find((n) => n.id === npcId);
  expect(npc!.maxHp - npc!.hp).toBe(PLAYER_MAX_HIT + 2); // 4 dmg, exceeds unarmed cap of 2
});

test("equipped armour reduces incoming NPC damage by the player's defence", () => {
  const w = new GameWorld(MAP, { x: 0, y: 0 }, () => 0.999);
  w.addPlayer("p1");
  w.getInventory("p1")![1] = { item: "bronze_platebody", qty: 1 };
  w.equip("p1", 1); // defence 2
  w.spawnNpc("goblin", 1, 0, 0); // maxHit 1
  const npcId = w.snapshot().npcs[0].id;
  w.attack("p1", npcId); // aggro: goblin retaliates and hits the player
  w.step(1 / 15);
  const me = w.snapshot().players.find((p) => p.id === "p1");
  expect(me!.hp).toBe(PLAYER_MAX_HP); // max(0, 1 - 2) = 0 damage taken
});

test("unarmoured/unarmed combat is unchanged (regression)", () => {
  const w = new GameWorld(MAP, { x: 0, y: 0 }, () => 0.999);
  w.addPlayer("p1");
  w.spawnNpc("goblin", 1, 0, 0); // maxHp 5
  const npcId = w.snapshot().npcs[0].id;
  w.attack("p1", npcId);
  w.step(1 / 15);
  const npc = w.snapshot().npcs.find((n) => n.id === npcId);
  expect(npc!.maxHp - npc!.hp).toBe(PLAYER_MAX_HIT); // unarmed base damage, unchanged
});

import { test, expect } from "bun:test";
import { GameWorld } from "./game";
import type { MapData } from "@termenor/protocol";

const MAP: MapData = { width: 5, height: 5, tiles: Array(25).fill(0), heights: Array(25).fill(0) };

function setup() {
  const w = new GameWorld(MAP, { x: 2, y: 2 });
  w.addPlayer("p1", { x: 2, y: 2, facing: "south", inventory: new Array(28).fill(null) });
  w.spawnNpc("chef", 2, 2, 0);
  return { w, chefId: w.npcs[0].id };
}

test("talking to the cook starts Cook's Assistant", () => {
  const { w, chefId } = setup();
  w.talk("p1", chefId);
  expect(w.getQuests("p1").cooks_assistant).toBe(1); // step 0 done → on step 1
  expect(w.consumeFacts()).toEqual([
    { kind: "playerTalked", playerId: "p1", npcType: "chef", tick: 0, sequence: 0 },
  ]);
});

test("the delivery step does not advance without the item", () => {
  const { w, chefId } = setup();
  w.talk("p1", chefId);
  w.talk("p1", chefId); // still need a potato
  expect(w.getQuests("p1").cooks_assistant).toBe(1);
});

test("delivering a potato completes the quest and grants the reward", () => {
  const { w, chefId } = setup();
  w.talk("p1", chefId);
  w.getInventory("p1")![0] = { item: "potato", qty: 1 };
  w.talk("p1", chefId);
  expect(w.getQuests("p1").cooks_assistant).toBe(2); // == steps.length → complete
  const inv = w.getInventory("p1")!;
  expect(inv.some((s) => s?.item === "potato")).toBe(false);           // delivered (consumed)
  expect(inv.some((s) => s?.item === "coins" && s.qty === 100)).toBe(true); // reward items
  expect(w.getPlayerSkills("p1").cooking.xp).toBe(300);                 // reward xp
});

test("talking to a non-quest npc starts nothing", () => {
  const { w } = setup();
  w.spawnNpc("goblin", 3, 3, 0);
  w.talk("p1", w.npcs[1].id);
  expect(w.getQuests("p1")).toEqual({});
});

test("talking to a nonexistent NPC emits no fact", () => {
  const { w } = setup();
  w.talk("p1", "missing");
  expect(w.consumeFacts()).toEqual([]);
});

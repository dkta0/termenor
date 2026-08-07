import { test, expect } from "bun:test";
import { GameWorld } from "./game";
import type { MapData } from "@termenor/protocol";

const MAP: MapData = { width: 3, height: 3, tiles: Array(9).fill(0), heights: Array(9).fill(0) };

test("firemaking with logs + tinderbox creates a fire at the player tile", () => {
  const w = new GameWorld(MAP, { x: 1, y: 1 });
  const inv: ({ item: string; qty: number } | null)[] = new Array(28).fill(null);
  inv[0] = { item: "logs", qty: 1 };
  inv[1] = { item: "tinderbox", qty: 1 };
  w.addPlayer("p1", { x: 1, y: 1, facing: "south", inventory: inv });
  w.use("p1", "firemaking", 0);
  expect(w.snapshot().resources.some((r) => r.type === "fire" && r.x === 1 && r.y === 1)).toBe(true);
});

test("a successful cooking action emits an item-produced fact", () => {
  const w = new GameWorld(MAP, { x: 1, y: 1 });
  const fireInventory: ({ item: string; qty: number } | null)[] = new Array(28).fill(null);
  fireInventory[0] = { item: "logs", qty: 1 };
  fireInventory[1] = { item: "tinderbox", qty: 1 };
  w.addPlayer("firemaker", { x: 1, y: 1, facing: "south", inventory: fireInventory });
  w.use("firemaker", "firemaking", 0);
  w.consumeFacts();

  const cookInventory: ({ item: string; qty: number } | null)[] = new Array(28).fill(null);
  cookInventory[0] = { item: "raw_shrimp", qty: 1 };
  w.addPlayer("cook", { x: 2, y: 1, facing: "south", inventory: cookInventory });
  w.use("cook", "cooking", 0);

  expect(w.consumeFacts()).toEqual([
    { kind: "skillXpGained", playerId: "cook", skill: "cooking", amount: 30, tick: 0, sequence: 0 },
    {
      kind: "itemProduced",
      playerId: "cook",
      source: "action",
      operation: "cook",
      item: "cooked_shrimp",
      qty: 1,
      tick: 0,
      sequence: 1,
    },
  ]);
});

test("a rejected action emits no fact", () => {
  const w = new GameWorld(MAP, { x: 1, y: 1 });
  w.addPlayer("p1", { x: 1, y: 1, facing: "south", inventory: new Array(28).fill(null) });
  w.use("p1", "firemaking", 0);
  expect(w.consumeFacts()).toEqual([]);
});

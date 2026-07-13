import { test, expect } from "bun:test";
import { GameWorld } from "./game";
import type { MapData } from "@termenor/protocol";

const MAP: MapData = { width: 3, height: 3, tiles: [0,0,0,0,0,0,0,0,0], heights: [0,0,0,0,0,0,0,0,0] };

test("pickup picks up a ground item at the player's tile", () => {
  const w = new GameWorld(MAP, { x: 1, y: 1 });
  w.addPlayer("p1");
  w.addGroundItem("logs", 1, 1, 1);
  expect(w.pickup("p1")).toBe(true);
  expect(w.getInventory("p1")!.some((s) => s?.item === "logs")).toBe(true);
});

test("drop places the slot's stack on the ground and clears the slot", () => {
  const w = new GameWorld(MAP, { x: 1, y: 1 });
  w.addPlayer("p1");
  w.addGroundItem("logs", 1, 1, 1);
  w.pickup("p1");
  const slot = w.getInventory("p1")!.findIndex((s) => s?.item === "logs");
  expect(w.drop("p1", slot)).toBe(true);
  expect(w.consumeFacts()).toEqual([
    {
      kind: "inventoryActionPerformed",
      playerId: "p1",
      action: "drop",
      item: "logs",
      tick: 0,
      sequence: 0,
    },
  ]);
});

test("a rejected drop emits no fact", () => {
  const w = new GameWorld(MAP, { x: 1, y: 1 });
  w.addPlayer("p1");
  expect(w.drop("p1", -1)).toBe(false);
  expect(w.consumeFacts()).toEqual([]);
});

test("equipping an item emits an inventory-action fact", () => {
  const w = new GameWorld(MAP, { x: 1, y: 1 });
  w.addPlayer("p1");
  const inventory = w.getInventory("p1")!;
  inventory.fill(null);
  inventory[0] = { item: "bronze_sword", qty: 1 };

  expect(w.equip("p1", 0)).toBe(true);
  expect(w.consumeFacts()).toEqual([
    {
      kind: "inventoryActionPerformed",
      playerId: "p1",
      action: "equip",
      item: "bronze_sword",
      tick: 0,
      sequence: 0,
    },
  ]);
});

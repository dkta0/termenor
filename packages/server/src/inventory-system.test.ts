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
});

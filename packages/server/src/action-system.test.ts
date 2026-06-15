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

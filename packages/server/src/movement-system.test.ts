import { test, expect } from "bun:test";
import { GameWorld } from "./game";
import type { MapData } from "@termenor/protocol";

const MAP: MapData = { width: 5, height: 1, tiles: [0,0,0,0,0], heights: [0,0,0,0,0] };

test("queueMove + stepMovement advances the player toward the target", () => {
  const w = new GameWorld(MAP, { x: 0, y: 0 });
  w.addPlayer("p1");
  w.queueMove("p1", 4, 0);
  const before = w.getPlayerState("p1")!.x;
  for (let i = 0; i < 5; i++) w.step(1 / 15);
  expect(w.getPlayerState("p1")!.x).toBeGreaterThan(before);
});

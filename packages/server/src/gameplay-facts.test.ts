import { expect, test } from "bun:test";
import { GameWorld } from "./game";

const MAP = {
  width: 3,
  height: 3,
  tiles: Array(9).fill(0),
  heights: Array(9).fill(0),
  scenery: [],
};

test("facts keep deterministic sequence within a tick", () => {
  const world = new GameWorld(MAP, { x: 1, y: 1 }, () => 0);
  world.addPlayer("p");

  world.emitFact({ kind: "skillXpGained", playerId: "p", skill: "woodcutting", amount: 25 });
  world.emitFact({ kind: "resourceGathered", playerId: "p", resourceType: "tree", item: "logs", qty: 1 });

  expect(world.consumeFacts().map((fact) => [fact.tick, fact.sequence, fact.kind])).toEqual([
    [0, 0, "skillXpGained"],
    [0, 1, "resourceGathered"],
  ]);
});

test("consuming facts clears the buffer and resets its sequence", () => {
  const world = new GameWorld(MAP, { x: 1, y: 1 }, () => 0);
  world.addPlayer("p");
  world.emitFact({ kind: "inventoryActionPerformed", playerId: "p", action: "examine", item: "logs" });

  const consumed = world.consumeFacts();
  expect(world.consumeFacts()).toEqual([]);

  world.emitFact({ kind: "playerEnteredZone", playerId: "p", zone: "overworld" });
  expect(world.consumeFacts()).toEqual([
    { kind: "playerEnteredZone", playerId: "p", zone: "overworld", tick: 0, sequence: 0 },
  ]);
  expect(consumed).toEqual([
    { kind: "inventoryActionPerformed", playerId: "p", action: "examine", item: "logs", tick: 0, sequence: 0 },
  ]);
});

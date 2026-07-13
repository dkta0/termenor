import { test, expect } from "bun:test";
import { awardXp } from "./skills-system";
import { GameWorld } from "./game";
import { levelForXp, type MapData } from "@termenor/protocol";

const MAP: MapData = { width: 1, height: 1, tiles: [0], heights: [0] };

test("awardXp adds xp, marks the player changed, and emits an XP fact", () => {
  const world = new GameWorld(MAP, { x: 0, y: 0 });
  world.addPlayer("p1", { x: 0, y: 0, facing: "south" });
  const player = world.players.get("p1")!;

  awardXp(world, player, "mining", 50);

  expect(player.skills.mining).toBe(50);
  expect(world.events.skillChanged.has("p1")).toBe(true);
  expect(world.consumeFacts()).toEqual([
    { kind: "skillXpGained", playerId: "p1", skill: "mining", amount: 50, tick: 0, sequence: 0 },
  ]);
});

test("awardXp records and emits a level-up when the level increases", () => {
  const world = new GameWorld(MAP, { x: 0, y: 0 });
  world.addPlayer("p1", { x: 0, y: 0, facing: "south" });
  const player = world.players.get("p1")!;
  const enough = 200;
  const level = levelForXp(enough);

  awardXp(world, player, "mining", enough);

  expect(world.events.levelUps).toContainEqual({ id: "p1", skill: "mining", level });
  expect(world.consumeFacts()).toEqual([
    { kind: "skillXpGained", playerId: "p1", skill: "mining", amount: enough, tick: 0, sequence: 0 },
    { kind: "skillLevelGained", playerId: "p1", skill: "mining", level, tick: 0, sequence: 1 },
  ]);
});

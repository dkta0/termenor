import { test, expect } from "bun:test";
import type { MapData } from "@termenor/protocol";
import { Game } from "./game";

// open 10x1 corridor
const corridor: MapData = { width: 10, height: 1, tiles: new Array(10).fill(0), heights: new Array(10).fill(0) };

test("addPlayer spawns at given tile and appears in snapshot", () => {
  const g = new Game(corridor, { x: 0, y: 0 });
  g.addPlayer("p1");
  const snap = g.snapshot();
  expect(snap.players).toHaveLength(1);
  expect(snap.players[0]).toMatchObject({ id: "p1", x: 0, y: 0 });
});

test("player walks to target over time and stops there", () => {
  const g = new Game(corridor, { x: 0, y: 0 });
  g.addPlayer("p1");
  g.queueMove("p1", 4, 0); // 4 tiles at 5 tiles/s = 0.8s
  // advance 1 second in 66ms steps
  for (let i = 0; i < 16; i++) g.step(1 / 15);
  const p = g.snapshot().players[0];
  expect(p.x).toBeCloseTo(4, 5);
  expect(p.y).toBeCloseTo(0, 5);
});

test("facing updates toward movement direction", () => {
  const g = new Game(corridor, { x: 0, y: 0 });
  g.addPlayer("p1");
  g.queueMove("p1", 3, 0);
  g.step(1 / 15);
  expect(g.snapshot().players[0].facing).toBe("east");
});

test("queueMove to unwalkable tile is ignored", () => {
  const map: MapData = { width: 3, height: 1, tiles: [0, 1, 0], heights: [0, 0, 0] };
  const g = new Game(map, { x: 0, y: 0 });
  g.addPlayer("p1");
  g.queueMove("p1", 1, 0); // blocked
  for (let i = 0; i < 10; i++) g.step(1 / 15);
  expect(g.snapshot().players[0]).toMatchObject({ x: 0, y: 0 });
});

test("fractional moveTo is floored to a tile", () => {
  const g = new Game(corridor, { x: 0, y: 0 });
  g.addPlayer("p1");
  g.queueMove("p1", 3.9, 0.2); // → tile (3, 0)
  for (let i = 0; i < 16; i++) g.step(1 / 15);
  expect(g.snapshot().players[0].x).toBeCloseTo(3, 5);
});

test("two players tracked independently", () => {
  const g = new Game(corridor, { x: 0, y: 0 });
  g.addPlayer("a");
  g.addPlayer("b");
  g.queueMove("a", 2, 0);
  for (let i = 0; i < 10; i++) g.step(1 / 15);
  const byId = Object.fromEntries(g.snapshot().players.map((p) => [p.id, p]));
  expect(byId.a.x).toBeCloseTo(2, 5);
  expect(byId.b.x).toBeCloseTo(0, 5);
});

test("removePlayer drops it from snapshot", () => {
  const g = new Game(corridor, { x: 0, y: 0 });
  g.addPlayer("a");
  g.removePlayer("a");
  expect(g.snapshot().players).toHaveLength(0);
});

test("tick counter increments each step", () => {
  const g = new Game(corridor, { x: 0, y: 0 });
  g.step(1 / 15);
  g.step(1 / 15);
  expect(g.snapshot().tick).toBe(2);
});

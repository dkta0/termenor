import { test, expect } from "bun:test";
import type { MapData } from "@termenor/protocol";
import { Game } from "./game";

// Open 20x20 map (walls on border, interior walkable)
function openMap(w: number, h: number): MapData {
  const tiles = new Array(w * h).fill(0);
  const heights = new Array(w * h).fill(0);
  // wall border
  for (let x = 0; x < w; x++) { tiles[0 * w + x] = 1; tiles[(h - 1) * w + x] = 1; }
  for (let y = 0; y < h; y++) { tiles[y * w + 0] = 1; tiles[y * w + (w - 1)] = 1; }
  return { width: w, height: h, tiles, heights };
}

const map20 = openMap(20, 20);

// Seeded deterministic rng (same formula as npc.test.ts)
function seededRng(seed: number): () => number {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 4294967296; };
}

test("spawnNpc adds npc to snapshot with deterministic id", () => {
  const g = new Game(map20, { x: 10, y: 10 }, seededRng(1));
  g.spawnNpc("goblin", 10, 10, 3);
  const snap = g.snapshot();
  expect(snap.npcs).toHaveLength(1);
  expect(snap.npcs[0]).toMatchObject({ id: "npc-1", type: "goblin", x: 10, y: 10 });
});

test("spawnNpc ids increment: npc-1, npc-2", () => {
  const g = new Game(map20, { x: 10, y: 10 }, seededRng(1));
  g.spawnNpc("goblin", 5, 5, 3);
  g.spawnNpc("rat", 8, 8, 2);
  const ids = g.snapshot().npcs.map((n) => n.id);
  expect(ids).toEqual(["npc-1", "npc-2"]);
});

test("NPC moves after enough ticks (wander AI fires)", () => {
  const g = new Game(map20, { x: 10, y: 10 }, seededRng(42));
  g.spawnNpc("goblin", 10, 10, 4);
  const before = g.snapshot().npcs[0];
  // Run 60 ticks (4 seconds at 15Hz) — should have wandered at least once
  for (let i = 0; i < 60; i++) g.step(1 / 15);
  const after = g.snapshot().npcs[0];
  expect(after.x !== before.x || after.y !== before.y).toBe(true);
});

test("NPC stays within radius of home after many ticks", () => {
  const g = new Game(map20, { x: 10, y: 10 }, seededRng(77));
  const home = { x: 10, y: 10 };
  const radius = 3;
  g.spawnNpc("goblin", home.x, home.y, radius);
  for (let i = 0; i < 300; i++) g.step(1 / 15);
  const npc = g.snapshot().npcs[0];
  const chebyshev = Math.max(Math.abs(Math.round(npc.x) - home.x), Math.abs(Math.round(npc.y) - home.y));
  expect(chebyshev).toBeLessThanOrEqual(radius);
});

test("NPC never occupies a blocked tile", () => {
  const g = new Game(map20, { x: 10, y: 10 }, seededRng(55));
  g.spawnNpc("rat", 10, 10, 5);
  for (let i = 0; i < 300; i++) g.step(1 / 15);
  const npc = g.snapshot().npcs[0];
  const tx = Math.round(npc.x);
  const ty = Math.round(npc.y);
  expect(map20.tiles[ty * map20.width + tx]).toBe(0);
});

test("snapshot.npcs is empty when no npcs spawned", () => {
  const g = new Game(map20, { x: 10, y: 10 });
  expect(g.snapshot().npcs).toEqual([]);
});

test("wander AI: idle npc gets a new path when nextWanderTick elapses", () => {
  const g = new Game(map20, { x: 10, y: 10 }, seededRng(33));
  g.spawnNpc("goblin", 10, 10, 4);
  // advance until movement occurs — check that the npc eventually has a non-zero path
  let moved = false;
  for (let i = 0; i < 200; i++) {
    g.step(1 / 15);
    const npc = g.snapshot().npcs[0];
    if (npc.x !== 10 || npc.y !== 10) { moved = true; break; }
  }
  expect(moved).toBe(true);
});

test("existing player tests still pass after Game refactor", () => {
  // Regression: player movement identical after advanceAlongPath refactor
  const corridor: MapData = { width: 10, height: 1, tiles: new Array(10).fill(0), heights: new Array(10).fill(0) };
  const g = new Game(corridor, { x: 0, y: 0 });
  g.addPlayer("p1");
  g.queueMove("p1", 4, 0);
  for (let i = 0; i < 16; i++) g.step(1 / 15);
  expect(g.snapshot().players[0].x).toBeCloseTo(4, 5);
});

import { test, expect } from "bun:test";
import type { SnapshotMsg } from "@termenor/protocol";
import { WorldIndex } from "./aoi";

const world: SnapshotMsg = {
  t: "snapshot", tick: 7,
  players: [
    { id: "me", x: 50, y: 50, facing: "south", hp: 10, maxHp: 10 },
    { id: "near", x: 58, y: 52, facing: "south", hp: 10, maxHp: 10 },   // Chebyshev 8
    { id: "edge", x: 60, y: 50, facing: "south", hp: 10, maxHp: 10 },   // Chebyshev 10 (== radius)
    { id: "far", x: 61, y: 50, facing: "south", hp: 10, maxHp: 10 },    // Chebyshev 11 (out)
  ],
  npcs: [
    { id: "n_in", type: "goblin", x: 45, y: 45, facing: "south", hp: 5, maxHp: 5 },
    { id: "n_out", type: "rat", x: 50, y: 70, facing: "south", hp: 3, maxHp: 3 }, // dy 20 (out)
  ],
  ground: [
    { id: 1, item: "coins", qty: 5, x: 52, y: 52 },  // in
    { id: 2, item: "logs", qty: 1, x: 50, y: 80 },   // out
  ],
  resources: [
    { id: "r_in", type: "tree", x: 48, y: 55 },  // dy 5 (in)
    { id: "r_out", type: "rock", x: 10, y: 10 }, // out
  ],
  hits: [
    { targetId: "n_in", amount: 2, tick: 7 },  // visible npc → kept
    { targetId: "far", amount: 1, tick: 7 },   // player out of view → dropped
    { targetId: "ghost", amount: 9, tick: 7 }, // not present → dropped
  ],
};

const view = () => new WorldIndex(world, 100).view(50, 50, 10);

test("includes the centered player and entities within the radius", () => {
  const ids = view().players.map((p) => p.id).sort();
  expect(ids).toEqual(["edge", "me", "near"]);
});

test("excludes players just past the radius (Chebyshev radius is inclusive)", () => {
  expect(view().players.some((p) => p.id === "far")).toBe(false);
});

test("filters npcs, ground, and resources by the same radius", () => {
  const v = view();
  expect(v.npcs.map((n) => n.id)).toEqual(["n_in"]);
  expect(v.ground.map((g) => g.id)).toEqual([1]);
  expect(v.resources.map((r) => r.id)).toEqual(["r_in"]);
});

test("keeps only hits whose target is itself in view", () => {
  expect(view().hits).toEqual([{ targetId: "n_in", amount: 2, tick: 7 }]);
});

test("carries the source tick through", () => {
  expect(view().tick).toBe(7);
});

test("finds entities bucketed in cells other than the center's", () => {
  // center (50,50) sits in cell (6,6); "near" (58,52) sits in cell (7,6) — a different
  // bucket — so a hit here proves the query sweeps neighbouring cells, not just the center.
  expect(view().players.some((p) => p.id === "near")).toBe(true);
});

test("a tiny radius isolates the center player only", () => {
  const solo = new WorldIndex(world, 100).view(50, 50, 1);
  expect(solo.players.map((p) => p.id)).toEqual(["me"]);
  expect(solo.npcs).toEqual([]);
});

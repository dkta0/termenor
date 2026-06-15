import { test, expect } from "bun:test";
import type { MapData, SnapshotMsg, GroundItem, ItemStack, NpcState } from "@termenor/protocol";
import { GameState, INTERP_DELAY_MS, sampleElevation } from "./game-state";

const snap = (tick: number, x: number): SnapshotMsg => ({
  t: "snapshot", tick, players: [{ id: "a", x, y: 0, facing: "east" }], ground: [], npcs: [],
});

test("samplePositions returns empty before any snapshot", () => {
  const gs = new GameState();
  expect(gs.samplePositions(1000)).toEqual([]);
});

test("interpolates linearly between two snapshots", () => {
  const gs = new GameState();
  gs.applySnapshot(snap(1, 0), 1000);
  gs.applySnapshot(snap(2, 10), 1100); // 100ms apart, moved 0→10
  // render time held INTERP_DELAY_MS behind the latest snapshot.
  // ask for the midpoint between the two snapshot timestamps.
  const renderTime = 1050 + INTERP_DELAY_MS;
  const players = gs.samplePositions(renderTime);
  expect(players[0].x).toBeCloseTo(5, 5);
});

test("clamps to latest when render time is past newest snapshot", () => {
  const gs = new GameState();
  gs.applySnapshot(snap(1, 0), 1000);
  gs.applySnapshot(snap(2, 10), 1100);
  const players = gs.samplePositions(5000);
  expect(players[0].x).toBeCloseTo(10, 5);
});

test("REGRESSION: smooth interpolation at real 66.7ms tick cadence (no clamp-freeze)", () => {
  // Snapshots arrive every ~66.7ms (15Hz), player moves 1 unit/tick.
  const gs = new GameState();
  const TICK = 1000 / 15;
  for (let i = 0; i < 6; i++) gs.applySnapshot(snap(i, i), 1000 + i * TICK);
  // Newest frame time = 1000 + 5*TICK. With INTERP_DELAY_MS=100 (~1.5 ticks),
  // sweeping render time across a tick must yield strictly increasing x with no
  // flat (frozen) stretch — the bug clamped to a stale frame for ~half each tick.
  const newest = 1000 + 5 * TICK;
  const xs: number[] = [];
  for (let r = 0; r <= 10; r++) {
    const players = gs.samplePositions(newest + (r / 10) * TICK);
    xs.push(players[0].x);
  }
  // strictly non-decreasing and actually advances (not stuck on one value)
  for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThanOrEqual(xs[i - 1]);
  expect(xs[xs.length - 1]).toBeGreaterThan(xs[0]);
});

test("interpolates within an OLDER bracketing pair instead of clamping to newest", () => {
  const gs = new GameState();
  gs.applySnapshot(snap(0, 0), 1000);
  gs.applySnapshot(snap(1, 10), 1100);
  gs.applySnapshot(snap(2, 20), 1200); // newest
  // target 1050 (between frame@1000 and frame@1100) → x=5, NOT clamped to 20
  const players = gs.samplePositions(1050 + INTERP_DELAY_MS);
  expect(players[0].x).toBeCloseTo(5, 5);
});

test("setMap / setLocalId expose state", () => {
  const gs = new GameState();
  gs.setMap({ width: 2, height: 1, tiles: [0, 0], heights: [0, 0] });
  gs.setLocalId("a");
  expect(gs.map?.width).toBe(2);
  expect(gs.localId).toBe("a");
});

const ramp: MapData = { width: 2, height: 1, tiles: [0, 0], heights: [0, 2] };

test("sampleElevation bilinearly interpolates terrain height", () => {
  expect(sampleElevation(ramp, 0, 0)).toBeCloseTo(0, 9);
  expect(sampleElevation(ramp, 1, 0)).toBeCloseTo(2, 9);
  expect(sampleElevation(ramp, 0.5, 0)).toBeCloseTo(1, 9); // smooth midpoint
});

test("sampleElevation returns 0 out of bounds", () => {
  expect(sampleElevation(ramp, -5, -5)).toBeCloseTo(0, 9);
});

test("applySnapshot stores ground items", () => {
  const gs = new GameState();
  const ground: GroundItem[] = [{ id: 1, item: "coins", qty: 5, x: 3, y: 4 }];
  gs.applySnapshot({ t: "snapshot", tick: 1, players: [], ground, npcs: [] }, 1000);
  expect(gs.ground).toEqual(ground);
});

test("ground defaults to empty array before any snapshot", () => {
  const gs = new GameState();
  expect(gs.ground).toEqual([]);
});

test("setInventory stores slots", () => {
  const gs = new GameState();
  const slots: (ItemStack | null)[] = [{ item: "logs", qty: 2 }, null];
  gs.setInventory(slots);
  expect(gs.inventory[0]).toEqual({ item: "logs", qty: 2 });
});

test("inventory defaults to empty array before setInventory", () => {
  const gs = new GameState();
  expect(gs.inventory).toEqual([]);
});

// ---- NPC tests ----

const snapWithNpcs = (tick: number, npcX: number): SnapshotMsg => ({
  t: "snapshot", tick,
  players: [],
  ground: [],
  npcs: [{ id: "npc-1", type: "goblin", x: npcX, y: 0, facing: "east" }],
});

test("applySnapshot stores npcs", () => {
  const gs = new GameState();
  gs.applySnapshot(snapWithNpcs(1, 5), 1000);
  const npcs = gs.sampleNpcs(1000 + INTERP_DELAY_MS + 50);
  expect(npcs).toHaveLength(1);
  expect(npcs[0].id).toBe("npc-1");
  expect(npcs[0].type).toBe("goblin");
});

test("sampleNpcs returns empty before any snapshot", () => {
  const gs = new GameState();
  expect(gs.sampleNpcs(1000)).toEqual([]);
});

test("sampleNpcs interpolates npc position between two snapshots", () => {
  const gs = new GameState();
  gs.applySnapshot(snapWithNpcs(1, 0), 1000);
  gs.applySnapshot(snapWithNpcs(2, 10), 1100);
  const renderTime = 1050 + INTERP_DELAY_MS;
  const npcs = gs.sampleNpcs(renderTime);
  expect(npcs).toHaveLength(1);
  expect(npcs[0].x).toBeCloseTo(5, 5);
});

test("sampleNpcs clamps to latest when render time is past newest snapshot", () => {
  const gs = new GameState();
  gs.applySnapshot(snapWithNpcs(1, 0), 1000);
  gs.applySnapshot(snapWithNpcs(2, 10), 1100);
  const npcs = gs.sampleNpcs(5000);
  expect(npcs[0].x).toBeCloseTo(10, 5);
});

test("sampleNpcs handles npc missing from first frame (uses newest position)", () => {
  const gs = new GameState();
  gs.applySnapshot({ t: "snapshot", tick: 1, players: [], ground: [], npcs: [] }, 1000);
  gs.applySnapshot(snapWithNpcs(2, 8), 1100);
  const npcs = gs.sampleNpcs(1050 + INTERP_DELAY_MS);
  expect(npcs).toHaveLength(1);
  expect(npcs[0].x).toBe(8);
});

test("sampleNpcs attaches elevation h", () => {
  const gs = new GameState();
  gs.setMap({ width: 2, height: 1, tiles: [0, 0], heights: [0, 4] });
  gs.applySnapshot(snapWithNpcs(1, 1), 1000);
  const npcs = gs.sampleNpcs(1000 + INTERP_DELAY_MS + 50);
  expect(npcs[0].h).toBeCloseTo(4, 5);
});

test("samplePositions behavior unchanged after refactor (regression)", () => {
  const gs = new GameState();
  gs.applySnapshot(snap(1, 0), 1000);
  gs.applySnapshot(snap(2, 10), 1100);
  const players = gs.samplePositions(1050 + INTERP_DELAY_MS);
  expect(players[0].x).toBeCloseTo(5, 5);
});

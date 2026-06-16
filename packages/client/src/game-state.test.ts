import { test, expect } from "bun:test";
import type { MapData, SnapshotMsg, GroundItem, ItemStack, NpcState, ResourceState } from "@termenor/protocol";
import { SPLAT_MS } from "@termenor/protocol";
import { GameState, INTERP_DELAY_MS, sampleElevation } from "./game-state";

const snap = (tick: number, x: number): SnapshotMsg => ({
  t: "snapshot", tick, players: [{ id: "a", x, y: 0, facing: "east", hp: 10, maxHp: 10 }], ground: [], npcs: [], hits: [], resources: [],
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
  gs.applySnapshot({ t: "snapshot", tick: 1, players: [], ground, npcs: [], hits: [], resources: [] }, 1000);
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
  npcs: [{ id: "npc-1", type: "goblin", x: npcX, y: 0, facing: "east", hp: 5, maxHp: 5 }],
  hits: [],
  resources: [],
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
  gs.applySnapshot({ t: "snapshot", tick: 1, players: [], ground: [], npcs: [], hits: [], resources: [] }, 1000);
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

// ---- Combat / hp / splat tests ----

function combatSnap(over: Partial<SnapshotMsg> = {}): SnapshotMsg {
  return {
    t: "snapshot", tick: 1,
    players: [{ id: "me", x: 0, y: 0, facing: "south", hp: 8, maxHp: 10 }],
    ground: [], npcs: [], hits: [], resources: [], ...over,
  };
}

test("hp is read from the newest frame (not interpolated)", () => {
  const gs = new GameState();
  gs.setMap({ width: 4, height: 4, tiles: new Array(16).fill(0), heights: new Array(16).fill(0) });
  gs.setLocalId("me");
  gs.applySnapshot(combatSnap({ tick: 1 }), 0);
  gs.applySnapshot(combatSnap({ tick: 2, players: [{ id: "me", x: 0, y: 0, facing: "south", hp: 3, maxHp: 10 }] }), 100);
  expect(gs.hpOf("me")).toBe(3);
});

test("hits become active splats that prune after SPLAT_MS", () => {
  const gs = new GameState();
  gs.applySnapshot(combatSnap({ hits: [{ targetId: "g1", amount: 2, tick: 1 }] }), 1000);
  expect(gs.activeSplats(1000).length).toBe(1);
  expect(gs.activeSplats(1000 + SPLAT_MS - 1).length).toBe(1);
  expect(gs.activeSplats(1000 + SPLAT_MS + 1).length).toBe(0);
});

// ---- Resource / skills tests ----

test("applySnapshot with resources makes sampleResources return them with numeric h", () => {
  const gs = new GameState();
  const resources: ResourceState[] = [{ id: "r1", type: "tree", x: 3, y: 4 }];
  gs.applySnapshot({ t: "snapshot", tick: 1, players: [], ground: [], npcs: [], hits: [], resources }, 1000);
  const sampled = gs.sampleResources();
  expect(sampled).toHaveLength(1);
  expect(sampled[0].x).toBe(3);
  expect(sampled[0].y).toBe(4);
  expect(typeof sampled[0].h).toBe("number");
});

test("setSkills + skillsLine returns string containing level and Woodcutting", () => {
  const gs = new GameState();
  gs.setSkills({ woodcutting: { xp: 25, level: 1 } });
  const line = gs.skillsLine();
  expect(line).toContain("Woodcutting");
  expect(line).toContain("1");
});

// ---- Unit 4 new tests ----

test("sampleResources returns rock and fire entries with numeric h", () => {
  const gs = new GameState();
  const resources: ResourceState[] = [
    { id: "r1", type: "rock", x: 2, y: 2 },
    { id: "f1", type: "fire", x: 3, y: 3 },
  ];
  gs.applySnapshot({ t: "snapshot", tick: 1, players: [], ground: [], npcs: [], hits: [], resources }, 1000);
  const sampled = gs.sampleResources();
  expect(sampled).toHaveLength(2);
  expect(sampled.find((r) => r.type === "rock")).toBeDefined();
  expect(sampled.find((r) => r.type === "fire")).toBeDefined();
  for (const r of sampled) expect(typeof r.h).toBe("number");
});

test("skillsLines returns 5 lines, one mentioning Mining", () => {
  const gs = new GameState();
  gs.setSkills({
    woodcutting: { xp: 0, level: 1 },
    mining:      { xp: 50, level: 1 },
    fishing:     { xp: 0, level: 1 },
    firemaking:  { xp: 0, level: 1 },
    cooking:     { xp: 0, level: 1 },
  });
  const lines = gs.skillsLines();
  expect(lines).toHaveLength(5);
  expect(lines.some((l) => l.includes("Mining"))).toBe(true);
  expect(lines.some((l) => l.includes("50"))).toBe(true);
});

test("firstSlotOf returns index of first matching item", () => {
  const gs = new GameState();
  gs.setInventory([null, { item: "logs", qty: 3 }, { item: "logs", qty: 1 }, null]);
  expect(gs.firstSlotOf("logs")).toBe(1);
});

test("firstSlotOf returns -1 when item not in inventory", () => {
  const gs = new GameState();
  gs.setInventory([{ item: "bronze_axe", qty: 1 }, null]);
  expect(gs.firstSlotOf("logs")).toBe(-1);
});

test("setBank stores items and opens the bank panel", () => {
  const gs = new GameState();
  gs.setBank([{ item: "logs", qty: 10 }], true);
  expect(gs.bank).toEqual([{ item: "logs", qty: 10 }]);
  expect(gs.bankOpen).toBe(true);
});

test("closeBank clears the open flag but keeps items", () => {
  const gs = new GameState();
  gs.setBank([{ item: "coins", qty: 5 }], true);
  gs.closeBank();
  expect(gs.bankOpen).toBe(false);
  expect(gs.bank).toEqual([{ item: "coins", qty: 5 }]);
});

test("setShop stores the shop and opens the shop panel", () => {
  const gs = new GameState();
  gs.setShop("general_store", "General Store", [{ item: "logs", price: 4, stock: 100 }], true);
  expect(gs.shop).toEqual({ shopId: "general_store", name: "General Store", entries: [{ item: "logs", price: 4, stock: 100 }] });
  expect(gs.shopOpen).toBe(true);
});

test("closeShop clears the open flag but keeps shop data", () => {
  const gs = new GameState();
  gs.setShop("general_store", "General Store", [], true);
  gs.closeShop();
  expect(gs.shopOpen).toBe(false);
  expect(gs.shop?.shopId).toBe("general_store");
});

const snapWithResources = (px: number, py: number, resources: ResourceState[]): SnapshotMsg => ({
  t: "snapshot", tick: 1,
  players: [{ id: "me", x: px, y: py, facing: "south", hp: 10, maxHp: 10 }],
  ground: [], npcs: [], hits: [], resources,
});

test("nearestResourceOfType returns the id of the closest matching resource", () => {
  const gs = new GameState();
  gs.setMap({ width: 10, height: 10, tiles: new Array(100).fill(0), heights: new Array(100).fill(0) });
  gs.setLocalId("me");
  gs.applySnapshot(snapWithResources(5, 5, [
    { id: "booth-far", type: "bank_booth", x: 9, y: 9 },
    { id: "booth-near", type: "bank_booth", x: 6, y: 5 },
    { id: "store", type: "general_store", x: 5, y: 6 },
  ]), 1000);
  expect(gs.nearestResourceOfType("bank_booth", 1000)).toBe("booth-near");
  expect(gs.nearestResourceOfType("general_store", 1000)).toBe("store");
});

test("nearestResourceOfType returns null when no resource of that type exists", () => {
  const gs = new GameState();
  gs.setMap({ width: 10, height: 10, tiles: new Array(100).fill(0), heights: new Array(100).fill(0) });
  gs.setLocalId("me");
  gs.applySnapshot(snapWithResources(5, 5, [{ id: "tree", type: "tree", x: 6, y: 5 }]), 1000);
  expect(gs.nearestResourceOfType("bank_booth", 1000)).toBeNull();
});

test("nearestResourceOfType returns null when there is no local player", () => {
  const gs = new GameState();
  expect(gs.nearestResourceOfType("bank_booth", 1000)).toBeNull();
});

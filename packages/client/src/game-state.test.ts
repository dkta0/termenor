import { test, expect } from "bun:test";
import type { SnapshotMsg } from "@termenor/protocol";
import { GameState, INTERP_DELAY_MS } from "./game-state";

const snap = (tick: number, x: number): SnapshotMsg => ({
  t: "snapshot", tick, players: [{ id: "a", x, y: 0, facing: "east" }],
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

test("setMap / setLocalId expose state", () => {
  const gs = new GameState();
  gs.setMap({ width: 2, height: 1, tiles: [0, 0] });
  gs.setLocalId("a");
  expect(gs.map?.width).toBe(2);
  expect(gs.localId).toBe("a");
});

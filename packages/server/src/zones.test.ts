import { test, expect } from "bun:test";
import { Zones } from "./zones";

test("a new player starts in the overworld", () => {
  const z = new Zones();
  z.addPlayer("p1");
  expect(z.zoneOf("p1")).toBe("overworld");
  expect(z.worldOf("p1").players.has("p1")).toBe(true);
});

test("a saved cave player is restored into the cave, not the overworld", () => {
  const z = new Zones();
  z.addPlayer("p1", { x: 12, y: 12, facing: "south", zone: "cave" });
  expect(z.zoneOf("p1")).toBe("cave");
  expect(z.world("cave").players.has("p1")).toBe(true);
  expect(z.world("overworld").players.has("p1")).toBe(false);
});

test("an unknown saved zone falls back to the overworld", () => {
  const z = new Zones();
  z.addPlayer("p1", { x: 0, y: 0, facing: "south", zone: "atlantis" });
  expect(z.zoneOf("p1")).toBe("overworld");
});

test("stepping onto a portal moves the player to the target zone, carrying state", () => {
  const z = new Zones();
  z.addPlayer("p1");
  const p = z.worldOf("p1").players.get("p1")!;
  p.x = 30; p.y = 30;            // overworld portal tile → cave (12,12)
  p.skills = { mining: 100 };
  z.step(1 / 15);
  expect(z.zoneOf("p1")).toBe("cave");
  const moved = z.world("cave").players.get("p1")!;
  expect(Math.round(moved.x)).toBe(12);
  expect(Math.round(moved.y)).toBe(12);
  expect(moved.skills.mining).toBe(100); // full state carried across the boundary
  expect(z.world("overworld").players.has("p1")).toBe(false);
  const tr = z.consumeTransitions();
  expect(tr).toHaveLength(1);
  expect(tr[0]).toMatchObject({ id: "p1", zone: "cave" });
});

test("the destination tile is not itself a portal (no immediate bounce-back)", () => {
  const z = new Zones();
  z.addPlayer("p1");
  const p = z.worldOf("p1").players.get("p1")!;
  p.x = 30; p.y = 30;
  z.step(1 / 15);              // → cave
  z.consumeTransitions();
  z.step(1 / 15);              // a second step must NOT bounce back to overworld
  expect(z.zoneOf("p1")).toBe("cave");
});

test("stateOf includes the current zone for persistence", () => {
  const z = new Zones();
  z.addPlayer("p1", { x: 12, y: 12, facing: "south", zone: "cave" });
  expect(z.stateOf("p1")?.zone).toBe("cave");
});

test("zones have distinct maps", () => {
  const z = new Zones();
  expect(z.zoneIds()).toContain("overworld");
  expect(z.zoneIds()).toContain("cave");
  expect(z.mapOf("overworld").width).not.toBe(z.mapOf("cave").width);
});

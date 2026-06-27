import { test, expect } from "bun:test";
import { GameWorld } from "./game";
import type { MapData, ItemStack } from "@termenor/protocol";

const MAP: MapData = { width: 3, height: 3, tiles: Array(9).fill(0), heights: Array(9).fill(0) };

function withInventory(items: Record<number, ItemStack>): (ItemStack | null)[] {
  const inv: (ItemStack | null)[] = new Array(28).fill(null);
  for (const [slot, stack] of Object.entries(items)) inv[Number(slot)] = stack;
  return inv;
}

function count(inv: (ItemStack | null)[] | null, item: string): number {
  return (inv ?? []).reduce((n, s) => n + (s?.item === item ? s.qty : 0), 0);
}

test("a recipe consumes inputs, yields outputs, and awards xp", () => {
  const w = new GameWorld(MAP, { x: 1, y: 1 });
  w.addPlayer("p1", { x: 1, y: 1, facing: "south", inventory: withInventory({ 0: { item: "copper_ore", qty: 1 }, 1: { item: "tin_ore", qty: 1 } }) });
  w.train("p1", "smith_bronze_bar");
  const inv = w.getInventory("p1");
  expect(count(inv, "bronze_bar")).toBe(1);
  expect(count(inv, "copper_ore")).toBe(0);
  expect(count(inv, "tin_ore")).toBe(0);
  expect(w.getPlayerSkills("p1").smithing.xp).toBe(12);
});

test("training is gated by a per-player cooldown", () => {
  const w = new GameWorld(MAP, { x: 1, y: 1 });
  w.addPlayer("p1", { x: 1, y: 1, facing: "south", inventory: withInventory({ 0: { item: "copper_ore", qty: 2 }, 1: { item: "tin_ore", qty: 2 } }) });
  w.train("p1", "smith_bronze_bar");           // succeeds, sets cooldown
  w.train("p1", "smith_bronze_bar");           // same tick → still on cooldown, ignored
  expect(count(w.getInventory("p1"), "bronze_bar")).toBe(1);
  expect(w.getPlayerSkills("p1").smithing.xp).toBe(12);
});

test("missing inputs award no xp and produce nothing", () => {
  const w = new GameWorld(MAP, { x: 1, y: 1 });
  w.addPlayer("p1", { x: 1, y: 1, facing: "south", inventory: new Array(28).fill(null) });
  w.train("p1", "smith_bronze_bar");
  expect(count(w.getInventory("p1"), "bronze_bar")).toBe(0);
  expect(w.getPlayerSkills("p1").smithing.xp).toBe(0);
});

test("an activity recipe with no inputs still trains (e.g. agility)", () => {
  const w = new GameWorld(MAP, { x: 1, y: 1 });
  w.addPlayer("p1", { x: 1, y: 1, facing: "south", inventory: new Array(28).fill(null) });
  w.train("p1", "train_agility");
  expect(w.getPlayerSkills("p1").agility.xp).toBe(8);
});

test("a full inventory rejects the recipe without consuming inputs", () => {
  const w = new GameWorld(MAP, { x: 1, y: 1 });
  // 26 junk + ore inputs in the last two slots → no empty slot for the bronze_bar output.
  const inv: (ItemStack | null)[] = new Array(28).fill(null).map((_, i) => ({ item: "coins", qty: i + 1 }));
  inv[26] = { item: "copper_ore", qty: 1 };
  inv[27] = { item: "tin_ore", qty: 1 };
  w.addPlayer("p1", { x: 1, y: 1, facing: "south", inventory: inv });
  w.train("p1", "smith_bronze_bar");
  const after = w.getInventory("p1");
  expect(count(after, "bronze_bar")).toBe(0);
  expect(count(after, "copper_ore")).toBe(1);
  expect(count(after, "tin_ore")).toBe(1);
  expect(w.getPlayerSkills("p1").smithing.xp).toBe(0);
});

test("unknown recipe is a no-op", () => {
  const w = new GameWorld(MAP, { x: 1, y: 1 });
  w.addPlayer("p1", { x: 1, y: 1, facing: "south", inventory: new Array(28).fill(null) });
  expect(() => w.train("p1", "nonsense")).not.toThrow();
});

import { test, expect } from "bun:test";
import { ITEMS, isItem, INV_SIZE, type ItemStack, type GroundItem } from "./items";

test("ITEMS registry has expected item ids", () => {
  expect(Object.keys(ITEMS)).toContain("coins");
  expect(Object.keys(ITEMS)).toContain("logs");
  expect(Object.keys(ITEMS)).toContain("bronze_sword");
  expect(Object.keys(ITEMS)).toContain("shrimp");
});

test("each ITEMS entry has required fields", () => {
  for (const [, entry] of Object.entries(ITEMS)) {
    expect(typeof entry.name).toBe("string");
    expect(typeof entry.glyph).toBe("string");
    expect(entry.color).toHaveLength(3);
    expect(typeof entry.stackable).toBe("boolean");
  }
});

test("isItem returns true for known ids", () => {
  expect(isItem("coins")).toBe(true);
  expect(isItem("logs")).toBe(true);
});

test("isItem returns false for unknown ids", () => {
  expect(isItem("dragon_plate")).toBe(false);
  expect(isItem("")).toBe(false);
});

test("INV_SIZE is 28", () => {
  expect(INV_SIZE).toBe(28);
});

test("ItemStack and GroundItem shapes compile correctly", () => {
  const stack: ItemStack = { item: "coins", qty: 5 };
  const gi: GroundItem = { id: 1, item: "coins", qty: 10, x: 3, y: 4 };
  expect(stack.item).toBe("coins");
  expect(gi.id).toBe(1);
});

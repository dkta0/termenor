import { test, expect } from "bun:test";
import { emptyInventory, addToInventory, removeSlot } from "./inventory";
import { INV_SIZE } from "@termenor/protocol";

test("emptyInventory returns 28 nulls", () => {
  const inv = emptyInventory();
  expect(inv).toHaveLength(INV_SIZE);
  expect(inv.every((s) => s === null)).toBe(true);
});

test("addToInventory places stack in first empty slot", () => {
  const { slots, leftover } = addToInventory(emptyInventory(), { item: "logs", qty: 1 });
  expect(leftover).toBeNull();
  expect(slots[0]).toEqual({ item: "logs", qty: 1 });
  expect(slots[1]).toBeNull();
});

test("addToInventory stacks same stackable item", () => {
  let inv = emptyInventory();
  inv[0] = { item: "coins", qty: 5 };
  const { slots, leftover } = addToInventory(inv, { item: "coins", qty: 3 });
  expect(leftover).toBeNull();
  expect(slots[0]).toEqual({ item: "coins", qty: 8 });
});

test("addToInventory uses first-empty-slot for non-stackable", () => {
  let inv = emptyInventory();
  inv[0] = { item: "bronze_sword", qty: 1 };
  const { slots, leftover } = addToInventory(inv, { item: "bronze_sword", qty: 1 });
  expect(leftover).toBeNull();
  expect(slots[1]).toEqual({ item: "bronze_sword", qty: 1 });
});

test("addToInventory returns leftover when inventory is full", () => {
  const inv = emptyInventory().map(() => ({ item: "bronze_sword", qty: 1 })) as import("@termenor/protocol").ItemStack[];
  const { slots, leftover } = addToInventory(inv, { item: "logs", qty: 5 });
  expect(leftover).toEqual({ item: "logs", qty: 5 });
  // all slots unchanged
  expect(slots.every((s) => s?.item === "bronze_sword")).toBe(true);
});

test("addToInventory partial: stacks what fits, returns leftover 0 for non-stackable when full", () => {
  // When inventory is full but item is stackable and matches slot[0]
  const inv = emptyInventory().map((_, i) => i === 0 ? { item: "coins", qty: 5 } : { item: "bronze_sword", qty: 1 }) as import("@termenor/protocol").ItemStack[];
  const { slots, leftover } = addToInventory(inv, { item: "coins", qty: 3 });
  expect(leftover).toBeNull();
  expect(slots[0]).toEqual({ item: "coins", qty: 8 });
});

test("removeSlot empties the slot and returns the stack", () => {
  let inv = emptyInventory();
  inv[2] = { item: "shrimp", qty: 4 };
  const { slots, removed } = removeSlot(inv, 2);
  expect(removed).toEqual({ item: "shrimp", qty: 4 });
  expect(slots[2]).toBeNull();
});

test("removeSlot on empty slot returns null removed", () => {
  const { slots, removed } = removeSlot(emptyInventory(), 0);
  expect(removed).toBeNull();
  expect(slots[0]).toBeNull();
});

test("removeSlot out-of-range index returns null removed unchanged inv", () => {
  const inv = emptyInventory();
  const { slots, removed } = removeSlot(inv, 999);
  expect(removed).toBeNull();
  expect(slots).toHaveLength(INV_SIZE);
});

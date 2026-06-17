import { test, expect } from "bun:test";
import { resolveCommand, completions, type ResolveContext } from "./resolve";

function ctx(over: Partial<ResolveContext> = {}): ResolveContext {
  return {
    player: { x: 10, y: 10 },
    npcs: [{ id: "npc-1", type: "goblin", name: "goblin", x: 11, y: 10 }],
    resources: [
      { id: "res-1", type: "copper_rock", name: "copper rock", x: 12, y: 10 },
      { id: "res-2", type: "tree", name: "tree", x: 9, y: 10 },
    ],
    inventory: [{ item: "logs", qty: 3 }, null, { item: "bronze_sword", qty: 1 }],
    equipment: { weapon: "bronze_sword", body: null, shield: null },
    itemName: (id) => id,
    nearestOfType: (type) => (type === "bank_booth" ? "bank-1" : type === "general_store" ? "shop-1" : null),
    equipSlotName: (index) => (["weapon", "body", "shield"][index] ?? null),
    ...over,
  };
}

test("attack resolves an npc by name to its id", () => {
  expect(resolveCommand("attack goblin", ctx())).toEqual({ ok: true, intent: { kind: "attack", targetId: "npc-1" } });
});

test("mine is an alias for gather and resolves a resource", () => {
  expect(resolveCommand("mine copper", ctx())).toEqual({ ok: true, intent: { kind: "gather", targetId: "res-1" } });
});

test("unknown resource name yields a helpful error", () => {
  const r = resolveCommand("mine diamond", ctx());
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.message).toContain("diamond");
});

test("drop resolves an item name to its inventory slot", () => {
  expect(resolveCommand("drop logs", ctx())).toEqual({ ok: true, intent: { kind: "drop", slot: 0 } });
});

test("equip resolves an inventory item to its slot", () => {
  expect(resolveCommand("equip bronze_sword", ctx())).toEqual({ ok: true, intent: { kind: "equip", slot: 2 } });
});

test("bank with no argument opens the nearest booth", () => {
  expect(resolveCommand("bank", ctx())).toEqual({ ok: true, intent: { kind: "openBank", targetId: "bank-1" } });
});

test("buy parses item and optional quantity (default 1)", () => {
  expect(resolveCommand("buy logs 5", ctx())).toEqual({ ok: true, intent: { kind: "buy", item: "logs", qty: 5 } });
  expect(resolveCommand("buy logs", ctx())).toEqual({ ok: true, intent: { kind: "buy", item: "logs", qty: 1 } });
});

test("unknown verb suggests the closest known verb", () => {
  const r = resolveCommand("atttack goblin", ctx());
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.message).toContain("attack");
});

test("empty input is an error, not a crash", () => {
  expect(resolveCommand("   ", ctx()).ok).toBe(false);
});

test("completions returns verbs matching a prefix", () => {
  expect(completions("ba")).toContain("bank");
  expect(completions("mi")).toContain("mine");
});

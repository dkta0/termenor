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

test("use resolves action and item to slot; errors if item arg missing", () => {
  expect(resolveCommand("use firemaking logs", ctx())).toEqual({ ok: true, intent: { kind: "use", action: "firemaking", slot: 0 } });
  expect(resolveCommand("use firemaking", ctx()).ok).toBe(false);
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

test("mine ... until full produces a gather order intent with the resource type", () => {
  expect(resolveCommand("mine copper until full", ctx())).toEqual({
    ok: true,
    intent: { kind: "order", activity: "gather", targetType: "copper_rock", stop: { kind: "untilFull" } },
  });
});

test("chop ... count N produces a gather order intent", () => {
  expect(resolveCommand("chop tree count 5", ctx())).toEqual({
    ok: true,
    intent: { kind: "order", activity: "gather", targetType: "tree", stop: { kind: "count", n: 5 } },
  });
});

test("gather ... until level N produces a gather order intent", () => {
  expect(resolveCommand("mine copper until level 30", ctx())).toEqual({
    ok: true,
    intent: { kind: "order", activity: "gather", targetType: "copper_rock", stop: { kind: "untilLevel", level: 30 } },
  });
});

test("fight ... forever produces a combat order intent", () => {
  expect(resolveCommand("fight goblin forever", ctx())).toEqual({
    ok: true,
    intent: { kind: "order", activity: "combat", targetType: "goblin", stop: { kind: "forever" } },
  });
});

test("fight ... count N produces a combat order intent", () => {
  expect(resolveCommand("attack goblin count 10", ctx())).toEqual({
    ok: true,
    intent: { kind: "order", activity: "combat", targetType: "goblin", stop: { kind: "count", n: 10 } },
  });
});

test("combat rejects gather-only stop-conditions", () => {
  const r = resolveCommand("fight goblin until full", ctx());
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.message).toContain("combat");
});

test("a bare gather/attack verb is still a one-shot intent (back-compat)", () => {
  expect(resolveCommand("mine copper", ctx())).toEqual({ ok: true, intent: { kind: "gather", targetId: "res-1" } });
  expect(resolveCommand("attack goblin", ctx())).toEqual({ ok: true, intent: { kind: "attack", targetId: "npc-1" } });
});

test("malformed count is a friendly error", () => {
  const r = resolveCommand("chop tree count abc", ctx());
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.message).toContain("count");
});

test("halt is an alias for stop", () => {
  expect(resolveCommand("halt", ctx())).toEqual({ ok: true, intent: { kind: "stopOrder" } });
});

test("stop cancels the active order", () => {
  expect(resolveCommand("stop", ctx())).toEqual({ ok: true, intent: { kind: "stopOrder" } });
});

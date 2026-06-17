import { test, expect } from "bun:test";
import type { Intent, StopCondition } from "./intents";

test("an attack intent carries a targetId", () => {
  const i: Intent = { kind: "attack", targetId: "npc-7" };
  expect(i.kind).toBe("attack");
  expect(i.targetId).toBe("npc-7");
});

test("a deposit intent carries slot and qty", () => {
  const i: Intent = { kind: "deposit", slot: 2, qty: -1 };
  expect(i).toEqual({ kind: "deposit", slot: 2, qty: -1 });
});

test("StopCondition variants are well-formed", () => {
  const forever: StopCondition = { kind: "forever" };
  const count: StopCondition = { kind: "count", n: 10 };
  const full: StopCondition = { kind: "untilFull" };
  const level: StopCondition = { kind: "untilLevel", level: 50 };
  expect([forever.kind, count.kind, full.kind, level.kind]).toEqual([
    "forever", "count", "untilFull", "untilLevel",
  ]);
});

test("order and stopOrder are valid Intents", () => {
  const order: Intent = { kind: "order", activity: "gather", targetType: "tree", stop: { kind: "count", n: 5 } };
  const stop: Intent = { kind: "stopOrder" };
  expect(order.kind).toBe("order");
  expect(stop.kind).toBe("stopOrder");
  if (order.kind === "order") expect(order.activity).toBe("gather");
});

import { test, expect } from "bun:test";
import type { Intent } from "./intents";

test("an attack intent carries a targetId", () => {
  const i: Intent = { kind: "attack", targetId: "npc-7" };
  expect(i.kind).toBe("attack");
  expect(i.targetId).toBe("npc-7");
});

test("a deposit intent carries slot and qty", () => {
  const i: Intent = { kind: "deposit", slot: 2, qty: -1 };
  expect(i).toEqual({ kind: "deposit", slot: 2, qty: -1 });
});

import { test, expect } from "bun:test";
import {
  TABS, TAB_LABELS, layoutTabs, spanHas, inventoryView, actionsForItem,
  examineText, skillLines, gearRows, questLines, makeIntentForItem, scenarioLines,
} from "./panel";
import type { ItemStack, Equipment } from "@termenor/protocol";

const itemName = (id: string) => id; // identity for tests

test("layoutTabs lays every tab in order, non-overlapping, left of nothing", () => {
  const spans = layoutTabs(50);
  expect(spans.map((s) => s.tab)).toEqual([...TABS]);
  for (let i = 1; i < spans.length; i++) {
    expect(spans[i].col0).toBeGreaterThan(spans[i - 1].col1); // gap between tabs
  }
  // first span width matches its label
  expect(spans[0].col1 - spans[0].col0 + 1).toBe(TAB_LABELS[spans[0].tab].length);
});

test("spanHas matches only columns within a tab span", () => {
  const [first] = layoutTabs(50);
  expect(spanHas(first, first.col0)).toBe(true);
  expect(spanHas(first, first.col1)).toBe(true);
  expect(spanHas(first, first.col1 + 1)).toBe(false);
  expect(spanHas(first, first.col0 - 1)).toBe(false);
});

test("inventoryView skips empty slots and keeps the real slot index", () => {
  const inv: (ItemStack | null)[] = [null, { item: "logs", qty: 5 }, null, { item: "bronze_sword", qty: 1 }];
  const rows = inventoryView(inv, itemName);
  expect(rows.map((r) => r.slot)).toEqual([1, 3]);
  expect(rows[0].label).toContain("x5"); // qty>1 shows count
  expect(rows[1].label).not.toContain("x"); // qty 1 has no suffix
});

test("actionsForItem offers normal Make, Equip, Drop, and Examine actions when applicable", () => {
  expect(actionsForItem("bronze_sword")).toEqual(["equip", "drop", "examine"]);
  expect(actionsForItem("logs")).toEqual(["make", "drop", "examine"]);
  expect(makeIntentForItem("logs")).toEqual({ kind: "train", recipe: "fletch_arrow_shafts" });
  expect(makeIntentForItem("bronze_axe")).toBeNull();
});

test("examineText distinguishes wearable, stackable, and plain items", () => {
  expect(examineText("bronze_sword")).toContain("wield");
  expect(examineText("logs")).toContain("stack");
  expect(examineText("bronze_axe")).toBe("Bronze axe."); // non-stackable, non-wearable tool
});

test("skillLines has a combat header plus one row per skill, showing levels and XP", () => {
  const lines = skillLines({
    attack: { xp: 1000, level: 8 },
    fletching: { xp: 5, level: 1 },
  });
  expect(lines[0]).toMatch(/^Combat /);
  expect(lines.length).toBe(1 + 23); // header + every skill
  expect(lines.find((line) => line.startsWith("Attack"))).toBe("Attack        8  1000xp");
  expect(lines.find((line) => line.startsWith("Fletching"))).toBe("Fletching     1  5xp");
});

test("gearRows lists the three slots with filled flags and unequip index", () => {
  const eq: Equipment = { weapon: "bronze_sword", body: null, shield: null };
  const rows = gearRows(eq, itemName);
  expect(rows).toHaveLength(3);
  expect(rows[0]).toMatchObject({ index: 0, slot: "weapon", filled: true });
  expect(rows[1]).toMatchObject({ index: 1, filled: false });
  expect(rows[1].label).toContain("(empty)");
});

test("questLines surfaces the catalog as reference text", () => {
  const lines = questLines();
  expect(lines.some((l) => l.includes("Cook's Assistant"))).toBe(true);
});

test("scenarioLines shows one current objective under the Scenario title", () => {
  expect(scenarioLines({
    scenarioId: "first_steps",
    version: 1,
    objectiveId: "gather_logs",
    objectiveText: "Find a tree and gather logs.",
    completed: ["meet_guide"],
    done: false,
  })).toEqual(["First Steps", "• Find a tree and gather logs."]);
});

test("scenarioLines replaces the objective with a compact completed state", () => {
  expect(scenarioLines({
    scenarioId: "first_steps",
    version: 1,
    objectiveId: null,
    objectiveText: null,
    completed: ["meet_guide", "enter_world"],
    done: true,
  })).toEqual(["First Steps", "✓ Complete"]);
});

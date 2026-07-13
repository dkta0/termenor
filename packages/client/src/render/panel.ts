// Pure layout + content for the reserved side panel (Inventory / Skills / Gear /
// Quest tabs). The renderer owns pixel blitting; everything here is data the
// renderer paints and the click router hit-tests, so it can be unit-tested
// without a terminal.
import {
  ITEM_KINDS,
  EQUIP_SLOTS,
  isEquippable,
  SKILLS,
  combatLevel,
  QUESTS,
  RECIPES,
  type ItemStack,
  type Equipment,
  type EquipSlot,
  type Intent,
  type ScenarioState,
} from "@termenor/protocol";

export type Tab = "inventory" | "skills" | "gear" | "quests";

/** Tab order = display order, left to right across the tab bar. */
export const TABS: readonly Tab[] = ["inventory", "skills", "gear", "quests"];

export const TAB_LABELS: Record<Tab, string> = {
  inventory: "Inv",
  skills: "Skills",
  gear: "Gear",
  quests: "Quest",
};

/** Absolute column span (inclusive) a tab label occupies — for click hit-testing. */
export interface TabSpan {
  tab: Tab;
  col0: number;
  col1: number;
}

/**
 * Lay the tab labels across the panel starting one column in from `panelCol`,
 * separated by two spaces. Returns each tab's absolute column span.
 */
export function layoutTabs(panelCol: number): TabSpan[] {
  const spans: TabSpan[] = [];
  let c = panelCol + 1;
  for (const t of TABS) {
    const len = TAB_LABELS[t].length;
    spans.push({ tab: t, col0: c, col1: c + len - 1 });
    c += len + 2;
  }
  return spans;
}

/** True when absolute cell column `col` falls within `span`. */
export function spanHas(span: TabSpan, col: number): boolean {
  return col >= span.col0 && col <= span.col1;
}

// ---- Inventory ----

export interface InvRow {
  /** Inventory slot index the server action targets. */
  slot: number;
  label: string;
}

/** Non-empty inventory slots as display rows, in slot order. */
export function inventoryView(
  inv: (ItemStack | null)[],
  itemName: (id: string) => string,
): InvRow[] {
  const rows: InvRow[] = [];
  for (let i = 0; i < inv.length; i++) {
    const s = inv[i];
    if (!s) continue;
    const name = itemName(s.item);
    rows.push({ slot: i, label: s.qty > 1 ? `${name}  x${s.qty}` : name });
  }
  return rows;
}

// ---- Item actions (the action row for a selected inventory slot) ----

export type ItemAction = "equip" | "make" | "drop" | "examine";

export const ACTION_LABELS: Record<ItemAction, string> = {
  equip: "Equip",
  make: "Make",
  drop: "Drop",
  examine: "Examine",
};

const SOLE_INPUT_RECIPES = new Map<string, string>();
for (const recipe of Object.values(RECIPES)) {
  const input = recipe.inputs.length === 1 ? recipe.inputs[0] : undefined;
  // Catalog order is the authored preference when more than one Recipe shares an input.
  if (input && !SOLE_INPUT_RECIPES.has(input.item)) {
    SOLE_INPUT_RECIPES.set(input.item, recipe.id);
  }
}

/** Existing train Intent for the preferred Recipe whose only input is this Item. */
export function makeIntentForItem(itemId: string): Intent | null {
  const recipe = SOLE_INPUT_RECIPES.get(itemId);
  return recipe ? { kind: "train", recipe } : null;
}

/** Actions offered for an Item using normal equipment, Recipe, and Inventory rules. */
export function actionsForItem(itemId: string): ItemAction[] {
  const out: ItemAction[] = [];
  if (isEquippable(itemId)) out.push("equip");
  if (SOLE_INPUT_RECIPES.has(itemId)) out.push("make");
  out.push("drop", "examine");
  return out;
}

/** One-line examine flavor for an item id. */
export function examineText(itemId: string): string {
  const k = ITEM_KINDS[itemId];
  const name = k?.name ?? itemId;
  if (!k) return `${name}.`;
  if (isEquippable(itemId)) return `${name} — you can wield this.`;
  if (k.stackable) return `${name} — these stack.`;
  return `${name}.`;
}

// ---- Skills ----

/** One aligned line per skill, plus a combat-level header. */
export function skillLines(skills: Record<string, { xp: number; level: number }>): string[] {
  const xpMap: Record<string, number> = {};
  for (const s of SKILLS) xpMap[s] = skills[s]?.xp ?? 0;
  const header = `Combat ${combatLevel(xpMap)}`;
  const rows = SKILLS.map((name) => {
    const cap = name.charAt(0).toUpperCase() + name.slice(1);
    const entry = skills[name];
    return `${cap.padEnd(12)} ${String(entry?.level ?? 1).padStart(2)}`;
  });
  return [header, ...rows];
}

// ---- Gear ----

export interface GearRow {
  /** Index into EQUIP_SLOTS — the unequip action targets this. */
  index: number;
  slot: EquipSlot;
  label: string;
  filled: boolean;
}

export function gearRows(equipment: Equipment, itemName: (id: string) => string): GearRow[] {
  return EQUIP_SLOTS.map((slot, index) => {
    const item = equipment[slot];
    const slotName = slot.charAt(0).toUpperCase() + slot.slice(1);
    return {
      index,
      slot,
      filled: item != null,
      label: `${slotName}: ${item ? itemName(item) : "(empty)"}`,
    };
  });
}

// ---- Quests (catalog reference; per-player progress not yet synced to client) ----

/** Compact authoritative Scenario progress for the Quest tab. */
export function scenarioLines(state: ScenarioState): string[] {
  const title = state.scenarioId
    .split("_")
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
  if (state.done) return [title, "✓ Complete"];
  return [title, `• ${state.objectiveText ?? "Continue exploring."}`];
}

export function questLines(): string[] {
  const out: string[] = [];
  for (const q of Object.values(QUESTS)) {
    out.push(q.name);
    const first = q.steps[0];
    if (first) out.push(`  ${first.text}`);
  }
  if (out.length === 0) out.push("No quests yet.");
  return out;
}

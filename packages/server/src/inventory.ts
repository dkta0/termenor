import { INV_SIZE, ITEMS } from "@termenor/protocol";
import type { ItemStack } from "@termenor/protocol";

export function emptyInventory(): (ItemStack | null)[] {
  return new Array(INV_SIZE).fill(null);
}

export function addToInventory(
  slots: (ItemStack | null)[],
  stack: ItemStack,
): { slots: (ItemStack | null)[]; leftover: ItemStack | null } {
  const result = slots.slice() as (ItemStack | null)[];
  const entry = ITEMS[stack.item];
  const stackable = entry?.stackable ?? false;

  if (stackable) {
    // try to merge into an existing slot of the same item
    for (let i = 0; i < result.length; i++) {
      if (result[i]?.item === stack.item) {
        result[i] = { item: stack.item, qty: (result[i]!.qty + stack.qty) };
        return { slots: result, leftover: null };
      }
    }
  }

  // find first empty slot
  const emptyIdx = result.findIndex((s) => s === null);
  if (emptyIdx === -1) return { slots: result, leftover: stack };

  result[emptyIdx] = { item: stack.item, qty: stack.qty };
  return { slots: result, leftover: null };
}

export function removeSlot(
  slots: (ItemStack | null)[],
  i: number,
): { slots: (ItemStack | null)[]; removed: ItemStack | null } {
  if (i < 0 || i >= slots.length) return { slots: slots.slice(), removed: null };
  const result = slots.slice() as (ItemStack | null)[];
  const removed = result[i] ?? null;
  result[i] = null;
  return { slots: result, removed };
}

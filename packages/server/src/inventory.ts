import { INV_SIZE, ITEM_KINDS } from "@termenor/protocol";
import type { ItemStack } from "@termenor/protocol";

export function emptyInventory(): (ItemStack | null)[] {
  return new Array(INV_SIZE).fill(null);
}

export function addToInventory(
  slots: (ItemStack | null)[],
  stack: ItemStack,
): { slots: (ItemStack | null)[]; leftover: ItemStack | null } {
  const result = slots.slice() as (ItemStack | null)[];
  const entry = ITEM_KINDS[stack.item];
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

/** Total quantity of `item` across all slots (sums stacks and unit slots). */
export function countItem(slots: (ItemStack | null)[], item: string): number {
  let n = 0;
  for (const s of slots) if (s?.item === item) n += s.qty;
  return n;
}

/**
 * Remove up to `qty` units of `item`, draining slots in order. Works for stackable items
 * (one slot) and non-stackable items (one unit per slot). Returns a new slots array.
 */
export function removeItems(
  slots: (ItemStack | null)[],
  item: string,
  qty: number,
): (ItemStack | null)[] {
  const result = slots.slice() as (ItemStack | null)[];
  let remaining = qty;
  for (let i = 0; i < result.length && remaining > 0; i++) {
    const s = result[i];
    if (s?.item !== item) continue;
    const take = Math.min(s.qty, remaining);
    remaining -= take;
    result[i] = s.qty === take ? null : { item: s.item, qty: s.qty - take };
  }
  return result;
}

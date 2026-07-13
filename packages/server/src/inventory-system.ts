import { addToInventory, removeSlot } from "./inventory";
import { emitFact } from "./gameplay-facts";
import type { GameWorld } from "./game";

export function addGroundItem(w: GameWorld, item: string, qty: number, x: number, y: number): void {
  w.groundItems.push({ id: w.nextItemId++, item, qty, x, y });
}

export function pickup(w: GameWorld, id: string): boolean {
  const p = w.players.get(id);
  if (!p) return false;

  const px = Math.round(p.x);
  const py = Math.round(p.y);
  const matches = w.groundItems.filter(
    (gi) => Math.round(gi.x) === px && Math.round(gi.y) === py,
  );
  if (matches.length === 0) return false;

  let changed = false;
  for (const gi of matches) {
    const { slots, leftover } = addToInventory(p.inventory, { item: gi.item, qty: gi.qty });
    if (leftover === null) {
      // fully picked up
      p.inventory = slots;
      w.groundItems = w.groundItems.filter((g) => g.id !== gi.id);
      changed = true;
    } else if (leftover.qty < gi.qty) {
      // partially picked up
      p.inventory = slots;
      gi.qty = leftover.qty;
      changed = true;
      break;
    } else {
      // nothing could be taken (inventory full for this item)
      break;
    }
  }
  return changed;
}

export function drop(w: GameWorld, id: string, slot: number): boolean {
  const p = w.players.get(id);
  if (!p) return false;

  const { slots, removed } = removeSlot(p.inventory, slot);
  if (removed === null) return false;

  p.inventory = slots;
  w.groundItems.push({
    id: w.nextItemId++,
    item: removed.item,
    qty: removed.qty,
    x: Math.round(p.x),
    y: Math.round(p.y),
  });
  emitFact(w, {
    kind: "inventoryActionPerformed",
    playerId: id,
    action: "drop",
    item: removed.item,
  });
  return true;
}

import { addToInventory } from "./inventory";
import { isAdjacent } from "./combat";
import { BANK_CAP } from "@termenor/protocol";
import type { ItemStack } from "@termenor/protocol";
import type { GameWorld } from "./game";

function notice(w: GameWorld, id: string, text: string): void {
  w.events.gatherNotices.push({ id, text });
}

/** True when the player exists and is adjacent to a live bank_booth resource with the given id. */
export function openBank(w: GameWorld, playerId: string, boothId: string): boolean {
  const p = w.players.get(playerId);
  if (!p) return false;
  const booth = w.resources.find((r) => r.id === boothId && r.type === "bank_booth" && r.respawnAt < 0);
  if (!booth) return false;
  return isAdjacent(p, booth);
}

export function getBank(w: GameWorld, playerId: string): ItemStack[] {
  return w.players.get(playerId)?.bank ?? [];
}

/** Move items from an inventory slot into the bank. qty < 0 means "all" of that slot. */
export function deposit(w: GameWorld, playerId: string, invSlot: number, qty: number): boolean {
  const p = w.players.get(playerId);
  if (!p) return false;
  const slot = p.inventory[invSlot];
  if (!slot) return false;

  const moveQty = Math.min(qty < 0 ? slot.qty : qty, slot.qty);
  if (moveQty <= 0) return false;

  const existing = p.bank.find((e) => e.item === slot.item);
  if (!existing && p.bank.length >= BANK_CAP) {
    notice(w, playerId, "Your bank is full.");
    return false;
  }

  // commit
  if (existing) {
    existing.qty += moveQty;
  } else {
    p.bank.push({ item: slot.item, qty: moveQty });
  }
  slot.qty -= moveQty;
  if (slot.qty <= 0) p.inventory[invSlot] = null;
  return true;
}

/** Move items from a bank entry into the inventory. qty < 0 means "all". Only removes from the bank what actually fit. */
export function withdraw(w: GameWorld, playerId: string, bankIndex: number, qty: number): boolean {
  const p = w.players.get(playerId);
  if (!p) return false;
  const entry = p.bank[bankIndex];
  if (!entry) return false;

  const wantQty = Math.min(qty < 0 ? entry.qty : qty, entry.qty);
  if (wantQty <= 0) return false;

  // Add one unit at a time so a partial fit (limited inventory space) is handled correctly
  // for both stackable and non-stackable items.
  let slots = p.inventory;
  let added = 0;
  for (let i = 0; i < wantQty; i++) {
    const res = addToInventory(slots, { item: entry.item, qty: 1 });
    if (res.leftover !== null) break;
    slots = res.slots;
    added++;
  }

  if (added <= 0) {
    notice(w, playerId, "Your inventory is full.");
    return false;
  }

  p.inventory = slots;
  entry.qty -= added;
  if (entry.qty <= 0) p.bank.splice(bankIndex, 1);
  return true;
}

import { addToInventory } from "./inventory";
import { isAdjacent } from "./combat";
import { SELL_RATE } from "@termenor/protocol";
import type { ShopEntry, ItemStack } from "@termenor/protocol";
import type { PlayerEntity } from "./entities";
import type { GameWorld } from "./game";

function notice(w: GameWorld, id: string, text: string): void {
  w.events.gatherNotices.push({ id, text });
}

/** Total quantity of an item the player holds across all inventory slots. */
function itemCount(p: PlayerEntity, item: string): number {
  let n = 0;
  for (const s of p.inventory) if (s?.item === item) n += s.qty;
  return n;
}

/** Remove up to n of an item across slots, clearing emptied slots. */
function removeFromSlots(slots: (ItemStack | null)[], item: string, n: number): void {
  let remaining = n;
  for (let i = 0; i < slots.length && remaining > 0; i++) {
    const s = slots[i];
    if (s?.item === item) {
      const take = Math.min(remaining, s.qty);
      s.qty -= take;
      remaining -= take;
      if (s.qty <= 0) slots[i] = null;
    }
  }
}

const removeItems = (p: PlayerEntity, item: string, n: number): void => removeFromSlots(p.inventory, item, n);

const coinCount = (p: PlayerEntity): number => itemCount(p, "coins");
const removeCoins = (p: PlayerEntity, n: number): void => removeItems(p, "coins", n);

/** Returns the shop id if the player is adjacent to a matching general_store resource; else null. */
export function openShop(w: GameWorld, playerId: string, npcId: string): string | null {
  const p = w.players.get(playerId);
  if (!p) return null;
  const store = w.resources.find((r) => r.id === npcId && r.type === "general_store" && r.respawnAt < 0);
  if (!store || !isAdjacent(p, store)) return null;
  return "general_store";
}

export function getShop(w: GameWorld, shopId: string): { name: string; entries: ShopEntry[] } | null {
  return w.shops[shopId] ?? null;
}

export function buy(w: GameWorld, playerId: string, shopId: string, item: string, qty: number): boolean {
  const p = w.players.get(playerId);
  if (!p || qty <= 0) return false;
  const shop = w.shops[shopId];
  if (!shop) return false;
  const entry = shop.entries.find((e) => e.item === item);
  if (!entry) {
    notice(w, playerId, "The shop doesn't sell that.");
    return false;
  }
  if (entry.stock < qty) {
    notice(w, playerId, "The shop is out of stock.");
    return false;
  }
  const cost = entry.price * qty;
  if (coinCount(p) < cost) {
    notice(w, playerId, "You don't have enough coins.");
    return false;
  }
  // Verify room one unit at a time (buy is all-or-nothing).
  let slots = p.inventory;
  let fit = 0;
  for (let i = 0; i < qty; i++) {
    const res = addToInventory(slots, { item, qty: 1 });
    if (res.leftover !== null) break;
    slots = res.slots;
    fit++;
  }
  if (fit < qty) {
    notice(w, playerId, "You don't have enough inventory space.");
    return false;
  }
  // commit
  p.inventory = slots;
  removeCoins(p, cost);
  entry.stock -= qty;
  return true;
}

export function sell(w: GameWorld, playerId: string, shopId: string, item: string, qty: number): boolean {
  const p = w.players.get(playerId);
  if (!p || qty <= 0) return false;
  const shop = w.shops[shopId];
  if (!shop) return false;
  const entry = shop.entries.find((e) => e.item === item);
  if (!entry) {
    notice(w, playerId, "You can't sell that here.");
    return false;
  }
  const owned = itemCount(p, item);
  if (owned < 1) {
    notice(w, playerId, "You have none to sell.");
    return false;
  }
  const sellQty = Math.min(qty, owned);
  const payout = Math.floor(entry.price * SELL_RATE) * sellQty;

  // Sell is all-or-nothing: build the result on a trial copy (remove the items,
  // then add the coins) and only commit if the coins fully fit. Otherwise the
  // payout would be silently dropped on a full inventory with no coins slot.
  const trial = p.inventory.map((s) => (s ? { ...s } : null));
  removeFromSlots(trial, item, sellQty);
  const { slots, leftover } = addToInventory(trial, { item: "coins", qty: payout });
  if (leftover !== null) {
    notice(w, playerId, "You don't have enough inventory space for the coins.");
    return false;
  }
  p.inventory = slots;
  entry.stock += sellQty;
  return true;
}

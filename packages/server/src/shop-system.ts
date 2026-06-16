import { addToInventory } from "./inventory";
import { isAdjacent } from "./combat";
import { SELL_RATE } from "@termenor/protocol";
import type { ShopEntry } from "@termenor/protocol";
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
function removeItems(p: PlayerEntity, item: string, n: number): void {
  let remaining = n;
  for (let i = 0; i < p.inventory.length && remaining > 0; i++) {
    const s = p.inventory[i];
    if (s?.item === item) {
      const take = Math.min(remaining, s.qty);
      s.qty -= take;
      remaining -= take;
      if (s.qty <= 0) p.inventory[i] = null;
    }
  }
}

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
  const unitPrice = Math.floor(entry.price * SELL_RATE);
  removeItems(p, item, sellQty);
  const { slots } = addToInventory(p.inventory, { item: "coins", qty: unitPrice * sellQty });
  p.inventory = slots;
  entry.stock += sellQty;
  return true;
}

import { test, expect } from "bun:test";
import { GameWorld } from "./game";
import { openDb, getOrCreateAccount, savePlayerState } from "./db";
import { SHOPS, SELL_RATE, emptyEquipment } from "@termenor/protocol";
import type { MapData, Facing } from "@termenor/protocol";

const MAP: MapData = {
  width: 5, height: 5,
  tiles: new Array(25).fill(0), heights: new Array(25).fill(0),
};
const SPAWN = { x: 2, y: 2, facing: "south" as Facing };

/** Coins the player currently holds. */
function coins(w: GameWorld, id: string): number {
  return w.getInventory(id)!.find((s) => s?.item === "coins")?.qty ?? 0;
}

/** Live stock of an item in the general store. */
function stock(w: GameWorld, item: string): number {
  return w.getShop("general_store")!.entries.find((e) => e.item === item)!.stock;
}

test("end-to-end: open booth, deposit + withdraw, survive a relogin", async () => {
  const db = openDb(":memory:");
  await getOrCreateAccount(db, "hero", "pw", SPAWN);

  const w = new GameWorld(MAP, { x: 2, y: 2 });
  w.addPlayer("hero");
  const booth = w.spawnResource("bank_booth", 3, 2); // adjacent to spawn (2,2)
  const inv = w.getInventory("hero")!;
  inv.fill(null);
  inv[0] = { item: "logs", qty: 30 };

  // open is adjacency-gated, then deposit the whole slot
  expect(w.openBank("hero", booth)).toBe(true);
  expect(w.deposit("hero", 0, -1)).toBe(true);
  expect(inv[0]).toBeNull();
  expect(w.getBank("hero")).toEqual([{ item: "logs", qty: 30 }]);

  // withdraw 10 back into the inventory; remainder stays banked.
  // (withdraw routes through addToInventory, which replaces p.inventory, so
  //  re-fetch rather than reusing the captured `inv` reference.)
  expect(w.withdraw("hero", 0, 10)).toBe(true);
  expect(w.getBank("hero")).toEqual([{ item: "logs", qty: 20 }]);
  expect(w.getInventory("hero")!.find((s) => s?.item === "logs")).toEqual({ item: "logs", qty: 10 });

  // persist, then reload as a fresh world (relogin-equivalent)
  const saved = w.getPlayerState("hero")!;
  savePlayerState(db, "hero", saved.x, saved.y, saved.facing, saved.inventory!, saved.skills!, saved.bank ?? [], emptyEquipment());
  const reloaded = await getOrCreateAccount(db, "hero", "pw", SPAWN);
  if (!reloaded.ok) throw new Error("reload failed");

  const w2 = new GameWorld(MAP, { x: 2, y: 2 });
  w2.addPlayer("hero", reloaded.state);
  expect(w2.getBank("hero")).toEqual([{ item: "logs", qty: 20 }]);
});

test("end-to-end: open store, buy then sell back, exact coin totals", () => {
  const w = new GameWorld(MAP, { x: 2, y: 2 });
  w.addPlayer("hero");
  const store = w.spawnResource("general_store", 2, 3); // adjacent to spawn (2,2)
  const inv = w.getInventory("hero")!;
  inv.fill(null);
  inv[0] = { item: "coins", qty: 100 };

  expect(w.openShop("hero", store)).toBe("general_store");

  const axe = SHOPS.general_store.entries.find((e) => e.item === "bronze_axe")!;
  const startStock = stock(w, "bronze_axe");

  // buy one axe: coins down by price, stock down by one
  expect(w.buy("hero", "general_store", "bronze_axe", 1)).toBe(true);
  expect(coins(w, "hero")).toBe(100 - axe.price);
  expect(stock(w, "bronze_axe")).toBe(startStock - 1);

  // sell it back: coins up by floor(price * SELL_RATE), stock restored
  expect(w.sell("hero", "general_store", "bronze_axe", 1)).toBe(true);
  const sellPrice = Math.floor(axe.price * SELL_RATE);
  expect(coins(w, "hero")).toBe(100 - axe.price + sellPrice);
  expect(stock(w, "bronze_axe")).toBe(startStock);
});

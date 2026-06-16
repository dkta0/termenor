import { test, expect } from "bun:test";
import { GameWorld } from "./game";
import { SELL_RATE, SHOPS } from "@termenor/protocol";
import type { MapData } from "@termenor/protocol";

const MAP: MapData = {
  width: 5, height: 5,
  tiles: new Array(25).fill(0), heights: new Array(25).fill(0),
};

function world(): GameWorld {
  return new GameWorld(MAP, { x: 2, y: 2 });
}

/** Give the player a coin stack and clear the starter axe. */
function withCoins(w: GameWorld, id: string, coins: number): void {
  const inv = w.getInventory(id)!;
  inv.fill(null);
  inv[0] = { item: "coins", qty: coins };
}

const logsEntry = SHOPS.general_store.entries.find((e) => e.item === "logs")!;

test("buy succeeds: coins decrease, item added, stock decreases", () => {
  const w = world();
  w.addPlayer("p1");
  withCoins(w, "p1", 100);

  expect(w.buy("p1", "general_store", "logs", 5)).toBe(true);
  const inv = w.getInventory("p1")!;
  expect(inv.find((s) => s?.item === "coins")).toEqual({ item: "coins", qty: 100 - logsEntry.price * 5 });
  expect(inv.find((s) => s?.item === "logs")).toEqual({ item: "logs", qty: 5 });
  expect(w.getShop("general_store")!.entries.find((e) => e.item === "logs")!.stock).toBe(logsEntry.stock - 5);
});

test("buy refused when coins are insufficient (no state change)", () => {
  const w = world();
  w.addPlayer("p1");
  withCoins(w, "p1", 3);

  expect(w.buy("p1", "general_store", "bronze_axe", 1)).toBe(false);
  const inv = w.getInventory("p1")!;
  expect(inv.find((s) => s?.item === "coins")).toEqual({ item: "coins", qty: 3 });
  expect(inv.some((s) => s?.item === "bronze_axe")).toBe(false);
  expect(w.consumeGatherNotices().some((n) => n.id === "p1")).toBe(true);
});

test("buy refused when there is no inventory room", () => {
  const w = world();
  w.addPlayer("p1");
  const inv = w.getInventory("p1")!;
  for (let i = 0; i < inv.length; i++) inv[i] = { item: "bronze_sword", qty: 1 };
  inv[0] = { item: "coins", qty: 1000 };
  // 27 slots full of swords, 1 coin slot — no room for a non-stackable axe

  expect(w.buy("p1", "general_store", "bronze_axe", 1)).toBe(false);
  expect(w.consumeGatherNotices().some((n) => n.id === "p1")).toBe(true);
});

test("buy refused when out of stock", () => {
  const w = world();
  w.addPlayer("p1");
  withCoins(w, "p1", 10000);
  const stock = w.getShop("general_store")!.entries.find((e) => e.item === "bronze_axe")!.stock;

  expect(w.buy("p1", "general_store", "bronze_axe", stock + 1)).toBe(false);
  expect(w.getShop("general_store")!.entries.find((e) => e.item === "bronze_axe")!.stock).toBe(stock);
});

test("sell succeeds: item removed, coins added at SELL_RATE, stock increases", () => {
  const w = world();
  w.addPlayer("p1");
  const inv = w.getInventory("p1")!;
  inv.fill(null);
  inv[0] = { item: "logs", qty: 10 };

  const stockBefore = w.getShop("general_store")!.entries.find((e) => e.item === "logs")!.stock;
  expect(w.sell("p1", "general_store", "logs", 4)).toBe(true);

  const expectedCoins = Math.floor(logsEntry.price * SELL_RATE) * 4;
  const inv2 = w.getInventory("p1")!;
  expect(inv2.find((s) => s?.item === "logs")).toEqual({ item: "logs", qty: 6 });
  expect(inv2.find((s) => s?.item === "coins")).toEqual({ item: "coins", qty: expectedCoins });
  expect(w.getShop("general_store")!.entries.find((e) => e.item === "logs")!.stock).toBe(stockBefore + 4);
});

test("sell clamps to owned quantity", () => {
  const w = world();
  w.addPlayer("p1");
  const inv = w.getInventory("p1")!;
  inv.fill(null);
  inv[0] = { item: "logs", qty: 2 };

  expect(w.sell("p1", "general_store", "logs", 99)).toBe(true);
  const inv2 = w.getInventory("p1")!;
  expect(inv2.some((s) => s?.item === "logs")).toBe(false);
  const expectedCoins = Math.floor(logsEntry.price * SELL_RATE) * 2;
  expect(inv2.find((s) => s?.item === "coins")).toEqual({ item: "coins", qty: expectedCoins });
});

test("sell refused when the player owns none of the item", () => {
  const w = world();
  w.addPlayer("p1");
  w.getInventory("p1")!.fill(null);

  expect(w.sell("p1", "general_store", "logs", 1)).toBe(false);
  expect(w.consumeGatherNotices().some((n) => n.id === "p1")).toBe(true);
});

test("the in-memory shop stock is a deep copy, untouched by mutations", () => {
  const w = world();
  w.addPlayer("p1");
  withCoins(w, "p1", 1000);
  w.buy("p1", "general_store", "logs", 10);

  // catalog constant is unchanged
  expect(SHOPS.general_store.entries.find((e) => e.item === "logs")!.stock).toBe(100);
});

test("openShop requires an adjacent general_store", () => {
  const w = world();
  w.addPlayer("p1"); // at (2,2)
  const adjacent = w.spawnResource("general_store", 3, 3);
  const faraway = w.spawnResource("general_store", 10, 10);

  expect(w.openShop("p1", adjacent)).toBe("general_store");
  expect(w.openShop("p1", faraway)).toBe(null);
  expect(w.openShop("p1", "nonexistent")).toBe(null);
});

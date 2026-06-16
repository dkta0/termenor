import { test, expect } from "bun:test";
import { GameWorld } from "./game";
import { openDb, getOrCreateAccount, savePlayerState } from "./db";
import { BANK_CAP, emptyEquipment } from "@termenor/protocol";
import type { MapData, ItemStack, Facing } from "@termenor/protocol";

const MAP: MapData = {
  width: 5, height: 5,
  tiles: new Array(25).fill(0), heights: new Array(25).fill(0),
};
const SPAWN = { x: 2, y: 2, facing: "south" as Facing };

function world(): GameWorld {
  return new GameWorld(MAP, { x: 2, y: 2 });
}

test("deposit moves a partial stack and leaves the remainder in the slot", () => {
  const w = world();
  w.addPlayer("p1");
  const inv = w.getInventory("p1")!;
  inv[0] = { item: "logs", qty: 50 };

  expect(w.deposit("p1", 0, 20)).toBe(true);
  expect(w.getBank("p1")).toEqual([{ item: "logs", qty: 20 }]);
  expect(inv[0]).toEqual({ item: "logs", qty: 30 });
});

test("deposit merges into an existing bank entry of the same item", () => {
  const w = world();
  w.addPlayer("p1");
  const inv = w.getInventory("p1")!;
  inv[0] = { item: "logs", qty: 10 };
  inv[1] = { item: "logs", qty: 5 };

  w.deposit("p1", 0, -1);
  w.deposit("p1", 1, -1);
  expect(w.getBank("p1")).toEqual([{ item: "logs", qty: 15 }]);
});

test("deposit -1 deposits the whole slot and clears it", () => {
  const w = world();
  w.addPlayer("p1");
  const inv = w.getInventory("p1")!;
  inv[0] = { item: "copper_ore", qty: 7 };

  expect(w.deposit("p1", 0, -1)).toBe(true);
  expect(w.getBank("p1")).toEqual([{ item: "copper_ore", qty: 7 }]);
  expect(inv[0]).toBeNull();
});

test("deposit on an empty slot is a no-op", () => {
  const w = world();
  w.addPlayer("p1");
  expect(w.deposit("p1", 5, 10)).toBe(false);
  expect(w.getBank("p1")).toEqual([]);
});

test("deposit refuses a new item when the bank is at BANK_CAP", () => {
  const w = world();
  w.addPlayer("p1");
  const bank = w.getBank("p1");
  for (let i = 0; i < BANK_CAP; i++) bank.push({ item: `item_${i}`, qty: 1 });

  const inv = w.getInventory("p1")!;
  inv[0] = { item: "logs", qty: 5 };
  expect(w.deposit("p1", 0, -1)).toBe(false);
  expect(bank.length).toBe(BANK_CAP);
  expect(inv[0]).toEqual({ item: "logs", qty: 5 });
  expect(w.consumeGatherNotices().some((n) => n.id === "p1")).toBe(true);
});

test("withdraw clamps qty to what the bank holds and removes the emptied entry", () => {
  const w = world();
  w.addPlayer("p1");
  // clear the starter axe so the inventory is empty
  w.getInventory("p1")!.fill(null);
  w.getBank("p1").push({ item: "logs", qty: 10 });

  expect(w.withdraw("p1", 0, 999)).toBe(true);
  expect(w.getBank("p1")).toEqual([]);
  const logs = w.getInventory("p1")!.find((s) => s?.item === "logs");
  expect(logs).toEqual({ item: "logs", qty: 10 });
});

test("withdraw respects the 28-slot inventory cap and leaves the remainder in the bank", () => {
  const w = world();
  w.addPlayer("p1");
  const inv = w.getInventory("p1")!;
  // fill all but 2 slots with distinct non-stackable items
  for (let i = 0; i < inv.length; i++) inv[i] = { item: "bronze_sword", qty: 1 };
  inv[26] = null;
  inv[27] = null;

  w.getBank("p1").push({ item: "bronze_axe", qty: 5 });
  expect(w.withdraw("p1", 0, -1)).toBe(true);

  // only 2 axes fit; 3 remain banked
  expect(w.getBank("p1")).toEqual([{ item: "bronze_axe", qty: 3 }]);
  const axes = w.getInventory("p1")!.filter((s) => s?.item === "bronze_axe").length;
  expect(axes).toBe(2);
});

test("withdraw refuses when the inventory is completely full", () => {
  const w = world();
  w.addPlayer("p1");
  const inv = w.getInventory("p1")!;
  for (let i = 0; i < inv.length; i++) inv[i] = { item: "bronze_sword", qty: 1 };
  w.getBank("p1").push({ item: "bronze_axe", qty: 1 });

  expect(w.withdraw("p1", 0, 1)).toBe(false);
  expect(w.getBank("p1")).toEqual([{ item: "bronze_axe", qty: 1 }]);
  expect(w.consumeGatherNotices().some((n) => n.id === "p1")).toBe(true);
});

test("openBank requires an adjacent bank_booth", () => {
  const w = world();
  w.addPlayer("p1"); // at (2,2)
  const adjacent = w.spawnResource("bank_booth", 3, 2);
  const faraway = w.spawnResource("bank_booth", 10, 10);

  expect(w.openBank("p1", adjacent)).toBe(true);
  expect(w.openBank("p1", faraway)).toBe(false);
  expect(w.openBank("p1", "nonexistent")).toBe(false);
});

test("a deposited bank survives a db save/reload round-trip", async () => {
  const db = openDb(":memory:");
  await getOrCreateAccount(db, "banker", "pw", SPAWN);

  const w1 = world();
  w1.addPlayer("banker");
  w1.getInventory("banker")![0] = { item: "logs", qty: 40 };
  w1.deposit("banker", 0, -1);
  const saved = w1.getPlayerState("banker")!;
  savePlayerState(db, "banker", saved.x, saved.y, saved.facing, saved.inventory!, saved.skills!, saved.bank ?? [], emptyEquipment());

  const reloaded = await getOrCreateAccount(db, "banker", "pw", SPAWN);
  expect(reloaded.ok).toBe(true);
  if (!reloaded.ok) throw new Error("reload failed");

  const w2 = world();
  w2.addPlayer("banker", reloaded.state);
  expect(w2.getBank("banker")).toEqual([{ item: "logs", qty: 40 }]);
});

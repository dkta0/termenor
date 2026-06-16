import { test, expect } from "bun:test";
import { GameWorld } from "./game";
import { playerMaxHit, playerDefence } from "./equipment-system";
import { PLAYER_MAX_HIT } from "@termenor/protocol";
import type { MapData } from "@termenor/protocol";

const MAP: MapData = { width: 5, height: 5, tiles: new Array(25).fill(0), heights: new Array(25).fill(0) };
const world = () => new GameWorld(MAP, { x: 2, y: 2 });

test("equip moves an equippable item from inventory into its slot", () => {
  const w = world();
  w.addPlayer("p1");
  const inv = w.getInventory("p1")!;
  inv.fill(null);
  inv[0] = { item: "bronze_sword", qty: 1 };
  expect(w.equip("p1", 0)).toBe(true);
  expect(w.getEquipment("p1").weapon).toBe("bronze_sword");
  expect(w.getInventory("p1")![0]).toBeNull();
});

test("equip into an occupied slot swaps the old gear back to that inventory slot", () => {
  const w = world();
  w.addPlayer("p1");
  const inv = w.getInventory("p1")!;
  inv.fill(null);
  inv[0] = { item: "bronze_sword", qty: 1 };
  w.equip("p1", 0); // weapon = sword, inv[0] = null
  inv[0] = { item: "bronze_sword", qty: 1 }; // a second sword (stand-in)
  expect(w.equip("p1", 0)).toBe(true);
  expect(w.getEquipment("p1").weapon).toBe("bronze_sword");
  expect(w.getInventory("p1")![0]).toEqual({ item: "bronze_sword", qty: 1 }); // swapped-out sword
});

test("equip a non-equippable item is refused", () => {
  const w = world();
  w.addPlayer("p1");
  const inv = w.getInventory("p1")!;
  inv.fill(null);
  inv[0] = { item: "logs", qty: 5 };
  expect(w.equip("p1", 0)).toBe(false);
  expect(w.getEquipment("p1").weapon).toBeNull();
  expect(w.getInventory("p1")![0]).toEqual({ item: "logs", qty: 5 });
});

test("unequip returns gear to the inventory", () => {
  const w = world();
  w.addPlayer("p1");
  const inv = w.getInventory("p1")!;
  inv.fill(null);
  inv[0] = { item: "bronze_platebody", qty: 1 };
  w.equip("p1", 0); // body
  expect(w.unequip("p1", 1)).toBe(true); // index 1 = "body"
  expect(w.getEquipment("p1").body).toBeNull();
  expect(w.getInventory("p1")!.some((s) => s?.item === "bronze_platebody")).toBe(true);
});

test("unequip into a full inventory is refused and the gear is retained", () => {
  const w = world();
  w.addPlayer("p1");
  const inv = w.getInventory("p1")!;
  inv.fill(null);
  inv[0] = { item: "bronze_sword", qty: 1 };
  w.equip("p1", 0); // weapon equipped, inv[0] now null
  for (let i = 0; i < inv.length; i++) inv[i] = { item: "logs", qty: 1 }; // fill every slot
  expect(w.unequip("p1", 0)).toBe(false); // index 0 = "weapon"
  expect(w.getEquipment("p1").weapon).toBe("bronze_sword");
});

test("playerMaxHit adds the weapon bonus to the unarmed base", () => {
  const w = world();
  w.addPlayer("p1");
  const p = (w as unknown as { players: Map<string, import("./entities").PlayerEntity> }).players.get("p1")!;
  expect(playerMaxHit(p)).toBe(PLAYER_MAX_HIT); // unarmed
  const inv = w.getInventory("p1")!;
  inv.fill(null); inv[0] = { item: "bronze_sword", qty: 1 };
  w.equip("p1", 0);
  expect(playerMaxHit(p)).toBe(PLAYER_MAX_HIT + 2);
});

test("playerDefence sums equipped armour", () => {
  const w = world();
  w.addPlayer("p1");
  const p = (w as unknown as { players: Map<string, import("./entities").PlayerEntity> }).players.get("p1")!;
  expect(playerDefence(p)).toBe(0);
  const inv = w.getInventory("p1")!;
  inv.fill(null);
  inv[0] = { item: "bronze_platebody", qty: 1 };
  inv[1] = { item: "bronze_shield", qty: 1 };
  w.equip("p1", 0); w.equip("p1", 1);
  expect(playerDefence(p)).toBe(3); // 2 + 1
});

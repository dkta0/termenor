import { test, expect } from "bun:test";
import { EQUIP_SLOTS, EQUIPMENT, isEquippable, emptyEquipment } from "./equipment";

test("EQUIP_SLOTS is the fixed weapon/body/shield order", () => {
  expect(EQUIP_SLOTS).toEqual(["weapon", "body", "shield"]);
});

test("EQUIPMENT maps gear to slots with stats", () => {
  expect(EQUIPMENT.bronze_sword).toEqual({ slot: "weapon", maxHit: 2 });
  expect(EQUIPMENT.bronze_platebody.slot).toBe("body");
  expect(EQUIPMENT.bronze_shield.defence).toBe(1);
});

test("isEquippable is true only for listed gear", () => {
  expect(isEquippable("bronze_sword")).toBe(true);
  expect(isEquippable("logs")).toBe(false);
});

test("emptyEquipment has three null slots", () => {
  expect(emptyEquipment()).toEqual({ weapon: null, body: null, shield: null });
});

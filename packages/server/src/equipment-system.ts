import { addToInventory } from "./inventory";
import { EQUIPMENT, EQUIP_SLOTS, PLAYER_MAX_HIT, levelForXp, type Equipment, type EquipSlot } from "@termenor/protocol";
import type { PlayerEntity } from "./entities";
import type { GameWorld } from "./game";

function notice(w: GameWorld, id: string, text: string): void {
  w.events.gatherNotices.push({ id, text });
}

/** Unarmed base + equipped weapon's maxHit bonus + a strength-level bonus (skill-driven). */
export function playerMaxHit(p: PlayerEntity): number {
  const w = p.equipment.weapon;
  const weaponBonus = w ? (EQUIPMENT[w]?.maxHit ?? 0) : 0;
  const strengthBonus = Math.floor(levelForXp(p.skills.strength ?? 0) / 8);
  return PLAYER_MAX_HIT + weaponBonus + strengthBonus;
}

/** Sum of equipped-armour defence + a defence-level bonus (skill-driven). */
export function playerDefence(p: PlayerEntity): number {
  let d = 0;
  for (const slot of EQUIP_SLOTS) {
    const item = p.equipment[slot];
    if (item) d += EQUIPMENT[item]?.defence ?? 0;
  }
  return d + Math.floor(levelForXp(p.skills.defence ?? 0) / 12);
}

export function getEquipment(w: GameWorld, playerId: string): Equipment {
  const p = w.players.get(playerId);
  return p ? p.equipment : { weapon: null, body: null, shield: null };
}

export function equip(w: GameWorld, playerId: string, invSlot: number): boolean {
  const p = w.players.get(playerId);
  if (!p) return false;
  const stack = p.inventory[invSlot];
  if (!stack) return false;
  const stats = EQUIPMENT[stack.item];
  if (!stats) { notice(w, playerId, "You can't equip that."); return false; }
  const slot: EquipSlot = stats.slot;
  // Swap: old gear (if any) returns to the freed inventory slot. Net inv count unchanged.
  const old = p.equipment[slot];
  p.equipment = { ...p.equipment, [slot]: stack.item };
  p.inventory[invSlot] = old ? { item: old, qty: 1 } : null;
  return true;
}

export function unequip(w: GameWorld, playerId: string, equipIndex: number): boolean {
  const p = w.players.get(playerId);
  if (!p) return false;
  const slot = EQUIP_SLOTS[equipIndex];
  if (!slot) return false;
  const item = p.equipment[slot];
  if (!item) return false;
  // All-or-nothing (slice-10 sell lesson): only commit if the gear actually fits.
  const { slots, leftover } = addToInventory(p.inventory, { item, qty: 1 });
  if (leftover !== null) {
    notice(w, playerId, "You don't have inventory space to unequip that.");
    return false;
  }
  p.inventory = slots;
  p.equipment = { ...p.equipment, [slot]: null };
  return true;
}

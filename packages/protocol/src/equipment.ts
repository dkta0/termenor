export type EquipSlot = "weapon" | "body" | "shield";

/** Fixed display + index order. UNEQUIP actions index into this. */
export const EQUIP_SLOTS: EquipSlot[] = ["weapon", "body", "shield"];

/** A player's equipped item id per slot (null = empty). */
export type Equipment = Record<EquipSlot, string | null>;

export const emptyEquipment = (): Equipment => ({ weapon: null, body: null, shield: null });

export interface EquipStats { slot: EquipSlot; maxHit?: number; defence?: number; }

export const EQUIPMENT: Record<string, EquipStats> = {
  bronze_sword:     { slot: "weapon", maxHit: 2 },
  bronze_platebody: { slot: "body",   defence: 2 },
  bronze_shield:    { slot: "shield", defence: 1 },
};

export const isEquippable = (item: string): boolean =>
  Object.prototype.hasOwnProperty.call(EQUIPMENT, item);

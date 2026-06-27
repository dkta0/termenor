import type { ItemStack } from "./items";

/**
 * A shallow "make X" training action. The player must have all `inputs` (consumed) and
 * inventory room for `outputs` (added); on success they gain `xp` in `skill` and the
 * action goes on a per-player cooldown of `cooldownTicks`. This single data shape gives
 * every non-combat, non-node skill at least one in-game training path; combat skills
 * (attack/strength/defence/hitpoints/ranged/magic) train through the combat system, and
 * woodcutting/mining/fishing train at resource nodes.
 *
 * Inputs for recipes that aren't produced by another skill (hides, herbs, essence, …) are
 * stocked in the general store, so every skill is reachable from a fresh account.
 */
export interface Recipe {
  id: string;
  skill: string;
  level: number;
  inputs: ItemStack[];
  outputs: ItemStack[];
  xp: number;
  cooldownTicks: number;
}

export const RECIPES: Record<string, Recipe> = {
  // Smithing — smelt ore into a bar, then smith the bar into a weapon.
  smith_bronze_bar:    { id: "smith_bronze_bar",    skill: "smithing",     level: 1, inputs: [{ item: "copper_ore", qty: 1 }, { item: "tin_ore", qty: 1 }], outputs: [{ item: "bronze_bar", qty: 1 }],     xp: 12, cooldownTicks: 4 },
  smith_bronze_dagger: { id: "smith_bronze_dagger", skill: "smithing",     level: 1, inputs: [{ item: "bronze_bar", qty: 1 }],                                outputs: [{ item: "bronze_dagger", qty: 1 }],  xp: 12, cooldownTicks: 4 },
  // Crafting — tan a hide into leather, then craft gloves.
  tan_leather:         { id: "tan_leather",         skill: "crafting",     level: 1, inputs: [{ item: "cowhide", qty: 1 }],                                   outputs: [{ item: "leather", qty: 1 }],        xp: 5,  cooldownTicks: 4 },
  craft_leather_gloves:{ id: "craft_leather_gloves",skill: "crafting",     level: 1, inputs: [{ item: "leather", qty: 1 }],                                   outputs: [{ item: "leather_gloves", qty: 1 }], xp: 14, cooldownTicks: 4 },
  // Fletching — whittle logs into arrow shafts, then attach feathers.
  fletch_arrow_shafts: { id: "fletch_arrow_shafts", skill: "fletching",    level: 1, inputs: [{ item: "logs", qty: 1 }],                                      outputs: [{ item: "arrow_shafts", qty: 1 }],   xp: 5,  cooldownTicks: 4 },
  fletch_bronze_arrow: { id: "fletch_bronze_arrow", skill: "fletching",    level: 1, inputs: [{ item: "arrow_shafts", qty: 1 }, { item: "feather", qty: 1 }], outputs: [{ item: "bronze_arrow", qty: 1 }],   xp: 6,  cooldownTicks: 4 },
  // Herblore — clean a grimy herb, then brew a potion with a vial of water.
  clean_guam:          { id: "clean_guam",          skill: "herblore",     level: 1, inputs: [{ item: "grimy_guam", qty: 1 }],                                outputs: [{ item: "guam_leaf", qty: 1 }],      xp: 3,  cooldownTicks: 4 },
  make_attack_potion:  { id: "make_attack_potion",  skill: "herblore",     level: 1, inputs: [{ item: "guam_leaf", qty: 1 }, { item: "vial_of_water", qty: 1 }], outputs: [{ item: "attack_potion", qty: 1 }], xp: 25, cooldownTicks: 4 },
  // Runecrafting — bind rune essence into air runes.
  craft_air_rune:      { id: "craft_air_rune",      skill: "runecrafting", level: 1, inputs: [{ item: "rune_essence", qty: 1 }],                              outputs: [{ item: "air_rune", qty: 1 }],       xp: 5,  cooldownTicks: 4 },
  // Construction — saw logs into planks, then build furniture.
  make_planks:         { id: "make_planks",         skill: "construction", level: 1, inputs: [{ item: "logs", qty: 1 }],                                      outputs: [{ item: "planks", qty: 1 }],         xp: 10, cooldownTicks: 4 },
  build_wooden_chair:  { id: "build_wooden_chair",  skill: "construction", level: 1, inputs: [{ item: "planks", qty: 2 }],                                    outputs: [{ item: "wooden_chair", qty: 1 }],   xp: 20, cooldownTicks: 4 },
  // Prayer — bury bones for prayer experience (no product).
  bury_bones:          { id: "bury_bones",          skill: "prayer",       level: 1, inputs: [{ item: "bones", qty: 1 }],                                     outputs: [],                                   xp: 5,  cooldownTicks: 4 },
  // Activity skills — performed "at a spot": no inputs, slower cooldown, small yield.
  train_agility:       { id: "train_agility",       skill: "agility",      level: 1, inputs: [],                                                             outputs: [],                                   xp: 8,  cooldownTicks: 8 },
  steal_stall:         { id: "steal_stall",         skill: "thieving",     level: 1, inputs: [],                                                             outputs: [{ item: "coins", qty: 5 }],          xp: 8,  cooldownTicks: 8 },
  hunt_bird:           { id: "hunt_bird",           skill: "hunter",       level: 1, inputs: [],                                                             outputs: [{ item: "raw_bird_meat", qty: 1 }],  xp: 10, cooldownTicks: 8 },
  harvest_potato:      { id: "harvest_potato",      skill: "farming",      level: 1, inputs: [],                                                             outputs: [{ item: "potato", qty: 1 }],         xp: 8,  cooldownTicks: 8 },
};

export function isRecipe(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(RECIPES, id);
}

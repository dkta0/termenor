export interface ResourceState { id: string; type: string; x: number; y: number; }

export interface ResourceConfig {
  name: string;
  color: [number, number, number];
  skill: string;
  tool: string | null;      // required inventory item, or null
  yield: string;            // item id produced (ignored for fire)
  xp: number;               // xp per success
  charges: number;          // uses before depletion (ignored if infinite)
  respawnTicks: number;     // ticks to respawn after depletion (ignored if infinite)
  cooldownTicks: number;    // ticks between successes
  infinite?: boolean;       // never depletes (fishing spot)
  lifetimeTicks?: number;   // one-shot entities (fire): auto-remove after this many ticks
  gatherable?: boolean;     // can be targeted by the gather pass / 'c' key (false for fire)
}

export const RESOURCE_TYPES: Record<string, ResourceConfig> = {
  tree:         { name: "Tree",         color: [40, 120, 40],    skill: "woodcutting", tool: "bronze_axe",     yield: "logs",       xp: 25, charges: 5, respawnTicks: 90,  cooldownTicks: 30, gatherable: true },
  rock:         { name: "Rock",         color: [120, 120, 130],  skill: "mining",      tool: "bronze_pickaxe", yield: "copper_ore", xp: 18, charges: 4, respawnTicks: 120, cooldownTicks: 30, gatherable: true },
  fishing_spot: { name: "Fishing spot", color: [60, 120, 200],   skill: "fishing",     tool: "small_net",      yield: "raw_shrimp", xp: 10, charges: 0, respawnTicks: 0,   cooldownTicks: 35, infinite: true, gatherable: true },
  fire:         { name: "Fire",         color: [240, 140, 30],   skill: "firemaking",  tool: null,             yield: "",           xp: 0,  charges: 0, respawnTicks: 0,   cooldownTicks: 0,  lifetimeTicks: 150, gatherable: false },
};

export const FIRE_LIFETIME_TICKS = 150;
// keep for back-compat — engine now reads per-type config
export const RESOURCE_RESPAWN_TICKS = 90;
export const TREE_CHARGES = 5;

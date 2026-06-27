export const MAX_LEVEL = 99;
export const WOODCUTTING_XP_PER_LOG = 25;

/**
 * Every RuneScape skill. Order follows the in-game skill guide so the client skills
 * panel reads naturally. Player skill XP is a `Record<skill, xp>`; a skill not present
 * is level 1 / 0 xp. Every skill here has at least one training path (combat for the
 * combat skills, a recipe in `recipes.ts` for the rest).
 */
export const SKILLS = [
  "attack", "strength", "defence", "hitpoints", "ranged", "prayer", "magic",
  "runecrafting", "construction", "agility", "herblore", "thieving", "crafting",
  "fletching", "slayer", "hunter", "mining", "smithing", "fishing", "cooking",
  "firemaking", "woodcutting", "farming",
] as const;

export type Skill = (typeof SKILLS)[number];

/** Combat skills train through fighting (combat-system), not crafting recipes. */
export const COMBAT_SKILLS = ["attack", "strength", "defence", "hitpoints", "ranged", "magic"] as const;

/** The seven skills that contribute to the combat level (prayer included). */
export const COMBAT_LEVEL_SKILLS = ["attack", "strength", "defence", "hitpoints", "ranged", "magic", "prayer"] as const;

export function isCombatSkill(skill: string): boolean {
  return (COMBAT_SKILLS as readonly string[]).includes(skill);
}

// RuneScape XP table: points to reach level L = floor( sum_{i=1}^{L-1} floor(i + 300*2^(i/7)) / 4 ).
function buildTable(): number[] {
  const table: number[] = [0, 0]; // index by level; level 1 needs 0 xp
  let points = 0;
  for (let lvl = 1; lvl < MAX_LEVEL; lvl++) {
    points += Math.floor(lvl + 300 * Math.pow(2, lvl / 7));
    table[lvl + 1] = Math.floor(points / 4);
  }
  return table;
}
const XP_TABLE = buildTable(); // XP_TABLE[L] = xp needed to BE level L (XP_TABLE[1]=0)

export function xpForLevel(level: number): number {
  const l = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
  return XP_TABLE[l];
}

export function levelForXp(xp: number): number {
  if (xp <= 0) return 1;
  let level = 1;
  for (let l = 1; l <= MAX_LEVEL; l++) if (xp >= XP_TABLE[l]) level = l; else break;
  return level;
}

/**
 * RuneScape combat level from a player's skill XP map. Shallow port of the OSRS formula:
 * a defence/hitpoints/prayer base plus the best of the melee/ranged/magic contributions.
 */
export function combatLevel(skills: Record<string, number>): number {
  const lvl = (s: string): number => levelForXp(skills[s] ?? 0);
  const base = 0.25 * (lvl("defence") + lvl("hitpoints") + Math.floor(lvl("prayer") / 2));
  const melee = 0.325 * (lvl("attack") + lvl("strength"));
  const ranged = 0.325 * Math.floor(lvl("ranged") * 1.5);
  const magic = 0.325 * Math.floor(lvl("magic") * 1.5);
  return Math.floor(base + Math.max(melee, ranged, magic));
}

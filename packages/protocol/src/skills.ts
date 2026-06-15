export const MAX_LEVEL = 99;
export const WOODCUTTING_XP_PER_LOG = 25;

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

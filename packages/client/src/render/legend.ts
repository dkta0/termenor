export type Mode = "play" | "direct";

export interface LegendContext {
  mode: Mode;
  /** Display name of the nearest attackable NPC, or null if none in view. */
  nearestEnemy: string | null;
  /** Display name of the nearest gatherable resource, or null if none in view. */
  nearestResource: string | null;
  /** Display name of an item on the player's tile, or null if none. */
  itemUnderfoot: string | null;
}

const PLAY_HINT = "[click] move · act    [/] command    [?] help";
const DIRECT_HINT = "[Esc] back  ·  type to chat, /verb for commands";

/**
 * Control-legend lines, generated from live world state. Mouse-first: one
 * standing hint plus a single context cue pointing at the most relevant nearby
 * thing the player can click. The renderer joins these onto one bottom row.
 */
export function legendLines(ctx: LegendContext): string[] {
  if (ctx.mode === "direct") return [DIRECT_HINT];
  const lines: string[] = [];
  if (ctx.nearestEnemy) lines.push(`click ${ctx.nearestEnemy} to fight`);
  else if (ctx.nearestResource) lines.push(`click ${ctx.nearestResource} to gather`);
  else if (ctx.itemUnderfoot) lines.push(`click ${ctx.itemUnderfoot} to grab`);
  lines.push(PLAY_HINT);
  return lines;
}

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

const PLAY_HINT = "[move] arrows/click   [/] command   [Enter] chat   [?] help";
const DIRECT_HINT = "[Esc] play   ·   type to chat, /verb for commands";

/**
 * Control-legend lines, generated from live world state so the UI always
 * reflects exactly what the keys will do right now. The renderer joins these
 * onto a single bottom row.
 */
export function legendLines(ctx: LegendContext): string[] {
  if (ctx.mode === "direct") return [DIRECT_HINT];
  const lines: string[] = [];
  if (ctx.nearestEnemy) lines.push(`[a] attack ${ctx.nearestEnemy}`);
  if (ctx.nearestResource) lines.push(`[c] gather ${ctx.nearestResource}`);
  if (ctx.itemUnderfoot) lines.push(`[g] pick up ${ctx.itemUnderfoot}`);
  lines.push(PLAY_HINT);
  return lines;
}

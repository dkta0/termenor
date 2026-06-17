import { RESOURCE_KINDS } from "@termenor/protocol";
import type { StopCondition } from "@termenor/protocol";
import type { GameWorld } from "./game";
import type { PlayerEntity } from "./entities";

/** Total quantity of a given item across the inventory. */
function countItem(p: PlayerEntity, item: string): number {
  let n = 0;
  for (const s of p.inventory) if (s && s.item === item) n += s.qty;
  return n;
}

/** Clear all low-level action state — the v1 safe-idle default (stop & hold). */
function safeIdle(p: PlayerEntity): void {
  p.gatherTarget = null;
  p.target = null;
  p.path = [];
}

/** Human-readable summary of an order, for notices. */
export function describeOrder(activity: "gather" | "combat", targetType: string, stop: StopCondition): string {
  const what = activity === "gather" ? `gather ${targetType}` : `fight ${targetType}`;
  switch (stop.kind) {
    case "forever": return `${what} forever`;
    case "count": return `${what} (count ${stop.n})`;
    case "untilFull": return `${what} until full`;
    case "untilLevel": return `${what} until level ${stop.level}`;
  }
}

export function setOrder(
  w: GameWorld,
  playerId: string,
  activity: "gather" | "combat",
  targetType: string,
  stop: StopCondition,
): string {
  const p = w.players.get(playerId);
  if (!p) return "";
  safeIdle(p); // drop any in-progress one-shot action
  const baselineYield = activity === "gather" ? countItem(p, RESOURCE_KINDS[targetType]?.yield ?? "") : 0;
  p.order = { activity, targetType, stop, unitsDone: 0, baselineYield, engagedNpcId: null };
  return `Order set: ${describeOrder(activity, targetType, stop)}.`;
}

export function clearOrder(w: GameWorld, playerId: string): string {
  const p = w.players.get(playerId);
  if (!p || !p.order) return "";
  p.order = null;
  safeIdle(p);
  return "Order cancelled.";
}

/** Per-tick supervisor. Filled in by later tasks (gather + combat). */
export function stepOrders(_w: GameWorld): void {
  // implemented in Tasks 3 (gather) and 4 (combat)
}

import { RESOURCE_KINDS, levelForXp } from "@termenor/protocol";
import type { StopCondition } from "@termenor/protocol";
import { addToInventory } from "./inventory";
import type { GameWorld } from "./game";
import type { ActiveOrder, PlayerEntity } from "./entities";
import * as combatSys from "./combat-system";

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

/** Nearest entity to the player by Euclidean distance, or null for an empty list. */
function nearest<T extends { x: number; y: number }>(p: PlayerEntity, list: T[]): T | null {
  let best: T | null = null;
  let bestD = Infinity;
  for (const e of list) {
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

function stopMet(p: PlayerEntity, order: ActiveOrder): boolean {
  const stop = order.stop;
  switch (stop.kind) {
    case "forever":
      return false;
    case "count":
      return order.unitsDone >= stop.n;
    case "untilFull": {
      if (order.activity !== "gather") return false;
      const yieldItem = RESOURCE_KINDS[order.targetType]?.yield ?? "";
      const { leftover } = addToInventory(p.inventory, { item: yieldItem, qty: 1 });
      return leftover !== null;
    }
    case "untilLevel": {
      if (order.activity !== "gather") return false;
      const skill = RESOURCE_KINDS[order.targetType]?.skill ?? "";
      return levelForXp(p.skills[skill] ?? 0) >= stop.level;
    }
  }
}

export function stepOrders(w: GameWorld): void {
  for (const p of w.players.values()) {
    const order = p.order;
    if (!order) continue;

    // 1. account progress (observational)
    if (order.activity === "gather") {
      const yieldItem = RESOURCE_KINDS[order.targetType]?.yield ?? "";
      const current = countItem(p, yieldItem);
      if (current > order.baselineYield) {
        order.unitsDone += current - order.baselineYield;
        order.baselineYield = current;
      }
    } else if (order.engagedNpcId !== null) {
      // Kill is observed the tick AFTER it lands: stepOrders runs before stepCombat/
      // resolveDeaths, so resolveDeaths(T) sets respawnAt and we count it on T+1.
      // combat: the engaged npc dying (respawnAt set) or vanishing counts as a kill
      const npc = w.npcs.find((n) => n.id === order.engagedNpcId);
      if (!npc || npc.respawnAt >= 0) {
        order.unitsDone++;
        order.engagedNpcId = null;
      }
    }

    // 2. check stop-condition
    if (stopMet(p, order)) {
      p.order = null;
      safeIdle(p);
      w.events.orderNotices.push({ id: p.id, text: `Order complete: ${describeOrder(order.activity, order.targetType, order.stop)}.` });
      continue;
    }

    // 3. acquire the next target if the low-level action is idle
    if (order.activity === "gather" && p.gatherTarget === null) {
      const candidates = w.resources.filter(
        (r) => r.type === order.targetType && r.respawnAt < 0 && RESOURCE_KINDS[r.type]?.gatherable !== false,
      );
      const res = nearest(p, candidates);
      if (res) p.gatherTarget = res.id;
    }

    if (order.activity === "combat" && p.target === null) {
      const candidates = w.npcs.filter((n) => n.type === order.targetType && n.respawnAt < 0);
      const npc = nearest(p, candidates);
      if (npc) {
        combatSys.setTarget(w, p.id, npc.id);
        order.engagedNpcId = npc.id;
      }
    }
  }
}

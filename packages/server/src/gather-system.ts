import { RESOURCE_KINDS } from "@termenor/protocol";
import { addToInventory } from "./inventory";
import { isAdjacent } from "./combat";
import { stepToward } from "./movement-system";
import { awardXp } from "./skills-system";
import type { GameWorld } from "./game";
import type { PlayerEntity } from "./entities";

export function setGatherTarget(w: GameWorld, playerId: string, targetId: string): void {
  const p = w.players.get(playerId);
  if (!p) return;
  const res = w.resources.find((r) => r.id === targetId && r.respawnAt < 0);
  if (!res) return;
  p.gatherTarget = targetId;
}

export function stepGather(w: GameWorld): void {
  for (const p of w.players.values()) {
    if (!p.gatherTarget) continue;
    if (p.gatherCd > 0) p.gatherCd--;
    const res = w.resources.find((r) => r.id === p.gatherTarget && r.respawnAt < 0);
    if (!res) { p.gatherTarget = null; continue; }
    const cfg = RESOURCE_KINDS[res.type];
    if (!cfg || cfg.gatherable === false) { p.gatherTarget = null; continue; }
    if (isAdjacent(p, res)) {
      p.path = [];
      if (p.gatherCd === 0) {
        if (cfg.tool && !hasItem(p, cfg.tool)) {
          p.gatherTarget = null;
          w.events.gatherNotices.push({ id: p.id, text: "You need the right tool." });
          continue;
        }
        const { slots, leftover } = addToInventory(p.inventory, { item: cfg.yield, qty: 1 });
        if (leftover !== null) {
          // inventory full — could not add item
          p.gatherTarget = null;
          w.events.gatherNotices.push({ id: p.id, text: "Your inventory is full." });
          continue;
        }
        p.inventory = slots;
        awardXp(w.events, p, cfg.skill, cfg.xp);
        p.gatherCd = cfg.cooldownTicks;
        if (!cfg.infinite) {
          res.charges--;
          if (res.charges <= 0) {
            res.respawnAt = w.tick + cfg.respawnTicks;
            // clear all players targeting this depleted resource
            for (const other of w.players.values()) {
              if (other.gatherTarget === res.id) other.gatherTarget = null;
            }
          }
        }
      }
    } else {
      stepToward(w, p, res.x, res.y);
    }
  }
}

export function hasItem(p: PlayerEntity, item: string): boolean {
  return p.inventory.some((s) => s !== null && s.item === item);
}

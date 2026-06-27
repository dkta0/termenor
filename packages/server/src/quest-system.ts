import { QUESTS, questGivenBy, type QuestDef } from "@termenor/protocol";
import { countItem, removeItems, addToInventory } from "./inventory";
import { awardXp } from "./skills-system";
import type { GameWorld } from "./game";
import type { PlayerEntity } from "./entities";

/**
 * Talk to an NPC: advance any in-progress quest whose current step targets this NPC type
 * (consuming delivery items), or start a quest this NPC gives. Progress/feedback is pushed
 * as chat notices; completion grants the quest reward.
 */
export function talk(w: GameWorld, playerId: string, npcId: string): void {
  const p = w.players.get(playerId);
  if (!p) return;
  const npc = w.npcs.find((n) => n.id === npcId && n.respawnAt < 0);
  if (!npc) return;

  if (advanceInProgress(w, p, npc.type)) return;

  // Otherwise, this NPC may start a quest the player hasn't begun.
  const giver = questGivenBy(npc.type);
  if (giver && p.quests[giver.id] === undefined) {
    p.quests = { ...p.quests, [giver.id]: 1 }; // step 0 (the introductory talk) is now done
    if (1 >= giver.steps.length) {
      completeQuest(w, p, giver);
    } else {
      notify(w, p.id, `Quest started — ${giver.name}: ${giver.steps[1].text}`);
    }
  }
}

function advanceInProgress(w: GameWorld, p: PlayerEntity, npcType: string): boolean {
  for (const q of Object.values(QUESTS)) {
    const idx = p.quests[q.id];
    if (idx === undefined || idx >= q.steps.length) continue; // not started / already done
    const step = q.steps[idx];
    if (step.talkTo !== npcType) continue;

    if (step.deliver) {
      for (const need of step.deliver) {
        if (countItem(p.inventory, need.item) < need.qty) {
          notify(w, p.id, `${q.name}: ${step.text}`);
          return true;
        }
      }
      for (const need of step.deliver) p.inventory = removeItems(p.inventory, need.item, need.qty);
    }

    const next = idx + 1;
    p.quests = { ...p.quests, [q.id]: next };
    if (next >= q.steps.length) completeQuest(w, p, q);
    else notify(w, p.id, `${q.name}: ${q.steps[next].text}`);
    return true;
  }
  return false;
}

function completeQuest(w: GameWorld, p: PlayerEntity, q: QuestDef): void {
  for (const r of q.reward.xp ?? []) awardXp(w.events, p, r.skill, r.amount);
  for (const item of q.reward.items ?? []) {
    const { slots, leftover } = addToInventory(p.inventory, item);
    if (leftover === null) p.inventory = slots;
    else w.addGroundItem(item.item, item.qty, Math.round(p.x), Math.round(p.y)); // full inv → drop reward
  }
  notify(w, p.id, `Quest complete — ${q.name}!`);
}

function notify(w: GameWorld, id: string, text: string): void {
  w.events.gatherNotices.push({ id, text });
}

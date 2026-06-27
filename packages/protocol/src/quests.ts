import type { ItemStack } from "./items";

/**
 * A linear quest step. The player advances it by talking to an NPC of type `talkTo`; if
 * `deliver` is set, the talk only advances when the player holds those items (consumed).
 */
export interface QuestStep {
  text: string;
  talkTo: string;
  deliver?: ItemStack[];
}

export interface QuestReward {
  xp?: { skill: string; amount: number }[];
  items?: ItemStack[];
}

export interface QuestDef {
  id: string;
  name: string;
  steps: QuestStep[];
  reward: QuestReward;
}

/**
 * Quest catalog. Per-player progress is a `Record<questId, stepIndex>`: absent = not
 * started, `n` = on step `n`, `steps.length` = complete. Shallow but real: talk to start,
 * fetch + deliver to finish, claim a reward.
 */
export const QUESTS: Record<string, QuestDef> = {
  cooks_assistant: {
    id: "cooks_assistant",
    name: "Cook's Assistant",
    steps: [
      { text: "Talk to the Cook in the village.", talkTo: "chef" },
      { text: "Bring the Cook a potato.", talkTo: "chef", deliver: [{ item: "potato", qty: 1 }] },
    ],
    reward: { xp: [{ skill: "cooking", amount: 300 }], items: [{ item: "coins", qty: 100 }] },
  },
};

/** The quest started by talking to an NPC of this type (its first step's target), if any. */
export function questGivenBy(npcType: string): QuestDef | null {
  for (const q of Object.values(QUESTS)) {
    if (q.steps[0]?.talkTo === npcType) return q;
  }
  return null;
}

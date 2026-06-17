import type { Facing, ItemStack, Equipment, StopCondition } from "@termenor/protocol";
import type { Point } from "./pathfinding";

/** A standing order: an autonomous activity + stop-condition the server runs across ticks (Slice B). */
export interface ActiveOrder {
  activity: "gather" | "combat";
  targetType: string;          // entity .type key, re-resolved to nearest live each cycle
  stop: StopCondition;
  unitsDone: number;           // progress counter for `count`
  baselineYield: number;       // gather: yield-item count in inventory at last sample
  engagedNpcId: string | null; // combat: npc currently engaged, for kill detection
}

export interface PlayerEntity {
  id: string; x: number; y: number; facing: Facing; path: Point[];
  inventory: (ItemStack | null)[]; hp: number; maxHp: number;
  target: string | null; attackCd: number;
  skills: Record<string, number>; gatherTarget: string | null; gatherCd: number;
  bank: ItemStack[];
  equipment: Equipment;
  order: ActiveOrder | null;
}

export interface NpcEntity {
  id: string; type: string; x: number; y: number; facing: Facing; path: Point[];
  home: Point; radius: number; nextWanderTick: number;
  hp: number; maxHp: number; maxHit: number;
  target: string | null; attackCd: number; respawnAt: number;
}

export interface ResourceEntity {
  id: string; type: string; x: number; y: number; home: Point;
  charges: number; maxCharges: number; respawnAt: number; // -1 = alive
}

export interface FireEntity {
  id: string; x: number; y: number; expiresAt: number;
}

export interface GameEvents {
  skillChanged: Set<string>;
  levelUps: { id: string; skill: string; level: number }[];
  gatherNotices: { id: string; text: string }[];
  orderNotices: { id: string; text: string }[];
}

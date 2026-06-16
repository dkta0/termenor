import type { Facing, ItemStack, Equipment } from "@termenor/protocol";
import type { Point } from "./pathfinding";

export interface PlayerEntity {
  id: string; x: number; y: number; facing: Facing; path: Point[];
  inventory: (ItemStack | null)[]; hp: number; maxHp: number;
  target: string | null; attackCd: number;
  skills: Record<string, number>; gatherTarget: string | null; gatherCd: number;
  bank: ItemStack[];
  equipment: Equipment;
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
}

import type { Facing } from "./index";

export interface NpcState {
  id: string;
  type: string;
  x: number;
  y: number;
  facing: Facing;
  hp: number;
  maxHp: number;
}

export const NPC_TYPES: Record<string, { name: string; color: [number, number, number]; maxHp: number; maxHit: number }> = {
  goblin: { name: "Goblin", color: [80, 160, 60],   maxHp: 5, maxHit: 1 },
  rat:    { name: "Rat",    color: [160, 130, 100],  maxHp: 3, maxHit: 1 },
};

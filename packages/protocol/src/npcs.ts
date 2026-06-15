import type { Facing } from "./index";

export interface NpcState {
  id: string;
  type: string;
  x: number;
  y: number;
  facing: Facing;
}

export const NPC_TYPES: Record<string, { name: string; color: [number, number, number] }> = {
  goblin: { name: "Goblin", color: [80, 160, 60] },
  rat:    { name: "Rat",    color: [160, 130, 100] },
};

export interface ResourceState { id: string; type: string; x: number; y: number; }

export const RESOURCE_TYPES: Record<string, { name: string; color: [number, number, number] }> = {
  tree: { name: "Tree", color: [40, 120, 40] },
};

export const RESOURCE_RESPAWN_TICKS = 90; // ~6s
export const TREE_CHARGES = 5;

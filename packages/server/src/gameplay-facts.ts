import type { GameWorld } from "./game";

export type FactDraft =
  | { kind: "playerTalked"; playerId: string; npcType: string }
  | { kind: "resourceGathered"; playerId: string; resourceType: string; item: string; qty: number }
  | { kind: "itemProduced"; playerId: string; source: "recipe" | "action"; operation: string; item: string; qty: number }
  | { kind: "inventoryActionPerformed"; playerId: string; action: "drop" | "equip" | "examine"; item: string }
  | { kind: "skillXpGained"; playerId: string; skill: string; amount: number }
  | { kind: "skillLevelGained"; playerId: string; skill: string; level: number }
  | { kind: "playerEnteredZone"; playerId: string; zone: string }
  | { kind: "scenarioExitCrossed"; playerId: string; scenarioId: string; fromZone: string; toZone: string };

export type GameplayFact = FactDraft & { tick: number; sequence: number };

export function emitFact(world: GameWorld, draft: FactDraft): void {
  world.emitFact(draft);
}

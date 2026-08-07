import { levelForXp } from "@termenor/protocol";
import type { PlayerEntity } from "./entities";
import { emitFact } from "./gameplay-facts";
import type { GameWorld } from "./game";

export function awardXp(world: GameWorld, p: PlayerEntity, skill: string, amount: number): void {
  const oldXp = p.skills[skill] ?? 0;
  const newXp = oldXp + amount;
  const oldLevel = levelForXp(oldXp);
  const newLevel = levelForXp(newXp);

  p.skills = { ...p.skills, [skill]: newXp };
  emitFact(world, { kind: "skillXpGained", playerId: p.id, skill, amount });
  if (newLevel > oldLevel) {
    world.events.levelUps.push({ id: p.id, skill, level: newLevel });
    emitFact(world, { kind: "skillLevelGained", playerId: p.id, skill, level: newLevel });
  }
  world.events.skillChanged.add(p.id);
}

import { levelForXp } from "@termenor/protocol";
import type { PlayerEntity, GameEvents } from "./entities";

export function awardXp(events: GameEvents, p: PlayerEntity, skill: string, amount: number): void {
  const oldXp = p.skills[skill] ?? 0;
  const newXp = oldXp + amount;
  p.skills = { ...p.skills, [skill]: newXp };
  if (levelForXp(newXp) > levelForXp(oldXp)) {
    events.levelUps.push({ id: p.id, skill, level: levelForXp(newXp) });
  }
  events.skillChanged.add(p.id);
}

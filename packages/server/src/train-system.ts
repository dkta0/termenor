import { RECIPES, levelForXp } from "@termenor/protocol";
import { addToInventory, countItem, removeItems } from "./inventory";
import { awardXp } from "./skills-system";
import type { GameWorld } from "./game";

/**
 * Run a shallow crafting/activity recipe for a player: validate level + inputs + room,
 * consume inputs, add outputs, award XP, and set the per-player cooldown. A one-shot
 * action (no per-tick loop) — the cooldown is a `trainReadyTick` gate against `w.tick`.
 */
export function train(w: GameWorld, playerId: string, recipeId: string): void {
  const p = w.players.get(playerId);
  if (!p) return;
  const recipe = RECIPES[recipeId];
  if (!recipe) {
    w.events.gatherNotices.push({ id: p.id, text: "You don't know how to make that." });
    return;
  }
  if (w.tick < p.trainReadyTick) return; // still on cooldown — silently ignore spam

  if (levelForXp(p.skills[recipe.skill] ?? 0) < recipe.level) {
    w.events.gatherNotices.push({ id: p.id, text: `You need ${recipe.skill} level ${recipe.level}.` });
    return;
  }
  for (const input of recipe.inputs) {
    if (countItem(p.inventory, input.item) < input.qty) {
      w.events.gatherNotices.push({ id: p.id, text: `You need ${input.qty} ${input.item.replace(/_/g, " ")}.` });
      return;
    }
  }

  // Apply outputs first so we can reject (and not consume inputs) on a full inventory.
  let slots = p.inventory;
  for (const output of recipe.outputs) {
    const res = addToInventory(slots, output);
    if (res.leftover !== null) {
      w.events.gatherNotices.push({ id: p.id, text: "Your inventory is full." });
      return;
    }
    slots = res.slots;
  }
  for (const input of recipe.inputs) slots = removeItems(slots, input.item, input.qty);

  p.inventory = slots;
  awardXp(w.events, p, recipe.skill, recipe.xp);
  p.trainReadyTick = w.tick + recipe.cooldownTicks;
}

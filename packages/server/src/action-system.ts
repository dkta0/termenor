import { FIRE_LIFETIME_TICKS } from "@termenor/protocol";
import { addToInventory, removeSlot } from "./inventory";
import { isAdjacent } from "./combat";
import { awardXp } from "./skills-system";
import { emitFact } from "./gameplay-facts";
import { hasItem } from "./gather-system";
import type { GameWorld } from "./game";

const FIREMAKING_XP = 40;
const COOKING_XP = 30;

export function use(w: GameWorld, playerId: string, action: string, slot: number): void {
  const p = w.players.get(playerId);
  if (!p) return;
  if (slot < 0 || slot >= p.inventory.length) return;
  const stack = p.inventory[slot];

  if (action === "firemaking") {
    if (stack?.item !== "logs") {
      w.events.gatherNotices.push({ id: p.id, text: "You need logs to make a fire." });
      return;
    }
    if (!hasItem(p, "tinderbox")) {
      w.events.gatherNotices.push({ id: p.id, text: "You need a tinderbox to make a fire." });
      return;
    }
    const px = Math.round(p.x);
    const py = Math.round(p.y);
    const fireAlreadyHere = w.fires.some(
      (f) => f.x === px && f.y === py && w.tick < f.expiresAt,
    );
    if (fireAlreadyHere) {
      w.events.gatherNotices.push({ id: p.id, text: "There is already a fire here." });
      return;
    }
    // Consume one log
    if (stack.qty === 1) {
      const { slots } = removeSlot(p.inventory, slot);
      p.inventory = slots;
    } else {
      p.inventory[slot] = { item: stack.item, qty: stack.qty - 1 };
    }
    spawnFire(w, px, py);
    awardXp(w, p, "firemaking", FIREMAKING_XP);
    return;
  }

  if (action === "cooking") {
    if (stack?.item !== "raw_shrimp") {
      w.events.gatherNotices.push({ id: p.id, text: "You need raw shrimp to cook." });
      return;
    }
    const hasAdjacentFire = w.fires.some(
      (f) => w.tick < f.expiresAt && isAdjacent(p, f),
    );
    if (!hasAdjacentFire) {
      w.events.gatherNotices.push({ id: p.id, text: "You need to be next to a fire to cook." });
      return;
    }
    const { slots: cookedSlots, leftover } = addToInventory(p.inventory, { item: "cooked_shrimp", qty: 1 });
    if (leftover !== null) {
      w.events.gatherNotices.push({ id: p.id, text: "Your inventory is full." });
      return;
    }
    // Consume one raw_shrimp from the updated slots (cooked_shrimp already added)
    const rawIdx = cookedSlots.findIndex((s) => s?.item === "raw_shrimp");
    if (rawIdx !== -1) {
      const rawStack = cookedSlots[rawIdx]!;
      if (rawStack.qty === 1) {
        const { slots: finalSlots } = removeSlot(cookedSlots, rawIdx);
        p.inventory = finalSlots;
      } else {
        cookedSlots[rawIdx] = { item: rawStack.item, qty: rawStack.qty - 1 };
        p.inventory = cookedSlots;
      }
    } else {
      p.inventory = cookedSlots;
    }
    awardXp(w, p, "cooking", COOKING_XP);
    emitFact(w, {
      kind: "itemProduced",
      playerId: p.id,
      source: "action",
      operation: "cook",
      item: "cooked_shrimp",
      qty: 1,
    });
    return;
  }
  // unknown action: ignore
}

function spawnFire(w: GameWorld, x: number, y: number): void {
  const id = `res-${w.nextResourceId++}`;
  w.fires.push({ id, x, y, expiresAt: w.tick + FIRE_LIFETIME_TICKS });
}

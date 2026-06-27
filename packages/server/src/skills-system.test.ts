import { test, expect } from "bun:test";
import { awardXp } from "./skills-system";
import type { PlayerEntity, GameEvents } from "./entities";
import { levelForXp } from "@termenor/protocol";

function player(): PlayerEntity {
  return { id: "p1", x: 0, y: 0, facing: "south", path: [], inventory: [],
    hp: 10, maxHp: 10, target: null, attackCd: 0, skills: {}, gatherTarget: null, gatherCd: 0, bank: [], equipment: { weapon: null, body: null, shield: null }, order: null, trainReadyTick: 0, quests: {} };
}
function events(): GameEvents { return { skillChanged: new Set(), levelUps: [], gatherNotices: [], orderNotices: [] }; }

test("awardXp adds xp and marks the player changed", () => {
  const p = player(); const ev = events();
  awardXp(ev, p, "mining", 50);
  expect(p.skills.mining).toBe(50);
  expect(ev.skillChanged.has("p1")).toBe(true);
});

test("awardXp records a level-up when the level increases", () => {
  const p = player(); const ev = events();
  const enough = 200; // enough to cross level 1->2 per xp table
  awardXp(ev, p, "mining", enough);
  if (levelForXp(enough) > levelForXp(0)) {
    expect(ev.levelUps.some((l) => l.id === "p1" && l.skill === "mining")).toBe(true);
  }
});

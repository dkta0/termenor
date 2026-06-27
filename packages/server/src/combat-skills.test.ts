import { test, expect } from "bun:test";
import { GameWorld } from "./game";
import { combatLevel } from "@termenor/protocol";
import type { MapData, ItemStack, Equipment } from "@termenor/protocol";

const MAP: MapData = { width: 3, height: 1, tiles: [0, 0, 0], heights: [0, 0, 0] };

function inv(items: Record<number, ItemStack>): (ItemStack | null)[] {
  const a: (ItemStack | null)[] = new Array(28).fill(null);
  for (const [s, v] of Object.entries(items)) a[Number(s)] = v;
  return a;
}
const eq = (weapon: string | null): Equipment => ({ weapon, body: null, shield: null });

test("a landed melee hit awards attack/strength/defence and hitpoints xp", () => {
  const w = new GameWorld(MAP, { x: 0, y: 0 }, () => 0.999);
  w.addPlayer("p1");
  w.spawnNpc("goblin", 1, 0, 0);
  w.attack("p1", w.snapshot().npcs[0].id);
  w.step(1 / 15);
  const s = w.getPlayerSkills("p1");
  expect(s.attack.xp).toBeGreaterThan(0);
  expect(s.strength.xp).toBeGreaterThan(0);
  expect(s.defence.xp).toBeGreaterThan(0);
  expect(s.hitpoints.xp).toBeGreaterThan(0);
  expect(s.ranged.xp).toBe(0);
});

test("killing an npc awards slayer xp and drops bones at its tile", () => {
  const w = new GameWorld(MAP, { x: 0, y: 0 }, () => 0.999);
  w.addPlayer("p1");
  w.spawnNpc("goblin", 1, 0, 0); // maxHp 5
  const npc = w.npcs[0];
  npc.hp = 1; // one swing kills
  w.attack("p1", npc.id);
  w.step(1 / 15);
  expect(w.getPlayerSkills("p1").slayer.xp).toBe(npc.maxHp * 2);
  expect(w.snapshot().ground.some((g) => g.item === "bones" && g.x === 1 && g.y === 0)).toBe(true);
});

test("a shortbow yields ranged xp, not melee xp", () => {
  const w = new GameWorld(MAP, { x: 0, y: 0 }, () => 0.999);
  w.addPlayer("p1", { x: 0, y: 0, facing: "south", inventory: inv({}), equipment: eq("shortbow") });
  w.spawnNpc("goblin", 1, 0, 0);
  w.attack("p1", w.snapshot().npcs[0].id);
  w.step(1 / 15);
  const s = w.getPlayerSkills("p1");
  expect(s.ranged.xp).toBeGreaterThan(0);
  expect(s.attack.xp).toBe(0);
  expect(s.strength.xp).toBe(0);
});

test("fighting unarmed while holding runes yields magic xp", () => {
  const w = new GameWorld(MAP, { x: 0, y: 0 }, () => 0.999);
  w.addPlayer("p1", { x: 0, y: 0, facing: "south", inventory: inv({ 0: { item: "air_rune", qty: 5 } }), equipment: eq(null) });
  w.spawnNpc("goblin", 1, 0, 0);
  w.attack("p1", w.snapshot().npcs[0].id);
  w.step(1 / 15);
  const s = w.getPlayerSkills("p1");
  expect(s.magic.xp).toBeGreaterThan(0);
  expect(s.attack.xp).toBe(0);
});

test("combatLevel starts low and rises with combat skills", () => {
  const fresh = combatLevel({});
  expect(fresh).toBeGreaterThanOrEqual(1);
  const trained = combatLevel({ attack: 5000, strength: 5000, hitpoints: 5000, defence: 5000 });
  expect(trained).toBeGreaterThan(fresh);
});

import { test, expect } from "bun:test";
import { xpForLevel, levelForXp, WOODCUTTING_XP_PER_LOG, MAX_LEVEL, SKILLS } from "./skills";

test("xpForLevel(1) === 0", () => {
  expect(xpForLevel(1)).toBe(0);
});

test("xpForLevel is strictly increasing over 1..99", () => {
  for (let l = 1; l < MAX_LEVEL; l++) {
    expect(xpForLevel(l + 1)).toBeGreaterThan(xpForLevel(l));
  }
});

test("levelForXp(xpForLevel(L)) === L for several L", () => {
  for (const l of [1, 2, 10, 50, 99]) {
    expect(levelForXp(xpForLevel(l))).toBe(l);
  }
});

test("levelForXp(0) === 1", () => {
  expect(levelForXp(0)).toBe(1);
});

test("levelForXp(huge number) === 99 (cap)", () => {
  expect(levelForXp(1e9)).toBe(99);
});

test("WOODCUTTING_XP_PER_LOG is a positive number", () => {
  expect(WOODCUTTING_XP_PER_LOG).toBeGreaterThan(0);
});

test("SKILLS contains every RuneScape skill", () => {
  const all: readonly string[] = SKILLS;
  for (const s of ["woodcutting", "mining", "fishing", "firemaking", "cooking",
    "attack", "strength", "defence", "hitpoints", "ranged", "prayer", "magic",
    "runecrafting", "construction", "agility", "herblore", "thieving", "crafting",
    "fletching", "slayer", "hunter", "smithing", "farming"]) {
    expect(all).toContain(s);
  }
  expect(SKILLS.length).toBe(23);
  expect(new Set(SKILLS).size).toBe(23); // no duplicates
});

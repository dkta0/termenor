import { test, expect } from "bun:test";
import { legendLines } from "./legend";

const PLAY_HINT = "[move] arrows/click   [/] command   [Enter] chat   [?] help";
const DIRECT_HINT = "[Esc] play   ·   type to chat, /verb for commands";

test("direct mode shows only the exit/usage hint", () => {
  expect(
    legendLines({ mode: "direct", nearestEnemy: null, nearestResource: null, itemUnderfoot: null }),
  ).toEqual([DIRECT_HINT]);
});

test("play mode with nothing actionable shows just the persistent hint", () => {
  expect(
    legendLines({ mode: "play", nearestEnemy: null, nearestResource: null, itemUnderfoot: null }),
  ).toEqual([PLAY_HINT]);
});

test("play mode lists only the contextual actions that are available", () => {
  expect(
    legendLines({ mode: "play", nearestEnemy: "Goblin", nearestResource: null, itemUnderfoot: null }),
  ).toEqual(["[a] attack Goblin", PLAY_HINT]);
});

test("play mode orders actions attack, gather, pickup, then the hint", () => {
  expect(
    legendLines({ mode: "play", nearestEnemy: "Goblin", nearestResource: "Tree", itemUnderfoot: "Logs" }),
  ).toEqual(["[a] attack Goblin", "[c] gather Tree", "[g] pick up Logs", PLAY_HINT]);
});

test("play mode always advertises the help key", () => {
  const withTargets = legendLines({ mode: "play", nearestEnemy: "Goblin", nearestResource: "Tree", itemUnderfoot: "Logs" });
  const without = legendLines({ mode: "play", nearestEnemy: null, nearestResource: null, itemUnderfoot: null });
  expect(withTargets.some((l) => l.includes("[?] help"))).toBe(true);
  expect(without.some((l) => l.includes("[?] help"))).toBe(true);
});

import { test, expect } from "bun:test";
import { legendLines } from "./legend";

const PLAY_HINT = "[click] move · act    [/] command    [?] help";
const DIRECT_HINT = "[Esc] back  ·  type to chat, /verb for commands";

test("direct mode shows only the exit/usage hint", () => {
  expect(
    legendLines({ mode: "direct", nearestEnemy: null, nearestResource: null, itemUnderfoot: null }),
  ).toEqual([DIRECT_HINT]);
});

test("play mode with nothing nearby shows just the standing hint", () => {
  expect(
    legendLines({ mode: "play", nearestEnemy: null, nearestResource: null, itemUnderfoot: null }),
  ).toEqual([PLAY_HINT]);
});

test("play mode shows a single context cue, enemy taking priority", () => {
  expect(
    legendLines({ mode: "play", nearestEnemy: "Goblin", nearestResource: "Tree", itemUnderfoot: "Logs" }),
  ).toEqual(["click Goblin to fight", PLAY_HINT]);
});

test("play mode falls back to resource, then item, for the cue", () => {
  expect(
    legendLines({ mode: "play", nearestEnemy: null, nearestResource: "Tree", itemUnderfoot: "Logs" }),
  ).toEqual(["click Tree to gather", PLAY_HINT]);
  expect(
    legendLines({ mode: "play", nearestEnemy: null, nearestResource: null, itemUnderfoot: "Logs" }),
  ).toEqual(["click Logs to grab", PLAY_HINT]);
});

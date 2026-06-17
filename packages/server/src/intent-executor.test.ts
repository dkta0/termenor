import { test, expect } from "bun:test";
import { GameWorld } from "./game";
import { createDefaultMap, SPAWN } from "./world";
import { executeIntent, type IntentSession } from "./intent-executor";

function world() {
  const g = new GameWorld(createDefaultMap(), SPAWN);
  g.addPlayer("alice");
  return g;
}

test("move intent queues a move and returns no messages", () => {
  const g = world();
  const res = executeIntent(g, "alice", { kind: "move", x: SPAWN.x + 1, y: SPAWN.y }, {});
  expect(res).toEqual({ self: [], world: [] });
});

test("gather intent forwards to the world without throwing", () => {
  const g = world();
  const id = g.spawnResource("tree", SPAWN.x + 1, SPAWN.y);
  const res = executeIntent(g, "alice", { kind: "gather", targetId: id }, {});
  expect(res).toEqual({ self: [], world: [] });
});

test("unknown openShop target is a safe no-op", () => {
  const g = world();
  const session: IntentSession = {};
  const res = executeIntent(g, "alice", { kind: "openShop", targetId: "does-not-exist" }, session);
  expect(res).toEqual({ self: [], world: [] });
  expect(session.shopId).toBeUndefined();
});

test("pickup with nothing underfoot returns no inventory message", () => {
  const g = world();
  const res = executeIntent(g, "alice", { kind: "pickup" }, {});
  expect(res).toEqual({ self: [], world: [] });
});

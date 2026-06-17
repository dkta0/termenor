import { test, expect } from "bun:test";
import { GameWorld } from "./game";
import type { MapData } from "@termenor/protocol";

const MAP: MapData = { width: 5, height: 5, tiles: Array(25).fill(0), heights: Array(25).fill(0) };

function world() {
  const w = new GameWorld(MAP, { x: 2, y: 2 }, () => 0.99);
  w.addPlayer("c"); // new player gets a bronze_axe (can chop trees)
  return w;
}

test("a new player has no standing order", () => {
  const w = world();
  expect(w.players.get("c")!.order).toBeNull();
});

test("setOrder stores an active order and returns a notice", () => {
  const w = world();
  const text = w.setOrder("c", "gather", "tree", { kind: "forever" });
  expect(text).toContain("Order set");
  const order = w.players.get("c")!.order;
  expect(order).not.toBeNull();
  expect(order!.activity).toBe("gather");
  expect(order!.targetType).toBe("tree");
});

test("clearOrder removes the order and safe-idles", () => {
  const w = world();
  w.setOrder("c", "gather", "tree", { kind: "forever" });
  w.players.get("c")!.gatherTarget = "res-1";
  const text = w.clearOrder("c");
  expect(text).toBe("Order cancelled.");
  expect(w.players.get("c")!.order).toBeNull();
  expect(w.players.get("c")!.gatherTarget).toBeNull();
});

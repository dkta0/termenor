import { test, expect } from "bun:test";
import { GameWorld } from "./game";
import type { MapData } from "@termenor/protocol";
import { INV_SIZE } from "@termenor/protocol";

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

// Step until the player's order clears, or until `max` ticks elapse.
function runUntilIdle(w: GameWorld, id: string, max = 400) {
  let i = 0;
  for (; i < max && w.players.get(id)!.order !== null; i++) w.step(1 / 15);
  expect(i).toBeLessThan(max);
}

test("gather order acquires the nearest matching resource and harvests across ticks", () => {
  const w = world();
  w.spawnResource("tree", 3, 2); // adjacent to (2,2)
  w.setOrder("c", "gather", "tree", { kind: "forever" });
  for (let i = 0; i < 3; i++) w.step(1 / 15);
  const p = w.players.get("c")!;
  expect(p.gatherTarget).not.toBeNull();          // supervisor acquired a target
  expect(countLogs(p)).toBeGreaterThanOrEqual(1); // and it started gathering
  expect(p.order).not.toBeNull();                 // forever never completes
});

test("count N completes after N units and safe-idles with a notice", () => {
  const w = world();
  w.spawnResource("tree", 3, 2);
  w.setOrder("c", "gather", "tree", { kind: "count", n: 2 });
  runUntilIdle(w, "c");
  const p = w.players.get("c")!;
  expect(p.order).toBeNull();
  expect(countLogs(p)).toBe(2);
  expect(p.gatherTarget).toBeNull(); // safe-idle
  expect(w.consumeOrderNotices().some((n) => n.id === "c" && /complete/i.test(n.text))).toBe(true);
});

test("untilLevel completes when the activity's skill reaches the level", () => {
  const w = world();
  w.spawnResource("tree", 3, 2); // tree: 5 charges * 25xp = 125xp, enough for woodcutting L2
  w.setOrder("c", "gather", "tree", { kind: "untilLevel", level: 2 });
  runUntilIdle(w, "c");
  const p = w.players.get("c")!;
  expect(p.order).toBeNull();
  expect(w.getPlayerSkills("c").woodcutting.level).toBeGreaterThanOrEqual(2);
});

test("untilFull completes immediately when there is no room for the yield", () => {
  const w = world();
  w.spawnResource("tree", 3, 2);
  const inv = w.getInventory("c")!;
  for (let i = 0; i < INV_SIZE; i++) inv[i] = { item: "bronze_sword", qty: 1 }; // non-stackable, no free slot
  w.setOrder("c", "gather", "tree", { kind: "untilFull" });
  w.step(1 / 15);
  expect(w.players.get("c")!.order).toBeNull(); // full on the first supervisor pass
  expect(countLogs(w.players.get("c")!)).toBe(0);
});

test("gather order waits without error when no matching resource exists", () => {
  const w = world();
  // no tree spawned
  w.setOrder("c", "gather", "tree", { kind: "count", n: 1 });
  for (let i = 0; i < 5; i++) w.step(1 / 15);
  const p = w.players.get("c")!;
  expect(p.order).not.toBeNull();   // still waiting
  expect(p.gatherTarget).toBeNull();
});

test("dropping the yield mid-order does not double-count progress", () => {
  const w = world();
  w.spawnResource("tree", 3, 2);
  // Use a large count so the order does not complete during the test
  w.setOrder("c", "gather", "tree", { kind: "count", n: 10 });
  const p = w.players.get("c")!;
  // Wait until stepOrders has counted the first log (it counts the tick AFTER stepGather yields)
  for (let i = 0; i < 5 && p.order!.unitsDone < 1; i++) w.step(1 / 15);
  expect(p.order!.unitsDone).toBe(1);
  expect(countLogs(p)).toBeGreaterThanOrEqual(1);
  // Drop the log stack — inventory count drops to 0
  const slot = p.inventory.findIndex((s) => s?.item === "logs");
  w.drop("c", slot);
  expect(countLogs(p)).toBe(0);
  w.step(1 / 15); // supervisor samples the drop; must NOT lower the high-water mark
  expect(p.order!.unitsDone).toBe(1); // still 1 — drop did not change progress
  // Wait for the next log to land in inventory, then step once more so supervisor accounts it
  for (let i = 0; i < 40 && countLogs(p) < 1; i++) w.step(1 / 15);
  w.step(1 / 15); // supervisor tick: with fix baseline stays at 1 (high-water), current=1 NOT > 1 → no increment
  // With the fix: re-gathered log brings current to 1, NOT > baseline(1) → unitsDone stays 1
  // Without the fix: baseline dropped to 0 on drop tick → current(1) > 0 → unitsDone becomes 2 (double-count)
  expect(p.order!.unitsDone).toBe(1);
});

function countLogs(p: { inventory: ({ item: string; qty: number } | null)[] }): number {
  let n = 0;
  for (const s of p.inventory) if (s && s.item === "logs") n += s.qty;
  return n;
}

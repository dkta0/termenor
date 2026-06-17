# Slice B — Standing Orders / AFK Floor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-side autonomous standing orders (an activity + a stop-condition that the server runs across ticks), expressed by suffixing the existing gather/attack command verbs.

**Architecture:** A new `order-system.ts` supervisor runs at the top of `GameWorld.step()`. It is purely observational: each tick it accounts progress from inventory/skill/target state, checks the order's stop-condition, and — if the low-level action is idle — re-acquires the nearest live entity of the order's target type. It reuses the existing gather/combat systems unchanged. Orders live on `PlayerEntity` (session-scoped, no persistence). The client resolver peels a trailing stop-clause off gather/attack verbs and emits a new `order` Intent; a `stop` verb emits `stopOrder`.

**Tech Stack:** TypeScript, Bun (`bun test`), monorepo packages `@termenor/protocol`, `@termenor/server`, `@termenor/client`.

**Spec:** `docs/superpowers/specs/2026-06-17-slice-b-standing-orders-design.md`

---

## File Structure

- `packages/protocol/src/intents.ts` — **modify**: add `StopCondition` type and `order` / `stopOrder` Intent variants.
- `packages/protocol/src/intents.test.ts` — **create**: shape test locking the new types.
- `packages/server/src/entities.ts` — **modify**: add `ActiveOrder` interface, `PlayerEntity.order` field, `GameEvents.orderNotices`.
- `packages/server/src/order-system.ts` — **create**: the supervisor (`setOrder`, `clearOrder`, `stepOrders`, helpers).
- `packages/server/src/order-system.test.ts` — **create**: deterministic per-tick tests.
- `packages/server/src/game.ts` — **modify**: init `order`/`orderNotices`, add `setOrder`/`clearOrder`/`consumeOrderNotices`, wire `stepOrders` into `step`.
- `packages/server/src/intent-executor.ts` — **modify**: add `order` / `stopOrder` handlers.
- `packages/server/src/intent-executor.test.ts` — **modify**: tests for the two handlers.
- `packages/server/src/server.ts` — **modify**: drain `orderNotices` in the tick loop.
- `packages/client/src/resolve.ts` — **modify**: `parseStopCondition`, order routing on gather/attack verbs, `stop` verb, combat validation.
- `packages/client/src/resolve.test.ts` — **modify**: tests for order parsing + back-compat + errors.

---

## Task 1: Protocol — StopCondition + order/stopOrder Intent variants

**Files:**
- Modify: `packages/protocol/src/intents.ts`
- Test: `packages/protocol/src/intents.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/protocol/src/intents.test.ts`:

```ts
import { test, expect } from "bun:test";
import type { Intent, StopCondition } from "./intents";

test("StopCondition variants are well-formed", () => {
  const forever: StopCondition = { kind: "forever" };
  const count: StopCondition = { kind: "count", n: 10 };
  const full: StopCondition = { kind: "untilFull" };
  const level: StopCondition = { kind: "untilLevel", level: 50 };
  expect([forever.kind, count.kind, full.kind, level.kind]).toEqual([
    "forever", "count", "untilFull", "untilLevel",
  ]);
});

test("order and stopOrder are valid Intents", () => {
  const order: Intent = { kind: "order", activity: "gather", targetType: "tree", stop: { kind: "count", n: 5 } };
  const stop: Intent = { kind: "stopOrder" };
  expect(order.kind).toBe("order");
  expect(stop.kind).toBe("stopOrder");
  if (order.kind === "order") expect(order.activity).toBe("gather");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/protocol && bun test src/intents.test.ts`
Expected: FAIL — type error / `StopCondition` not exported, `order` not assignable to `Intent`.

- [ ] **Step 3: Add the types**

In `packages/protocol/src/intents.ts`, add above `export type Intent`:

```ts
// Stop-conditions for standing orders (Slice B). A small, extensible grammar:
// add a variant here and a case in the server's stop-condition evaluator.
// untilFull / untilLevel apply to gather activities only.
export type StopCondition =
  | { kind: "forever" }
  | { kind: "count"; n: number }
  | { kind: "untilFull" }
  | { kind: "untilLevel"; level: number };
```

Then add these two variants to the `Intent` union (before the closing `;`):

```ts
  // Standing orders (Slice B): an autonomous activity + a stop-condition the
  // server runs across ticks. targetType is an entity .type key (e.g. "tree",
  // "rock", "goblin"), re-resolved server-side to the nearest live entity.
  | { kind: "order"; activity: "gather" | "combat"; targetType: string; stop: StopCondition }
  | { kind: "stopOrder" };
```

(Replace the existing final `;` after `unequip` so the union stays valid.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/protocol && bun test src/intents.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck the workspace**

Run: `bun run typecheck`
Expected: PASS — the executor's exhaustiveness check will now error in `intent-executor.ts` ("Property 'order'/'stopOrder' is missing"). **If typecheck fails only on `intent-executor.ts` handlers, that is expected and fixed in Task 5.** Commit anyway; the protocol package itself typechecks.

- [ ] **Step 6: Commit**

```bash
git add packages/protocol/src/intents.ts packages/protocol/src/intents.test.ts
git commit -m "feat(protocol): StopCondition + order/stopOrder intents (Slice B)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Server state + GameWorld wiring + order-system scaffold

**Files:**
- Modify: `packages/server/src/entities.ts`
- Create: `packages/server/src/order-system.ts`
- Modify: `packages/server/src/game.ts`
- Test: `packages/server/src/order-system.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/order-system.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && bun test src/order-system.test.ts`
Expected: FAIL — `order` not on `PlayerEntity`, `setOrder`/`clearOrder` not on `GameWorld`.

- [ ] **Step 3: Add entity state**

In `packages/server/src/entities.ts`, add the import and types. At the top, extend the protocol import:

```ts
import type { Facing, ItemStack, Equipment, StopCondition } from "@termenor/protocol";
```

Add after the imports (above `PlayerEntity`):

```ts
/** A standing order: an autonomous activity + stop-condition the server runs across ticks (Slice B). */
export interface ActiveOrder {
  activity: "gather" | "combat";
  targetType: string;          // entity .type key, re-resolved to nearest live each cycle
  stop: StopCondition;
  unitsDone: number;           // progress counter for `count`
  baselineYield: number;       // gather: yield-item count in inventory at last sample
  engagedNpcId: string | null; // combat: npc currently engaged, for kill detection
}
```

Add `order` to `PlayerEntity` (append to the interface body):

```ts
  order: ActiveOrder | null;
```

Add `orderNotices` to `GameEvents`:

```ts
  orderNotices: { id: string; text: string }[];
```

- [ ] **Step 4: Create the order-system scaffold**

Create `packages/server/src/order-system.ts`:

```ts
import { RESOURCE_KINDS } from "@termenor/protocol";
import type { StopCondition } from "@termenor/protocol";
import type { GameWorld } from "./game";
import type { PlayerEntity } from "./entities";

/** Total quantity of a given item across the inventory. */
function countItem(p: PlayerEntity, item: string): number {
  let n = 0;
  for (const s of p.inventory) if (s && s.item === item) n += s.qty;
  return n;
}

/** Clear all low-level action state — the v1 safe-idle default (stop & hold). */
function safeIdle(p: PlayerEntity): void {
  p.gatherTarget = null;
  p.target = null;
  p.path = [];
}

/** Human-readable summary of an order, for notices. */
export function describeOrder(activity: string, targetType: string, stop: StopCondition): string {
  const what = activity === "gather" ? `gather ${targetType}` : `fight ${targetType}`;
  switch (stop.kind) {
    case "forever": return `${what} forever`;
    case "count": return `${what} (count ${stop.n})`;
    case "untilFull": return `${what} until full`;
    case "untilLevel": return `${what} until level ${stop.level}`;
  }
}

export function setOrder(
  w: GameWorld,
  playerId: string,
  activity: "gather" | "combat",
  targetType: string,
  stop: StopCondition,
): string {
  const p = w.players.get(playerId);
  if (!p) return "";
  safeIdle(p); // drop any in-progress one-shot action
  const baselineYield = activity === "gather" ? countItem(p, RESOURCE_KINDS[targetType]?.yield ?? "") : 0;
  p.order = { activity, targetType, stop, unitsDone: 0, baselineYield, engagedNpcId: null };
  return `Order set: ${describeOrder(activity, targetType, stop)}.`;
}

export function clearOrder(w: GameWorld, playerId: string): string {
  const p = w.players.get(playerId);
  if (!p || !p.order) return "";
  p.order = null;
  safeIdle(p);
  return "Order cancelled.";
}

/** Per-tick supervisor. Filled in by later tasks (gather + combat). */
export function stepOrders(_w: GameWorld): void {
  // implemented in Tasks 3 (gather) and 4 (combat)
}
```

- [ ] **Step 5: Wire GameWorld**

In `packages/server/src/game.ts`:

Add `StopCondition` to the existing protocol type import at the top of `game.ts` (append it to the `import type { Facing, MapData, ... Equipment } from "@termenor/protocol";` line):

```ts
import type { Facing, MapData, PlayerState, SnapshotMsg, GroundItem, ItemStack, NpcState, HitEvent, ResourceState, ShopEntry, Equipment, StopCondition } from "@termenor/protocol";
```

Add the system import alongside the other `import * as ...System` lines:

```ts
import * as orderSys from "./order-system";
```

In the `events` field initializer, add `orderNotices: []`:

```ts
  events: GameEvents = { skillChanged: new Set(), levelUps: [], gatherNotices: [], orderNotices: [] };
```

In `addPlayer`, add `order: null` to the `this.players.set(...)` object literal (append after `equipment`):

```ts
    this.players.set(id, { id, x, y, facing, path: [], inventory, hp: PLAYER_MAX_HP, maxHp: PLAYER_MAX_HP, target: null, attackCd: 0, skills, gatherTarget: null, gatherCd: 0, bank, equipment, order: null });
```

In `step(dt)`, call `stepOrders` first (right after `this.tick++;`):

```ts
  step(dt: number): void {
    this.tick++;
    orderSys.stepOrders(this);
    combatSys.stepNpcRespawn(this);
    moveSys.stepMovement(this, dt);
    combatSys.stepCombat(this);
    combatSys.resolveDeaths(this);
    resourceSys.stepResources(this);
    gatherSys.stepGather(this);
  }
```

Add these methods (place near the other delegating command methods, e.g. after `gather`):

```ts
  // --- Standing orders (delegates to order-system) ---
  setOrder(id: string, activity: "gather" | "combat", targetType: string, stop: StopCondition): string {
    return orderSys.setOrder(this, id, activity, targetType, stop);
  }
  clearOrder(id: string): string {
    return orderSys.clearOrder(this, id);
  }
  consumeOrderNotices(): { id: string; text: string }[] {
    const notices = this.events.orderNotices;
    this.events.orderNotices = [];
    return notices;
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd packages/server && bun test src/order-system.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Run the full server suite (no regressions) + typecheck**

Run: `cd packages/server && bun test`
Expected: PASS (all existing tests still green).
Run: `bun run typecheck`
Expected: still only the Task-5 executor exhaustiveness errors, if any.

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/entities.ts packages/server/src/order-system.ts packages/server/src/game.ts packages/server/src/order-system.test.ts
git commit -m "feat(server): standing-order state + GameWorld wiring scaffold (Slice B)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: order-system — gather activity (acquire, progress, stop-conditions)

**Files:**
- Modify: `packages/server/src/order-system.ts`
- Test: `packages/server/src/order-system.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/server/src/order-system.test.ts`:

```ts
import { INV_SIZE } from "@termenor/protocol";

// Step until the player's order clears, or until `max` ticks elapse.
function runUntilIdle(w: GameWorld, id: string, max = 400) {
  for (let i = 0; i < max && w.players.get(id)!.order !== null; i++) w.step(1 / 15);
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

function countLogs(p: { inventory: ({ item: string; qty: number } | null)[] }): number {
  let n = 0;
  for (const s of p.inventory) if (s && s.item === "logs") n += s.qty;
  return n;
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/server && bun test src/order-system.test.ts`
Expected: FAIL — `stepOrders` is a no-op, so `gatherTarget` stays null and no orders complete.

- [ ] **Step 3: Implement the gather supervisor**

In `packages/server/src/order-system.ts`, add `levelForXp` to the protocol import and `addToInventory` import:

```ts
import { RESOURCE_KINDS, levelForXp } from "@termenor/protocol";
import { addToInventory } from "./inventory";
import type { ActiveOrder } from "./entities";
```

Add a nearest-entity helper (above `stepOrders`):

```ts
/** Nearest entity to the player by Euclidean distance, or null for an empty list. */
function nearest<T extends { x: number; y: number }>(p: PlayerEntity, list: T[]): T | null {
  let best: T | null = null;
  let bestD = Infinity;
  for (const e of list) {
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}
```

Add the stop-condition evaluator (above `stepOrders`):

```ts
function stopMet(p: PlayerEntity, order: ActiveOrder): boolean {
  const stop = order.stop;
  switch (stop.kind) {
    case "forever":
      return false;
    case "count":
      return order.unitsDone >= stop.n;
    case "untilFull": {
      if (order.activity !== "gather") return false;
      const yieldItem = RESOURCE_KINDS[order.targetType]?.yield ?? "";
      const { leftover } = addToInventory(p.inventory, { item: yieldItem, qty: 1 });
      return leftover !== null;
    }
    case "untilLevel": {
      if (order.activity !== "gather") return false;
      const skill = RESOURCE_KINDS[order.targetType]?.skill ?? "";
      return levelForXp(p.skills[skill] ?? 0) >= stop.level;
    }
  }
}
```

Replace the placeholder `stepOrders` with:

```ts
export function stepOrders(w: GameWorld): void {
  for (const p of w.players.values()) {
    const order = p.order;
    if (!order) continue;

    // 1. account progress (observational)
    if (order.activity === "gather") {
      const yieldItem = RESOURCE_KINDS[order.targetType]?.yield ?? "";
      const current = countItem(p, yieldItem);
      if (current > order.baselineYield) order.unitsDone += current - order.baselineYield;
      order.baselineYield = current;
    }

    // 2. check stop-condition
    if (stopMet(p, order)) {
      p.order = null;
      safeIdle(p);
      w.events.orderNotices.push({ id: p.id, text: `Order complete: ${describeOrder(order.activity, order.targetType, order.stop)}.` });
      continue;
    }

    // 3. acquire the next target if the low-level action is idle
    if (order.activity === "gather" && p.gatherTarget === null) {
      const candidates = w.resources.filter(
        (r) => r.type === order.targetType && r.respawnAt < 0 && RESOURCE_KINDS[r.type]?.gatherable !== false,
      );
      const res = nearest(p, candidates);
      if (res) p.gatherTarget = res.id;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/server && bun test src/order-system.test.ts`
Expected: PASS (all gather tests + the Task-2 tests).

- [ ] **Step 5: Run the full server suite**

Run: `cd packages/server && bun test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/order-system.ts packages/server/src/order-system.test.ts
git commit -m "feat(server): gather standing orders — acquire, progress, stop-conditions (Slice B)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: order-system — combat activity (acquire, kill counting)

**Files:**
- Modify: `packages/server/src/order-system.ts`
- Test: `packages/server/src/order-system.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/server/src/order-system.test.ts`:

```ts
test("combat order engages the nearest matching npc and counts kills", () => {
  const w = world(); // rng pinned to 0.99 → unarmed max-hit lands every swing
  w.spawnNpc("goblin", 3, 2, 0); // maxHp 5, adjacent
  w.setOrder("c", "combat", "goblin", { kind: "count", n: 1 });
  runUntilIdle(w, "c");
  const p = w.players.get("c")!;
  expect(p.order).toBeNull(); // one kill satisfies count 1
  expect(p.target).toBeNull(); // safe-idle
  expect(w.consumeOrderNotices().some((n) => n.id === "c" && /complete/i.test(n.text))).toBe(true);
});

test("combat forever keeps the order active after a kill", () => {
  const w = world();
  w.spawnNpc("goblin", 3, 2, 0);
  w.setOrder("c", "combat", "goblin", { kind: "forever" });
  for (let i = 0; i < 80; i++) w.step(1 / 15); // long enough for at least one kill + respawn wait
  expect(w.players.get("c")!.order).not.toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/server && bun test src/order-system.test.ts`
Expected: FAIL — combat orders never acquire a target (`stepOrders` only handles gather).

- [ ] **Step 3: Implement the combat branch**

In `packages/server/src/order-system.ts`, add the combat-system import:

```ts
import * as combatSys from "./combat-system";
```

In `stepOrders`, extend the progress-accounting block (step 1) with the combat case — replace the `if (order.activity === "gather") { ... }` accounting block with:

```ts
    // 1. account progress (observational)
    if (order.activity === "gather") {
      const yieldItem = RESOURCE_KINDS[order.targetType]?.yield ?? "";
      const current = countItem(p, yieldItem);
      if (current > order.baselineYield) order.unitsDone += current - order.baselineYield;
      order.baselineYield = current;
    } else if (order.engagedNpcId !== null) {
      // combat: the engaged npc dying (respawnAt set) or vanishing counts as a kill
      const npc = w.npcs.find((n) => n.id === order.engagedNpcId);
      if (!npc || npc.respawnAt >= 0) {
        order.unitsDone++;
        order.engagedNpcId = null;
      }
    }
```

In `stepOrders`, add the combat acquire branch — after the existing gather acquire block, add:

```ts
    if (order.activity === "combat" && p.target === null) {
      const candidates = w.npcs.filter((n) => n.type === order.targetType && n.respawnAt < 0);
      const npc = nearest(p, candidates);
      if (npc) {
        combatSys.setTarget(w, p.id, npc.id);
        order.engagedNpcId = npc.id;
      }
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/server && bun test src/order-system.test.ts`
Expected: PASS (gather + combat).

- [ ] **Step 5: Run the full server suite**

Run: `cd packages/server && bun test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/order-system.ts packages/server/src/order-system.test.ts
git commit -m "feat(server): combat standing orders — engage + kill counting (Slice B)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Executor handlers + server tick-loop delivery

**Files:**
- Modify: `packages/server/src/intent-executor.ts`
- Modify: `packages/server/src/server.ts`
- Test: `packages/server/src/intent-executor.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/server/src/intent-executor.test.ts`:

```ts
test("order intent sets a standing order and returns a chat notice", () => {
  const g = world();
  const res = executeIntent(g, "alice", { kind: "order", activity: "gather", targetType: "tree", stop: { kind: "forever" } }, {});
  expect(g.players.get("alice")!.order).not.toBeNull();
  expect(res.self.some((m) => m.t === "chatMsg")).toBe(true);
  expect(res.world).toEqual([]);
});

test("stopOrder intent cancels the active order and returns a chat notice", () => {
  const g = world();
  g.setOrder("alice", "gather", "tree", { kind: "forever" });
  const res = executeIntent(g, "alice", { kind: "stopOrder" }, {});
  expect(g.players.get("alice")!.order).toBeNull();
  expect(res.self.some((m) => m.t === "chatMsg")).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/server && bun test src/intent-executor.test.ts`
Expected: FAIL — no handler for `order`/`stopOrder` (and the file may not typecheck until Step 3).

- [ ] **Step 3: Add the handlers**

In `packages/server/src/intent-executor.ts`, add two entries to the `handlers` object (e.g. after `unequip`):

```ts
  order: (game, playerId, intent) => {
    const text = game.setOrder(playerId, intent.activity, intent.targetType, intent.stop);
    return { self: text ? [{ t: "chatMsg", from: "", text }] : [], world: [] };
  },
  stopOrder: (game, playerId) => {
    const text = game.clearOrder(playerId);
    return { self: text ? [{ t: "chatMsg", from: "", text }] : [], world: [] };
  },
```

- [ ] **Step 4: Deliver order notices from the tick loop**

In `packages/server/src/server.ts`, inside the `setInterval` tick callback, after the `consumeGatherNotices()` loop, add:

```ts
    // deliver standing-order notices (set / complete / cancelled)
    for (const { id, text } of game.consumeOrderNotices()) {
      const sock = sockets.get(id);
      if (sock) sock.send(encode({ t: "chatMsg", from: "", text }));
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/server && bun test src/intent-executor.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + full server suite**

Run: `bun run typecheck`
Expected: PASS (the exhaustiveness errors from Task 1 are now resolved).
Run: `cd packages/server && bun test`
Expected: PASS (existing `server.test.ts` still green — the new tick-loop loop is additive).

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/intent-executor.ts packages/server/src/server.ts packages/server/src/intent-executor.test.ts
git commit -m "feat(server): order/stopOrder executor handlers + notice delivery (Slice B)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Client resolver — stop-condition parsing + order routing + stop verb

**Files:**
- Modify: `packages/client/src/resolve.ts`
- Test: `packages/client/src/resolve.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/client/src/resolve.test.ts`:

```ts
test("mine ... until full produces a gather order intent with the resource type", () => {
  expect(resolveCommand("mine copper until full", ctx())).toEqual({
    ok: true,
    intent: { kind: "order", activity: "gather", targetType: "copper_rock", stop: { kind: "untilFull" } },
  });
});

test("chop ... count N produces a gather order intent", () => {
  expect(resolveCommand("chop tree count 5", ctx())).toEqual({
    ok: true,
    intent: { kind: "order", activity: "gather", targetType: "tree", stop: { kind: "count", n: 5 } },
  });
});

test("gather ... until level N produces a gather order intent", () => {
  expect(resolveCommand("mine copper until level 30", ctx())).toEqual({
    ok: true,
    intent: { kind: "order", activity: "gather", targetType: "copper_rock", stop: { kind: "untilLevel", level: 30 } },
  });
});

test("fight ... forever produces a combat order intent", () => {
  expect(resolveCommand("fight goblin forever", ctx())).toEqual({
    ok: true,
    intent: { kind: "order", activity: "combat", targetType: "goblin", stop: { kind: "forever" } },
  });
});

test("fight ... count N produces a combat order intent", () => {
  expect(resolveCommand("attack goblin count 10", ctx())).toEqual({
    ok: true,
    intent: { kind: "order", activity: "combat", targetType: "goblin", stop: { kind: "count", n: 10 } },
  });
});

test("combat rejects gather-only stop-conditions", () => {
  const r = resolveCommand("fight goblin until full", ctx());
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.message).toContain("combat");
});

test("a bare gather/attack verb is still a one-shot intent (back-compat)", () => {
  expect(resolveCommand("mine copper", ctx())).toEqual({ ok: true, intent: { kind: "gather", targetId: "res-1" } });
  expect(resolveCommand("attack goblin", ctx())).toEqual({ ok: true, intent: { kind: "attack", targetId: "npc-1" } });
});

test("malformed count is a friendly error", () => {
  const r = resolveCommand("chop tree count abc", ctx());
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.message).toContain("count");
});

test("stop cancels the active order", () => {
  expect(resolveCommand("stop", ctx())).toEqual({ ok: true, intent: { kind: "stopOrder" } });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/client && bun test src/resolve.test.ts`
Expected: FAIL — order intents not produced; `stop` is an unknown verb.

- [ ] **Step 3: Add the stop-condition parser**

In `packages/client/src/resolve.ts`, extend the protocol import:

```ts
import type { Intent, StopCondition } from "@termenor/protocol";
```

(Remove the now-duplicate `import type { Intent }` if it was separate — keep a single import line for `Intent`/`StopCondition`, plus the existing `ItemStack`/`Equipment` import line unchanged.)

Add this helper after `parseQty`:

```ts
/**
 * Peel a trailing stop-clause off command args: `forever`, `count N`,
 * `until full`, or `until level N`. Returns the remaining name tokens and the
 * parsed stop (null when no clause is present), or a friendly error.
 */
function parseStopCondition(args: string[]): { stop: StopCondition | null; nameTokens: string[]; error: string | null } {
  const lower = args.map((a) => a.toLowerCase());
  const i = lower.findIndex((t) => t === "forever" || t === "count" || t === "until");
  if (i === -1) return { stop: null, nameTokens: args, error: null };
  const nameTokens = args.slice(0, i);
  const kw = lower[i];
  if (kw === "forever") return { stop: { kind: "forever" }, nameTokens, error: null };
  if (kw === "count") {
    const n = parseInt(args[i + 1] ?? "", 10);
    if (!Number.isFinite(n) || n < 1) return { stop: null, nameTokens, error: "count how many? e.g. `count 10`" };
    return { stop: { kind: "count", n }, nameTokens, error: null };
  }
  // kw === "until"
  const next = lower[i + 1];
  if (next === "full") return { stop: { kind: "untilFull" }, nameTokens, error: null };
  if (next === "level") {
    const level = parseInt(args[i + 2] ?? "", 10);
    if (!Number.isFinite(level) || level < 1) return { stop: null, nameTokens, error: "until what level? e.g. `until level 50`" };
    return { stop: { kind: "untilLevel", level }, nameTokens, error: null };
  }
  return { stop: null, nameTokens, error: "stop-condition must be `until full` or `until level N`" };
}
```

- [ ] **Step 4: Route gather/attack verbs through the parser**

Replace the `gather` command's `parse` (the `verbs: ["gather", "mine", "chop", "fish"]` entry) with:

```ts
    parse: (args, ctx) => {
      if (args.length === 0) return err("gather what? e.g. `mine copper`");
      const sc = parseStopCondition(args);
      if (sc.error) return err(sc.error);
      const query = sc.nameTokens.join(" ");
      if (query.length === 0) return err("gather what? e.g. `mine copper until full`");
      const target = matchEntity(query, ctx.resources, ctx.player);
      if (!target) return err(`no resource matching "${query}" nearby`);
      if (sc.stop === null) return ok({ kind: "gather", targetId: target.id });
      return ok({ kind: "order", activity: "gather", targetType: target.type, stop: sc.stop });
    },
```

Replace the `attack` command's `parse` (the `verbs: ["attack", "fight", "kill"]` entry) with:

```ts
    parse: (args, ctx) => {
      if (args.length === 0) return err("attack what? e.g. `attack goblin`");
      const sc = parseStopCondition(args);
      if (sc.error) return err(sc.error);
      const query = sc.nameTokens.join(" ");
      if (query.length === 0) return err("attack what? e.g. `fight goblin forever`");
      const target = matchEntity(query, ctx.npcs, ctx.player);
      if (!target) return err(`no enemy matching "${query}" nearby`);
      if (sc.stop === null) return ok({ kind: "attack", targetId: target.id });
      if (sc.stop.kind === "untilFull" || sc.stop.kind === "untilLevel")
        return err("can't use that stop-condition with combat — try `forever` or `count N`");
      return ok({ kind: "order", activity: "combat", targetType: target.type, stop: sc.stop });
    },
```

- [ ] **Step 5: Add the stop verb**

Add a new entry to the `COMMANDS` array (e.g. after the `unequip` entry):

```ts
  {
    verbs: ["stop", "halt"],
    help: "stop — cancel the current standing order",
    parse: () => ok({ kind: "stopOrder" }),
  },
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd packages/client && bun test src/resolve.test.ts`
Expected: PASS (new tests + existing resolve tests, including the unchanged one-shot ones).

- [ ] **Step 7: Typecheck + full client suite**

Run: `bun run typecheck`
Expected: PASS.
Run: `cd packages/client && bun test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/client/src/resolve.ts packages/client/src/resolve.test.ts
git commit -m "feat(client): standing-order command grammar + stop verb (Slice B)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Full verification + roadmap update

**Files:**
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: Run the entire workspace test suite + typecheck**

Run: `bun test` (from repo root) and `bun run typecheck`
Expected: ALL packages green, no type errors.

- [ ] **Step 2: Mark the slice delivered in the roadmap**

In `docs/ROADMAP.md`, add a Slice B entry beneath the Slice A entry (after line ~"A. ✅ Intent boundary…"):

```markdown
B. ✅ **Standing orders / AFK floor** — server-side per-player order supervisor (`order-system.ts`)
   running gather + combat activities autonomously across ticks; stop-conditions
   (`forever` / `count N` / `until full` / `until level N`) registered alongside intents;
   command grammar suffixes (`mine tree count 50`, `fight goblin forever`) + `stop` verb;
   safe-idle (stop & hold) on completion/cancel. *(merged)* Deferred to later slices: order
   queue / `then` / `repeat`, banking-as-order, richer safe-idle policies, order persistence,
   combat `until level` (needs combat skills), and the event-tier system (Slice C).
```

- [ ] **Step 3: Commit**

```bash
git add docs/ROADMAP.md
git commit -m "docs: mark Slice B (standing orders) delivered

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Notes for the implementer

- **Why the supervisor is observational:** gather success keeps `gatherTarget` set (it only clears on depletion / full / missing-tool), so counting by watching `gatherTarget` is impossible — instead we sample the yield-item count in the inventory. Combat clears `target` on the engaged npc's death, so we detect a kill by checking whether the remembered `engagedNpcId` is now dead (`respawnAt >= 0`).
- **`until full` and stackable yields:** all current gather yields (`logs`, `copper_ore`, `raw_shrimp`) are stackable and stack without a cap, so in normal play a gather inventory never fills — `until full` only fires when there is genuinely no free slot (hence the pre-filled-inventory test). This is intentional: the condition is correct and future-proof for non-stackable gatherables.
- **Tick ordering:** `stepOrders` runs first in `step()` so a freshly-acquired target is acted on by the gather/combat passes the same tick. Kill counting has a one-tick latency (the supervisor sees the death on the following tick), which is invisible at 15 Hz.
- **Determinism in tests:** construct `GameWorld` with `() => 0.99` so `rollDamage` lands the max hit every swing; use the `runUntilIdle` helper rather than hard-coding tick counts.
- **Scope discipline:** do not add the order queue, banking-as-order, persistence, or event tiers — those are explicitly deferred (Slice C and beyond). If a task tempts you toward them, stop and flag it.
```

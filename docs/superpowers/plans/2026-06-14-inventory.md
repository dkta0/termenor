# Inventory + Ground Items Implementation Plan

> For agentic workers: work exactly one task at a time, run the listed test command after every step, and do not advance until it passes. Commit after every task with the exact message shown. Never combine tasks into one commit.

**Goal:** Items exist in the world. Players pick them off the ground into a 28-slot inventory and drop them back. All item state is server-authoritative. Inventory persists across reconnect. Ground items are visible to everyone.

**Architecture:** New `items.ts` in protocol defines types + registry. New `server/inventory.ts` holds pure slot helpers. `Game` gains ground item tracking and pickup/drop methods. `db.ts` gains an `inventory TEXT` column with a migration guard. `server.ts` wires pickup/drop handlers, sends `InventoryMsg` at login and on change, seeds ground items at startup. Client stores ground + inventory in `GameState`, sends pickup/drop via `Connection`, renders ground sprites via `rasterizeIso` (`Kind.ITEM`), and draws an inventory panel overlay with `g`/`1-9` keys in `renderer.ts`.

**Tech Stack:** TypeScript, Bun (runtime + test runner), bun:sqlite, @opentui/core, @termenor/protocol workspace package.

---

## File Structure

### New files
- `packages/protocol/src/items.ts`
- `packages/protocol/src/items.test.ts`
- `packages/server/src/inventory.ts`
- `packages/server/src/inventory.test.ts`
- `packages/server/src/integration.test.ts`

### Modified files
- `packages/protocol/src/index.ts`
- `packages/protocol/src/index.test.ts`
- `packages/server/src/game.ts`
- `packages/server/src/game.test.ts`
- `packages/server/src/db.ts`
- `packages/server/src/db.test.ts`
- `packages/server/src/server.ts`
- `packages/client/src/game-state.ts`
- `packages/client/src/connection.ts`
- `packages/client/src/render/types.ts`
- `packages/client/src/render/rasterize.ts`
- `packages/client/src/render/rasterize.test.ts`
- `packages/client/src/render/renderer.ts`
- `packages/client/src/index.ts`

---

## Task 1 — Protocol: `items.ts` (types + registry + INV_SIZE)

**Files:**
- `packages/protocol/src/items.ts` (new)
- `packages/protocol/src/items.test.ts` (new)
- `packages/protocol/src/index.ts` (add re-exports)

### Steps

1. Write a failing test in `packages/protocol/src/items.test.ts`:

```typescript
import { test, expect } from "bun:test";
import { ITEMS, isItem, INV_SIZE, type ItemStack, type GroundItem } from "./items";

test("ITEMS registry has expected item ids", () => {
  expect(Object.keys(ITEMS)).toContain("coins");
  expect(Object.keys(ITEMS)).toContain("logs");
  expect(Object.keys(ITEMS)).toContain("bronze_sword");
  expect(Object.keys(ITEMS)).toContain("shrimp");
});

test("each ITEMS entry has required fields", () => {
  for (const [, entry] of Object.entries(ITEMS)) {
    expect(typeof entry.name).toBe("string");
    expect(typeof entry.glyph).toBe("string");
    expect(entry.color).toHaveLength(3);
    expect(typeof entry.stackable).toBe("boolean");
  }
});

test("isItem returns true for known ids", () => {
  expect(isItem("coins")).toBe(true);
  expect(isItem("logs")).toBe(true);
});

test("isItem returns false for unknown ids", () => {
  expect(isItem("dragon_plate")).toBe(false);
  expect(isItem("")).toBe(false);
});

test("INV_SIZE is 28", () => {
  expect(INV_SIZE).toBe(28);
});

test("ItemStack and GroundItem shapes compile correctly", () => {
  const stack: ItemStack = { item: "coins", qty: 5 };
  const gi: GroundItem = { id: 1, item: "coins", qty: 10, x: 3, y: 4 };
  expect(stack.item).toBe("coins");
  expect(gi.id).toBe(1);
});
```

2. Run: `cd /home/dakota/Work/github/dkta0/termenor && bun test packages/protocol/src/items.test.ts` — expect FAIL (file not found).

3. Create `packages/protocol/src/items.ts`:

```typescript
export interface ItemStack {
  item: string;
  qty: number;
}

export interface GroundItem {
  id: number;
  item: string;
  qty: number;
  x: number;
  y: number;
}

export const INV_SIZE = 28;

export const ITEMS: Record<string, { name: string; glyph: string; color: [number, number, number]; stackable: boolean }> = {
  coins:        { name: "Coins",        glyph: "$", color: [255, 215,   0], stackable: true  },
  logs:         { name: "Logs",         glyph: "l", color: [139,  90,  43], stackable: true  },
  bronze_sword: { name: "Bronze sword", glyph: "/", color: [205, 127,  50], stackable: false },
  shrimp:       { name: "Shrimp",       glyph: "~", color: [255, 160, 122], stackable: true  },
};

export function isItem(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(ITEMS, id);
}
```

4. Add re-exports to `packages/protocol/src/index.ts` at the top:

```typescript
export type { ItemStack, GroundItem } from "./items";
export { ITEMS, isItem, INV_SIZE } from "./items";
```

5. Run: `bun test packages/protocol/src/items.test.ts` — expect PASS.

6. Run: `bun test packages/protocol` — expect all pass.

7. Commit: `feat(protocol): add items registry, ItemStack/GroundItem types, INV_SIZE`

---

## Task 2 — Protocol: new messages + `SnapshotMsg.ground`

**Files:**
- `packages/protocol/src/index.ts` (modify)
- `packages/protocol/src/index.test.ts` (extend)

### Steps

1. Add failing tests to `packages/protocol/src/index.test.ts`:

```typescript
import { ITEMS, INV_SIZE } from "./items";
import type { GroundItem, ItemStack } from "./items";

test("PickupMsg round-trips", () => {
  const msg: ClientMsg = { t: "pickup" };
  expect(decodeClient(encode(msg))).toEqual(msg);
});

test("DropMsg round-trips", () => {
  const msg: ClientMsg = { t: "drop", slot: 3 };
  expect(decodeClient(encode(msg))).toEqual(msg);
});

test("InventoryMsg round-trips", () => {
  const slots: (ItemStack | null)[] = [{ item: "coins", qty: 5 }, null];
  const msg: ServerMsg = { t: "inventory", slots };
  expect(decodeServer(encode(msg))).toEqual(msg);
});

test("SnapshotMsg includes ground array", () => {
  const ground: GroundItem[] = [{ id: 1, item: "coins", qty: 10, x: 3, y: 4 }];
  const msg: ServerMsg = { t: "snapshot", tick: 1, players: [], ground };
  expect(decodeServer(encode(msg))).toEqual(msg);
});
```

2. Run: `bun test packages/protocol/src/index.test.ts` — expect FAIL.

3. Modify `packages/protocol/src/index.ts`:

   a. Add `ground: GroundItem[]` to `SnapshotMsg`:
   ```typescript
   export interface SnapshotMsg { t: "snapshot"; tick: number; players: PlayerState[]; ground: GroundItem[]; }
   ```

   b. Add new client message types and union:
   ```typescript
   export interface PickupMsg { t: "pickup"; }
   export interface DropMsg { t: "drop"; slot: number; }
   export type ClientMsg = LoginMsg | MoveToMsg | ChatMsg | PickupMsg | DropMsg;
   ```

   c. Add new server message type and union:
   ```typescript
   export interface InventoryMsg { t: "inventory"; slots: (ItemStack | null)[]; }
   export type ServerMsg = WelcomeMsg | SnapshotMsg | LoginErrorMsg | ChatBroadcastMsg | InventoryMsg;
   ```

   d. Update type-sets:
   ```typescript
   const CLIENT_TYPES = new Set(["login", "moveTo", "chat", "pickup", "drop"]);
   const SERVER_TYPES = new Set(["welcome", "snapshot", "loginError", "chatMsg", "inventory"]);
   ```

4. Run: `bun test packages/protocol/src/index.test.ts` — expect PASS.

5. Fix any snapshot call sites that omit `ground` — in `packages/server/src/game.ts` the `snapshot()` return will need `ground: []` temporarily (handled fully in Task 4). Add it now so typecheck passes:

   In `game.ts`, update the snapshot return to `{ t: "snapshot", tick: this.tick, players, ground: [] }`.

6. Fix `packages/client/src/connection.ts` — the seed snapshot call in the `welcome` handler currently constructs a bare `SnapshotMsg`. Add `ground: []`:
   ```typescript
   this.state.applySnapshot(
     { t: "snapshot", tick: 0, players: [{ id: msg.playerId, x: msg.x, y: msg.y, facing: msg.facing }], ground: [] },
     this.now(),
   );
   ```

7. Run: `bun test packages/protocol` — all pass; `bun run typecheck` in `packages/protocol` — clean.

8. Commit: `feat(protocol): PickupMsg, DropMsg, InventoryMsg; SnapshotMsg gains ground`

---

## Task 3 — Server: `inventory.ts` pure helpers

**Files:**
- `packages/server/src/inventory.ts` (new)
- `packages/server/src/inventory.test.ts` (new)

### Steps

1. Write failing tests in `packages/server/src/inventory.test.ts`:

```typescript
import { test, expect } from "bun:test";
import { emptyInventory, addToInventory, removeSlot } from "./inventory";
import { INV_SIZE } from "@termenor/protocol";

test("emptyInventory returns 28 nulls", () => {
  const inv = emptyInventory();
  expect(inv).toHaveLength(INV_SIZE);
  expect(inv.every((s) => s === null)).toBe(true);
});

test("addToInventory places stack in first empty slot", () => {
  const { slots, leftover } = addToInventory(emptyInventory(), { item: "logs", qty: 1 });
  expect(leftover).toBeNull();
  expect(slots[0]).toEqual({ item: "logs", qty: 1 });
  expect(slots[1]).toBeNull();
});

test("addToInventory stacks same stackable item", () => {
  let inv = emptyInventory();
  inv[0] = { item: "coins", qty: 5 };
  const { slots, leftover } = addToInventory(inv, { item: "coins", qty: 3 });
  expect(leftover).toBeNull();
  expect(slots[0]).toEqual({ item: "coins", qty: 8 });
});

test("addToInventory uses first-empty-slot for non-stackable", () => {
  let inv = emptyInventory();
  inv[0] = { item: "bronze_sword", qty: 1 };
  const { slots, leftover } = addToInventory(inv, { item: "bronze_sword", qty: 1 });
  expect(leftover).toBeNull();
  expect(slots[1]).toEqual({ item: "bronze_sword", qty: 1 });
});

test("addToInventory returns leftover when inventory is full", () => {
  const inv = emptyInventory().map(() => ({ item: "bronze_sword", qty: 1 })) as import("@termenor/protocol").ItemStack[];
  const { slots, leftover } = addToInventory(inv, { item: "logs", qty: 5 });
  expect(leftover).toEqual({ item: "logs", qty: 5 });
  // all slots unchanged
  expect(slots.every((s) => s?.item === "bronze_sword")).toBe(true);
});

test("addToInventory partial: stacks what fits, returns leftover 0 for non-stackable when full", () => {
  // When inventory is full but item is stackable and matches slot[0]
  const inv = emptyInventory().map((_, i) => i === 0 ? { item: "coins", qty: 5 } : { item: "bronze_sword", qty: 1 }) as import("@termenor/protocol").ItemStack[];
  const { slots, leftover } = addToInventory(inv, { item: "coins", qty: 3 });
  expect(leftover).toBeNull();
  expect(slots[0]).toEqual({ item: "coins", qty: 8 });
});

test("removeSlot empties the slot and returns the stack", () => {
  let inv = emptyInventory();
  inv[2] = { item: "shrimp", qty: 4 };
  const { slots, removed } = removeSlot(inv, 2);
  expect(removed).toEqual({ item: "shrimp", qty: 4 });
  expect(slots[2]).toBeNull();
});

test("removeSlot on empty slot returns null removed", () => {
  const { slots, removed } = removeSlot(emptyInventory(), 0);
  expect(removed).toBeNull();
  expect(slots[0]).toBeNull();
});

test("removeSlot out-of-range index returns null removed unchanged inv", () => {
  const inv = emptyInventory();
  const { slots, removed } = removeSlot(inv, 999);
  expect(removed).toBeNull();
  expect(slots).toHaveLength(INV_SIZE);
});
```

2. Run: `bun test packages/server/src/inventory.test.ts` — expect FAIL.

3. Create `packages/server/src/inventory.ts`:

```typescript
import { INV_SIZE, ITEMS } from "@termenor/protocol";
import type { ItemStack } from "@termenor/protocol";

export function emptyInventory(): (ItemStack | null)[] {
  return new Array(INV_SIZE).fill(null);
}

export function addToInventory(
  slots: (ItemStack | null)[],
  stack: ItemStack,
): { slots: (ItemStack | null)[]; leftover: ItemStack | null } {
  const result = slots.slice() as (ItemStack | null)[];
  const entry = ITEMS[stack.item];
  const stackable = entry?.stackable ?? false;

  if (stackable) {
    // try to merge into an existing slot of the same item
    for (let i = 0; i < result.length; i++) {
      if (result[i]?.item === stack.item) {
        result[i] = { item: stack.item, qty: (result[i]!.qty + stack.qty) };
        return { slots: result, leftover: null };
      }
    }
  }

  // find first empty slot
  const emptyIdx = result.findIndex((s) => s === null);
  if (emptyIdx === -1) return { slots: result, leftover: stack };

  result[emptyIdx] = { item: stack.item, qty: stack.qty };
  return { slots: result, leftover: null };
}

export function removeSlot(
  slots: (ItemStack | null)[],
  i: number,
): { slots: (ItemStack | null)[]; removed: ItemStack | null } {
  if (i < 0 || i >= slots.length) return { slots: slots.slice(), removed: null };
  const result = slots.slice() as (ItemStack | null)[];
  const removed = result[i] ?? null;
  result[i] = null;
  return { slots: result, removed };
}
```

4. Run: `bun test packages/server/src/inventory.test.ts` — expect PASS.

5. Run: `bun test packages/server` — all pass.

6. Commit: `feat(server): inventory pure helpers — emptyInventory/addToInventory/removeSlot`

---

## Task 4 — Server: `Game` gains ground items + pickup/drop

**Files:**
- `packages/server/src/game.ts` (modify)
- `packages/server/src/game.test.ts` (extend)

### Steps

1. Add failing tests to `packages/server/src/game.test.ts`:

```typescript
import type { GroundItem } from "@termenor/protocol";

test("addGroundItem places item in groundItems", () => {
  const g = new Game(corridor, { x: 0, y: 0 });
  g.addGroundItem("coins", 10, 2, 0);
  const snap = g.snapshot();
  expect(snap.ground).toHaveLength(1);
  expect(snap.ground[0]).toMatchObject({ item: "coins", qty: 10, x: 2, y: 0 });
});

test("snapshot.ground is empty when no ground items", () => {
  const g = new Game(corridor, { x: 0, y: 0 });
  expect(g.snapshot().ground).toEqual([]);
});

test("pickup moves ground item at player tile into inventory, returns true", () => {
  const g = new Game(corridor, { x: 0, y: 0 });
  g.addPlayer("p1", { x: 2, y: 0, facing: "south" });
  g.addGroundItem("coins", 5, 2, 0);
  const changed = g.pickup("p1");
  expect(changed).toBe(true);
  expect(g.snapshot().ground).toHaveLength(0);
  const inv = g.getInventory("p1");
  expect(inv?.[0]).toEqual({ item: "coins", qty: 5 });
});

test("pickup on empty tile returns false, no change", () => {
  const g = new Game(corridor, { x: 0, y: 0 });
  g.addPlayer("p1", { x: 2, y: 0, facing: "south" });
  const changed = g.pickup("p1");
  expect(changed).toBe(false);
  expect(g.snapshot().ground).toHaveLength(0);
});

test("pickup with full inventory: leftover stays on ground", () => {
  const g = new Game(corridor, { x: 0, y: 0 });
  g.addPlayer("p1", { x: 2, y: 0, facing: "south" });
  // fill inventory with non-stackable items
  for (let i = 0; i < 28; i++) g.addGroundItem("bronze_sword", 1, 3, 0);
  // move player to tile 3,0 and pick up once to seed inventory
  // simpler: inject state directly via addPlayer with pre-filled inventory
  const g2 = new Game(corridor, { x: 0, y: 0 });
  g2.addPlayer("p2", { x: 2, y: 0, facing: "south", inventory: new Array(28).fill({ item: "bronze_sword", qty: 1 }) });
  g2.addGroundItem("logs", 3, 2, 0);
  const changed = g2.pickup("p2");
  expect(changed).toBe(false); // inventory full, nothing could be taken
  expect(g2.snapshot().ground).toHaveLength(1); // item still on ground
});

test("drop moves slot item to ground, returns true", () => {
  const g = new Game(corridor, { x: 0, y: 0 });
  g.addPlayer("p1", { x: 2, y: 0, facing: "south", inventory: [{ item: "logs", qty: 2 }, ...new Array(27).fill(null)] });
  const changed = g.drop("p1", 0);
  expect(changed).toBe(true);
  expect(g.snapshot().ground).toHaveLength(1);
  expect(g.snapshot().ground[0]).toMatchObject({ item: "logs", qty: 2, x: 2, y: 0 });
  expect(g.getInventory("p1")?.[0]).toBeNull();
});

test("drop of empty slot returns false", () => {
  const g = new Game(corridor, { x: 0, y: 0 });
  g.addPlayer("p1", { x: 0, y: 0, facing: "south" });
  const changed = g.drop("p1", 0);
  expect(changed).toBe(false);
});

test("drop slot out of range is ignored, returns false", () => {
  const g = new Game(corridor, { x: 0, y: 0 });
  g.addPlayer("p1", { x: 0, y: 0, facing: "south" });
  expect(g.drop("p1", 999)).toBe(false);
});

test("getInventory returns null for unknown player", () => {
  const g = new Game(corridor, { x: 0, y: 0 });
  expect(g.getInventory("ghost")).toBeNull();
});

test("addPlayer with saved inventory restores it", () => {
  const g = new Game(corridor, { x: 0, y: 0 });
  const inv = [{ item: "coins", qty: 7 }, ...new Array(27).fill(null)];
  g.addPlayer("alice", { x: 0, y: 0, facing: "south", inventory: inv });
  expect(g.getInventory("alice")?.[0]).toEqual({ item: "coins", qty: 7 });
});
```

2. Run: `bun test packages/server/src/game.test.ts` — expect FAIL.

3. Rewrite `packages/server/src/game.ts`:

   a. Extend imports: add `GroundItem, ItemStack` from `@termenor/protocol`.
   b. Add `import { emptyInventory, addToInventory, removeSlot } from "./inventory"`.
   c. Add `inventory: (ItemStack | null)[]` field to the `Player` interface.
   d. Extend `RestoredState` to include `inventory?: (ItemStack | null)[]`.
   e. Add `private groundItems: GroundItem[] = []` and `private nextItemId = 1` to the `Game` class.
   f. `addPlayer`: restore `inventory: state?.inventory ?? emptyInventory()`.
   g. `getPlayerState`: include `inventory: p.inventory` in the return.
   h. Add `addGroundItem(item: string, qty: number, x: number, y: number): void` — push `{ id: this.nextItemId++, item, qty, x, y }` to `this.groundItems`.
   i. Add `getInventory(id: string): (ItemStack | null)[] | null` — returns `p.inventory ?? null`.
   j. Add `pickup(id: string): boolean`:
      - get player; return false if not found.
      - find all ground items where `Math.round(gi.x) === Math.round(p.x) && Math.round(gi.y) === Math.round(p.y)`.
      - if none, return false.
      - for each matching ground item, call `addToInventory(p.inventory, { item: gi.item, qty: gi.qty })`. If leftover is null, remove the ground item. If leftover is non-null, update the ground item qty to leftover.qty, stop.
      - return true if at least one item was successfully picked up (inventory changed).
   k. Add `drop(id: string, slot: number): boolean`:
      - get player; return false if not found.
      - call `removeSlot(p.inventory, slot)`. If removed is null return false.
      - update `p.inventory = slots`.
      - push `{ id: this.nextItemId++, item: removed.item, qty: removed.qty, x: Math.round(p.x), y: Math.round(p.y) }` to `this.groundItems`.
      - return true.
   l. `snapshot()`: return `{ t: "snapshot", tick: this.tick, players, ground: this.groundItems.slice() }`.

4. Run: `bun test packages/server/src/game.test.ts` — expect PASS.

5. Run: `bun test packages/server` — all pass.

6. Commit: `feat(server): Game gains groundItems, addGroundItem, pickup, drop, getInventory`

---

## Task 5 — Server: `db.ts` inventory column + persistence

**Files:**
- `packages/server/src/db.ts` (modify)
- `packages/server/src/db.test.ts` (extend)

### Steps

1. Add failing tests to `packages/server/src/db.test.ts`:

```typescript
import { emptyInventory } from "./inventory";
import type { ItemStack } from "@termenor/protocol";

test("new account returns empty inventory", async () => {
  const result = await getOrCreateAccount(db, "invuser", "pw", SPAWN);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.state.inventory).toHaveLength(28);
  expect(result.state.inventory.every((s: ItemStack | null) => s === null)).toBe(true);
});

test("savePlayerState persists inventory and restores it", async () => {
  await getOrCreateAccount(db, "inv2", "pw", SPAWN);
  const inv = [{ item: "coins", qty: 10 }, ...new Array(27).fill(null)];
  savePlayerState(db, "inv2", SPAWN.x, SPAWN.y, SPAWN.facing, inv);
  const result = await getOrCreateAccount(db, "inv2", "pw", SPAWN);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.state.inventory[0]).toEqual({ item: "coins", qty: 10 });
  expect(result.state.inventory[1]).toBeNull();
});

test("openDb migrates existing db without inventory column", () => {
  // Create a db without inventory column (simulating pre-migration db)
  const legacy = new Database(":memory:");
  legacy.run(`CREATE TABLE IF NOT EXISTS accounts (
    username TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    x REAL NOT NULL DEFAULT 24,
    y REAL NOT NULL DEFAULT 24,
    facing TEXT NOT NULL DEFAULT 'south',
    last_seen INTEGER NOT NULL DEFAULT 0
  )`);
  legacy.run("INSERT INTO accounts (username, password_hash, x, y, facing, last_seen) VALUES ('old', 'hash', 24, 24, 'south', 0)");
  // Run migration manually (same logic as openDb)
  try { legacy.run("ALTER TABLE accounts ADD COLUMN inventory TEXT"); } catch { /* already exists */ }
  const row = legacy.query("SELECT inventory FROM accounts WHERE username = 'old'").get() as { inventory: string | null };
  // After migration, inventory column exists (null for existing rows is fine — login will default to emptyInventory)
  expect(row).toBeDefined();
  legacy.close();
});
```

2. Run: `bun test packages/server/src/db.test.ts` — expect FAIL.

3. Modify `packages/server/src/db.ts`:

   a. Add import: `import { emptyInventory } from "./inventory"`.
   b. Add import: `import type { ItemStack } from "@termenor/protocol"`.
   c. Extend `PlayerStateRecord` to include `inventory: (ItemStack | null)[]`.
   d. In `openDb`, after the `CREATE TABLE` statement, add a migration guard:
      ```typescript
      try {
        db.run("ALTER TABLE accounts ADD COLUMN inventory TEXT");
      } catch {
        // column already exists on an existing db — safe to ignore
      }
      ```
   e. In the `CREATE TABLE` statement, add `inventory TEXT` as a new column after `last_seen`.
   f. In `getOrCreateAccount`, when creating a new account: keep INSERT as-is (inventory column will be NULL), and return `state: { x: spawn.x, y: spawn.y, facing: spawn.facing, inventory: emptyInventory() }`.
   g. In `getOrCreateAccount`, update the SELECT to include `inventory`, and parse it in the return:
      ```typescript
      const row = db.query<{ password_hash: string; x: number; y: number; facing: string; inventory: string | null }, string>(
        "SELECT password_hash, x, y, facing, inventory FROM accounts WHERE username = ?",
      ).get(username);
      ```
      Return:
      ```typescript
      return {
        ok: true,
        state: {
          x: row.x, y: row.y, facing: row.facing as Facing,
          inventory: row.inventory ? (JSON.parse(row.inventory) as (ItemStack | null)[]) : emptyInventory(),
        },
      };
      ```
   h. Update `savePlayerState` signature to accept `inventory: (ItemStack | null)[]`:
      ```typescript
      export function savePlayerState(
        db: Database,
        username: string,
        x: number,
        y: number,
        facing: Facing,
        inventory: (ItemStack | null)[],
      ): void {
        db.run(
          "UPDATE accounts SET x = ?, y = ?, facing = ?, inventory = ?, last_seen = ? WHERE username = ?",
          [x, y, facing, JSON.stringify(inventory), Date.now(), username],
        );
      }
      ```

4. Run: `bun test packages/server/src/db.test.ts` — expect PASS.

5. Run: `bun test packages/server` — all pass (server.ts will need patching if it calls `savePlayerState` — fix compile errors before running, see note below).

   **Note:** `server.ts` calls `savePlayerState(db, username, state.x, state.y, state.facing)`. This will fail to typecheck but not fail the `db.test.ts` run directly. Patch the call sites in `server.ts` temporarily with a placeholder `emptyInventory()` until Task 6 wires them properly:
   ```typescript
   savePlayerState(db, username, state.x, state.y, state.facing, state.inventory ?? emptyInventory());
   ```
   Add `import { emptyInventory } from "./inventory"` to `server.ts` at this point.

6. Run: `bun run typecheck` in `packages/server` — clean.

7. Commit: `feat(db): inventory TEXT column, migration guard, save/restore inventory`

---

## Task 6 — Server wiring: handlers, InventoryMsg, seed, persist

**Files:**
- `packages/server/src/server.ts` (modify)
- `packages/server/src/world.ts` (modify — expose seed data)

### Steps

1. There is no isolated unit test file for `server.ts` wiring (integration tests come in Task 10). Instead, verify manually with typecheck and the integration test stub. Write a minimal compile-time guard by reviewing the typecheck output.

2. Modify `packages/server/src/world.ts` — add seed ground items export:

```typescript
export interface SeedItem { item: string; qty: number; x: number; y: number; }

/** Ground items to seed near spawn at server start. */
export const SEED_ITEMS: SeedItem[] = [
  { item: "coins",  qty: 25, x: 25, y: 24 },
  { item: "logs",   qty: 3,  x: 23, y: 24 },
  { item: "shrimp", qty: 5,  x: 24, y: 25 },
];
```

3. Modify `packages/server/src/server.ts`:

   a. Add imports:
      ```typescript
      import { encode, decodeClient, MAX_CHAT_LEN, type InventoryMsg } from "@termenor/protocol";
      import { SEED_ITEMS } from "./world";
      import { emptyInventory } from "./inventory";
      ```
      (Replace existing `import { decodeClient, encode, MAX_CHAT_LEN } from "@termenor/protocol"`)

   b. After `const game = new Game(map, SPAWN);`, seed ground items:
      ```typescript
      for (const s of SEED_ITEMS) game.addGroundItem(s.item, s.qty, s.x, s.y);
      ```

   c. In the login success path, after the `ws.send(encode({ t: "welcome", ... }))` call, send the initial inventory:
      ```typescript
      const invMsg: InventoryMsg = { t: "inventory", slots: result.state.inventory };
      ws.send(encode(invMsg));
      ```
      Also update `game.addPlayer` call to pass `result.state` (which now includes `inventory`):
      ```typescript
      game.addPlayer(username, result.state);
      ```
      (This call is already there — no change needed since `RestoredState` now includes `inventory`.)

   d. In the authed message handler, add after the `chat` branch:
      ```typescript
      } else if (msg.t === "pickup") {
        const changed = game.pickup(ws.data.username);
        if (changed) {
          const inv = game.getInventory(ws.data.username);
          if (inv) ws.send(encode({ t: "inventory", slots: inv } satisfies InventoryMsg));
        }
      } else if (msg.t === "drop") {
        const changed = game.drop(ws.data.username, msg.slot);
        if (changed) {
          const inv = game.getInventory(ws.data.username);
          if (inv) ws.send(encode({ t: "inventory", slots: inv } satisfies InventoryMsg));
        }
      }
      ```

   e. Fix the disconnect `savePlayerState` call to pass inventory:
      ```typescript
      const state = game.getPlayerState(username);
      if (state) savePlayerState(db, username, state.x, state.y, state.facing, state.inventory);
      ```

   f. Fix the periodic save loop `savePlayerState` calls:
      ```typescript
      const state = game.getPlayerState(username);
      if (state) savePlayerState(db, username, state.x, state.y, state.facing, state.inventory);
      ```

4. Run: `bun run typecheck` in `packages/server` — clean.

5. Run: `bun test packages/server` — all pass.

6. Commit: `feat(server): wire pickup/drop handlers, InventoryMsg on login+change, seed ground items`

---

## Task 7 — Client: `GameState` + `Connection` (ground, inventory, sendPickup/sendDrop)

**Files:**
- `packages/client/src/game-state.ts` (modify)
- `packages/client/src/connection.ts` (modify)

### Steps

1. Write failing tests. Add to `packages/client/src/game-state.test.ts` (the file currently has game-state tests already — append these):

```typescript
import type { GroundItem, ItemStack } from "@termenor/protocol";

test("applySnapshot stores ground items", () => {
  const gs = new GameState();
  const ground: GroundItem[] = [{ id: 1, item: "coins", qty: 5, x: 3, y: 4 }];
  gs.applySnapshot({ t: "snapshot", tick: 1, players: [], ground }, 1000);
  expect(gs.ground).toEqual(ground);
});

test("ground defaults to empty array before any snapshot", () => {
  const gs = new GameState();
  expect(gs.ground).toEqual([]);
});

test("setInventory stores slots", () => {
  const gs = new GameState();
  const slots: (ItemStack | null)[] = [{ item: "logs", qty: 2 }, null];
  gs.setInventory(slots);
  expect(gs.inventory[0]).toEqual({ item: "logs", qty: 2 });
});

test("inventory defaults to empty array before setInventory", () => {
  const gs = new GameState();
  expect(gs.inventory).toEqual([]);
});
```

   Run: `bun test packages/client/src/game-state.test.ts` — expect FAIL.

2. Modify `packages/client/src/game-state.ts`:

   a. Add import: `import type { GroundItem, ItemStack } from "@termenor/protocol"`.
   b. Add public fields to `GameState`:
      ```typescript
      ground: GroundItem[] = [];
      inventory: (ItemStack | null)[] = [];
      ```
   c. In `applySnapshot`, after pushing the frame, update ground:
      ```typescript
      this.ground = snap.ground;
      ```
   d. Add `setInventory(slots: (ItemStack | null)[]): void { this.inventory = slots; }`.

3. Run: `bun test packages/client/src/game-state.test.ts` — expect PASS.

4. Write failing connection tests. Create `packages/client/src/connection.test.ts` if it does not exist (check: there is currently no connection test file — create it):

```typescript
import { test, expect } from "bun:test";
import { Connection, type SocketLike } from "./connection";
import { GameState } from "./game-state";
import { encode } from "@termenor/protocol";
import type { ItemStack } from "@termenor/protocol";

function makeSocket(): { sock: SocketLike; sent: string[] } {
  const sent: string[] = [];
  const sock: SocketLike = {
    send: (d) => sent.push(d),
    close: () => {},
  };
  return { sock, sent };
}

function makeConn(state: GameState, sock: SocketLike) {
  return new Connection("ws://test", state, {
    username: "alice",
    password: "pw",
    socketFactory: () => sock,
    now: () => 1000,
  });
}

test("sendPickup sends pickup message", () => {
  const state = new GameState();
  const { sock, sent } = makeSocket();
  const conn = makeConn(state, sock);
  conn.connect();
  sock.onopen?.();
  sent.length = 0; // clear login msg
  conn.sendPickup();
  expect(JSON.parse(sent[0])).toEqual({ t: "pickup" });
});

test("sendDrop sends drop message with slot", () => {
  const state = new GameState();
  const { sock, sent } = makeSocket();
  const conn = makeConn(state, sock);
  conn.connect();
  sock.onopen?.();
  sent.length = 0;
  conn.sendDrop(3);
  expect(JSON.parse(sent[0])).toEqual({ t: "drop", slot: 3 });
});

test("inventory message updates GameState", () => {
  const state = new GameState();
  const { sock } = makeSocket();
  const conn = makeConn(state, sock);
  conn.connect();
  sock.onopen?.();
  // simulate welcome first
  sock.onmessage?.(encode({
    t: "welcome", playerId: "alice", map: { width: 2, height: 1, tiles: [0, 0], heights: [0, 0] },
    tickRate: 15, x: 0, y: 0, facing: "south",
  }));
  const slots: (ItemStack | null)[] = [{ item: "coins", qty: 5 }, null];
  sock.onmessage?.(encode({ t: "inventory", slots }));
  expect(state.inventory[0]).toEqual({ item: "coins", qty: 5 });
});
```

5. Run: `bun test packages/client/src/connection.test.ts` — expect FAIL.

6. Modify `packages/client/src/connection.ts`:

   a. Update import: `import { decodeServer, encode, type MoveToMsg, type ChatMsg, type PickupMsg, type DropMsg } from "@termenor/protocol"`.
   b. Add `sendPickup(): void`:
      ```typescript
      sendPickup(): void {
        const msg: PickupMsg = { t: "pickup" };
        this.sock?.send(encode(msg));
      }
      ```
   c. Add `sendDrop(slot: number): void`:
      ```typescript
      sendDrop(slot: number): void {
        const msg: DropMsg = { t: "drop", slot };
        this.sock?.send(encode(msg));
      }
      ```
   d. In `handle`, add a branch for `inventory`:
      ```typescript
      } else if (msg.t === "inventory") {
        this.state.setInventory(msg.slots);
      }
      ```
   e. Update the seed snapshot in the `welcome` handler — `ground: []` is already there from Task 2; verify it is present.

7. Run: `bun test packages/client/src/connection.test.ts` — expect PASS.

8. Run: `bun test packages/client` — all pass.

9. Commit: `feat(client): GameState stores ground+inventory; Connection sendPickup/sendDrop/handleInventory`

---

## Task 8 — Client render: ground sprites + inventory panel + g/1-9 keys

**Files:**
- `packages/client/src/render/types.ts` (add `Kind.ITEM`)
- `packages/client/src/render/rasterize.ts` (modify)
- `packages/client/src/render/rasterize.test.ts` (extend)
- `packages/client/src/render/renderer.ts` (modify)

### Steps

1. Add `ITEM: 6` to `Kind` in `packages/client/src/render/types.ts`:

```typescript
export const Kind = {
  EMPTY: 0,
  FLOOR: 1,
  WALL: 2,
  PLAYER: 3,
  LOCAL: 4,
  SHADOW: 5,
  ITEM: 6,
} as const;
```

2. Write failing tests in `packages/client/src/render/rasterize.test.ts` (append to existing file):

```typescript
import type { GroundItem } from "@termenor/protocol";
import { Kind } from "./types";

test("rasterizeIso with ground item produces ITEM pixels at item tile", () => {
  const map: import("@termenor/protocol").MapData = {
    width: 5, height: 5,
    tiles: new Array(25).fill(0),
    heights: new Array(25).fill(0),
  };
  const ground: GroundItem[] = [{ id: 1, item: "coins", qty: 5, x: 2, y: 2 }];
  const frame = rasterizeIso(map, [], 0, 0, 200, 200, null, ground);
  const hasItem = frame.buf.kinds.some((k) => k === Kind.ITEM);
  expect(hasItem).toBe(true);
});

test("rasterizeIso with no ground items produces no ITEM pixels", () => {
  const map: import("@termenor/protocol").MapData = {
    width: 5, height: 5,
    tiles: new Array(25).fill(0),
    heights: new Array(25).fill(0),
  };
  const frame = rasterizeIso(map, [], 0, 0, 200, 200, null, []);
  const hasItem = frame.buf.kinds.some((k) => k === Kind.ITEM);
  expect(hasItem).toBe(false);
});
```

3. Run: `bun test packages/client/src/render/rasterize.test.ts` — expect FAIL (wrong arity).

4. Modify `packages/client/src/render/rasterize.ts`:

   a. Add import: `import { ITEMS } from "@termenor/protocol"; import type { GroundItem } from "@termenor/protocol"`.
   b. Update `rasterizeIso` signature:
      ```typescript
      export function rasterizeIso(
        map: MapData, players: RenderPlayer[],
        camOx: number, camOy: number, pxW: number, pxH: number, localId: string | null,
        ground: GroundItem[] = [],
      ): IsoFrame {
      ```
   c. After the players loop (before the final `return f`), add a ground items loop:
      ```typescript
      // ground items — render as small colored sprites, depth = x+y (sits on ground)
      for (const gi of ground) {
        const h = map.heights[Math.round(gi.y) * map.width + Math.round(gi.x)] ?? 0;
        const s = tileToScreen(gi.x, gi.y, h);
        const cx = s.sx - camOx, cy = s.sy - camOy;
        const depth = gi.x + gi.y;
        const entry = ITEMS[gi.item];
        const rgb: RGB = entry ? entry.color : [200, 200, 200];
        // draw a 2x2 pixel sprite at the tile center
        for (let dy = 0; dy < 2; dy++)
          for (let dx = 0; dx < 2; dx++)
            plot(f, Math.round(cx + dx - 1), Math.round(cy + dy - 1), depth, Kind.ITEM, rgb, -1);
      }
      ```

5. Run: `bun test packages/client/src/render/rasterize.test.ts` — expect PASS.

6. Update the `rasterizeIso` call in `packages/client/src/render/renderer.ts` to pass `state.ground`:

   Existing call:
   ```typescript
   const frame = rasterizeIso(map, players, cam.ox, cam.oy, pxW, pxH, state.localId);
   ```
   Updated:
   ```typescript
   const frame = rasterizeIso(map, players, cam.ox, cam.oy, pxW, pxH, state.localId, state.ground);
   ```

7. Add `onPickup` and `onDrop` hooks to `RendererHooks` in `renderer.ts`:

```typescript
export interface RendererHooks {
  onMoveTo(x: number, y: number): void;
  onChat(text: string): void;
  onPickup(): void;
  onDrop(slot: number): void;
}
```

8. Add inventory panel overlay to the frame callback in `renderer.ts`. After the chat input overlay block (after the `if (chat.active)` block), add:

```typescript
// Inventory panel: right edge, list non-empty slots
const PANEL_COL = cols - 22;
const PANEL_COLOR = RGBA.fromInts(200, 200, 160, 255);
buffer.setCell(PANEL_COL, 1, "[", PANEL_COLOR, BLACK);
const invLabel = " Inventory ]";
for (const cell of textCells(invLabel, PANEL_COL + 1, 1, cols, rows)) {
  buffer.setCell(cell.col, cell.row, cell.char, PANEL_COLOR, BLACK);
}
const nonEmpty = state.inventory
  .map((s, i) => ({ s, i }))
  .filter(({ s }) => s !== null);
const maxSlots = Math.min(nonEmpty.length, rows - 4);
for (let row = 0; row < maxSlots; row++) {
  const { s, i } = nonEmpty[row];
  if (!s) continue;
  const entry = ITEMS[s.item];
  const label = `${i + 1}: ${entry?.name ?? s.item} x${s.qty}`;
  for (const cell of textCells(label, PANEL_COL, row + 2, cols, rows)) {
    buffer.setCell(cell.col, cell.row, cell.char, PANEL_COLOR, BLACK);
  }
}
```

   Add import at top of `renderer.ts`: `import { ITEMS } from "@termenor/protocol"`.

9. Add key handlers in the `keypress` handler in `renderer.ts`. In the non-chat block, after the arrow key handling:

```typescript
// Inventory action keys (gated: not in chat mode)
if (key.name === "g") {
  hooks.onPickup();
  return;
}
const numMatch = key.name?.match(/^([1-9])$/);
if (numMatch) {
  hooks.onDrop(parseInt(numMatch[1], 10) - 1);
  return;
}
```

   Place this after the `const d = arrowDelta(key.name)` block (i.e., after the `if (!d) return;` line — but we need to add the inventory checks before that `return`, so restructure: remove the early `if (!d) return` and instead handle arrow delta only if d exists):

   Replace:
   ```typescript
   // Arrow key movement
   const d = arrowDelta(key.name);
   if (!d) return;
   const players = state.samplePositions(performance.now());
   const me = players.find((p) => p.id === state.localId);
   if (!me) return;
   hooks.onMoveTo(Math.round(me.x) + d.dx, Math.round(me.y) + d.dy);
   ```
   With:
   ```typescript
   // Inventory keys
   if (key.name === "g") { hooks.onPickup(); return; }
   const numMatch = /^([1-9])$/.exec(key.name ?? "");
   if (numMatch) { hooks.onDrop(parseInt(numMatch[1], 10) - 1); return; }

   // Arrow key movement
   const d = arrowDelta(key.name);
   if (!d) return;
   const players = state.samplePositions(performance.now());
   const me = players.find((p) => p.id === state.localId);
   if (!me) return;
   hooks.onMoveTo(Math.round(me.x) + d.dx, Math.round(me.y) + d.dy);
   ```

10. Run: `bun test packages/client/src/render/rasterize.test.ts` — PASS.

11. Run: `bun test packages/client` — all pass.

12. Run: `bun run typecheck` in `packages/client` — clean.

13. Commit: `feat(client): ground sprites (Kind.ITEM), inventory panel overlay, g/1-9 keys`

---

## Task 9 — Client `index.ts` wiring

**Files:**
- `packages/client/src/index.ts` (modify)

### Steps

1. There is no unit test for `index.ts` (it's the entrypoint). Verify by typecheck only.

2. In `packages/client/src/index.ts`, update the `startRenderer` call to wire the new hooks:

   Existing call:
   ```typescript
   const handle = await startRenderer(state, chatState, {
     onMoveTo: (x, y) => conn.sendMoveTo(x, y),
     onChat: (text) => conn.sendChat(text),
   });
   ```
   Updated:
   ```typescript
   const handle = await startRenderer(state, chatState, {
     onMoveTo: (x, y) => conn.sendMoveTo(x, y),
     onChat: (text) => conn.sendChat(text),
     onPickup: () => conn.sendPickup(),
     onDrop: (slot) => conn.sendDrop(slot),
   });
   ```

3. Run: `bun run typecheck` in `packages/client` — clean.

4. Run: `bun test` (full suite) — all pass.

5. Commit: `feat(client): wire onPickup/onDrop hooks in index.ts`

---

## Task 10 — Integration test

**Files:**
- `packages/server/src/integration.test.ts` (new)

### Steps

1. Write the integration test:

```typescript
import { test, expect, beforeEach, afterEach } from "bun:test";
import { startServer } from "./server";
import type { RunningServer } from "./server";

let srv: RunningServer;
let port: number;

beforeEach(() => {
  srv = startServer(0); // port 0 = OS-assigned
  port = srv.port;
});

afterEach(() => {
  srv.stop();
});

function wsConnect(username: string, password: string): Promise<{
  ws: WebSocket;
  messages: unknown[];
  send: (obj: unknown) => void;
}> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    const messages: unknown[] = [];
    ws.onmessage = (e) => messages.push(JSON.parse(e.data as string));
    ws.onopen = () => {
      ws.send(JSON.stringify({ t: "login", username, password }));
      // Give server a tick to respond
      setTimeout(() => resolve({ ws, messages, send: (obj) => ws.send(JSON.stringify(obj)) }), 100);
    };
  });
}

function waitFor(messages: unknown[], pred: (m: unknown) => boolean, timeoutMs = 1000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      const found = messages.find(pred);
      if (found) return resolve(found);
      if (Date.now() > deadline) return reject(new Error("timeout waiting for message"));
      setTimeout(check, 20);
    };
    check();
  });
}

test("login receives welcome + inventory messages", async () => {
  const { ws, messages } = await wsConnect("alice", "pw");
  await waitFor(messages, (m: unknown) => (m as { t: string }).t === "welcome");
  await waitFor(messages, (m: unknown) => (m as { t: string }).t === "inventory");
  const inv = messages.find((m: unknown) => (m as { t: string }).t === "inventory") as { t: string; slots: unknown[] };
  expect(inv.slots).toHaveLength(28);
  ws.close();
  await new Promise((r) => setTimeout(r, 50));
});

test("snapshot includes ground array", async () => {
  const { ws, messages } = await wsConnect("bob", "pw");
  await waitFor(messages, (m: unknown) => (m as { t: string }).t === "snapshot");
  const snap = messages.find((m: unknown) => (m as { t: string }).t === "snapshot") as { ground: unknown[] };
  expect(Array.isArray(snap.ground)).toBe(true);
  ws.close();
  await new Promise((r) => setTimeout(r, 50));
});

test("pickup on a seeded item adds it to inventory", async () => {
  // Server seeds coins at (25,24), logs at (23,24), shrimp at (24,25)
  // Move player to (25,24) and pickup
  const { ws, messages, send } = await wsConnect("carol", "pw");
  await waitFor(messages, (m: unknown) => (m as { t: string }).t === "welcome");
  send({ t: "moveTo", x: 25, y: 24 });
  // wait for player to arrive (at SPEED=5 tiles/s, 1 tile takes ~200ms; allow 1s)
  await new Promise((r) => setTimeout(r, 1200));
  send({ t: "pickup" });
  const invMsg = await waitFor(
    messages,
    (m: unknown) => {
      const msg = m as { t: string; slots?: unknown[] };
      if (msg.t !== "inventory") return false;
      return msg.slots?.some((s) => s !== null) ?? false;
    },
    2000,
  ) as { slots: Array<{ item: string; qty: number } | null> };
  const coinSlot = invMsg.slots.find((s) => s?.item === "coins");
  expect(coinSlot).toBeDefined();
  expect(coinSlot?.qty).toBeGreaterThan(0);
  ws.close();
  await new Promise((r) => setTimeout(r, 50));
}, 5000);

test("drop puts item back on ground (visible in next snapshot)", async () => {
  const { ws, messages, send } = await wsConnect("dave", "pw");
  await waitFor(messages, (m: unknown) => (m as { t: string }).t === "welcome");
  // Walk to logs at (23,24) and pick up
  send({ t: "moveTo", x: 23, y: 24 });
  await new Promise((r) => setTimeout(r, 1200));
  send({ t: "pickup" });
  await waitFor(
    messages,
    (m: unknown) => {
      const msg = m as { t: string; slots?: unknown[] };
      return msg.t === "inventory" && (msg.slots?.some((s) => s !== null) ?? false);
    },
    2000,
  );
  // Now drop slot 0
  send({ t: "drop", slot: 0 });
  const invAfterDrop = await waitFor(
    messages,
    (m: unknown) => {
      const msgs = messages.filter((x: unknown) => (x as { t: string }).t === "inventory");
      // We want the second inventory message (after drop)
      return msgs.length >= 2;
    },
    2000,
  ) as unknown;
  const allInvMsgs = messages.filter((m: unknown) => (m as { t: string }).t === "inventory") as Array<{ slots: unknown[] }>;
  const lastInv = allInvMsgs[allInvMsgs.length - 1];
  // After drop, slot 0 should be null
  expect((lastInv.slots[0] as unknown)).toBeNull();
  ws.close();
  await new Promise((r) => setTimeout(r, 50));
}, 5000);

test("inventory persists across reconnect", async () => {
  // Pick up item, disconnect, reconnect, verify inventory still has it
  const { ws, messages, send } = await wsConnect("eve", "secret");
  await waitFor(messages, (m: unknown) => (m as { t: string }).t === "welcome");
  send({ t: "moveTo", x: 25, y: 24 });
  await new Promise((r) => setTimeout(r, 1200));
  send({ t: "pickup" });
  await waitFor(
    messages,
    (m: unknown) => {
      const msg = m as { t: string; slots?: unknown[] };
      return msg.t === "inventory" && (msg.slots?.some((s) => s !== null) ?? false);
    },
    2000,
  );
  ws.close();
  await new Promise((r) => setTimeout(r, 200)); // let disconnect save run

  // Reconnect
  const { ws: ws2, messages: msgs2 } = await wsConnect("eve", "secret");
  const inv2 = await waitFor(
    msgs2,
    (m: unknown) => {
      const msg = m as { t: string; slots?: unknown[] };
      return msg.t === "inventory" && (msg.slots?.some((s) => s !== null) ?? false);
    },
    2000,
  ) as { slots: Array<{ item: string; qty: number } | null> };
  expect(inv2.slots.some((s) => s !== null)).toBe(true);
  ws2.close();
  await new Promise((r) => setTimeout(r, 50));
}, 10000);
```

2. Run: `bun test packages/server/src/integration.test.ts` — expect PASS (all 5 tests).

3. Run: `bun test` (full workspace suite) — all pass.

4. Commit: `test(server): integration tests — login inventory, snapshot ground, pickup/drop/persist`

---

## Task 11 — Review + typecheck + regression check

**Files:** No code changes; verification only.

### Steps

1. Run the full test suite: `bun test` — all green.

2. Run typechecks across all packages:
   ```
   cd /home/dakota/Work/github/dkta0/termenor
   bun run typecheck
   ```
   Expect clean output with zero errors.

3. Run the visual render smoke test if it exists in the workspace:
   ```
   bun run verify:render
   ```
   Expect green (ground items and inventory panel must not break the pixel output assertions, since they draw over the HUD area not the isometric world assertions).

4. Manually verify no console errors when building each package:
   ```
   cd packages/protocol && bun build src/index.ts --outdir /tmp/proto-out
   cd packages/server && bun build src/server.ts --outdir /tmp/server-out
   ```

5. If any test is red: diagnose, fix, re-commit with message `fix: <description>`.

6. Commit: `chore: slice 5 review pass — all tests green, typecheck clean`

---

## Self-Review — Spec Criteria Checklist

| # | Criterion | Satisfied by |
|---|-----------|-------------|
| 1 | Item types + registry tested | Task 1: `items.test.ts` covers ITEMS, isItem, INV_SIZE, type shapes |
| 2 | Server inventory ops tested | Task 3: `inventory.test.ts` covers add/remove/stack/full/out-of-range |
| 3 | Ground/pickup/drop in Game tested | Task 4: `game.test.ts` extensions cover addGroundItem, pickup (change/no-change/full-inv), drop (change/empty/OOB), getInventory, restore |
| 4 | Protocol messages | Task 2: SnapshotMsg.ground, PickupMsg, DropMsg, InventoryMsg all in index.ts with round-trip tests; CLIENT_TYPES/SERVER_TYPES updated |
| 5 | Persistence | Task 5: inventory TEXT column with ADD COLUMN guard; getOrCreateAccount returns parsed inventory; savePlayerState serializes it; Task 6 wires disconnect+periodic saves |
| 6 | Client render | Task 8: Kind.ITEM, ground sprites via rasterizeIso ground param, inventory panel overlay (right side), g→onPickup, 1-9→onDrop, chat.active gate respected |
| 7 | No regressions | Task 11: full bun test + typecheck + verify:render |

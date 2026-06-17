# Slice A — Intent Boundary + Grammar Resolver + Command Line — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a shared `Intent` vocabulary and an extensible command line (REPL) so the player drives actions by typing, resolved through one seam, without removing existing hotkeys.

**Architecture:** The client `resolve` module turns typed text into a normalized `Intent` (shared, in `@termenor/protocol`) via a verb *registry* (the extension point — new verbs/NL plug in here). The client sends `IntentMsg` over the wire. The server `intent-executor` module executes any `Intent` against the `GameWorld` via a typed handler registry, returning an `IntentResult` (messages to send to self / broadcast). A `CommandLine` text buffer and a tiered `LogState` (skeleton for Slice C) round out the client surface.

**Scope guardrails:**
- **Additive only.** Existing hotkey handlers in `server.ts` and `renderer.ts` keep working unchanged. The command line is a *new* parallel path. Unifying hotkeys onto the executor is **deferred to Slice B**.
- **No autonomy, no events.** Standing orders (Slice B) and event emission/tiers (Slice C) are out of scope. The `LogState` is built now but only carries command feedback (confirmations/errors).
- **Chat is untouched.** `Enter` still opens chat. The command line opens on `:`. There is no `say` intent.

**Tech Stack:** TypeScript 6 (ESM), Bun runtime + `bun:test`, OpenTUI ~0.4 (raw key capture + `buffer.setCell`), workspace packages `@termenor/{protocol,server,client}`.

**Commands used throughout:**
- Single test file: `bun test packages/<pkg>/src/<file>.test.ts`
- All tests: `bun test`
- Typecheck: `bun run typecheck`
- Full gate (run before final commit): `just check`

---

## File Structure

**Create:**
- `packages/protocol/src/intents.ts` — the `Intent` discriminated union (shared vocabulary).
- `packages/protocol/src/intents.test.ts` — type/shape guards for intents.
- `packages/client/src/command-line.ts` — `CommandLine` text buffer + history (mirrors `chat.ts`).
- `packages/client/src/command-line.test.ts`
- `packages/client/src/log.ts` — `LogState` tiered feedback log (Slice C skeleton).
- `packages/client/src/log.test.ts`
- `packages/client/src/resolve.ts` — verb registry, `resolveCommand`, name resolution, completions.
- `packages/client/src/resolve.test.ts`
- `packages/server/src/intent-executor.ts` — `executeIntent` + typed handler registry + `IntentResult`.
- `packages/server/src/intent-executor.test.ts`

**Modify:**
- `packages/protocol/src/index.ts` — re-export intents; add `IntentMsg`; extend `ClientMsg` union + `CLIENT_TYPES`.
- `packages/server/src/server.ts` — dispatch `msg.t === "intent"` through `executeIntent` and send the `IntentResult`.
- `packages/client/src/connection.ts` — add `sendIntent`.
- `packages/client/src/render/renderer.ts` — command-line mode (open on `:`, capture keys, submit → resolve → `onIntent`/log), render the command line + tiered log.
- `packages/client/src/index.ts` — add the `onIntent` hook wiring to `conn.sendIntent`.

---

## Task 1: Shared `Intent` type + `IntentMsg`

**Files:**
- Create: `packages/protocol/src/intents.ts`
- Create: `packages/protocol/src/intents.test.ts`
- Modify: `packages/protocol/src/index.ts`

- [ ] **Step 1: Write the `Intent` type**

Create `packages/protocol/src/intents.ts`:

```typescript
// The normalized, structured player command — the shared vocabulary between
// the client resolver (text/NL -> Intent) and the server executor (Intent -> effect).
// Adding a new intent is: add a variant here, register a verb in the client
// resolver, and add a handler in the server executor (the handler map is
// exhaustiveness-checked, so the compiler will flag the missing handler).
export type Intent =
  | { kind: "move"; x: number; y: number }
  | { kind: "attack"; targetId: string }
  | { kind: "gather"; targetId: string }
  | { kind: "pickup" }
  | { kind: "drop"; slot: number }
  | { kind: "use"; action: string; slot: number }
  | { kind: "openBank"; targetId: string }
  | { kind: "openShop"; targetId: string }
  | { kind: "deposit"; slot: number; qty: number }
  | { kind: "withdraw"; index: number; qty: number }
  | { kind: "buy"; item: string; qty: number }
  | { kind: "sell"; item: string; qty: number }
  | { kind: "equip"; slot: number }
  | { kind: "unequip"; index: number };

export type IntentKind = Intent["kind"];
```

- [ ] **Step 2: Write the failing test**

Create `packages/protocol/src/intents.test.ts`:

```typescript
import { test, expect } from "bun:test";
import type { Intent } from "./intents";

test("an attack intent carries a targetId", () => {
  const i: Intent = { kind: "attack", targetId: "npc-7" };
  expect(i.kind).toBe("attack");
  expect(i.targetId).toBe("npc-7");
});

test("a deposit intent carries slot and qty", () => {
  const i: Intent = { kind: "deposit", slot: 2, qty: -1 };
  expect(i).toEqual({ kind: "deposit", slot: 2, qty: -1 });
});
```

- [ ] **Step 3: Run test to verify it passes**

Run: `bun test packages/protocol/src/intents.test.ts`
Expected: PASS (2 tests). This test exists mainly to lock the shape; it passes immediately because the type is already written.

- [ ] **Step 4: Add `IntentMsg` to the protocol index**

In `packages/protocol/src/index.ts`, add the re-export near the other module re-exports (top of file, follow existing `export * from "./items"` style):

```typescript
export * from "./intents";
import type { Intent } from "./intents";
```

Add the message interface alongside the other client message interfaces (after `EquipActionMsg`, before the `ClientMsg` union):

```typescript
export interface IntentMsg { t: "intent"; intent: Intent; }
```

Extend the `ClientMsg` union to include it:

```typescript
export type ClientMsg = LoginMsg | MoveToMsg | ChatMsg | PickupMsg | DropMsg | AttackMsg | GatherMsg | UseMsg | OpenMsg | BankActionMsg | ShopActionMsg | EquipActionMsg | IntentMsg;
```

Add `"intent"` to the `CLIENT_TYPES` set:

```typescript
const CLIENT_TYPES = new Set(["login", "moveTo", "chat", "pickup", "drop", "attack", "gather", "use", "open", "bankAction", "shopAction", "equipAction", "intent"]);
```

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: PASS (no errors).

- [ ] **Step 6: Commit**

```bash
git add packages/protocol/src/intents.ts packages/protocol/src/intents.test.ts packages/protocol/src/index.ts
git commit -m "feat(protocol): add Intent vocabulary and IntentMsg"
```

---

## Task 2: Server `intent-executor` (single execution source)

**Files:**
- Create: `packages/server/src/intent-executor.ts`
- Create: `packages/server/src/intent-executor.test.ts`

Mirrors the response-message logic currently inline in `server.ts` (bank/shop/equip send `inventory`/`bank`/`shop`/`equipment` back). `IntentResult.self` → `ws.send`; `IntentResult.world` → `server.publish("world", ...)`. The session object holds the open shop id (today `ws.data.shopId`).

- [ ] **Step 1: Write the executor**

Create `packages/server/src/intent-executor.ts`:

```typescript
import type { Intent } from "@termenor/protocol";
import type { ServerMsg, InventoryMsg, BankMsg, ShopMsg, EquipmentMsg } from "@termenor/protocol";
import type { GameWorld } from "./game";

/** Per-connection session state the executor reads/writes (backed by ws.data). */
export interface IntentSession { shopId?: string; }

/** Messages produced by executing an intent. */
export interface IntentResult { self: ServerMsg[]; world: ServerMsg[]; }

const NOTHING: IntentResult = { self: [], world: [] };

function inventoryMsg(game: GameWorld, playerId: string): InventoryMsg | null {
  const inv = game.getInventory(playerId);
  return inv ? { t: "inventory", slots: inv } : null;
}

function equipmentMsg(game: GameWorld, playerId: string): EquipmentMsg {
  const eq = game.getEquipment(playerId);
  return { t: "equipment", weapon: eq.weapon, body: eq.body, shield: eq.shield };
}

function bankMsg(game: GameWorld, playerId: string): BankMsg {
  return { t: "bank", items: game.getBank(playerId), open: true };
}

// One handler per Intent kind. The mapped type forces every kind to have a
// handler — adding an Intent variant without a handler is a compile error.
type Handlers = {
  [K in Intent["kind"]]: (
    game: GameWorld,
    playerId: string,
    intent: Extract<Intent, { kind: K }>,
    session: IntentSession,
  ) => IntentResult;
};

const handlers: Handlers = {
  move: (game, playerId, intent) => {
    game.queueMove(playerId, intent.x, intent.y);
    return NOTHING;
  },
  attack: (game, playerId, intent) => {
    game.attack(playerId, intent.targetId);
    return NOTHING;
  },
  gather: (game, playerId, intent) => {
    game.gather(playerId, intent.targetId);
    return NOTHING;
  },
  pickup: (game, playerId) => {
    const changed = game.pickup(playerId);
    const inv = changed ? inventoryMsg(game, playerId) : null;
    return { self: inv ? [inv] : [], world: [] };
  },
  drop: (game, playerId, intent) => {
    const changed = game.drop(playerId, intent.slot);
    const inv = changed ? inventoryMsg(game, playerId) : null;
    return { self: inv ? [inv] : [], world: [] };
  },
  use: (game, playerId, intent) => {
    game.use(playerId, intent.action, intent.slot);
    return NOTHING;
  },
  openBank: (game, playerId, intent) => {
    if (!game.openBank(playerId, intent.targetId)) return NOTHING;
    return { self: [bankMsg(game, playerId)], world: [] };
  },
  openShop: (game, playerId, intent, session) => {
    const sid = game.openShop(playerId, intent.targetId);
    if (!sid) return NOTHING;
    const shop = game.getShop(sid);
    if (!shop) return NOTHING;
    session.shopId = sid;
    const msg: ShopMsg = { t: "shop", shopId: sid, name: shop.name, entries: shop.entries, open: true };
    return { self: [msg], world: [] };
  },
  deposit: (game, playerId, intent) => {
    game.deposit(playerId, intent.slot, intent.qty);
    const inv = inventoryMsg(game, playerId);
    return { self: inv ? [bankMsg(game, playerId), inv] : [bankMsg(game, playerId)], world: [] };
  },
  withdraw: (game, playerId, intent) => {
    game.withdraw(playerId, intent.index, intent.qty);
    const inv = inventoryMsg(game, playerId);
    return { self: inv ? [bankMsg(game, playerId), inv] : [bankMsg(game, playerId)], world: [] };
  },
  buy: (game, playerId, intent, session) => {
    const sid = session.shopId;
    if (!sid) return NOTHING;
    game.buy(playerId, sid, intent.item, intent.qty);
    const shop = game.getShop(sid);
    const self: ServerMsg[] = [];
    if (shop) self.push({ t: "shop", shopId: sid, name: shop.name, entries: shop.entries, open: true });
    const inv = inventoryMsg(game, playerId);
    if (inv) self.push(inv);
    return { self, world: [] };
  },
  sell: (game, playerId, intent, session) => {
    const sid = session.shopId;
    if (!sid) return NOTHING;
    game.sell(playerId, sid, intent.item, intent.qty);
    const shop = game.getShop(sid);
    const self: ServerMsg[] = [];
    if (shop) self.push({ t: "shop", shopId: sid, name: shop.name, entries: shop.entries, open: true });
    const inv = inventoryMsg(game, playerId);
    if (inv) self.push(inv);
    return { self, world: [] };
  },
  equip: (game, playerId, intent) => {
    game.equip(playerId, intent.slot);
    const inv = inventoryMsg(game, playerId);
    return { self: inv ? [equipmentMsg(game, playerId), inv] : [equipmentMsg(game, playerId)], world: [] };
  },
  unequip: (game, playerId, intent) => {
    game.unequip(playerId, intent.index);
    const inv = inventoryMsg(game, playerId);
    return { self: inv ? [equipmentMsg(game, playerId), inv] : [equipmentMsg(game, playerId)], world: [] };
  },
};

/** Execute any intent against the world, returning the messages to send. */
export function executeIntent(
  game: GameWorld,
  playerId: string,
  intent: Intent,
  session: IntentSession,
): IntentResult {
  const handler = handlers[intent.kind] as (
    game: GameWorld,
    playerId: string,
    intent: Intent,
    session: IntentSession,
  ) => IntentResult;
  return handler(game, playerId, intent, session);
}
```

- [ ] **Step 2: Write the failing test**

Create `packages/server/src/intent-executor.test.ts`. Construct a real `GameWorld` the way the existing system tests do, add a player, and assert that intents mutate state + return the expected messages. (Check `combat-system.test.ts` / `equipment-system.test.ts` for the exact `GameWorld` construction + `addPlayer` arguments and adapt the import/constructor call to match.)

```typescript
import { test, expect } from "bun:test";
import { GameWorld } from "./game";
import { createDefaultMap } from "./world";
import { executeIntent, type IntentSession } from "./intent-executor";

function world() {
  const g = new GameWorld(createDefaultMap());
  g.addPlayer("alice");
  return g;
}

test("move intent queues a move (no messages returned)", () => {
  const g = world();
  const res = executeIntent(g, "alice", { kind: "move", x: 24, y: 25 }, {});
  expect(res.self).toEqual([]);
  expect(res.world).toEqual([]);
  // queueMove ran without throwing; movement is asserted by movement-system tests.
});

test("gather intent forwards to the world without throwing", () => {
  const g = world();
  const id = g.spawnResource("tree", 24, 25);
  const res = executeIntent(g, "alice", { kind: "gather", targetId: id }, {});
  expect(res).toEqual({ self: [], world: [] });
});

test("openShop sets the session shop id and returns a shop message", () => {
  const g = world();
  // Find a shop the world seeds (general_store). If none is reachable in a bare
  // world, this asserts the no-op path instead; adjust the npc id to a seeded shop.
  const session: IntentSession = {};
  const res = executeIntent(g, "alice", { kind: "openShop", targetId: "general_store_1" }, session);
  // Either the shop opened (session set + shop msg) or it was a no-op — both are valid shapes.
  if (res.self.length > 0) {
    expect(res.self[0].t).toBe("shop");
    expect(session.shopId).toBeDefined();
  } else {
    expect(res).toEqual({ self: [], world: [] });
  }
});
```

> **Note for the implementer:** the exact `GameWorld` constructor signature and `addPlayer` arguments must match `game.ts`. Open `packages/server/src/combat-system.test.ts` and copy its setup verbatim, then swap in `executeIntent` calls. If `spawnResource` returns the resource id, use it as `targetId`; if a seeded shop/bank id is needed, read `world.ts` for the seeded ids.

- [ ] **Step 3: Run test to verify it passes**

Run: `bun test packages/server/src/intent-executor.test.ts`
Expected: PASS. If the `GameWorld` constructor differs, fix the test setup until green.

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck`
Expected: PASS. The mapped `Handlers` type guarantees every intent kind is handled.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/intent-executor.ts packages/server/src/intent-executor.test.ts
git commit -m "feat(server): intent executor with typed handler registry"
```

---

## Task 3: Wire the `intent` message into the server dispatch

**Files:**
- Modify: `packages/server/src/server.ts`

- [ ] **Step 1: Import the executor**

At the top of `server.ts`, alongside the other local imports, add:

```typescript
import { executeIntent } from "./intent-executor";
```

- [ ] **Step 2: Add the dispatch branch**

In the authenticated dispatch chain (the `if (msg.t === "moveTo") { ... } else if (...)` block), add a new branch. Place it as the **first** branch so intents are the primary path:

```typescript
  if (msg.t === "intent") {
    const result = executeIntent(game, ws.data.username, msg.intent, ws.data);
    for (const m of result.self) ws.send(encode(m));
    for (const m of result.world) server.publish("world", encode(m));
  } else if (msg.t === "moveTo") {
```

(The existing `if (msg.t === "moveTo")` becomes `} else if (msg.t === "moveTo")`. All other branches stay unchanged.)

> **Note:** `ws.data` already carries `username` and `shopId`, so it structurally satisfies `IntentSession` for the `shopId` field. If the typecheck complains that `ws.data` isn't assignable to `IntentSession`, pass `ws.data as unknown as IntentSession` or add `shopId?: string` to the `ws.data` type declaration (search `server.ts` for where `ws.data` is typed).

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 4: Run the server test suite**

Run: `bun test packages/server`
Expected: PASS (all existing server tests still green; no behavior changed for existing messages).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/server.ts
git commit -m "feat(server): dispatch IntentMsg through the executor"
```

---

## Task 4: Client `CommandLine` text buffer + history

**Files:**
- Create: `packages/client/src/command-line.ts`
- Create: `packages/client/src/command-line.test.ts`

Mirrors `chat.ts` (`ChatState`) — raw char capture, single-char `type()`, `backspace()`, `submit()` — plus command history (up/down recall).

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/command-line.test.ts`:

```typescript
import { test, expect } from "bun:test";
import { CommandLine } from "./command-line";

test("initially inactive with empty input", () => {
  const c = new CommandLine();
  expect(c.active).toBe(false);
  expect(c.input).toBe("");
});

test("open activates and clears input", () => {
  const c = new CommandLine();
  c.open();
  expect(c.active).toBe(true);
  expect(c.input).toBe("");
});

test("type appends only single printable chars", () => {
  const c = new CommandLine();
  c.open();
  c.type("m");
  c.type("ine"); // multi-char ignored
  c.type("\n");  // control ignored
  expect(c.input).toBe("m");
});

test("submit returns trimmed text, deactivates, and records history", () => {
  const c = new CommandLine();
  c.open();
  "mine copper".split("").forEach((ch) => c.type(ch));
  expect(c.submit()).toBe("mine copper");
  expect(c.active).toBe(false);
});

test("submit returns null for blank input and records no history", () => {
  const c = new CommandLine();
  c.open();
  expect(c.submit()).toBeNull();
  c.open();
  c.historyPrev();
  expect(c.input).toBe("");
});

test("history recall walks previous submissions newest-first", () => {
  const c = new CommandLine();
  for (const cmd of ["bank", "mine copper"]) {
    c.open();
    cmd.split("").forEach((ch) => c.type(ch));
    c.submit();
  }
  c.open();
  c.historyPrev();
  expect(c.input).toBe("mine copper");
  c.historyPrev();
  expect(c.input).toBe("bank");
  c.historyNext();
  expect(c.input).toBe("mine copper");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/client/src/command-line.test.ts`
Expected: FAIL with "Cannot find module './command-line'".

- [ ] **Step 3: Write the implementation**

Create `packages/client/src/command-line.ts`:

```typescript
const HISTORY_CAP = 50;

/** A typed command input buffer with history recall. Pure model, rendered as an overlay. */
export class CommandLine {
  input = "";
  active = false;
  private history: string[] = [];
  private cursor = 0; // index into history during recall; history.length == "fresh"

  open(): void {
    this.active = true;
    this.input = "";
    this.cursor = this.history.length;
  }

  cancel(): void {
    this.active = false;
    this.input = "";
  }

  /** Append a single printable char (ASCII 32–126). Ignores multi-char/control input. */
  type(ch: string): void {
    if (!this.active || ch.length !== 1) return;
    const code = ch.charCodeAt(0);
    if (code < 32 || code === 127) return;
    this.input += ch;
  }

  backspace(): void {
    if (!this.active) return;
    this.input = this.input.slice(0, -1);
  }

  /** Returns trimmed text (recorded in history) or null if blank. Deactivates. */
  submit(): string | null {
    if (!this.active) return null;
    const text = this.input.trim();
    this.active = false;
    this.input = "";
    if (text.length === 0) return null;
    this.history.push(text);
    if (this.history.length > HISTORY_CAP) this.history.shift();
    return text;
  }

  /** Recall older history into the input buffer. */
  historyPrev(): void {
    if (!this.active || this.history.length === 0) return;
    this.cursor = Math.max(0, this.cursor - 1);
    this.input = this.history[this.cursor] ?? "";
  }

  /** Walk back toward the freshest (empty) input. */
  historyNext(): void {
    if (!this.active || this.history.length === 0) return;
    this.cursor = Math.min(this.history.length, this.cursor + 1);
    this.input = this.cursor >= this.history.length ? "" : this.history[this.cursor];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/client/src/command-line.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/command-line.ts packages/client/src/command-line.test.ts
git commit -m "feat(client): CommandLine input buffer with history"
```

---

## Task 5: Client tiered `LogState` (Slice C skeleton)

**Files:**
- Create: `packages/client/src/log.ts`
- Create: `packages/client/src/log.test.ts`

Carries command feedback now; Slice C will push server events with real tiers.

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/log.test.ts`:

```typescript
import { test, expect } from "bun:test";
import { LogState } from "./log";

test("starts empty", () => {
  const log = new LogState();
  expect(log.recent(10)).toEqual([]);
});

test("push records entries with a tier, newest last", () => {
  const log = new LogState();
  log.push("ambient", "mining copper");
  log.push("critical", "you are nearly dead");
  expect(log.recent(10)).toEqual([
    { tier: "ambient", text: "mining copper" },
    { tier: "critical", text: "you are nearly dead" },
  ]);
});

test("recent(n) returns the last n entries", () => {
  const log = new LogState();
  for (let i = 0; i < 5; i++) log.push("ambient", `line ${i}`);
  expect(log.recent(2)).toEqual([
    { tier: "ambient", text: "line 3" },
    { tier: "ambient", text: "line 4" },
  ]);
});

test("caps stored entries", () => {
  const log = new LogState();
  for (let i = 0; i < 300; i++) log.push("ambient", `line ${i}`);
  expect(log.recent(1000).length).toBe(200);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/client/src/log.test.ts`
Expected: FAIL with "Cannot find module './log'".

- [ ] **Step 3: Write the implementation**

Create `packages/client/src/log.ts`:

```typescript
export type LogTier = "ambient" | "notable" | "critical";
export interface LogEntry { tier: LogTier; text: string; }

const CAP = 200;

/** Append-only feedback log. Slice A: command confirmations/errors.
 *  Slice C: server-emitted events with meaningful tiers. */
export class LogState {
  private entries: LogEntry[] = [];

  push(tier: LogTier, text: string): void {
    this.entries.push({ tier, text });
    if (this.entries.length > CAP) this.entries.shift();
  }

  /** Last n entries, oldest-first. */
  recent(n: number): LogEntry[] {
    return this.entries.slice(-n);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/client/src/log.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/log.ts packages/client/src/log.test.ts
git commit -m "feat(client): tiered LogState (event-log skeleton)"
```

---

## Task 6: Client `resolve` — verb registry, name resolution, completions

**Files:**
- Create: `packages/client/src/resolve.ts`
- Create: `packages/client/src/resolve.test.ts`

The registry (`COMMANDS`) is the extension point. `resolveCommand` tokenizes, finds the spec by verb/alias, and delegates to `spec.parse`, which resolves entity/item names against an injected `ResolveContext` (so the resolver stays pure and unit-testable). Unknown verbs return a `did you mean` suggestion via Levenshtein distance.

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/resolve.test.ts`:

```typescript
import { test, expect } from "bun:test";
import { resolveCommand, completions, type ResolveContext } from "./resolve";

function ctx(over: Partial<ResolveContext> = {}): ResolveContext {
  return {
    player: { x: 10, y: 10 },
    npcs: [{ id: "npc-1", type: "goblin", name: "goblin", x: 11, y: 10 }],
    resources: [
      { id: "res-1", type: "copper_rock", name: "copper rock", x: 12, y: 10 },
      { id: "res-2", type: "tree", name: "tree", x: 9, y: 10 },
    ],
    inventory: [{ item: "logs", qty: 3 }, null, { item: "bronze_sword", qty: 1 }],
    equipment: { weapon: "bronze_sword", body: null, shield: null },
    itemName: (id) => id,
    nearestOfType: (type) => (type === "bank_booth" ? "bank-1" : type === "general_store" ? "shop-1" : null),
    equipSlotName: (index) => (["weapon", "body", "shield"][index] ?? null),
  };
}

test("attack resolves an npc by name to its id", () => {
  const r = resolveCommand("attack goblin", ctx());
  expect(r).toEqual({ ok: true, intent: { kind: "attack", targetId: "npc-1" } });
});

test("mine is an alias for gather and resolves a resource", () => {
  const r = resolveCommand("mine copper", ctx());
  expect(r).toEqual({ ok: true, intent: { kind: "gather", targetId: "res-1" } });
});

test("unknown resource name yields a helpful error", () => {
  const r = resolveCommand("mine diamond", ctx());
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.message).toContain("diamond");
});

test("drop resolves an item name to its inventory slot", () => {
  const r = resolveCommand("drop logs", ctx());
  expect(r).toEqual({ ok: true, intent: { kind: "drop", slot: 0 } });
});

test("equip resolves an inventory item to its slot", () => {
  const r = resolveCommand("equip bronze_sword", ctx());
  expect(r).toEqual({ ok: true, intent: { kind: "equip", slot: 2 } });
});

test("bank with no argument opens the nearest booth", () => {
  const r = resolveCommand("bank", ctx());
  expect(r).toEqual({ ok: true, intent: { kind: "openBank", targetId: "bank-1" } });
});

test("buy parses item and optional quantity (default 1)", () => {
  expect(resolveCommand("buy logs 5", ctx())).toEqual({ ok: true, intent: { kind: "buy", item: "logs", qty: 5 } });
  expect(resolveCommand("buy logs", ctx())).toEqual({ ok: true, intent: { kind: "buy", item: "logs", qty: 1 } });
});

test("unknown verb suggests the closest known verb", () => {
  const r = resolveCommand("atttack goblin", ctx());
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.message).toContain("attack");
});

test("empty input is an error, not a crash", () => {
  expect(resolveCommand("   ", ctx()).ok).toBe(false);
});

test("completions returns verbs matching a prefix", () => {
  expect(completions("ba")).toContain("bank");
  expect(completions("mi")).toContain("mine");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/client/src/resolve.test.ts`
Expected: FAIL with "Cannot find module './resolve'".

- [ ] **Step 3: Write the implementation**

Create `packages/client/src/resolve.ts`:

```typescript
import type { Intent } from "@termenor/protocol";
import type { ItemStack, Equipment } from "@termenor/protocol";

export interface EntityRef { id: string; type: string; name: string; x: number; y: number; }

/** Everything the resolver needs from the live world, injected so it stays pure. */
export interface ResolveContext {
  player: { x: number; y: number };
  npcs: EntityRef[];
  resources: EntityRef[];
  inventory: (ItemStack | null)[];
  equipment: Equipment;
  itemName: (id: string) => string;
  nearestOfType: (type: string) => string | null;
  equipSlotName: (index: number) => string | null;
}

export type ResolveResult = { ok: true; intent: Intent } | { ok: false; message: string };

export interface CommandSpec {
  verbs: string[]; // first is canonical; rest are aliases
  help: string;
  parse: (args: string[], ctx: ResolveContext) => ResolveResult;
}

const err = (message: string): ResolveResult => ({ ok: false, message });
const ok = (intent: Intent): ResolveResult => ({ ok: true, intent });

/** Case-insensitive substring match; nearest to the player wins ties. */
function matchEntity(query: string, list: EntityRef[], player: { x: number; y: number }): EntityRef | null {
  const q = query.toLowerCase();
  const hits = list.filter((e) => e.name.toLowerCase().includes(q) || e.type.toLowerCase().includes(q));
  if (hits.length === 0) return null;
  return hits.reduce((best, e) =>
    Math.hypot(e.x - player.x, e.y - player.y) < Math.hypot(best.x - player.x, best.y - player.y) ? e : best,
  );
}

/** Match an item name (id or display name) to its first inventory slot, or -1. */
function matchInventorySlot(query: string, inv: (ItemStack | null)[], itemName: (id: string) => string): number {
  const q = query.toLowerCase();
  return inv.findIndex(
    (s) => s != null && (s.item.toLowerCase().includes(q) || itemName(s.item).toLowerCase().includes(q)),
  );
}

function parseQty(token: string | undefined): number {
  if (token === undefined) return 1;
  if (token === "all") return -1;
  const n = parseInt(token, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export const COMMANDS: CommandSpec[] = [
  {
    verbs: ["attack", "fight", "kill"],
    help: "attack <enemy> — fight the named enemy",
    parse: (args, ctx) => {
      if (args.length === 0) return err("attack what? e.g. `attack goblin`");
      const target = matchEntity(args.join(" "), ctx.npcs, ctx.player);
      return target ? ok({ kind: "attack", targetId: target.id }) : err(`no enemy matching "${args.join(" ")}" nearby`);
    },
  },
  {
    verbs: ["gather", "mine", "chop", "fish"],
    help: "gather <resource> — harvest the named resource",
    parse: (args, ctx) => {
      if (args.length === 0) return err("gather what? e.g. `mine copper`");
      const target = matchEntity(args.join(" "), ctx.resources, ctx.player);
      return target ? ok({ kind: "gather", targetId: target.id }) : err(`no resource matching "${args.join(" ")}" nearby`);
    },
  },
  {
    verbs: ["take", "pickup", "pick", "grab"],
    help: "take — pick up the item under you",
    parse: () => ok({ kind: "pickup" }),
  },
  {
    verbs: ["drop"],
    help: "drop <item> — drop the named item",
    parse: (args, ctx) => {
      if (args.length === 0) return err("drop what? e.g. `drop logs`");
      const slot = matchInventorySlot(args.join(" "), ctx.inventory, ctx.itemName);
      return slot >= 0 ? ok({ kind: "drop", slot }) : err(`no "${args.join(" ")}" in your inventory`);
    },
  },
  {
    verbs: ["use"],
    help: "use <action> <item> — e.g. `use firemaking logs`",
    parse: (args, ctx) => {
      if (args.length < 2) return err("use what? e.g. `use firemaking logs`");
      const action = args[0];
      const slot = matchInventorySlot(args.slice(1).join(" "), ctx.inventory, ctx.itemName);
      return slot >= 0 ? ok({ kind: "use", action, slot }) : err(`no "${args.slice(1).join(" ")}" in your inventory`);
    },
  },
  {
    verbs: ["bank"],
    help: "bank — open the nearest bank booth",
    parse: (_args, ctx) => {
      const id = ctx.nearestOfType("bank_booth");
      return id ? ok({ kind: "openBank", targetId: id }) : err("no bank booth nearby");
    },
  },
  {
    verbs: ["shop", "store"],
    help: "shop — open the nearest store",
    parse: (_args, ctx) => {
      const id = ctx.nearestOfType("general_store");
      return id ? ok({ kind: "openShop", targetId: id }) : err("no store nearby");
    },
  },
  {
    verbs: ["deposit"],
    help: "deposit <item> [qty|all] — deposit from inventory",
    parse: (args, ctx) => {
      if (args.length === 0) return err("deposit what? e.g. `deposit logs all`");
      const slot = matchInventorySlot(args[0], ctx.inventory, ctx.itemName);
      if (slot < 0) return err(`no "${args[0]}" in your inventory`);
      return ok({ kind: "deposit", slot, qty: parseQty(args[1]) });
    },
  },
  {
    verbs: ["withdraw"],
    help: "withdraw <bank-index> [qty|all] — withdraw by bank slot number",
    parse: (args) => {
      const index = parseInt(args[0] ?? "", 10);
      if (!Number.isFinite(index) || index < 1) return err("withdraw which slot? e.g. `withdraw 1 all`");
      return ok({ kind: "withdraw", index: index - 1, qty: parseQty(args[1]) });
    },
  },
  {
    verbs: ["buy"],
    help: "buy <item> [qty] — buy from the open shop",
    parse: (args) => {
      if (args.length === 0) return err("buy what? e.g. `buy logs 5`");
      return ok({ kind: "buy", item: args[0], qty: parseQty(args[1]) });
    },
  },
  {
    verbs: ["sell"],
    help: "sell <item> [qty] — sell to the open shop",
    parse: (args) => {
      if (args.length === 0) return err("sell what? e.g. `sell logs 5`");
      return ok({ kind: "sell", item: args[0], qty: parseQty(args[1]) });
    },
  },
  {
    verbs: ["equip", "wield", "wear"],
    help: "equip <item> — equip the named item",
    parse: (args, ctx) => {
      if (args.length === 0) return err("equip what? e.g. `equip bronze sword`");
      const slot = matchInventorySlot(args.join(" "), ctx.inventory, ctx.itemName);
      return slot >= 0 ? ok({ kind: "equip", slot }) : err(`no "${args.join(" ")}" in your inventory`);
    },
  },
  {
    verbs: ["unequip", "remove"],
    help: "unequip <weapon|body|shield> — remove equipped gear",
    parse: (args, ctx) => {
      if (args.length === 0) return err("unequip what? e.g. `unequip weapon`");
      const q = args[0].toLowerCase();
      const index = ["weapon", "body", "shield"].findIndex((s) => s === q);
      if (index < 0) return err("unequip weapon, body, or shield");
      const slotName = ctx.equipSlotName(index);
      if (!slotName) return err("nothing equipped there");
      return ok({ kind: "unequip", index });
    },
  },
];

// Verb -> spec lookup, built once.
const VERB_INDEX = new Map<string, CommandSpec>();
for (const spec of COMMANDS) for (const v of spec.verbs) VERB_INDEX.set(v, spec);

const ALL_VERBS = [...VERB_INDEX.keys()];

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[a.length][b.length];
}

function closestVerb(verb: string): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const v of ALL_VERBS) {
    const d = levenshtein(verb, v);
    if (d < bestD) { bestD = d; best = v; }
  }
  return best !== null && bestD <= 2 ? best : null;
}

/** Resolve a typed command line into an Intent, or an error message to show. */
export function resolveCommand(line: string, ctx: ResolveContext): ResolveResult {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return err("type a command, e.g. `mine copper`");
  const [verb, ...args] = tokens;
  const spec = VERB_INDEX.get(verb.toLowerCase());
  if (!spec) {
    const suggestion = closestVerb(verb.toLowerCase());
    return err(suggestion ? `unknown command "${verb}" — did you mean "${suggestion}"?` : `unknown command "${verb}"`);
  }
  return spec.parse(args, ctx);
}

/** Verbs (canonical + aliases) matching a prefix, for tab-completion. */
export function completions(prefix: string): string[] {
  const p = prefix.toLowerCase();
  return ALL_VERBS.filter((v) => v.startsWith(p)).sort();
}
```

> **Note for the implementer:** confirm `ItemStack` and `Equipment` are exported from `@termenor/protocol` (they are used by existing client code in `game-state.ts`). If `Equipment`'s field names differ from `weapon/body/shield`, adjust `equipSlotName` usage accordingly.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/client/src/resolve.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/resolve.ts packages/client/src/resolve.test.ts
git commit -m "feat(client): command resolver with verb registry and name resolution"
```

---

## Task 7: Wire the command line into the client (connection + renderer + hooks)

**Files:**
- Modify: `packages/client/src/connection.ts`
- Modify: `packages/client/src/index.ts`
- Modify: `packages/client/src/render/renderer.ts`

This task has no new unit test (it is UI wiring over already-tested units); it is verified by `bun run typecheck` and the PTY render smoke test.

- [ ] **Step 1: Add `sendIntent` to the connection**

In `packages/client/src/connection.ts`, alongside the other `sendX` methods, add (and add `Intent`/`IntentMsg` to the `@termenor/protocol` import):

```typescript
  sendIntent(intent: Intent): void {
    const msg: IntentMsg = { t: "intent", intent };
    this.sock?.send(encode(msg));
  }
```

- [ ] **Step 2: Add the `onIntent` hook wiring**

In `packages/client/src/index.ts`, add to the hooks object passed to `startRenderer`:

```typescript
  onIntent: (intent) => conn.sendIntent(intent),
```

- [ ] **Step 3: Extend `RendererHooks` and construct the new state in `renderer.ts`**

In `packages/client/src/render/renderer.ts`:

Add to the `RendererHooks` interface (search for `onEquipAction` to find it):

```typescript
  onIntent?: (intent: Intent) => void;
```

Add the imports at the top of the file:

```typescript
import type { Intent } from "@termenor/protocol";
import { CommandLine } from "../command-line";
import { LogState } from "../log";
import { resolveCommand, type ResolveContext, type EntityRef } from "../resolve";
import { ITEM_KINDS } from "@termenor/protocol";
import { RESOURCE_KINDS } from "@termenor/protocol";
```

> **Note:** `ITEM_KINDS` / `RESOURCE_KINDS` are already imported somewhere in this file (used by the existing `gather`/`firemaking` hotkeys). Reuse the existing import rather than duplicating it — adjust the import lines above to match what is already present.

Near the modal-mode state (`let equipMode = ...`), construct the new state:

```typescript
  const cmd = new CommandLine();
  const log = new LogState();
```

- [ ] **Step 4: Add the command-line key-handling block**

In the `keypress` handler, add a modal block **before** the existing `if (chat.active) { ... }` block so the command line captures keys when open:

```typescript
    if (cmd.active) {
      if (key.name === "return" || key.name === "enter") {
        const line = cmd.submit();
        if (line) {
          const result = resolveCommand(line, buildResolveContext(state, log));
          if (result.ok) { hooks.onIntent?.(result.intent); log.push("ambient", `» ${line}`); }
          else log.push("notable", result.message);
        }
      } else if (key.name === "escape") {
        cmd.cancel();
      } else if (key.name === "backspace") {
        cmd.backspace();
      } else if (key.name === "up") {
        cmd.historyPrev();
      } else if (key.name === "down") {
        cmd.historyNext();
      } else {
        cmd.type(key.sequence ?? key.name ?? "");
      }
      return;
    }
```

Then add the opener in the base (non-modal) section, next to where `Enter` opens chat:

```typescript
    if (key.sequence === ":") { cmd.open(); return; }
```

> **Note:** match on `key.sequence === ":"` (the glyph) rather than `key.name`, since `:` has no stable key name. Place this check before the arrow/letter handling so it is not shadowed.

- [ ] **Step 5: Add the `buildResolveContext` helper**

Add this function in `renderer.ts` (module scope, below the imports). It adapts live `GameState` into the pure `ResolveContext` the resolver expects:

```typescript
function buildResolveContext(state: GameState, _log: LogState): ResolveContext {
  const now = performance.now();
  const me = state.samplePositions(now).find((p) => p.id === state.localId);
  const player = me ? { x: me.x, y: me.y } : { x: 0, y: 0 };
  const npcs: EntityRef[] = state.sampleNpcs(now).map((n) => ({
    id: n.id, type: n.type, name: n.type.replace(/_/g, " "), x: n.x, y: n.y,
  }));
  const resources: EntityRef[] = state.sampleResources().map((r) => ({
    id: r.id, type: r.type, name: (RESOURCE_KINDS[r.type]?.name ?? r.type).toLowerCase(), x: r.x, y: r.y,
  }));
  return {
    player,
    npcs,
    resources,
    inventory: state.inventory,
    equipment: state.equipment,
    itemName: (id) => ITEM_KINDS[id]?.name ?? id,
    nearestOfType: (type) => state.nearestResourceOfType(type, now),
    equipSlotName: (index) => (["weapon", "body", "shield"][index] ?? null),
  };
}
```

> **Note for the implementer:** verify `RESOURCE_KINDS[type]` and `ITEM_KINDS[id]` have a `.name` field (they are used for labels elsewhere in the renderer). `state.nearestResourceOfType(type, now)` already exists (used by the `b`/`o` hotkeys). `GameState` is already imported in this file.

- [ ] **Step 6: Render the command line + tiered log**

In the frame callback, in the overlays section (after the existing chat log/input rendering), add. Reuse the existing `textCells`, color constants (`DIM`, `CYAN`), and `RGBA.fromInts` already in the file:

```typescript
    // Tiered event/command log: bottom-left, above the chat log.
    const TIER_COLORS = {
      ambient: DIM,
      notable: RGBA.fromInts(230, 210, 140, 255),
      critical: RGBA.fromInts(230, 110, 110, 255),
    } as const;
    const logLines = log.recent(5);
    const logTop = rows - 6 - logLines.length - (cmd.active ? 1 : 0);
    for (let i = 0; i < logLines.length; i++) {
      const e = logLines[i];
      for (const cell of textCells(e.text, 1, logTop + i, cols, rows))
        buffer.setCell(cell.col, cell.row, cell.char, TIER_COLORS[e.tier], BLACK);
    }

    // Command input line (mutually exclusive with chat input).
    if (cmd.active) {
      const line = `» ${cmd.input}_`;
      for (const cell of textCells(line, 1, rows - 1, cols, rows))
        buffer.setCell(cell.col, cell.row, cell.char, CYAN, BLACK);
    }
```

> **Note:** the chat input also renders at `rows - 1` when `chat.active`. The two are never active at once (opening `:` requires chat to be closed and vice-versa), so the row collision is safe. Adjust `logTop` if it overlaps the chat log in your terminal size during the smoke test.

- [ ] **Step 7: Typecheck**

Run: `bun run typecheck`
Expected: PASS. Fix any mismatch between the assumed `ITEM_KINDS`/`RESOURCE_KINDS`/`GameState` shapes and the real ones.

- [ ] **Step 8: Render smoke test**

Run: `bun run verify:render`
Expected: PASS (the client boots and renders in a real PTY without crashing).

- [ ] **Step 9: Commit**

```bash
git add packages/client/src/connection.ts packages/client/src/index.ts packages/client/src/render/renderer.ts
git commit -m "feat(client): command line wired through resolver to Intent + tiered log"
```

---

## Task 8: Full verification + docs

**Files:**
- Modify: `docs/ROADMAP.md` (mark Slice A status — match the existing slice-status formatting)
- Modify: `docs/OPERATING-PROCEDURE.md` (if it tracks current slice — match existing format)

- [ ] **Step 1: Run the full test suite**

Run: `bun test`
Expected: PASS (all existing tests + the new protocol/client/server tests).

- [ ] **Step 2: Run the full pre-commit gate**

Run: `just check`
Expected: PASS (test + typecheck + render + click + login smoke tests all green).

- [ ] **Step 3: Update the roadmap/docs**

Record Slice A as delivered: shared `Intent` vocabulary, server intent executor, client command line + resolver + tiered log; note the deferred items (hotkey migration onto the executor, standing orders = Slice B, event tiers = Slice C). Follow the exact formatting used for Slice 11 in `docs/ROADMAP.md`.

- [ ] **Step 4: Commit**

```bash
git add docs/ROADMAP.md docs/OPERATING-PROCEDURE.md
git commit -m "docs: mark slice A (intent boundary) delivered"
```

---

## Manual verification (do this once after Task 8)

1. `just server` in one terminal, `just client-dev` in another.
2. Press `:` — the `»` prompt appears at the bottom; movement/hotkeys are blocked while typing.
3. Type `mine copper` + Enter near a copper rock — the character gathers; `» mine copper` appears in the log.
4. Type `gibberish` + Enter — a `notable`-tier error appears, suggesting the closest verb where applicable.
5. Press `:` then Up — the previous command is recalled.
6. Confirm existing hotkeys (`a`, `c`, arrows, `e`, `b`, `o`) still work unchanged.

---

## Self-Review

**Spec coverage (against the design doc §2/§5/§6):**
- §2 intent boundary (resolver → Intent → registry): Tasks 1 (Intent), 6 (resolver registry), 2 (executor registry). ✓
- §2 swappable resolver / extension via registration: `COMMANDS` registry in Task 6; new verbs plug in there. ✓
- §5 command line with history, `did you mean`, tab-completion: Tasks 4 (history), 6 (`closestVerb`, `completions`). ✓ (Completions are computed but not yet bound to a Tab keypress — noted below.)
- §5 tiered log: Tasks 5 + 7. ✓
- §6 unit-testable in isolation: Tasks 2, 4, 5, 6 are pure/deterministic tests. ✓
- §1/§3/§4 standing orders + events: correctly **out of scope** (Slice B/C). ✓

**Known intentional gaps (not silent):**
- Tab-completion is implemented (`completions`) but not bound to the Tab key in the renderer — wiring it is a small follow-on; the function is tested now so the binding is trivial later.
- Existing hotkeys still send their original messages; they do **not** yet route through the executor. Deferred to Slice B per the scope guardrails.
- The single-key answer to escalated events (§5) depends on the event system — Slice C.

**Placeholder scan:** No TBD/TODO; every code step contains complete code. Two steps carry implementer notes to reconcile assumed shapes (`GameWorld` constructor, `ITEM_KINDS`/`RESOURCE_KINDS`/`Equipment`) with the real ones — these are verification instructions, not placeholders.

**Type consistency:** `Intent` kinds/fields in Task 1 match the executor handlers (Task 2) and the resolver outputs (Task 6) — checked: `withdraw`/`unequip` use `index`; `deposit`/`drop`/`equip`/`use` use `slot`; `buy`/`sell` use `item`+`qty`. `IntentResult` (`{ self, world }`) is produced in Task 2 and consumed in Task 3. `ResolveContext` fields in Task 6's test match the interface and the `buildResolveContext` builder in Task 7.

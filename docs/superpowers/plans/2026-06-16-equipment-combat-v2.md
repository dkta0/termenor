# Equipment (Combat v2, lean cut) — Slice 11 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. TDD each unit; commit per unit; `bun test` green + `bun run typecheck` clean before moving on.

**Goal:** Let a player equip/unequip weapon + armour (3 fixed slots) that feed the existing flat melee combat — weapon raises max hit, armour gives flat damage reduction — server-authoritative and persisted, with a modal equipment panel in the client.

**Architecture:** Reuse the slice-10 shapes exactly. A command-style `equipment-system.ts` over `GameWorld` (like `bank-system.ts`); an `equipment` JSON column with a migration guard (like `bank`); request/response messages (`EquipActionMsg`/`EquipmentMsg`, mirroring `bankAction`/`bank`); a modal client panel with a locked key scheme (mirroring the bank panel). Combat changes are surgical: `combat-system.ts` computes a player's max hit from their weapon and subtracts a player victim's armour defence.

**Tech Stack:** TypeScript, Bun, monorepo (packages/protocol, packages/server, packages/client). Spec: `docs/superpowers/specs/2026-06-16-equipment-combat-v2-slice.md`. Branch: `feat/equipment-combat-v2`.

**Key decisions locked here (deviations from spec naming, intentional):**
- The unarmed base max hit is the **existing `PLAYER_MAX_HIT` (=2)**, NOT a new `BASE_MAX_HIT`. This avoids churn and preserves current unarmed combat tests. The spec's `BASE_MAX_HIT` is realized as `PLAYER_MAX_HIT`.
- Fixed 3-slot set: `weapon`, `body`, `shield`. Equipment is private per-player (not in snapshots) — no renderer iso-path changes.
- `playerMaxHit(p)` / `playerDefence(p)` are **pure functions over `PlayerEntity`** in `equipment-system.ts`, imported by `combat-system.ts` (one-directional, no cycle).

**Locked client key scheme (do not expand):**
- Open (no panel open, chat inactive): `e` → `state.toggleEquip()` (client-local; equipment is always available, no server round-trip to open).
- Equip panel open: `Esc` closes (`state.closeEquip()`). Default EQUIP mode; `u` → unequip mode, `q` → equip mode. Digit `1-9`: EQUIP mode → `onEquipAction("equip", invSlot=digit-1)`; UNEQUIP mode → `onEquipAction("unequip", equipIndex=digit-1)` (index into `EQUIP_SLOTS`).
- Panel-open branch sits at the TOP of the not-chatting handler and `return`s after handling, so digits don't fall through to `onDrop`. (Slice-10's bank/shop branches stay above or below it consistently — equip panel is just another modal branch; only one panel can be open since `e`/`b`/`o` each open their own and the branches return.)

---

## Unit 1 — Protocol: equipment table, consts, two messages

**Files:** create `packages/protocol/src/equipment.ts`; modify `packages/protocol/src/index.ts`, `packages/protocol/src/items.ts`; test `packages/protocol/src/index.test.ts` (+ an equipment assertion), new `packages/protocol/src/equipment.test.ts`.

- [ ] **Step 1: Write `equipment.ts`**

```typescript
export type EquipSlot = "weapon" | "body" | "shield";

/** Fixed display + index order. UNEQUIP actions index into this. */
export const EQUIP_SLOTS: EquipSlot[] = ["weapon", "body", "shield"];

/** A player's equipped item id per slot (null = empty). */
export type Equipment = Record<EquipSlot, string | null>;

export const emptyEquipment = (): Equipment => ({ weapon: null, body: null, shield: null });

export interface EquipStats { slot: EquipSlot; maxHit?: number; defence?: number; }

export const EQUIPMENT: Record<string, EquipStats> = {
  bronze_sword:     { slot: "weapon", maxHit: 2 },
  bronze_platebody: { slot: "body",   defence: 2 },
  bronze_shield:    { slot: "shield", defence: 1 },
};

export const isEquippable = (item: string): boolean =>
  Object.prototype.hasOwnProperty.call(EQUIPMENT, item);
```

- [ ] **Step 2: Add gear items to `ITEM_KINDS` in `items.ts`** (bronze_sword already exists; add the two armour pieces)

```typescript
  bronze_platebody: { name: "Bronze platebody", glyph: "B", color: [205, 127, 50], stackable: false },
  bronze_shield:    { name: "Bronze shield",    glyph: ")", color: [180, 120, 60], stackable: false },
```

- [ ] **Step 3: Add the two messages + registrations in `index.ts`**

```typescript
export interface EquipActionMsg { t: "equipAction"; action: "equip" | "unequip"; slot: number; }
export interface EquipmentMsg { t: "equipment"; weapon: string | null; body: string | null; shield: string | null; }
```
- Add `EquipActionMsg` to the `ClientMsg` union and `"equipAction"` to `CLIENT_TYPES`.
- Add `EquipmentMsg` to the `ServerMsg` union and `"equipment"` to `SERVER_TYPES`.
- Add `export * from "./equipment";`.

- [ ] **Step 4: Write `equipment.test.ts`**

```typescript
import { test, expect } from "bun:test";
import { EQUIP_SLOTS, EQUIPMENT, isEquippable, emptyEquipment } from "./equipment";

test("EQUIP_SLOTS is the fixed weapon/body/shield order", () => {
  expect(EQUIP_SLOTS).toEqual(["weapon", "body", "shield"]);
});

test("EQUIPMENT maps gear to slots with stats", () => {
  expect(EQUIPMENT.bronze_sword).toEqual({ slot: "weapon", maxHit: 2 });
  expect(EQUIPMENT.bronze_platebody.slot).toBe("body");
  expect(EQUIPMENT.bronze_shield.defence).toBe(1);
});

test("isEquippable is true only for listed gear", () => {
  expect(isEquippable("bronze_sword")).toBe(true);
  expect(isEquippable("logs")).toBe(false);
});

test("emptyEquipment has three null slots", () => {
  expect(emptyEquipment()).toEqual({ weapon: null, body: null, shield: null });
});
```

- [ ] **Step 5: Add a round-trip assertion to `index.test.ts`** (follow the existing message round-trip pattern in that file: encode then `decodeClient`/`decodeServer`, assert deep equality)

```typescript
import { type EquipActionMsg, type EquipmentMsg } from "./index";
// in a new test:
const ea: EquipActionMsg = { t: "equipAction", action: "equip", slot: 3 };
expect(decodeClient(encode(ea))).toEqual(ea);
const em: EquipmentMsg = { t: "equipment", weapon: "bronze_sword", body: null, shield: null };
expect(decodeServer(encode(em))).toEqual(em);
```

- [ ] **Step 6: Run + commit**

Run: `bun test packages/protocol/src/` → green; `bun run typecheck` → clean.
```bash
git add packages/protocol
git commit -m "feat(protocol): equipment table, slots, EquipAction/Equipment messages"
```

---

## Unit 2 — Persistence: equipment column

**Files:** modify `packages/server/src/db.ts`; test `packages/server/src/db.test.ts`.

- [ ] **Step 1: Write failing persistence tests in `db.test.ts`** (mirror the existing `bank` tests in this file)

```typescript
test("equipment round-trips through save/reload", async () => {
  const db = openDb(":memory:");
  await getOrCreateAccount(db, "eq", "pw", { x: 1, y: 1, facing: "south" });
  savePlayerState(db, "eq", 1, 1, "south", emptyInventory(), {}, [], { weapon: "bronze_sword", body: null, shield: "bronze_shield" });
  const reloaded = await getOrCreateAccount(db, "eq", "pw", { x: 1, y: 1, facing: "south" });
  if (!reloaded.ok) throw new Error("reload failed");
  expect(reloaded.state.equipment).toEqual({ weapon: "bronze_sword", body: null, shield: "bronze_shield" });
});

test("a new account starts with empty equipment", async () => {
  const db = openDb(":memory:");
  const r = await getOrCreateAccount(db, "fresh", "pw", { x: 1, y: 1, facing: "south" });
  if (!r.ok) throw new Error("create failed");
  expect(r.state.equipment).toEqual({ weapon: null, body: null, shield: null });
});
```
(Import `emptyInventory` is already imported in this file; ensure `savePlayerState` calls in existing tests get the new trailing arg — see Step 4.)

- [ ] **Step 2: Run to verify failure**

Run: `bun test packages/server/src/db.test.ts` → FAIL (`savePlayerState` arity / `state.equipment` undefined).

- [ ] **Step 3: Implement the column in `db.ts`**
- `import { ..., type Equipment, emptyEquipment } from "@termenor/protocol";` (and `ItemStack` already imported).
- `PlayerStateRecord` += `equipment: Equipment;`.
- In `openDb` CREATE TABLE: add `equipment TEXT` after `bank TEXT`.
- Add a migration guard after the bank one:
```typescript
try { db.run("ALTER TABLE accounts ADD COLUMN equipment TEXT"); } catch { /* already exists */ }
```
- `getOrCreateAccount`: extend the SELECT to include `equipment`; new account → `state.equipment: emptyEquipment()`; existing → parse:
```typescript
let equipment: Equipment = emptyEquipment();
if (row.equipment) { try { equipment = JSON.parse(row.equipment) as Equipment; } catch { equipment = emptyEquipment(); } }
```
add `equipment` to the returned `state` object. Update the SELECT row generic type to include `equipment: string | null`.
- `savePlayerState`: add trailing param `equipment: Equipment` (after `bank`); add `equipment = ?` to the UPDATE SET list and `JSON.stringify(equipment)` to the params array (before `Date.now()`).

- [ ] **Step 4: Update existing `savePlayerState` callers inside `db.test.ts`** (and any other test in this file) to pass a trailing `emptyEquipment()` so they keep compiling.

- [ ] **Step 5: Run + commit**

Run: `bun test packages/server/src/db.test.ts` → green; `bun run typecheck` → clean.
> NOTE: `server.ts`'s two `savePlayerState` calls now have wrong arity — they're fixed in Unit 5. If you run the full `bun test` here it will fail to typecheck server.ts; that's expected until Unit 5. Run only the db test + `bun test packages/server/src/db.test.ts` for this unit, OR temporarily pass `emptyEquipment()` placeholder at both server.ts call sites now (Unit 5 switches them to real state). Prefer the placeholder so the suite stays green.

Apply the placeholder in `server.ts` both call sites now: add `, emptyEquipment()` (import it) — Unit 5 swaps to `state.equipment ?? emptyEquipment()`.

```bash
git add packages/server/src/db.ts packages/server/src/db.test.ts packages/server/src/server.ts
git commit -m "feat(server): persist player equipment (JSON column + migration)"
```

---

## Unit 3 — Engine: PlayerEntity + GameWorld state + equipment-system

**Files:** modify `packages/server/src/entities.ts`, `packages/server/src/game.ts`; create `packages/server/src/equipment-system.ts` + `packages/server/src/equipment-system.test.ts`. Also fix the `PlayerEntity` literal in `skills-system.test.ts` (and any test constructing `PlayerEntity`) to include `equipment`.

- [ ] **Step 1: Extend `PlayerEntity` in `entities.ts`**
- `import type { ..., Equipment } from "@termenor/protocol";`
- Add field `equipment: Equipment;` to `PlayerEntity`.

- [ ] **Step 2: Wire `GameWorld` state in `game.ts`**
- Import `emptyEquipment`, `EQUIP_SLOTS`, `type Equipment` from protocol.
- `RestoredState` += `equipment?: Equipment;`.
- `addPlayer`: `const equipment = state?.equipment ?? emptyEquipment();` and add `equipment` to the `this.players.set(id, {...})` literal.
- `getPlayerState`: add `equipment: p.equipment` to the returned object.
- Add thin command wrappers (after the shop block):
```typescript
  // --- Equipment (delegates to equipment-system) ---
  getEquipment(id: string): Equipment {
    return equipSys.getEquipment(this, id);
  }
  equip(id: string, invSlot: number): boolean {
    return equipSys.equip(this, id, invSlot);
  }
  unequip(id: string, equipIndex: number): boolean {
    return equipSys.unequip(this, id, equipIndex);
  }
```
- Add `import * as equipSys from "./equipment-system";` at the top with the other system imports.

- [ ] **Step 3: Write failing `equipment-system.test.ts`** (minimal `GameWorld`, no server boot — mirror `bank-system.test.ts`)

```typescript
import { test, expect } from "bun:test";
import { GameWorld } from "./game";
import { playerMaxHit, playerDefence } from "./equipment-system";
import { PLAYER_MAX_HIT } from "@termenor/protocol";
import type { MapData } from "@termenor/protocol";

const MAP: MapData = { width: 5, height: 5, tiles: new Array(25).fill(0), heights: new Array(25).fill(0) };
const world = () => new GameWorld(MAP, { x: 2, y: 2 });

test("equip moves an equippable item from inventory into its slot", () => {
  const w = world();
  w.addPlayer("p1");
  const inv = w.getInventory("p1")!;
  inv.fill(null);
  inv[0] = { item: "bronze_sword", qty: 1 };
  expect(w.equip("p1", 0)).toBe(true);
  expect(w.getEquipment("p1").weapon).toBe("bronze_sword");
  expect(w.getInventory("p1")![0]).toBeNull();
});

test("equip into an occupied slot swaps the old gear back to that inventory slot", () => {
  const w = world();
  w.addPlayer("p1");
  const inv = w.getInventory("p1")!;
  inv.fill(null);
  inv[0] = { item: "bronze_sword", qty: 1 };
  w.equip("p1", 0); // weapon = sword, inv[0] = null
  inv[0] = { item: "bronze_sword", qty: 1 }; // a second sword (stand-in)
  expect(w.equip("p1", 0)).toBe(true);
  expect(w.getEquipment("p1").weapon).toBe("bronze_sword");
  expect(w.getInventory("p1")![0]).toEqual({ item: "bronze_sword", qty: 1 }); // swapped-out sword
});

test("equip a non-equippable item is refused", () => {
  const w = world();
  w.addPlayer("p1");
  const inv = w.getInventory("p1")!;
  inv.fill(null);
  inv[0] = { item: "logs", qty: 5 };
  expect(w.equip("p1", 0)).toBe(false);
  expect(w.getEquipment("p1").weapon).toBeNull();
  expect(w.getInventory("p1")![0]).toEqual({ item: "logs", qty: 5 });
});

test("unequip returns gear to the inventory", () => {
  const w = world();
  w.addPlayer("p1");
  const inv = w.getInventory("p1")!;
  inv.fill(null);
  inv[0] = { item: "bronze_platebody", qty: 1 };
  w.equip("p1", 0); // body
  expect(w.unequip("p1", 1)).toBe(true); // index 1 = "body"
  expect(w.getEquipment("p1").body).toBeNull();
  expect(w.getInventory("p1")!.some((s) => s?.item === "bronze_platebody")).toBe(true);
});

test("unequip into a full inventory is refused and the gear is retained", () => {
  const w = world();
  w.addPlayer("p1");
  const inv = w.getInventory("p1")!;
  inv.fill(null);
  inv[0] = { item: "bronze_sword", qty: 1 };
  w.equip("p1", 0); // weapon equipped, inv[0] now null
  for (let i = 0; i < inv.length; i++) inv[i] = { item: "logs", qty: 1 }; // fill every slot
  expect(w.unequip("p1", 0)).toBe(false); // index 0 = "weapon"
  expect(w.getEquipment("p1").weapon).toBe("bronze_sword");
});

test("playerMaxHit adds the weapon bonus to the unarmed base", () => {
  const w = world();
  w.addPlayer("p1");
  const p = (w as any).players.get("p1");
  expect(playerMaxHit(p)).toBe(PLAYER_MAX_HIT); // unarmed
  const inv = w.getInventory("p1")!;
  inv.fill(null); inv[0] = { item: "bronze_sword", qty: 1 };
  w.equip("p1", 0);
  expect(playerMaxHit(p)).toBe(PLAYER_MAX_HIT + 2);
});

test("playerDefence sums equipped armour", () => {
  const w = world();
  w.addPlayer("p1");
  const p = (w as any).players.get("p1");
  expect(playerDefence(p)).toBe(0);
  const inv = w.getInventory("p1")!;
  inv.fill(null);
  inv[0] = { item: "bronze_platebody", qty: 1 };
  inv[1] = { item: "bronze_shield", qty: 1 };
  w.equip("p1", 0); w.equip("p1", 1);
  expect(playerDefence(p)).toBe(3); // 2 + 1
});
```

- [ ] **Step 4: Run to verify failure**

Run: `bun test packages/server/src/equipment-system.test.ts` → FAIL (module not found).

- [ ] **Step 5: Implement `equipment-system.ts`**

```typescript
import { addToInventory } from "./inventory";
import { EQUIPMENT, EQUIP_SLOTS, PLAYER_MAX_HIT, type Equipment, type EquipSlot } from "@termenor/protocol";
import type { PlayerEntity } from "./entities";
import type { GameWorld } from "./game";

function notice(w: GameWorld, id: string, text: string): void {
  w.events.gatherNotices.push({ id, text });
}

/** Unarmed base + equipped weapon's maxHit bonus. */
export function playerMaxHit(p: PlayerEntity): number {
  const w = p.equipment.weapon;
  return PLAYER_MAX_HIT + (w ? (EQUIPMENT[w]?.maxHit ?? 0) : 0);
}

/** Sum of defence across equipped armour. */
export function playerDefence(p: PlayerEntity): number {
  let d = 0;
  for (const slot of EQUIP_SLOTS) {
    const item = p.equipment[slot];
    if (item) d += EQUIPMENT[item]?.defence ?? 0;
  }
  return d;
}

export function getEquipment(w: GameWorld, playerId: string): Equipment {
  const p = w.players.get(playerId);
  return p ? p.equipment : { weapon: null, body: null, shield: null };
}

export function equip(w: GameWorld, playerId: string, invSlot: number): boolean {
  const p = w.players.get(playerId);
  if (!p) return false;
  const stack = p.inventory[invSlot];
  if (!stack) return false;
  const stats = EQUIPMENT[stack.item];
  if (!stats) { notice(w, playerId, "You can't equip that."); return false; }
  const slot: EquipSlot = stats.slot;
  // Swap: old gear (if any) returns to the freed inventory slot. Net inv count unchanged.
  const old = p.equipment[slot];
  p.equipment = { ...p.equipment, [slot]: stack.item };
  p.inventory[invSlot] = old ? { item: old, qty: 1 } : null;
  return true;
}

export function unequip(w: GameWorld, playerId: string, equipIndex: number): boolean {
  const p = w.players.get(playerId);
  if (!p) return false;
  const slot = EQUIP_SLOTS[equipIndex];
  if (!slot) return false;
  const item = p.equipment[slot];
  if (!item) return false;
  // All-or-nothing (slice-10 sell lesson): only commit if the gear actually fits.
  const { slots, leftover } = addToInventory(p.inventory, { item, qty: 1 });
  if (leftover !== null) {
    notice(w, playerId, "You don't have inventory space to unequip that.");
    return false;
  }
  p.inventory = slots;
  p.equipment = { ...p.equipment, [slot]: null };
  return true;
}
```

- [ ] **Step 6: Fix `PlayerEntity` literals in tests** — add `equipment: { weapon: null, body: null, shield: null }` to any `PlayerEntity` object literal (search: `grep -rn "gatherCd:" packages/server/src/*.test.ts` — the same spots that have `bank: []`). At minimum `skills-system.test.ts`.

- [ ] **Step 7: Run + commit**

Run: `bun test packages/server/src/equipment-system.test.ts` → green; `bun run typecheck` → clean.
```bash
git add packages/server/src/entities.ts packages/server/src/game.ts packages/server/src/equipment-system.ts packages/server/src/equipment-system.test.ts packages/server/src/skills-system.test.ts
git commit -m "feat(server): equipment-system (equip/unequip/swap) + GameWorld state"
```

---

## Unit 4 — Combat integration: weapon max hit + armour defence

**Files:** modify `packages/server/src/combat-system.ts`; test `packages/server/src/combat-system.test.ts`.

- [ ] **Step 1: Write failing combat tests in `combat-system.test.ts`** (follow the file's existing pattern: a minimal `GameWorld`, a stubbed/deterministic `w.rng`. Check how existing tests force `rng` — reuse that mechanism.)

```typescript
// Pattern note: existing tests set w.rng to a fixed function. Use rng = () => 0.999
// so rollDamage returns the max (floor(0.999 * (maxHit+1)) === maxHit).

test("an equipped weapon raises the player's landed damage above the unarmed cap", () => {
  // player with bronze_sword equipped attacks an adjacent NPC with rng pinned to max.
  // Expected landed dmg === PLAYER_MAX_HIT + 2 (weapon bonus), exceeding unarmed PLAYER_MAX_HIT.
});

test("equipped armour reduces incoming NPC damage by the player's defence", () => {
  // NPC (maxHit 1) attacks an adjacent player wearing bronze_platebody (defence 2), rng pinned to max.
  // Expected: dmg = max(0, 1 - 2) = 0, so player hp unchanged. Unarmoured baseline would take 1.
});

test("unarmed/unarmoured combat is unchanged (regression)", () => {
  // player vs npc, no gear, rng pinned to max → landed dmg === PLAYER_MAX_HIT (as before).
});
```
(Write these out fully against the existing test harness in the file — read the top of `combat-system.test.ts` first to copy its `GameWorld` + rng setup and its assertion style for `w.hits` / target hp.)

- [ ] **Step 2: Run to verify failure**

Run: `bun test packages/server/src/combat-system.test.ts` → FAIL (armour/weapon not yet wired).

- [ ] **Step 3: Implement the combat changes in `combat-system.ts`**
- Add `import { playerMaxHit, playerDefence } from "./equipment-system";`.
- Remove the `PLAYER_MAX_HIT` import only if it becomes unused (it stays used via `equipment-system`; leave the import if still referenced elsewhere in the file — verify).
- Change `combatStepActor`'s signature to take a victim-defence lookup, and apply it:
```typescript
function combatStepActor(
  w: GameWorld,
  actor: { x: number; y: number; facing: Facing; path: Point[]; target: string | null; attackCd: number },
  findTarget: (id: string) => { id: string; x: number; y: number; hp: number } | null,
  maxHit: number,
  defenceOf: (targetId: string) => number,
): void {
  // ...unchanged until the damage line:
  const dmg = Math.max(0, rollDamage(maxHit, w.rng) - defenceOf(tgt.id));
  // ...rest unchanged
}
```
- Update the two call sites in `stepCombat`:
```typescript
for (const p of w.players.values()) {
  if (p.attackCd > 0) p.attackCd--;
  combatStepActor(w, p, (id) => w.npcs.find((n) => n.id === id && n.respawnAt < 0) ?? null, playerMaxHit(p), () => 0); // NPCs have no defence
}
for (const npc of w.npcs) {
  if (npc.respawnAt >= 0) continue;
  if (npc.attackCd > 0) npc.attackCd--;
  combatStepActor(w, npc, (id) => w.players.get(id) ?? null, npc.maxHit, (id) => { const pl = w.players.get(id); return pl ? playerDefence(pl) : 0; });
}
```

- [ ] **Step 4: Run + commit**

Run: `bun test packages/server/src/combat-system.test.ts` → green; `bun test packages/server/src/` → green; `bun run typecheck` → clean.
```bash
git add packages/server/src/combat-system.ts packages/server/src/combat-system.test.ts
git commit -m "feat(server): weapon-driven max hit + armour damage reduction in combat"
```

---

## Unit 5 — Server wiring + world: login equipment, equipAction handler, gear spawns

**Files:** modify `packages/server/src/server.ts`, `packages/server/src/world.ts`.

- [ ] **Step 1: Send `EquipmentMsg` on login** — in the welcome/login block of `server.ts` (where `InventoryMsg` and `SkillsMsg` are sent), add:
```typescript
const eq = game.getEquipment(username);
ws.send(encode({ t: "equipment", weapon: eq.weapon, body: eq.body, shield: eq.shield } satisfies EquipmentMsg));
```
Import `type EquipmentMsg` (and `emptyEquipment` is already imported from Unit 2's placeholder).

- [ ] **Step 2: Handle `equipAction` in the authed branch** (after the `shopAction` block)
```typescript
} else if (msg.t === "equipAction") {
  const u = ws.data.username;
  if (msg.action === "equip") game.equip(u, msg.slot);
  else game.unequip(u, msg.slot);
  const eq = game.getEquipment(u);
  ws.send(encode({ t: "equipment", weapon: eq.weapon, body: eq.body, shield: eq.shield } satisfies EquipmentMsg));
  const inv = game.getInventory(u);
  if (inv) ws.send(encode({ t: "inventory", slots: inv } satisfies InventoryMsg));
}
```

- [ ] **Step 3: Switch the Unit-2 placeholder to real equipment at BOTH `savePlayerState` call sites**
- Change `, emptyEquipment()` → `, state.equipment ?? emptyEquipment()` in both the `close(ws)` handler and the periodic save loop.

- [ ] **Step 4: Seed gear in `world.ts`** — add a starter-gear list and add gear to the slice-10 store:
```typescript
/** Starter gear seeded on the ground near spawn so any player can equip. */
export const STARTER_GEAR: SeedItem[] = [
  { item: "bronze_sword",     qty: 1, x: 23, y: 23 },
  { item: "bronze_platebody", qty: 1, x: 23, y: 22 },
  { item: "bronze_shield",    qty: 1, x: 24, y: 22 },
];
```
(Verify these tiles are walkable and not overlapping existing `SEED_ITEMS`/`STARTER_AXE`/`RESOURCE_SPAWNS`/`NPC_SPAWNS` — the spawn cluster is around 22–27, 22–26; pick free tiles, adjust if a chosen tile is taken.)
- In `server.ts` startup, seed them: `for (const g of STARTER_GEAR) game.addGroundItem(g.item, g.qty, g.x, g.y);` and add `STARTER_GEAR` to the `world` import.
- Add the three gear items to the `general_store` entries in `packages/protocol/src/shops.ts` (so buy-then-equip works):
```typescript
    { item: "bronze_sword",     price: 26, stock: 5 },
    { item: "bronze_platebody", price: 40, stock: 5 },
    { item: "bronze_shield",    price: 24, stock: 5 },
```
(Adding to `SHOPS` will shift the slice-10 `general_store` entry count — if any slice-10 test asserts a specific entry length, update it. Check: `grep -rn "general_store" packages/server/src/*.test.ts packages/protocol/src/*.test.ts`.)

- [ ] **Step 5: Run + commit**

Run: `bun test packages/server/src/` → green; `bun run typecheck` → clean.
```bash
git add packages/server/src/server.ts packages/server/src/world.ts packages/protocol/src/shops.ts
git commit -m "feat(server): wire equipAction + login equipment; seed + stock gear"
```

---

## Unit 6 — Client: state, connection, modal equipment panel, inputs

**Files:** modify `packages/client/src/game-state.ts`, `packages/client/src/connection.ts`, `packages/client/src/render/renderer.ts`, `packages/client/src/index.ts`; tests `game-state.test.ts`, `connection.test.ts`.

- [ ] **Step 1: TDD `game-state.ts`** — append tests to `game-state.test.ts`:
```typescript
test("setEquipment stores the equipped items", () => {
  const gs = new GameState();
  gs.setEquipment({ weapon: "bronze_sword", body: null, shield: "bronze_shield" });
  expect(gs.equipment).toEqual({ weapon: "bronze_sword", body: null, shield: "bronze_shield" });
});

test("toggleEquip flips the panel flag; closeEquip clears it", () => {
  const gs = new GameState();
  expect(gs.equipOpen).toBe(false);
  gs.toggleEquip();
  expect(gs.equipOpen).toBe(true);
  gs.closeEquip();
  expect(gs.equipOpen).toBe(false);
});
```
Then implement in `game-state.ts`:
- `import type { ..., Equipment } from "@termenor/protocol";`
- Fields: `equipment: Equipment = { weapon: null, body: null, shield: null };` and `equipOpen = false;`
- Methods: `setEquipment(eq: Equipment): void { this.equipment = eq; }`, `toggleEquip(): void { this.equipOpen = !this.equipOpen; }`, `closeEquip(): void { this.equipOpen = false; }`.

- [ ] **Step 2: TDD `connection.ts`** — append tests to `connection.test.ts`:
```typescript
test("sendEquipAction serializes an equipAction message", () => {
  const { sock, conn } = setup();
  sock.fireOpen();
  conn.sendEquipAction("equip", 3);
  expect(sock.lastDecoded()).toEqual({ t: "equipAction", action: "equip", slot: 3 });
});

test("equipment message updates game-state and fires onEquipment", () => {
  const sock = new MockSocket();
  const gs = new GameState();
  let fired = false;
  const conn = new Connection("ws://x", gs, {
    socketFactory: () => sock, now: () => 0, username: "u", password: "p",
    onEquipment: () => { fired = true; },
  });
  conn.connect();
  sock.fireOpen();
  sock.fireMessage(encode({ t: "equipment", weapon: "bronze_sword", body: null, shield: null }));
  expect(gs.equipment).toEqual({ weapon: "bronze_sword", body: null, shield: null });
  expect(fired).toBe(true);
});
```
Then implement in `connection.ts`:
- Import `type EquipActionMsg` (and the message handler uses the `equipment` server type).
- `ConnectionOpts` += `onEquipment?: () => void;`; store as `private readonly onEquipment`.
- `sendEquipAction(action: "equip" | "unequip", slot: number): void { const msg: EquipActionMsg = { t: "equipAction", action, slot }; this.sock?.send(encode(msg)); }`
- In `handle`, add: `else if (msg.t === "equipment") { this.state.setEquipment({ weapon: msg.weapon, body: msg.body, shield: msg.shield }); this.onEquipment?.(); }`

- [ ] **Step 3: Renderer — hooks + locked key scheme + panel** (additive only; do NOT touch the iso blit path)
- `RendererHooks` += `onEquipAction?(action: "equip" | "unequip", slot: number): void;`
- Add panel-local mode state near `bankMode`/`shopMode`: `let equipMode: "equip" | "unequip" = "equip";`
- Add the modal branch at the top of the not-chatting handler, alongside the bank/shop branches:
```typescript
if (state.equipOpen) {
  if (key.name === "escape") { state.closeEquip(); return; }
  if (key.name === "q") { equipMode = "equip"; return; }
  if (key.name === "u") { equipMode = "unequip"; return; }
  const m = /^([1-9])$/.exec(key.name ?? "");
  if (m) hooks.onEquipAction?.(equipMode, parseInt(m[1], 10) - 1);
  return;
}
```
- Add the open key in the main (not-chatting) section, next to `b`/`o`:
```typescript
if (key.name === "e") { state.toggleEquip(); return; }
```
- Draw the panel after the iso blit, alongside the bank/shop panels (reuse their drawing approach). List the three slots in `EQUIP_SLOTS` order with 1-based index and item name (via `ITEM_KINDS`), the current mode, and a one-line hint, e.g.:
```
[ Equipment — EQUIP ]
q equip · u unequip · 1-9 slot · Esc close
1 Weapon: Bronze sword
2 Body: (empty)
3 Shield: Bronze shield
```
(Import `EQUIP_SLOTS` from protocol; read `state.equipment[slot]`.)

- [ ] **Step 4: Wire `index.ts`** — add to the `startRenderer` hooks object:
```typescript
  onEquipAction: (action, slot) => conn.sendEquipAction(action, slot),
```

- [ ] **Step 5: Run + commit**

Run: `bun test` → green; `bun run typecheck` → clean; `bun run verify:render` → green.
```bash
git add packages/client
git commit -m "feat(client): equipment panel + equip/unequip inputs"
```

---

## Unit 7 — Integration test + review + merge

**Files:** create `packages/server/src/equipment.integration.test.ts`.

- [ ] **Step 1: Write the integration test** (mirror `banking-shops.integration.test.ts`; remember the stale-inventory-reference gotcha — re-fetch `getInventory` after mutations that route through `addToInventory`)

```typescript
import { test, expect } from "bun:test";
import { GameWorld } from "./game";
import { openDb, getOrCreateAccount, savePlayerState } from "./db";
import { PLAYER_MAX_HIT } from "@termenor/protocol";
import type { MapData, Facing } from "@termenor/protocol";

const MAP: MapData = { width: 5, height: 5, tiles: new Array(25).fill(0), heights: new Array(25).fill(0) };
const SPAWN = { x: 2, y: 2, facing: "south" as Facing };

test("end-to-end: equip a sword, hit harder; equip armour, take less; persist across relogin", async () => {
  const db = openDb(":memory:");
  await getOrCreateAccount(db, "knight", "pw", SPAWN);

  const w = new GameWorld(MAP, { x: 2, y: 2 });
  w.addPlayer("knight");
  const inv = w.getInventory("knight")!;
  inv.fill(null);
  inv[0] = { item: "bronze_sword", qty: 1 };
  inv[1] = { item: "bronze_platebody", qty: 1 };

  expect(w.equip("knight", 0)).toBe(true);
  expect(w.equip("knight", 1)).toBe(true);
  expect(w.getEquipment("knight")).toEqual({ weapon: "bronze_sword", body: "bronze_platebody", shield: null });

  // persist + relogin
  const saved = w.getPlayerState("knight")!;
  savePlayerState(db, "knight", saved.x, saved.y, saved.facing, saved.inventory!, saved.skills!, saved.bank ?? [], saved.equipment!);
  const reloaded = await getOrCreateAccount(db, "knight", "pw", SPAWN);
  if (!reloaded.ok) throw new Error("reload failed");
  const w2 = new GameWorld(MAP, { x: 2, y: 2 });
  w2.addPlayer("knight", reloaded.state);
  expect(w2.getEquipment("knight")).toEqual({ weapon: "bronze_sword", body: "bronze_platebody", shield: null });
});

test("end-to-end: equipped weapon and armour change combat outcomes", () => {
  const w = new GameWorld(MAP, { x: 2, y: 2 });
  w.rng = () => 0.999; // pin rolls to max
  w.addPlayer("knight");
  w.spawnNpc("rat", 3, 2, 1); // adjacent, maxHit 1
  const inv = w.getInventory("knight")!;
  inv.fill(null);
  inv[0] = { item: "bronze_sword", qty: 1 };
  inv[1] = { item: "bronze_platebody", qty: 1 };
  w.equip("knight", 0); w.equip("knight", 1);

  // (Assert via the combat pass: knight attacks rat -> landed dmg = PLAYER_MAX_HIT + 2;
  //  rat attacks knight -> dmg = max(0, 1 - 2) = 0. Use the same combat-stepping approach
  //  as combat-system.test.ts — set targets, run w.step(dt) enough ticks, inspect hp/hits.)
});
```
(Complete the second test against the real combat-stepping helper used in `combat-system.test.ts`; the comment marks the asserted outcomes.)

- [ ] **Step 2: Run the full gate**

Run: `bun test` → green; `bun run typecheck` → clean; `bun run verify:render` → green.

- [ ] **Step 3: Commit**
```bash
git add packages/server/src/equipment.integration.test.ts
git commit -m "test(server): end-to-end equipment + combat integration"
```

- [ ] **Step 4: Review + merge**
- Run `/review` against the spec (fresh-context reviewer agent). Fix any blocking findings.
- Mark slice 11 done in `docs/ROADMAP.md` + `docs/OPERATING-PROCEDURE.md`; commit.
- Merge to `main` LOCALLY (fast-forward, per operating procedure); push when ready.

---

## Self-Review (plan vs spec)

- Spec §2.1 equip moves item → Unit 3. §2.2 unequip + full-inv refusal → Unit 3 (test) + system. §2.3 non-equippable / swap → Unit 3. §2.4 weapon offense → Unit 1 (stats) + 3 (`playerMaxHit`) + 4 (combat). §2.5 armour defense → Unit 1 + 3 (`playerDefence`) + 4 (combat). §2.6 persistence → Unit 2 + 5 (real save wiring). §2.7 panel + locked keys → Unit 6. §2.8 no regressions → Units 4–7 (full suite + verify:render).
- §3.1 protocol → Unit 1 (note: `BASE_MAX_HIT` realized as existing `PLAYER_MAX_HIT`; no new constant). §3.2 engine → Unit 3. §3.3 wiring → Units 2 (placeholder) + 5. §3.4 client → Unit 6.
- §4 error handling: empty/oob equip no-op; non-equippable notice; occupied-slot swap; unequip-into-full refuse+notice (no loss); `max(0, dmg-defence)`; corrupt JSON → empty equipment (Unit 2). All covered.
- Scope guard: 3 fixed slots; flat damage model; equipment private (no renderer iso changes); NO combat skills / accuracy roll / ranged / magic / prayer. Held.
- Placeholder scan: no TBD/TODO; the two combat-integration tests (Unit 4) and the second integration test (Unit 7) intentionally reference the existing `combat-system.test.ts` rng/stepping harness rather than reprinting it — the implementer must read that file's setup first (flagged inline). Type names consistent: `Equipment`, `EquipSlot`, `EQUIP_SLOTS`, `EQUIPMENT`, `EquipActionMsg`, `EquipmentMsg`, `playerMaxHit`, `playerDefence`, `getEquipment`/`equip`/`unequip`, `setEquipment`/`toggleEquip`/`closeEquip`, `sendEquipAction`, `onEquipAction`, `onEquipment`.

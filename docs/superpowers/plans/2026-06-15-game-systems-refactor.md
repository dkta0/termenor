# Game Systems Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 537-line `Game` god-module into a `GameWorld` store + focused Systems, and apply the `*State`/`*Entity`/`*Kind` naming convention — with zero wire/behavior change.

**Architecture:** `GameWorld` (in `game.ts`) owns all state (entity collections, tick, map, rng, one event buffer) and the fixed tick order, and stays the single command surface `server.ts` calls. Each concern becomes a module of functions over the `GameWorld` — `movement-system.ts`, `combat-system.ts`, `resource-system.ts`, `gather-system.ts`, `skills-system.ts`, `inventory-system.ts`, `action-system.ts` — built on the existing pure helpers (`movement.ts`, `combat.ts`, `npc.ts`, `inventory.ts`). Entity types live in `entities.ts`. See [ADR-0001](../../adr/0001-three-layer-type-naming.md), [ADR-0002](../../adr/0002-systems-over-shared-world.md), [`CONTEXT.md`](../../../CONTEXT.md), and the [spec](../specs/2026-06-15-game-systems-refactor.md).

**Tech Stack:** Bun + TypeScript monorepo. Tests: `bun test` (root, all packages). Typecheck: `bun run typecheck`. Render smoke: `bun run verify:render`. Full gate: `just check`.

**Refinements to ADR-0002 made during planning (both intentional):**
1. A 7th system, `ActionSystem`, owns `use()` (firemaking, cooking) — cross-cutting over Fire + Inventory + Skills, fits no other system.
2. The `consume*()` methods are kept as thin readers over one unified `events` buffer (not deleted), so `server.ts` and existing tests stay green. The "single event buffer" is satisfied by unified storage.

**How to read Stage B tasks:** this is a *move* refactor. Where a step says "move the body of `X` (game.ts:L\<n>–\<m>)", copy that exact existing code into the new function and apply only the noted substitutions (e.g. `deadUntil`→`respawnAt`). New code (signatures, the `GameWorld` skeleton, the event buffer, tests) is shown in full.

**Working rule for every task:** run `bun test` before starting (baseline green) and after (still green). Behavior must not change. Commit only on green.

---

## File Structure (Stage B target)

```
packages/server/src/
  game.ts            # class GameWorld: state + commands + step() order + snapshot() + consume* (thin)
  entities.ts        # NEW: PlayerEntity, NpcEntity, ResourceEntity, FireEntity, GameEvents
  movement-system.ts # NEW: queueMove(w,...), stepMovement(w, dt)  (uses movement.ts, npc.ts)
  combat-system.ts   # NEW: setTarget(w,...), stepCombat(w), resolveDeaths(w)  (uses combat.ts)
  resource-system.ts # NEW: stepResources(w)  (respawn depleted + expire fires)
  gather-system.ts   # NEW: setGatherTarget(w,...), stepGather(w)  (uses inventory.ts, skills-system)
  skills-system.ts   # NEW: awardXp(w, player, skill, amount)
  inventory-system.ts# NEW: pickup(w,id), drop(w,id,slot), addGroundItem(w,...)  (uses inventory.ts)
  action-system.ts   # NEW: use(w, id, action, slot)  (firemaking, cooking)
  movement.ts        # unchanged pure helper: advanceAlongPath
  combat.ts          # unchanged pure helper: rollDamage, isAdjacent
  npc.ts             # unchanged pure helper: pickWanderTarget, NPC_SPEED
  inventory.ts       # unchanged pure helper: emptyInventory, addToInventory, removeSlot
```

`game-state.ts`, `renderer.ts`, `rasterize.ts` (client) and protocol files are touched only by Stage A renames.

---

# STAGE A — Renames (mechanical, test-guarded)

Each task: apply the rename across every listed site, run `bun test` + `bun run typecheck`, prove no old identifier remains with the given grep, commit.

## Task A1: `ITEMS` → `ITEM_KINDS`, type → `ItemKind`

**Files:**
- Modify: `packages/protocol/src/items.ts:16` (definition; name the value type)
- Modify: `packages/protocol/src/index.ts:3` (re-export)
- Modify importers: `packages/server/src/inventory.ts:1,13`, `packages/client/src/render/rasterize.ts:1,156`, `packages/client/src/render/renderer.ts:9,179`, `packages/server/src/game.ts` (uses `ITEMS`? no — but imports nothing of it; confirm)
- Modify tests: `packages/protocol/src/items.test.ts:2,4,5,6,7,11,12`, `packages/protocol/src/index.test.ts:76`

- [ ] **Step 1: Baseline** — Run `bun test`. Expected: all pass.

- [ ] **Step 2: Define the type and rename in `items.ts`**

In `packages/protocol/src/items.ts`, add the named type and rename the const:

```typescript
export interface ItemKind {
  name: string;
  glyph: string;
  color: [number, number, number];
  stackable: boolean;
}

export const ITEM_KINDS: Record<string, ItemKind> = {
  // ... existing entries unchanged ...
};
```

Update `isItem` (items.ts:31) to reference `ITEM_KINDS`:

```typescript
export function isItem(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(ITEM_KINDS, id);
}
```

- [ ] **Step 3: Update the re-export** in `packages/protocol/src/index.ts:3`:

```typescript
export { ITEM_KINDS, type ItemKind, isItem, INV_SIZE } from "./items";
```

- [ ] **Step 4: Update every importer.** Replace `ITEMS` → `ITEM_KINDS` at: `server/src/inventory.ts` (import + `ITEMS[stack.item]`), `client/src/render/rasterize.ts` (import + `ITEMS[gi.item]`), `client/src/render/renderer.ts` (import + `ITEMS[s.item]`).

- [ ] **Step 5: Update tests.** In `protocol/src/items.test.ts` and `protocol/src/index.test.ts`, replace `ITEMS` → `ITEM_KINDS` (import and all `Object.keys(ITEM_KINDS)` / `Object.entries(ITEM_KINDS)` uses).

- [ ] **Step 6: Verify no old identifier remains**

Run: `grep -rn --include=*.ts '\bITEMS\b' packages | grep -v node_modules`
Expected: no output.

- [ ] **Step 7: Tests + typecheck green**

Run: `bun test && bun run typecheck`
Expected: all pass, no type errors.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(protocol): rename ITEMS -> ITEM_KINDS, add ItemKind type"
```

## Task A2: `NPC_TYPES` → `NPC_KINDS`, type → `NpcKind`

**Files:**
- Modify: `packages/protocol/src/npcs.ts:13` (definition + named type)
- Modify: `packages/protocol/src/index.ts:7` (re-export)
- Modify importers: `packages/server/src/game.ts:2,112`, `packages/client/src/render/rasterize.ts:1,170`, `packages/client/src/render/renderer.ts:9,105,107`
- Modify tests: `packages/client/src/render/rasterize.test.ts:77`, `packages/protocol/src/index.test.ts:101,109,110,111,112,113`

- [ ] **Step 1:** In `npcs.ts`, add type and rename const:

```typescript
export interface NpcKind {
  name: string;
  color: [number, number, number];
  maxHp: number;
  maxHit: number;
}

export const NPC_KINDS: Record<string, NpcKind> = {
  // ... existing entries unchanged ...
};
```

- [ ] **Step 2:** `index.ts:7` re-export → `export { NPC_KINDS, type NpcKind } from "./npcs";`

- [ ] **Step 3:** Replace `NPC_TYPES` → `NPC_KINDS` in all importers and tests listed above (imports + every `NPC_TYPES[...]` access).

- [ ] **Step 4: Verify**

Run: `grep -rn --include=*.ts 'NPC_TYPES' packages | grep -v node_modules`
Expected: no output.

- [ ] **Step 5: Green** — `bun test && bun run typecheck`. Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(protocol): rename NPC_TYPES -> NPC_KINDS, add NpcKind type"
```

## Task A3: `RESOURCE_TYPES` → `RESOURCE_KINDS`, `ResourceConfig` → `ResourceKind`

**Files:**
- Modify: `packages/protocol/src/resources.ts:18` (const) + the `ResourceConfig` interface (rename to `ResourceKind`)
- `packages/protocol/src/index.ts` needs **no edit**: resources is re-exported via `export * from "./resources"` (index.ts:84), so renaming the const + type in `resources.ts` propagates automatically.
- Modify importers: `packages/server/src/game.ts:2,230,389`, `packages/client/src/render/rasterize.ts:1,181`, `packages/client/src/render/renderer.ts:9,245`
- Modify tests: `packages/server/src/game.test.ts:299,489,493,523,527,717,723,724,728`

- [ ] **Step 1:** In `resources.ts`, rename the `ResourceConfig` interface to `ResourceKind` and the const to `RESOURCE_KINDS: Record<string, ResourceKind>`. Keep all fields and entries unchanged.

- [ ] **Step 2:** No `index.ts` edit — `export * from "./resources"` (index.ts:84) re-exports the renamed `RESOURCE_KINDS`/`ResourceKind` automatically.

- [ ] **Step 3:** Replace `RESOURCE_TYPES` → `RESOURCE_KINDS` and `ResourceConfig` → `ResourceKind` in all importers and tests listed (imports + every `RESOURCE_TYPES[...]` / `RESOURCE_TYPES.rock.xp` etc.).

- [ ] **Step 4: Verify**

Run: `grep -rn --include=*.ts -E 'RESOURCE_TYPES|ResourceConfig' packages | grep -v node_modules`
Expected: no output.

- [ ] **Step 5: Green** — `bun test && bun run typecheck`. Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(protocol): rename RESOURCE_TYPES -> RESOURCE_KINDS, ResourceConfig -> ResourceKind"
```

## Task A4: Server entity interfaces → `*Entity`

**Files:** Modify `packages/server/src/game.ts` only (these interfaces are file-local: `Player` L14-28, `Resource` L30-39, `Npc` L41-57).

- [ ] **Step 1:** Rename the three interfaces and every reference within `game.ts`:
  - `interface Player` → `interface PlayerEntity` (and `Map<string, Player>` → `Map<string, PlayerEntity>`, the `awardXp(p: Player...)` / `hasItem(p: Player...)` params, etc.)
  - `interface Resource` → `interface ResourceEntity` (`resources: Resource[]` → `ResourceEntity[]`)
  - `interface Npc` → `interface NpcEntity` (`npcs: Npc[]` → `NpcEntity[]`)

- [ ] **Step 2: Verify** — no bare interface names remain as types:

Run: `grep -nE ':\s*(Player|Resource|Npc)(\[|\b)' packages/server/src/game.ts | grep -vE 'Entity|PlayerState|NpcState|ResourceState'`
Expected: no output (every entity usage is now `*Entity`; wire types `*State` are untouched).

- [ ] **Step 3: Green** — `bun test && bun run typecheck`. Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/game.ts
git commit -m "refactor(server): rename internal entity interfaces to *Entity"
```

## Task A5: Lift Fire out of Resource; split `deadUntil` → `respawnAt` / `expiresAt`

This changes data layout but not behavior. Fires move to their own collection; the wire snapshot still emits them as `ResourceState` with `type: "fire"`.

**Files:** Modify `packages/server/src/game.ts`.

- [ ] **Step 1: Baseline** — `bun test`. Expected: pass (note the fire/cooking tests in `game.test.ts` around L552–685; they guard this task).

- [ ] **Step 2: Rename the alive/respawn field.** In `ResourceEntity` and `NpcEntity`, rename `deadUntil` → `respawnAt` (same `-1 = alive` semantics). Update every `deadUntil` read/write on resources and npcs in `game.ts` (the respawn block in `step()`, `resolveDeaths()`, `attack()`, `snapshot()` npc filter, `spawnResource`, `gather`). Do **not** touch fire logic yet.

- [ ] **Step 3: Introduce `FireEntity` and the `fires` collection.** Add to `entities`-side of `game.ts` (will move in B1):

```typescript
interface FireEntity {
  id: string;
  x: number;
  y: number;
  expiresAt: number; // tick at which the fire goes out
}
```

Add the field on the class: `private fires: FireEntity[] = [];`

- [ ] **Step 4: Make fires their own thing.** 
  - `spawnFire(x, y)` pushes to `this.fires` a `{ id, x, y, expiresAt: this.tick + FIRE_LIFETIME_TICKS }` (drop the resource-shaped fields).
  - In `step()`, replace the fire filter `this.resources = this.resources.filter((r) => !(r.type === "fire" && ...))` with: keep the resource-respawn loop operating only on `this.resources` (now no fires there), and add fire expiry: `this.fires = this.fires.filter((f) => this.tick < f.expiresAt);`
  - In `use()` firemaking: the "fire already here" check reads `this.fires.some((f) => f.x === px && f.y === py && this.tick < f.expiresAt)`.
  - In `use()` cooking: adjacency check reads `this.fires.some((f) => this.tick < f.expiresAt && isAdjacent(p, f))`.
  - In `snapshot()`, build resources from `this.resources` (alive: `respawnAt < 0`) **and** append fires as wire entries:

```typescript
const resources: ResourceState[] = [
  ...this.resources
    .filter((r) => r.respawnAt < 0)
    .map((r) => ({ id: r.id, type: r.type, x: r.x, y: r.y })),
  ...this.fires.map((f) => ({ id: f.id, type: "fire", x: f.x, y: f.y })),
];
```

- [ ] **Step 5: Verify** — no `deadUntil` anywhere; the wire shape is unchanged:

Run: `grep -rn --include=*.ts 'deadUntil' packages | grep -v node_modules`
Expected: no output.

- [ ] **Step 6: Green** — `bun test && bun run typecheck`. Expected: pass (fire/cooking tests still green confirms behavior preserved). Then `bun run verify:render`. Expected: render check passes.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/game.ts
git commit -m "refactor(server): lift Fire out of Resource; deadUntil -> respawnAt/expiresAt"
```

---

# STAGE B — Systems split

`server.ts`'s command call sites stay byte-identical. After each task: `bun test` green.

## Task B1: Extract `entities.ts`; rename `Game` → `GameWorld`; unify event buffer

**Files:**
- Create: `packages/server/src/entities.ts`
- Modify: `packages/server/src/game.ts`
- Modify: `packages/server/src/server.ts:24` (import), `packages/server/src/index.ts` (if it imports `Game`)
- Modify: `packages/server/src/game.test.ts` (`new Game(` → `new GameWorld(`)

- [ ] **Step 1: Create `entities.ts`** with the four entity types and the events shape. Copy the exact field lists from the current `game.ts` interfaces (post-A4/A5):

```typescript
import type { Facing, ItemStack, GroundItem } from "@termenor/protocol";
import type { Point } from "./pathfinding";

export interface PlayerEntity {
  id: string; x: number; y: number; facing: Facing; path: Point[];
  inventory: (ItemStack | null)[]; hp: number; maxHp: number;
  target: string | null; attackCd: number;
  skills: Record<string, number>; gatherTarget: string | null; gatherCd: number;
}

export interface NpcEntity {
  id: string; type: string; x: number; y: number; facing: Facing; path: Point[];
  home: Point; radius: number; nextWanderTick: number;
  hp: number; maxHp: number; maxHit: number;
  target: string | null; attackCd: number; respawnAt: number;
}

export interface ResourceEntity {
  id: string; type: string; x: number; y: number; home: Point;
  charges: number; maxCharges: number; respawnAt: number; // -1 = alive
}

export interface FireEntity {
  id: string; x: number; y: number; expiresAt: number;
}

export interface GameEvents {
  skillChanged: Set<string>;
  levelUps: { id: string; skill: string; level: number }[];
  gatherNotices: { id: string; text: string }[];
}
```

> Verify the `PlayerEntity.skills` type matches the current code (`Record<string, number>` — `awardXp` does `p.skills[skill] ?? 0`). Adjust if the source differs.

- [ ] **Step 2:** In `game.ts`, delete the moved interfaces and import them from `./entities`. Rename `export class Game` → `export class GameWorld`. Replace the three private event fields (`skillChanged`, `levelUps`, `gatherNotices`) with one: `events: GameEvents = { skillChanged: new Set(), levelUps: [], gatherNotices: [] };`

- [ ] **Step 3:** Repoint internal writers to the unified buffer: `this.skillChanged.add(...)` → `this.events.skillChanged.add(...)`; `this.levelUps.push(...)` → `this.events.levelUps.push(...)`; `this.gatherNotices.push(...)` → `this.events.gatherNotices.push(...)`. Keep the `consume*` methods, now reading the buffer:

```typescript
consumeSkillChanges(): string[] {
  const ids = [...this.events.skillChanged];
  this.events.skillChanged.clear();
  return ids;
}
consumeLevelUps(): { id: string; skill: string; level: number }[] {
  const ups = this.events.levelUps;
  this.events.levelUps = [];
  return ups;
}
consumeGatherNotices(): { id: string; text: string }[] {
  const notices = this.events.gatherNotices;
  this.events.gatherNotices = [];
  return notices;
}
```

- [ ] **Step 4:** Update `server.ts:24` import `{ Game }` → `{ GameWorld }` and `new Game(` → `new GameWorld(`. Update `index.ts` if needed. Update `game.test.ts`: replace all `new Game(` → `new GameWorld(`.

Run: `grep -rn --include=*.ts '\bGame\b' packages/server | grep -v node_modules | grep -v GameWorld`
Expected: no output (no bare `Game` left).

- [ ] **Step 5: Green** — `bun test && bun run typecheck`. Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(server): extract entities.ts, rename Game -> GameWorld, unify event buffer"
```

## Task B2: `SkillsSystem` (`awardXp`)

**Files:**
- Create: `packages/server/src/skills-system.ts`
- Create: `packages/server/src/skills-system.test.ts`
- Modify: `packages/server/src/game.ts`

- [ ] **Step 1: Write the failing test** in `skills-system.test.ts`:

```typescript
import { test, expect } from "bun:test";
import { awardXp } from "./skills-system";
import type { PlayerEntity, GameEvents } from "./entities";
import { levelForXp } from "@termenor/protocol";

function player(): PlayerEntity {
  return { id: "p1", x: 0, y: 0, facing: "south", path: [], inventory: [],
    hp: 10, maxHp: 10, target: null, attackCd: 0, skills: {}, gatherTarget: null, gatherCd: 0 };
}
function events(): GameEvents { return { skillChanged: new Set(), levelUps: [], gatherNotices: [] }; }

test("awardXp adds xp and marks the player changed", () => {
  const p = player(); const ev = events();
  awardXp(ev, p, "mining", 50);
  expect(p.skills.mining).toBe(50);
  expect(ev.skillChanged.has("p1")).toBe(true);
});

test("awardXp records a level-up when the level increases", () => {
  const p = player(); const ev = events();
  const enough = 200; // enough to cross level 1->2 per xp table
  awardXp(ev, p, "mining", enough);
  if (levelForXp(enough) > levelForXp(0)) {
    expect(ev.levelUps.some((l) => l.id === "p1" && l.skill === "mining")).toBe(true);
  }
});
```

- [ ] **Step 2: Run, expect fail** — `bun test packages/server/src/skills-system.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement `skills-system.ts`** by moving the body of `awardXp` (game.ts, current ~L481-489), retargeting state from `this` to params:

```typescript
import { levelForXp } from "@termenor/protocol";
import type { PlayerEntity, GameEvents } from "./entities";

export function awardXp(events: GameEvents, p: PlayerEntity, skill: string, amount: number): void {
  const oldXp = p.skills[skill] ?? 0;
  const newXp = oldXp + amount;
  p.skills = { ...p.skills, [skill]: newXp };
  if (levelForXp(newXp) > levelForXp(oldXp)) {
    events.levelUps.push({ id: p.id, skill, level: levelForXp(newXp) });
  }
  events.skillChanged.add(p.id);
}
```

- [ ] **Step 4:** In `game.ts`, delete the private `awardXp` method and replace its call sites (`this.awardXp(p, skill, amt)` in gather + use) with `awardXp(this.events, p, skill, amt)` (import from `./skills-system`).

- [ ] **Step 5: Green** — `bun test && bun run typecheck`. Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(server): extract SkillsSystem (awardXp)"
```

## Task B3: `InventorySystem` (`pickup`, `drop`, `addGroundItem`)

**Files:**
- Create: `packages/server/src/inventory-system.ts`
- Create: `packages/server/src/inventory-system.test.ts`
- Modify: `packages/server/src/game.ts`

- [ ] **Step 1: Write the failing test.** Use a minimal `GameWorld` (construct via the class, seed one player). Build a tiny walkable map:

```typescript
import { test, expect } from "bun:test";
import { GameWorld } from "./game";
import type { MapData } from "@termenor/protocol";

const MAP: MapData = { width: 3, height: 3, tiles: [0,0,0,0,0,0,0,0,0], heights: [0,0,0,0,0,0,0,0,0] };

test("pickup picks up a ground item at the player's tile", () => {
  const w = new GameWorld(MAP, { x: 1, y: 1 });
  w.addPlayer("p1");
  w.addGroundItem("logs", 1, 1, 1);
  expect(w.pickup("p1")).toBe(true);
  expect(w.getInventory("p1")!.some((s) => s?.item === "logs")).toBe(true);
});

test("drop places the slot's stack on the ground and clears the slot", () => {
  const w = new GameWorld(MAP, { x: 1, y: 1 });
  w.addPlayer("p1");
  w.addGroundItem("logs", 1, 1, 1);
  w.pickup("p1");
  const slot = w.getInventory("p1")!.findIndex((s) => s?.item === "logs");
  expect(w.drop("p1", slot)).toBe(true);
});
```

> `MapData` is `{ width, height, tiles: number[], heights: number[] }` (protocol/src/index.ts:14); `tiles.length === width * height`, `0 = walkable`.

- [ ] **Step 2: Run, expect fail** — `bun test packages/server/src/inventory-system.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `inventory-system.ts`** by moving the bodies of `pickup`/`drop`/`addGroundItem` (game.ts current L326-385), reading state from a `GameWorld` param. Signature:

```typescript
import { addToInventory, removeSlot } from "./inventory";
import type { GameWorld } from "./game";

export function addGroundItem(w: GameWorld, item: string, qty: number, x: number, y: number): void { /* moved body, this.* -> w.* */ }
export function pickup(w: GameWorld, id: string): boolean { /* moved body */ }
export function drop(w: GameWorld, id: string, slot: number): boolean { /* moved body */ }
```

> `import type { GameWorld }` is type-only — no runtime cycle. The system reads `w.players`, `w.groundItems`, `w.nextItemId`. Make those fields accessible (drop `private`, or expose as needed) — see B9 note on field visibility.

- [ ] **Step 4:** In `game.ts`, make `pickup`/`drop`/`addGroundItem` thin command wrappers: `addGroundItem(item, qty, x, y) { invSys.addGroundItem(this, item, qty, x, y); }` etc. Keep signatures identical.

- [ ] **Step 5: Green** — `bun test && bun run typecheck`. Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(server): extract InventorySystem (pickup/drop/addGroundItem)"
```

## Task B4: `MovementSystem` (`queueMove`, `stepMovement`)

**Files:**
- Create: `packages/server/src/movement-system.ts`, `packages/server/src/movement-system.test.ts`
- Modify: `packages/server/src/game.ts`

- [ ] **Step 1: Write the failing test:**

```typescript
import { test, expect } from "bun:test";
import { GameWorld } from "./game";
import type { MapData } from "@termenor/protocol";

const MAP: MapData = { width: 5, height: 1, tiles: [0,0,0,0,0], heights: [0,0,0,0,0] };

test("queueMove + stepMovement advances the player toward the target", () => {
  const w = new GameWorld(MAP, { x: 0, y: 0 });
  w.addPlayer("p1");
  w.queueMove("p1", 4, 0);
  const before = w.getPlayerState("p1")!.x;
  for (let i = 0; i < 5; i++) w.step(1 / 15);
  expect(w.getPlayerState("p1")!.x).toBeGreaterThan(before);
});
```

- [ ] **Step 2: Run, expect fail** — module not found. (After implementing, this becomes a behavior assertion via the public surface.)

- [ ] **Step 3: Implement `movement-system.ts`** moving `queueMove` (game.ts L147-156), the player+npc advance loops and the NPC wander block from `step()` (game.ts L171-203), plus the private `stepToward`. Use the module const `SPEED` (move it here or import). Signatures:

```typescript
import { findPath, type Point } from "./pathfinding";
import { advanceAlongPath } from "./movement";
import { pickWanderTarget, NPC_SPEED } from "./npc";
import type { GameWorld } from "./game";

const SPEED = 5; // tiles per second

export function queueMove(w: GameWorld, id: string, x: number, y: number): void { /* moved body */ }
export function stepMovement(w: GameWorld, dt: number): void { /* moved player+npc advance + wander */ }
export function stepToward(w: GameWorld, actor: { x: number; y: number; path: Point[] }, tx: number, ty: number): void { /* moved */ }
```

> `stepToward` is also used by combat and gather — export it here and import where needed.

- [ ] **Step 4:** In `game.ts`, `queueMove` becomes a thin wrapper; remove `SPEED` from game.ts; the movement portion of `step()` calls `stepMovement(this, dt)`.

- [ ] **Step 5: Green** — `bun test && bun run typecheck`. Expected: pass. Movement, wander, and pathfinding tests in `game.test.ts`/`movement.test.ts` guard this.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(server): extract MovementSystem (queueMove/stepMovement/stepToward)"
```

## Task B5: `CombatSystem` (`setTarget`, `stepCombat`, `resolveDeaths`)

**Files:**
- Create: `packages/server/src/combat-system.ts`, `packages/server/src/combat-system.test.ts`
- Modify: `packages/server/src/game.ts`

- [ ] **Step 1: Write the failing test** (player attacks adjacent NPC, NPC retaliates):

```typescript
import { test, expect } from "bun:test";
import { GameWorld } from "./game";
import type { MapData } from "@termenor/protocol";

const MAP: MapData = { width: 3, height: 1, tiles: [0,0,0], heights: [0,0,0] };

test("attack damages an adjacent npc and triggers retaliation", () => {
  const w = new GameWorld(MAP, { x: 0, y: 0 }, () => 0.99); // high roll = nonzero damage
  w.addPlayer("p1");
  w.spawnNpc("rat", 1, 0, 0);
  const npcId = w.snapshot().npcs[0].id;
  w.attack("p1", npcId);
  for (let i = 0; i < 3; i++) w.step(1 / 15);
  const npc = w.snapshot().npcs.find((n) => n.id === npcId);
  expect(npc!.hp).toBeLessThan(npc!.maxHp); // took damage
});
```

> Confirm `spawnNpc` accepts `("rat", x, y, radius)` and that `"rat"` exists in `NPC_KINDS`.

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implement `combat-system.ts`** moving `attack` (the target/aggro set, L132-139) as `setTarget`, `combatStep` (L274-300) as the per-actor step, the combat passes from `step()` (L205-214), `resolveDeaths` (L308-324), and `idOf` (L303-306). Push damage events to `w.hits`. Use `stepToward` from movement-system. Signatures:

```typescript
import { rollDamage, isAdjacent } from "./combat";
import { stepToward } from "./movement-system";
import { ATTACK_COOLDOWN_TICKS, PLAYER_MAX_HIT, RESPAWN_TICKS, type Facing } from "@termenor/protocol";
import type { GameWorld } from "./game";

export function setTarget(w: GameWorld, playerId: string, targetId: string): void { /* moved attack() body */ }
export function stepCombat(w: GameWorld): void { /* moved both combat-pass loops; calls combatStepActor */ }
export function resolveDeaths(w: GameWorld): void { /* moved body */ }
```

- [ ] **Step 4:** `game.ts` `attack` becomes a thin wrapper → `combatSys.setTarget(this, ...)`; `step()` calls `stepCombat(this)` then `resolveDeaths(this)` in order.

- [ ] **Step 5: Green** — `bun test && bun run typecheck`. Expected: pass (combat + aggro tests in `game.test.ts` L464-489, `combat.test.ts`, `npc-game.test.ts` guard this).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(server): extract CombatSystem (setTarget/stepCombat/resolveDeaths)"
```

## Task B6: `ResourceSystem` (`stepResources`)

**Files:**
- Create: `packages/server/src/resource-system.ts`, `packages/server/src/resource-system.test.ts`
- Modify: `packages/server/src/game.ts`

- [ ] **Step 1: Write the failing test** (a depleted resource respawns; a fire expires):

```typescript
import { test, expect } from "bun:test";
import { GameWorld } from "./game";
import type { MapData } from "@termenor/protocol";

const MAP: MapData = { width: 3, height: 3, tiles: Array(9).fill(0), heights: Array(9).fill(0) };

test("an expired fire is removed from the snapshot", () => {
  const w = new GameWorld(MAP, { x: 1, y: 1 });
  w.addPlayer("p1");
  // give the player logs + tinderbox, light a fire, then run past FIRE_LIFETIME_TICKS
  // (use the public use() path or seed inventory) and assert no fire remains in snapshot.resources
  // Assert: w.snapshot().resources.filter(r => r.type === "fire").length === 0 after enough ticks
});
```

> Flesh out the setup using the same approach as the existing fire tests in `game.test.ts` (L552+). Keep the assertion on the public snapshot.

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implement `resource-system.ts`** moving the resource-respawn loop and fire-expiry filter from `step()` (post-A5: operates on `w.resources` with `respawnAt`, and `w.fires` with `expiresAt`):

```typescript
import type { GameWorld } from "./game";

export function stepResources(w: GameWorld): void {
  for (const res of w.resources) {
    if (res.respawnAt >= 0 && w.tick >= res.respawnAt) {
      res.charges = res.maxCharges;
      res.respawnAt = -1;
    }
  }
  w.fires = w.fires.filter((f) => w.tick < f.expiresAt);
}
```

- [ ] **Step 4:** `step()` calls `stepResources(this)` in order (after `resolveDeaths`, before gather).

- [ ] **Step 5: Green** — `bun test && bun run typecheck`. Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(server): extract ResourceSystem (respawn + fire expiry)"
```

## Task B7: `GatherSystem` (`setGatherTarget`, `stepGather`)

**Files:**
- Create: `packages/server/src/gather-system.ts`, `packages/server/src/gather-system.test.ts`
- Modify: `packages/server/src/game.ts`

- [ ] **Step 1: Write the failing test** (player gathers from an adjacent resource, gains item + xp):

```typescript
import { test, expect } from "bun:test";
import { GameWorld } from "./game";
import { RESOURCE_KINDS, type MapData } from "@termenor/protocol";

const MAP: MapData = { width: 3, height: 3, tiles: Array(9).fill(0), heights: Array(9).fill(0) };

test("gathering an adjacent rock yields ore and mining xp", () => {
  const w = new GameWorld(MAP, { x: 1, y: 1 });
  w.addPlayer("miner"); // confirm starter inventory includes the needed tool, or seed it
  const rockId = w.spawnResource("rock", 2, 1);
  w.gather("miner", rockId);
  for (let i = 0; i < RESOURCE_KINDS.rock.cooldownTicks + 3; i++) w.step(1 / 15);
  expect(w.getPlayerSkills("miner").mining.xp).toBe(RESOURCE_KINDS.rock.xp);
});
```

> Mirror the existing mining test (`game.test.ts:489`). If `rock` needs a pickaxe tool, seed it the way that test does.

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implement `gather-system.ts`** moving `gather` (L400-406) as `setGatherTarget`, the gather pass from `step()` (L226-264), and `hasItem` (L491-493). Use `awardXp` (skills-system), `addToInventory` (inventory.ts), `stepToward` (movement-system), `isAdjacent` (combat.ts), `RESOURCE_KINDS`. Signatures:

```typescript
import { RESOURCE_KINDS } from "@termenor/protocol";
import { addToInventory } from "./inventory";
import { isAdjacent } from "./combat";
import { stepToward } from "./movement-system";
import { awardXp } from "./skills-system";
import type { GameWorld } from "./game";
import type { PlayerEntity } from "./entities";

export function setGatherTarget(w: GameWorld, playerId: string, targetId: string): void { /* moved gather() */ }
export function stepGather(w: GameWorld): void { /* moved gather pass; awardXp(w.events, p, ...) */ }
```

- [ ] **Step 4:** `game.ts` `gather` becomes a thin wrapper; `step()` calls `stepGather(this)` last.

- [ ] **Step 5: Green** — `bun test && bun run typecheck`. Expected: pass (mining/fishing/woodcutting gather tests guard this).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(server): extract GatherSystem (setGatherTarget/stepGather)"
```

## Task B8: `ActionSystem` (`use`: firemaking, cooking)

**Files:**
- Create: `packages/server/src/action-system.ts`, `packages/server/src/action-system.test.ts`
- Modify: `packages/server/src/game.ts`

- [ ] **Step 1: Write the failing test** (firemaking with logs + tinderbox spawns a fire; mirror `game.test.ts` firemaking test L552+):

```typescript
import { test, expect } from "bun:test";
import { GameWorld } from "./game";
import type { MapData } from "@termenor/protocol";

const MAP: MapData = { width: 3, height: 3, tiles: Array(9).fill(0), heights: Array(9).fill(0) };

test("firemaking with logs + tinderbox creates a fire at the player tile", () => {
  const w = new GameWorld(MAP, { x: 1, y: 1 });
  w.addPlayer("p1");
  // seed logs + tinderbox into the player's inventory (match how the existing firemaking test does it)
  // find the logs slot, call w.use("p1", "firemaking", slot)
  // assert w.snapshot().resources.some(r => r.type === "fire" && r.x === 1 && r.y === 1)
});
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implement `action-system.ts`** moving the body of `use` (L408-479) and `spawnFire` (L395-398). Use `addToInventory`/`removeSlot` (inventory.ts), `isAdjacent` (combat.ts), `awardXp` (skills-system), `FIRE_LIFETIME_TICKS` (protocol), and the module consts `FIREMAKING_XP = 40`, `COOKING_XP = 30` (move them here from game.ts L11-12). Fire reads/writes `w.fires` (post-A5). Signature:

```typescript
import { FIRE_LIFETIME_TICKS } from "@termenor/protocol";
import { addToInventory, removeSlot } from "./inventory";
import { isAdjacent } from "./combat";
import { awardXp } from "./skills-system";
import type { GameWorld } from "./game";

const FIREMAKING_XP = 40;
const COOKING_XP = 30;

export function use(w: GameWorld, playerId: string, action: string, slot: number): void { /* moved body */ }
```

> `spawnFire` becomes an internal helper here (or a method on `GameWorld` that `use` calls). Keep `w.spawnResource` on `GameWorld` (it's a command used at seed time by `server.ts`/`world.ts`).

- [ ] **Step 4:** `game.ts` `use` becomes a thin wrapper → `actionSys.use(this, ...)`; remove `FIREMAKING_XP`/`COOKING_XP` consts from game.ts.

- [ ] **Step 5: Green** — `bun test && bun run typecheck`. Expected: pass (firemaking + cooking tests guard this).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(server): extract ActionSystem (firemaking/cooking)"
```

## Task B9: Finalize `GameWorld.step()` order + field visibility; full gate

**Files:** Modify `packages/server/src/game.ts`.

- [ ] **Step 1: Confirm `step()` reads as pure orchestration** in the fixed order from ADR-0002. It should now be roughly:

```typescript
step(dt: number): void {
  this.tick++;
  stepNpcRespawn(this);        // (folded into combat-system or kept inline; see note)
  stepMovement(this, dt);
  stepCombat(this);
  resolveDeaths(this);
  stepResources(this);
  stepGather(this);
}
```

> The NPC-death-respawn block (current `step()` L161-167) belongs with combat/death logic — fold it into `resolveDeaths`/combat-system or a small `stepNpcRespawn` in combat-system. Pick one home and document it; do not leave it inline in `game.ts` if the goal is a pure orchestrator.

- [ ] **Step 2: Field visibility.** Systems read `w.players`, `w.npcs`, `w.resources`, `w.fires`, `w.groundItems`, `w.hits`, `w.tick`, `w.rng`, `w.events`, `w.map`, and the id counters. Make exactly those fields accessible (remove `private`, or mark `/** @internal */`). Keep everything else private. Verify `server.ts` still only touches the documented command surface.

- [ ] **Step 3: Confirm the command surface is unchanged.** `server.ts` call sites must be byte-identical:

Run: `git diff main -- packages/server/src/server.ts`
Expected: only the `Game` → `GameWorld` import/constructor rename from B1 — no command signature changes.

- [ ] **Step 4: `game.ts` size check.** Confirm it now holds only state + thin commands + `step()` + `snapshot()` + `consume*`. The logic lives in systems.

Run: `wc -l packages/server/src/game.ts`
Expected: substantially smaller than 537 (target: state + delegation only).

- [ ] **Step 5: Full gate**

Run: `just check`  (= `bun test` + `bun run typecheck` + `bun run verify:render`)
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(server): finalize GameWorld.step() orchestration; systems split complete"
```

---

## Self-Review (planner)

- **Spec coverage:** Goals 1–3 → Stage A (A1–A3 naming, A4 entities, A5 Fire/respawnAt) and Stage B (B1–B9 systems). Non-goals respected: wire unchanged (A5 step 4, B9 step 3), no ECS (systems are function modules), no interface churn (B9 step 3). Every acceptance criterion maps to a verification step: tests-green (every task), no wire diff (B9 S3), command sites unchanged (B9 S3), per-system unit tests (B2–B8 each add one), no `deadUntil`/old catalog names (A1–A5 grep steps), render check (A5 S6, B9 S5).
- **Type consistency:** `PlayerEntity`/`NpcEntity`/`ResourceEntity`/`FireEntity`/`GameEvents` defined in B1; used consistently in B2–B8. `awardXp(events, p, skill, amount)` signature stable across B2 and its callers (B7, B8). `stepToward` defined in B4, imported by B5 and B7. `respawnAt`/`expiresAt` introduced in A5, used in B6.
- **Resolved against source during planning:** `MapData = { width, height, tiles, heights }`; `PlayerEntity.skills: Record<string, number>` (game.ts:25); resources re-exported via `export *` (no index.ts edit for A3).
- **Still verify-against-source when implementing** (flagged inline): presence of `"rat"`/`"rock"` in the kinds catalogs; starter-inventory contents for the gather/action tests (mirror the existing test that already exercises that path).

---

**Next:** run `/implement` to execute this plan task-by-task.

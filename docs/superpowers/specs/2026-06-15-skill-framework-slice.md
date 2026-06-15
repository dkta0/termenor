# Termenor — Vertical Slice 9: Skill framework (mining, fishing, cooking, firemaking)

Status: **spec** · Branch: `feat/skill-framework` · Date: 2026-06-15

## 1. Goal

Generalize the slice-8 woodcutting engine into a **data-driven skill framework**, then author
four more skills on top of it with (almost) no new engine code:

- **Gathering skills** (reuse the gather pass): **mining** (rock node → ore, needs pickaxe),
  **fishing** (fishing spot → raw fish, needs a net — but the spot does not deplete/respawn the
  same way; treat it as an infinite node, see §3).
- **Processing skills** (new "use" interaction): **firemaking** (logs + tinderbox → a temporary
  fire, XP), **cooking** (raw fish + a fire/range → cooked fish, XP).

"Done" = woodcutting still works unchanged; you can mine a rock for ore, fish a spot for raw fish,
light logs into a fire with a tinderbox, and cook raw fish on a fire — each grants the right
skill's XP and respects its tool/ingredient requirement; all four skills show in the HUD and
persist. The engine is generic: adding a gathering resource or a recipe is a data edit.

### Non-goals
- No smithing/smelting (ore→bar) — that's beyond these four skills; ore is a terminal item this slice.
- No new map regions, no skill capes, no XP-boost items, no tool tiers (one tool per skill).
- No banking (slice 10). Full inventory stops gathering/processing with feedback (existing pattern).
- Don't rebuild combat. Reuse `stepToward`, the per-tick passes, and the notice/skill-change buffers.

## 2. Success criteria (concrete & checkable)
1. **Generalized resource data (tested).** `RESOURCE_TYPES` entries carry combat-free gather
   config: `{ name; color; skill; tool: string|null; yield: string; xp: number; charges: number;
   respawnTicks: number; cooldownTicks: number; infinite?: boolean }`. `tree` is migrated into this
   table (woodcutting unchanged in behavior). `rock` (mining→`copper_ore`, pickaxe) and
   `fishing_spot` (fishing→`raw_shrimp`, small_net, `infinite:true`) added. Items added:
   `bronze_pickaxe`, `small_net`, `tinderbox`, `copper_ore`, `raw_shrimp`, `cooked_shrimp`, `fire`?(no
   — fire is an entity, not an item). XP-per-yield + level math reuse `skills.ts`.
2. **Generic gather pass (tested, deterministic).** The slice-8 gather pass becomes data-driven:
   on a chop/mine/fish tick it looks up the node's `RESOURCE_TYPES` config for `skill/tool/yield/
   xp/cooldown`, checks the configured tool (null = no tool needed), adds `yield` to inventory,
   grants `xp` to `config.skill`, and (unless `infinite`) decrements charges / depletes+respawns.
   `gather` works for any resource type. Tests: mining yields ore + Mining xp; fishing yields raw
   fish + Fishing xp and never depletes (infinite); wrong/missing tool refused with feedback;
   woodcutting behavior unchanged.
3. **Processing actions (new, tested).** A `UseMsg {t:"use"; action:"firemaking"|"cooking";
   slot:number}` (client→server) drives inventory-based processing:
   - **Firemaking:** `use` with `action:"firemaking"` on a `logs` slot, requires a `tinderbox` in
     inventory and the player's tile to be free of an existing fire → consumes one `logs`, spawns a
     **fire** entity at the player's tile (a resource-like entity with a `deadUntil` lifetime, e.g.
     `FIRE_LIFETIME_TICKS`), grants Firemaking xp. Fires appear in the snapshot (as resources of
     type `fire`) and vanish when expired.
   - **Cooking:** `use` with `action:"cooking"` on a `raw_shrimp` slot, requires the player to be
     adjacent to a live `fire` → consumes one `raw_shrimp`, adds one `cooked_shrimp`, grants Cooking
     xp. (Deterministic: no burn chance this slice — always succeeds.)
   - Tested: firemaking consumes logs + needs tinderbox + creates a fire + xp; cooking needs an
     adjacent fire + consumes raw + yields cooked + xp; missing requirement → refused + feedback.
4. **Skills delivery + persistence unchanged in shape.** All five skills (woodcutting, mining,
   fishing, firemaking, cooking) flow through the existing `SkillsMsg` + skills JSON column.
   `getPlayerSkills` returns every known skill (default xp 0) so the HUD lists them.
5. **Snapshot.** `resources` now includes rocks, fishing spots, and active fires (all as
   `ResourceState{id,type,x,y}`); depleted/expired excluded. Fishing spots are always present.
6. **Client.** Render rock / fishing-spot / fire billboards (colors from `RESOURCE_TYPES`/a fire
   color). The skills HUD lists all five skills (compact). Inputs: keep `c` = gather nearest
   resource (works for tree/rock/spot — picks nearest of ANY gatherable type). Add `f` = firemaking
   on the first `logs` slot; `k` = cooking the first `raw_shrimp` slot (chat-gated). Feedback
   (needs-tool / needs-fire / inventory-full / level-up) via the existing chat notices.
7. **Starter kit + world.** Seed near spawn: a `rock` and a `fishing_spot` node; ground items for
   `bronze_pickaxe`, `small_net`, `tinderbox`, and a few `logs`/`raw_shrimp` so all four skills are
   reachable immediately.
8. **No regressions.** Full `bun test` green, `bun run typecheck` clean, `verify:render` green.

## 3. Architecture

### 3.1 Protocol
- `resources.ts`: extend `RESOURCE_TYPES` entry shape (see §2.1). Add `tree`(migrated), `rock`,
  `fishing_spot`, `fire`. Add consts `FIRE_LIFETIME_TICKS` (~150). Keep `RESOURCE_RESPAWN_TICKS`/
  `TREE_CHARGES` or fold into per-type config (prefer per-type `respawnTicks`/`charges`).
- `skills.ts`: keep the XP curve. Add a `SKILLS: readonly string[]` list
  `["woodcutting","mining","fishing","firemaking","cooking"]` and replace the single
  `WOODCUTTING_XP_PER_LOG` usage with per-resource `xp` (keep the const if still referenced, but the
  engine reads xp from `RESOURCE_TYPES`).
- `items.ts`: add `bronze_pickaxe`, `small_net`, `tinderbox`, `copper_ore`, `raw_shrimp`,
  `cooked_shrimp` (sensible glyph/color/stackable; ores/fish stackable, tools not).
- `index.ts`: add `UseMsg {t:"use";action:string;slot:number}` → `ClientMsg`/`CLIENT_TYPES`.
  `SnapshotMsg.resources` already exists. Round-trip test the new msg + a snapshot with rock/fire.

### 3.2 Server (`game.ts`)
- `Resource` gains optional `charges`/`maxCharges` handling for `infinite` types (skip depletion).
  Fires are resources of type `fire` with `deadUntil = tick + FIRE_LIFETIME_TICKS` set at creation
  and excluded from snapshot once expired; they do NOT respawn (one-shot — when expired, remove from
  the array). Keep `spawnResource(type,x,y)` reading config from `RESOURCE_TYPES`.
- **Gather pass** generalized: replace hardcoded axe/logs/woodcutting with `cfg =
  RESOURCE_TYPES[res.type]`; tool check uses `cfg.tool` (null ⇒ skip); yield `cfg.yield`; xp to
  `cfg.skill`; cooldown `cfg.cooldownTicks`; if `!cfg.infinite` decrement charges + deplete/respawn
  with `cfg.respawnTicks`. Level-up detection unchanged (per `cfg.skill`).
- **Use action** (new): `use(playerId, action, slot)`:
  - `firemaking`: slot holds `logs`, inventory has `tinderbox`, no live fire on the player's tile →
    remove one log (via `removeSlot`/decrement), `spawnFire(px,py)` (a `fire` resource with
    lifetime), grant `firemaking` xp; else push a notice.
  - `cooking`: slot holds `raw_shrimp`, a live `fire` is adjacent (`isAdjacent`) → decrement one
    `raw_shrimp`, `addToInventory(cooked_shrimp,1)` (room check), grant `cooking` xp; else notice.
  - Reuse `skillChanged`/`levelUps`/`gatherNotices`. Add a helper to award xp + detect level-up so
    gather and use share it (DRY: `private awardXp(p, skill, amount)`).
- `step`: existing resource respawn loop now also removes expired one-shot fires. Gather pass
  unchanged structurally (now generic). No new pass needed for `use` (it's request-driven).
- `getPlayerSkills`: return all `SKILLS` (default xp 0).

### 3.3 Server wiring (`server.ts`, `world.ts`)
- `server.ts`: handle `use` → `game.use(username, msg.action, msg.slot)`. Skills/notice delivery
  unchanged (already generic).
- `world.ts`: add `RESOURCE_SPAWNS` entries for a `rock` and a `fishing_spot` near spawn; add
  ground `SEED_ITEMS` for `bronze_pickaxe`, `small_net`, `tinderbox`, `logs` x5, `raw_shrimp` x3.

### 3.4 Client
- `connection.ts`: `sendUse(action, slot)`.
- `render`: draw billboards for `rock`/`fishing_spot`/`fire` (colors from `RESOURCE_TYPES`; fire a
  bright orange). HUD lists all five skills via `skillsLines()` (or a multi-line `skillsLine`).
- `renderer.ts`: `c` gathers nearest gatherable resource (tree/rock/spot — exclude `fire` from the
  gather pick). `f` → `onUse("firemaking", firstSlotOf("logs"))`; `k` → `onUse("cooking",
  firstSlotOf("raw_shrimp"))`. Add `onUse?(action,slot)` hook. Gate while chatting.
- `index.ts`: wire `onUse`.
- `game-state.ts`: a helper to find the first inventory slot holding a given item (for f/k keys),
  and `skillsLines()` for the HUD.

## 4. Error handling
- `use` with an out-of-range/empty slot, wrong item in slot, or missing tool/fire/ingredient →
  no-op + a one-time notice; never throws. `gather` on a depleted/expired node → ignored.
- Firemaking on a tile that already has a live fire → refused (no stacking fires). Cooking with no
  adjacent fire → refused. Inventory full for the yield (ore/cooked/fire-less) → refused, ingredient
  NOT consumed. Expired fire removed exactly once (no double-free). Unknown resource type / unknown
  action → ignored. xp ≥ 0, level ≤ MAX_LEVEL (structural, as slice 8).

## 5. Testing
- **Unit:** protocol round-trip (UseMsg, snapshot with rock+fire); `RESOURCE_TYPES` has the new
  entries with required fields.
- **Server (seeded rng):** mining yields ore + Mining xp + depletes/respawns; fishing yields raw
  fish + Fishing xp + never depletes; wrong-tool refused; woodcutting still works (regression).
  Firemaking: needs tinderbox, consumes a log, creates a fire entity present in snapshot, grants xp,
  fire expires after FIRE_LIFETIME_TICKS and is removed; refused on an occupied tile. Cooking: needs
  adjacent fire, consumes raw + yields cooked + xp; refused with no fire. `getPlayerSkills` lists all
  five. Persistence round-trip of multi-skill xp.
- **Client:** resources of new types stored/sampled; `skillsLines()` lists all five; first-slot
  finder; nearest-gatherable pick excludes fire.
- **Visual/PTY:** `verify:render` green; assert a rock or fire renders if practical.

## 6. Sequencing (for `/plan`)
1. Protocol: generalize `RESOURCE_TYPES` (+ migrate tree), add rock/fishing_spot/fire + items +
   `SKILLS` list + `UseMsg` + consts; round-trip tests. 2. Game: generalize the gather pass to read
   config; `awardXp` helper (DRY); fire one-shot lifetime; `use()` for firemaking + cooking; tests
   (incl. woodcutting regression). 3. Server wiring (`use` handler) + world spawns/seeds. 4. Client:
   sendUse, new billboards, multi-skill HUD, `c`/`f`/`k` inputs + `onUse`, first-slot finder. 5.
   Integration test (mine→ore, fish→raw, firemake→fire, cook→cooked) + render verify. 6. Review.

**Risk / scope guard:** four skills is a lot — keep each skill a *data edit + a tiny branch*, not a
new subsystem. The only genuinely new mechanic is the `use` processing action (firemaking/cooking);
mining/fishing are pure data on the existing gather pass. Resist adding burn chance, ore tiers, or
smelting (out of scope). Keep randomness on the injected rng; deterministic success this slice.

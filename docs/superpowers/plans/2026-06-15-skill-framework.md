# Skill Framework (Slice 9) Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. TDD each unit; commit per unit; `bun test` green + `bun run typecheck` clean before moving on.

**Goal:** Generalize the woodcutting gather engine into a data-driven skill framework, then add mining + fishing (data on the gather pass) and firemaking + cooking (a new inventory "use" action).

**Architecture:** `RESOURCE_TYPES` becomes the config table the gather pass reads (skill/tool/yield/xp/charges/respawn/cooldown/infinite). Fires are one-shot resource entities with a lifetime. A `use()` request-driven action handles firemaking/cooking. XP-award + level-up detection is factored into one `awardXp` helper shared by gather and use.

**Tech Stack:** TypeScript, Bun, monorepo `@termenor/protocol`/server/client.

Spec: `docs/superpowers/specs/2026-06-15-skill-framework-slice.md`. Branch: `feat/skill-framework`.

Verified current state to generalize (post-woodcutting):
- `resources.ts`: `RESOURCE_TYPES = { tree: {name, color} }`, `RESOURCE_RESPAWN_TICKS=90`, `TREE_CHARGES=5`.
- `game.ts`: `GATHER_COOLDOWN_TICKS=30`; gather pass (lines ~222-258) hardcodes `hasAxe`, `WOODCUTTING_XP_PER_LOG`, `"woodcutting"`, `TREE_CHARGES`, `RESOURCE_RESPAWN_TICKS`; inline level-up detection via `levelForXp(new) > levelForXp(old)` pushing to `this.levelUps` + `this.skillChanged`. `spawnResource(type,x,y)` uses `TREE_CHARGES`. `Resource {id;type;x;y;home;charges;maxCharges;deadUntil}`. Buffers: `skillChanged:Set`, `levelUps[]`, `gatherNotices[]` with `consume*` methods. `getPlayerSkills` hardcodes woodcutting then loops other skills.
- Inventory helpers (`./inventory`): `emptyInventory`, `addToInventory(slots,{item,qty})=>{slots,leftover}` (leftover===null ⇒ added), `removeSlot(slots,i)=>{slots,removed}`.

---

## Unit 1 — Protocol: generalize RESOURCE_TYPES, add types/items, UseMsg, SKILLS

**Files:** modify `resources.ts`, `skills.ts`, `items.ts`, `index.ts`; tests `resources` (add to an existing or new test), `index.test.ts`, `skills.test.ts`.

1. `resources.ts` — new entry shape + entries:
```typescript
export interface ResourceState { id: string; type: string; x: number; y: number; }

export interface ResourceConfig {
  name: string;
  color: [number, number, number];
  skill: string;
  tool: string | null;      // required inventory item, or null
  yield: string;            // item id produced (ignored for fire)
  xp: number;               // xp per success
  charges: number;          // uses before depletion (ignored if infinite)
  respawnTicks: number;     // ticks to respawn after depletion (ignored if infinite)
  cooldownTicks: number;    // ticks between successes
  infinite?: boolean;       // never depletes (fishing spot)
  lifetimeTicks?: number;   // one-shot entities (fire): auto-remove after this many ticks
  gatherable?: boolean;     // can be targeted by the gather pass / 'c' key (false for fire)
}

export const RESOURCE_TYPES: Record<string, ResourceConfig> = {
  tree:         { name: "Tree",         color: [40, 120, 40],  skill: "woodcutting", tool: "bronze_axe",     yield: "logs",       xp: 25, charges: 5, respawnTicks: 90, cooldownTicks: 30, gatherable: true },
  rock:         { name: "Rock",         color: [120, 120, 130], skill: "mining",      tool: "bronze_pickaxe", yield: "copper_ore", xp: 18, charges: 4, respawnTicks: 120, cooldownTicks: 30, gatherable: true },
  fishing_spot: { name: "Fishing spot", color: [60, 120, 200],  skill: "fishing",     tool: "small_net",      yield: "raw_shrimp", xp: 10, charges: 0, respawnTicks: 0, cooldownTicks: 35, infinite: true, gatherable: true },
  fire:         { name: "Fire",         color: [240, 140, 30],  skill: "firemaking",  tool: null,             yield: "",           xp: 0,  charges: 0, respawnTicks: 0, cooldownTicks: 0, lifetimeTicks: 150, gatherable: false },
};

export const FIRE_LIFETIME_TICKS = 150;
// keep RESOURCE_RESPAWN_TICKS / TREE_CHARGES exports for back-compat if anything still imports them, but the engine now reads per-type config.
export const RESOURCE_RESPAWN_TICKS = 90;
export const TREE_CHARGES = 5;
```
2. `skills.ts` — add `export const SKILLS = ["woodcutting","mining","fishing","firemaking","cooking"] as const;`. Keep `WOODCUTTING_XP_PER_LOG` (back-compat). Add a `skills.test.ts` assertion that `SKILLS` includes all five.
3. `items.ts` — add: `bronze_pickaxe {glyph:"P",color:[140,110,80],stackable:false}`, `small_net {glyph:"n",color:[160,160,160],stackable:false}`, `tinderbox {glyph:"%",color:[180,90,40],stackable:false}`, `copper_ore {glyph:"o",color:[180,110,70],stackable:true}`, `raw_shrimp {glyph:"r",color:[255,150,120],stackable:true}`, `cooked_shrimp {glyph:"s",color:[255,120,90],stackable:true}` (pick names; keep style consistent with existing entries).
4. `index.ts` — add `export interface UseMsg { t:"use"; action:string; slot:number }` to `ClientMsg` + `CLIENT_TYPES` ("use"). `export * from` already re-exports resources/skills. 
5. `index.test.ts` — round-trip `UseMsg`; round-trip a snapshot with `resources:[{id:"r1",type:"rock",x:2,y:2},{id:"f1",type:"fire",x:3,y:3}]`.
6. Verify `bun test packages/protocol/src/` green; protocol typechecks clean (server/client will error where they read TREE_CHARGES etc. — expected). Commit: `feat(protocol): data-driven RESOURCE_TYPES, mining/fishing/fire, tools+items, UseMsg, SKILLS`.

---

## Unit 2 — Game engine: generic gather pass, awardXp, fire lifetime, use()

**Files:** modify `game.ts`; test `game.test.ts`.

TDD — add tests first (10x10 open map, seeded rng). Imports: `RESOURCE_TYPES, FIRE_LIFETIME_TICKS, SKILLS, levelForXp` from protocol.

Tests to add:
- **mining:** player adjacent to `spawnResource("rock", x, y)`, give a `bronze_pickaxe` (seed via a restored inventory or addGroundItem+pickup), `gather`, step → inventory gains `copper_ore`, `getPlayerSkills().mining.xp === RESOURCE_TYPES.rock.xp`; depletes after `rock.charges` and respawns after `rock.respawnTicks`.
- **fishing (infinite):** adjacent to `fishing_spot` with a `small_net`, gather + many chops → keeps yielding `raw_shrimp`, Fishing xp accrues, and the spot is NEVER absent from `snapshot().resources`.
- **wrong/missing tool:** gathering a rock without a pickaxe → no ore, target cleared, a notice.
- **woodcutting regression:** the existing tree tests still pass unchanged.
- **firemaking:** player with `logs` + `tinderbox` in inventory, `use(id,"firemaking",logsSlot)` → one `logs` consumed, a `fire` resource appears in `snapshot().resources` at the player's tile, `getPlayerSkills().firemaking.xp > 0`; calling firemaking again on the SAME tile (fire still live) is refused (notice, no second fire). After `FIRE_LIFETIME_TICKS` steps the fire is gone from the snapshot.
- **firemaking needs tinderbox:** without a tinderbox → refused, log not consumed.
- **cooking:** player adjacent to a live `fire` with `raw_shrimp`, `use(id,"cooking",rawSlot)` → one `raw_shrimp` → one `cooked_shrimp`, `getPlayerSkills().cooking.xp > 0`. With no adjacent fire → refused, raw not consumed.
- **getPlayerSkills lists all five** SKILLS with default xp 0.

Implementation:
1. `awardXp(p, skill, amount)` helper (DRY): `const oldXp = p.skills[skill] ?? 0; const newXp = oldXp + amount; p.skills[skill] = newXp; if (levelForXp(newXp) > levelForXp(oldXp)) this.levelUps.push({id:p.id, skill, level: levelForXp(newXp)}); this.skillChanged.add(p.id);`.
2. `spawnResource(type,x,y)`: read `const cfg = RESOURCE_TYPES[type]; const charges = cfg?.charges ?? 0;` set `charges`/`maxCharges` from cfg; `deadUntil: -1`. Add `private spawnFire(x,y): void` pushing a `fire` resource with `deadUntil = this.tick + FIRE_LIFETIME_TICKS` (one-shot — see step removal).
3. Generalize the gather pass: replace the hardcoded block with:
   - `const cfg = RESOURCE_TYPES[res.type]; if (!cfg || !cfg.gatherable) { p.gatherTarget = null; continue; }`
   - tool: `if (cfg.tool && !this.hasItem(p, cfg.tool)) { clear + notice \`You need a \${ITEMS?...}/tool to ...\` }` — use a generic notice like `You need the right tool.` or look up the tool's name.
   - room: `addToInventory(p.inventory, {item: cfg.yield, qty: 1})`; if `leftover !== null` → clear + "inventory full" notice; else keep `slots`.
   - `awardXp(p, cfg.skill, cfg.xp)`; `p.gatherCd = cfg.cooldownTicks`.
   - depletion: `if (!cfg.infinite) { res.charges--; if (res.charges <= 0) { res.deadUntil = this.tick + cfg.respawnTicks; clear gatherers targeting it } }`.
   Replace `hasAxe` with a generic `private hasItem(p, item): boolean`.
4. `use(playerId, action, slot)`:
   - validate player + slot in range; `const stack = p.inventory[slot];`
   - `firemaking`: require `stack?.item === "logs"`, `this.hasItem(p,"tinderbox")`, and no live `fire` on the player's rounded tile (`!this.resources.some(r=>r.type==="fire"&&r.deadUntil>=this.tick? ... )` — simpler: no fire resource whose x,y === player tile and not expired). On success: decrement that logs stack by 1 (use `removeSlot` if qty 1, else qty--), `spawnFire(px,py)`, `awardXp(p,"firemaking", FIREMAKING_XP)`. Else push a notice. Add `const FIREMAKING_XP = 40; const COOKING_XP = 30;` consts (top of file).
   - `cooking`: require `stack?.item === "raw_shrimp"` and a live adjacent `fire` (`this.resources.some(r=>r.type==="fire" && r.deadUntil>this.tick && isAdjacent(p,r))`). On success: room check for `cooked_shrimp` (addToInventory); decrement one `raw_shrimp`; add cooked; `awardXp(p,"cooking",COOKING_XP)`. Else notice.
   - unknown action → ignore.
   Note: for `fire` resources, `deadUntil` is the EXPIRY tick (alive while `tick < deadUntil`), which is the opposite polarity of NPC/gatherable `deadUntil` (=-1 alive). To avoid confusion, give fire a clear rule: a fire is live iff `r.type==="fire" && this.tick < r.deadUntil`. Gatherables use `deadUntil < 0` for alive. Keep the snapshot filter aware of both (see step/snapshot below).
5. `step`: in the resource maintenance loop, (a) respawn depleted GATHERABLES as today (`deadUntil>=0 && tick>=deadUntil && type!=="fire"` → reset charges, deadUntil=-1); (b) remove expired fires once: `this.resources = this.resources.filter(r => !(r.type==="fire" && this.tick >= r.deadUntil));`.
6. `snapshot()` resources filter: include gatherables with `deadUntil < 0` AND fires with `this.tick < r.deadUntil`. e.g. `this.resources.filter(r => r.type==="fire" ? this.tick < r.deadUntil : r.deadUntil < 0)`.
7. `getPlayerSkills`: iterate `SKILLS`, `result[s] = { xp: p.skills[s] ?? 0, level: levelForXp(p.skills[s] ?? 0) }`.
8. Verify `bun test packages/server/src/game.test.ts` + whole server suite green; `bun run typecheck` game.ts clean. Commit: `feat(server): data-driven gather pass, awardXp, fires, use() for firemaking+cooking`.

---

## Unit 3 — Server wiring + world spawns/seeds

**Files:** modify `server.ts`, `world.ts`.

- `server.ts`: add `else if (msg.t === "use") { game.use(ws.data.username, msg.action, msg.slot); }` to the authed branch. Skills/notice/level-up delivery already generic — no change. Spawn the new resources at startup (the existing RESOURCE_SPAWNS loop will pick them up).
- `world.ts`: add to `RESOURCE_SPAWNS`: `{type:"rock",x:27,y:25}`, `{type:"fishing_spot",x:23,y:26}` (verify walkable, near spawn). Add ground `SEED_ITEMS`: `bronze_pickaxe` (qty 1), `small_net` (qty 1), `tinderbox` (qty 1), `logs` (qty 5), `raw_shrimp` (qty 3) on distinct walkable tiles near spawn. (Keep the existing STARTER_AXE.)
- Verify `bun test packages/server/src/` green; `bun run typecheck` server-clean. Commit: `feat(server): wire use action; seed mining/fishing nodes + tool/ingredient starter kit`.

---

## Unit 4 — Client: sendUse, new billboards, multi-skill HUD, inputs

**Files:** modify `game-state.ts`, `connection.ts`, `render/rasterize.ts`, `render/renderer.ts`, `index.ts`; tests.

TDD (state): test that `sampleResources` returns rock/fire entries; `skillsLines()` returns lines for all five skills after `setSkills({...all five...})`; `firstSlotOf("logs")` returns the right index (or -1).

- `game-state.ts`: add `skillsLines(): string[]` (one line per skill present, or list all five) and `firstSlotOf(item: string): number` (scan inventory). Keep `skillsLine()` if referenced, or replace HUD usage with `skillsLines()`.
- `connection.ts`: `sendUse(action: string, slot: number)` builds a `UseMsg`. Import `UseMsg`.
- `render/rasterize.ts`: tree/rock/fishing_spot/fire all already flow through the `resources` param and `RESOURCE_TYPES[type].color` — confirm the billboard draw uses the type's color generically (it should after slice 8; fire gets orange from its config). No per-type code needed if color is read from `RESOURCE_TYPES`.
- `render/renderer.ts`: `c` key — restrict nearest pick to gatherable resources: filter `sampleResources` by `RESOURCE_TYPES[type]?.gatherable` (exclude fire). Add `f` → `hooks.onUse?.("firemaking", state.firstSlotOf("logs"))` and `k` → `hooks.onUse?.("cooking", state.firstSlotOf("raw_shrimp"))` (only if slot >= 0). Add `onUse?(action,slot)` to `RendererHooks`. Draw the multi-line skills HUD via `skillsLines()`. Gate all while chatting.
- `index.ts`: wire `onUse: (action, slot) => conn.sendUse(action, slot)`.
- Verify `bun run typecheck` fully clean; `bun test` whole monorepo green; `bun run verify:render` green. Commit: `feat(client): mine/fish/fire billboards, multi-skill HUD, f/k use keys, c excludes fire`.

---

## Unit 5 — Integration test + review

- Add a server integration test: a player with the full starter kit mines a rock to depletion (ore + Mining xp), fishes a spot several times (raw_shrimp + Fishing xp, spot never disappears), firemakes a fire from logs (fire entity appears + Firemaking xp), then cooks raw_shrimp on that fire (cooked_shrimp + Cooking xp). Commit.
- `/review` (reviewer agent, fresh context) vs the spec. Fix blocking findings. Mark slice 9 done in `docs/ROADMAP.md` + `docs/OPERATING-PROCEDURE.md`; merge `feat/skill-framework` → main.

---

## Self-Review (plan vs spec)
- §2.1 generalized data → Unit 1. §2.2 generic gather pass → Unit 2. §2.3 processing/use → Unit 2.
  §2.4 skills delivery/persistence (unchanged shape) → Units 2-3 (getPlayerSkills over SKILLS). §2.5
  snapshot (rocks/spots/fires) → Unit 2 snapshot filter. §2.6 client → Unit 4. §2.7 world/starter kit
  → Unit 3. §2.8 no regressions → Units 4-5 (woodcutting regression test in Unit 2).
- §4 error handling: unknown action/type ignored; missing tool/fire/ingredient → notice no-op;
  no fire-stacking on a tile; inventory-full → ingredient not consumed; fire removed once
  (filter in step); xp/level structural. Covered across Units 2.
- Scope guard honored: mining/fishing are pure RESOURCE_TYPES data; only `use()` is new code.
- DRY: `awardXp` shared by gather + use; `hasItem` replaces `hasAxe`; billboard color read from config.

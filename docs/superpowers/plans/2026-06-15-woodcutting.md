# Woodcutting (Slice 8) Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. TDD each unit, commit per unit, all `bun test` green + `bun run typecheck` clean before moving on.

**Goal:** First gathering skill + reusable skill engine: chop a tree (needs an axe) → logs into inventory + woodcutting XP → level up; trees deplete and respawn.

**Architecture:** Resource nodes mirror the NPC entity+respawn pattern; the gather pass mirrors the combat pass and shares a path-and-stop helper. XP is pure math in protocol. Skills are private per-player state delivered via a `SkillsMsg` (not the broadcast snapshot) and persisted as a JSON column like inventory.

**Tech Stack:** TypeScript, Bun, monorepo `@termenor/protocol`/server/client.

Spec: `docs/superpowers/specs/2026-06-15-woodcutting-slice.md`. Branch: `feat/woodcutting`.

Verified reuse points:
- `game.ts` `combatStep` already does adjacency + "path to target, `path.pop()` to stop adjacent". Extract the not-adjacent path step into a private `stepToward(actor, tgt)` and reuse it in both combat and gather.
- `inventory.ts`: `emptyInventory()`, `addToInventory(slots, {item,qty}) => {slots, leftover}` (`leftover===null` ⇒ fully added ⇒ there was room), `removeSlot`.
- `db.ts`: `openDb` has an inventory migration guard; `getOrCreateAccount` returns `PlayerStateRecord`; `savePlayerState(db, username, x, y, facing, inventory)`.
- `Player` and `Npc` interfaces; `snapshot()`; `addPlayer` seeds inventory from RestoredState.

---

## Unit 1 — Protocol: skills math, resources, item, messages

**Files:** create `packages/protocol/src/skills.ts`, `packages/protocol/src/resources.ts`; modify `items.ts`, `index.ts`; tests `skills.test.ts` (new), `index.test.ts`.

TDD:
1. `skills.test.ts` (write first, see fail): `xpForLevel(1) === 0`; `xpForLevel` strictly increasing for L=1..99; `levelForXp(xpForLevel(L)) === L` for several L (1,2,10,50,99); `levelForXp(0) === 1`; `levelForXp(hugeNumber) === 99` (cap); `WOODCUTTING_XP_PER_LOG` is a positive number.
2. `skills.ts`: implement the RuneScape XP curve.
```typescript
export const MAX_LEVEL = 99;
export const WOODCUTTING_XP_PER_LOG = 25;

// RuneScape XP table: points to reach level L = floor( sum_{i=1}^{L-1} floor(i + 300*2^(i/7)) / 4 ).
function buildTable(): number[] {
  const table: number[] = [0, 0]; // index by level; level 1 needs 0 xp
  let points = 0;
  for (let lvl = 1; lvl < MAX_LEVEL; lvl++) {
    points += Math.floor(lvl + 300 * Math.pow(2, lvl / 7));
    table[lvl + 1] = Math.floor(points / 4);
  }
  return table;
}
const XP_TABLE = buildTable(); // XP_TABLE[L] = xp needed to BE level L (XP_TABLE[1]=0)

export function xpForLevel(level: number): number {
  const l = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
  return XP_TABLE[l];
}
export function levelForXp(xp: number): number {
  if (xp <= 0) return 1;
  let level = 1;
  for (let l = 1; l <= MAX_LEVEL; l++) if (xp >= XP_TABLE[l]) level = l; else break;
  return level;
}
```
3. `resources.ts` (mirror `npcs.ts`):
```typescript
import type { } from "./index"; // no import needed; keep standalone
export interface ResourceState { id: string; type: string; x: number; y: number; }
export const RESOURCE_TYPES: Record<string, { name: string; color: [number, number, number] }> = {
  tree: { name: "Tree", color: [40, 120, 40] },
};
export const RESOURCE_RESPAWN_TICKS = 90; // ~6s
export const TREE_CHARGES = 5;
```
4. `items.ts`: add `bronze_axe: { name: "Bronze axe", glyph: "T", color: [150, 110, 70], stackable: false }`.
5. `index.test.ts` (add round-trip tests, see fail): a `gather` ClientMsg round-trips; a `skills` ServerMsg round-trips; a snapshot WITH `resources: [{id:"r1",type:"tree",x:3,y:4}]` round-trips.
6. `index.ts`:
   - `export interface GatherMsg { t: "gather"; targetId: string; }`; add to `ClientMsg` union + `CLIENT_TYPES` (`"gather"`).
   - `export interface SkillsMsg { t: "skills"; skills: Record<string, { xp: number; level: number }>; }`; add to `ServerMsg` union + `SERVER_TYPES` (`"skills"`).
   - `SnapshotMsg` += `resources: ResourceState[]` (import `ResourceState` from `./resources`).
   - `export * from "./skills"; export * from "./resources";`.
   - Fix the protocol package's snapshot literals to add `resources: []` (grep `'"snapshot"'` in protocol).
7. `bun test packages/protocol/src/` green. `bun run typecheck` will now error in server/client snapshot literals — expected. Commit: `feat(protocol): woodcutting — skills xp math, resources, bronze_axe, gather/skills msgs, snapshot.resources`.

---

## Unit 2 — Persistence: skills column

**Files:** modify `db.ts`; test `db.test.ts`.

TDD:
1. `db.test.ts` (add, see fail): save a player with a `skills` object (e.g. `{woodcutting: 100}`) and load it back; assert it round-trips; assert a fresh account loads with empty `skills` (`{}`); assert a malformed/null skills column loads as `{}`.
2. `db.ts`:
   - `PlayerStateRecord` += `skills: Record<string, number>`.
   - `openDb`: add `skills TEXT` to the CREATE TABLE and a migration guard `try { db.run("ALTER TABLE accounts ADD COLUMN skills TEXT"); } catch {}`.
   - `getOrCreateAccount`: SELECT `skills`; new account → `skills: {}`; existing → `row.skills ? JSON.parse(row.skills) : {}` (wrap parse in try/catch → `{}` on failure).
   - `savePlayerState`: add a `skills: Record<string, number>` param and persist `JSON.stringify(skills)`. Update the UPDATE SQL.
3. Fix `savePlayerState` callers in `server.ts` (and any test) for the new arg — but if that creates churn, it's fine to do the server-side call in Unit 4; for now just make db.ts + db.test.ts pass and note the caller break.
4. `bun test packages/server/src/db.test.ts` green. Commit: `feat(server): persist player skills (JSON column + migration)`.

---

## Unit 3 — Game engine: skill/gather, resources, level-up

**Files:** modify `game.ts`; test `game.test.ts`.

TDD — add these tests first (10x10 open map, seeded rng). Use `WOODCUTTING_XP_PER_LOG`, `TREE_CHARGES`, `RESOURCE_RESPAWN_TICKS`, `levelForXp` from `@termenor/protocol`. To give the player an axe in tests, either rely on the new-player starter axe or `addGroundItem`+`pickup`; simplest: a test helper that adds an axe — see below.

Tests:
- "chopping an adjacent tree with an axe adds a log + xp and decrements charges": player adjacent to a `spawnResource("tree", 1, 0)`, ensure player has a `bronze_axe` (new players get one — assert `getInventory` contains it), `gather`, `step` once → inventory has 1 `logs`, `getPlayerSkills("p1").woodcutting.xp === WOODCUTTING_XP_PER_LOG`, snapshot resource still present with one fewer charge (charges aren't in snapshot, so assert indirectly: keep chopping and count logs until depletion = TREE_CHARGES).
- "gather cooldown gates cadence": two steps → only one log (cooldown).
- "no axe → no logs, target cleared": construct a player whose inventory has no axe (drop/remove it first, or a player restored with an empty inventory via `addPlayer("p2",{x,y,facing,inventory: emptyInventory-like})`), `gather`, several steps → inventory has 0 logs and `gatherTarget` effect ends (chopping refused).
- "full inventory → no logs": fill the player's inventory (28 non-axe... but need an axe too; fill 27 slots with junk + axe in slot 28 so logs can't be added), `gather`, step → no `logs` added, xp unchanged.
- "tree depletes after TREE_CHARGES chops then respawns full after RESOURCE_RESPAWN_TICKS": chop until the resource is absent from `snapshot().resources`; then after RESOURCE_RESPAWN_TICKS it reappears at its spot.
- "out-of-range gatherer walks toward the tree before chopping": tree far away; first step no log; after enough steps a log appears.
- "xp crossing a level threshold raises level": grant enough chops (or seed a player with xp just below `xpForLevel(2)`) so `getPlayerSkills().woodcutting.level` increases; assert a level-up is reported via the skill-change/level-up accessor.

Implementation:
- `Player` += `skills: Record<string, number>`, `gatherTarget: string | null`, `gatherCd: number`. `addPlayer`: `skills = state?.skills ?? {}`; if it's a brand-new player (no `state?.inventory`), seed `bronze_axe` into the starter inventory.
- `RestoredState` += `skills?: Record<string, number>`. `getPlayerState` returns `skills`.
- `Resource` interface: `{ id; type; x; y; home: Point; charges: number; maxCharges: number; deadUntil: number }`. Class fields: `private resources: Resource[] = []; private nextResourceId = 1;` and a per-tick set/notice for skill changes: `private skillChanged = new Set<string>(); private levelUps: { id: string; skill: string; level: number }[] = [];`.
- `spawnResource(type, x, y)`: push `{ id: \`res-${this.nextResourceId++}\`, type, x, y, home:{x,y}, charges: TREE_CHARGES, maxCharges: TREE_CHARGES, deadUntil: -1 }`.
- `gather(playerId, targetId)`: validate live resource (`deadUntil < 0`); set `p.gatherTarget = targetId`.
- Extract `private stepToward(actor: {x;y;path:Point[]}, tx: number, ty: number): void` from `combatStep`'s not-adjacent branch (`if path && length>0 { path.pop(); actor.path = path }`), and call it from both combat and the gather pass.
- In `step`, after the combat pass + resolveDeaths: respawn depleted resources (mirror NPC respawn: when `deadUntil>=0 && tick>=deadUntil` → `charges=maxCharges; deadUntil=-1`); then a **gather pass** over players with a `gatherTarget`:
  ```
  for player p with gatherTarget:
    if p.gatherCd > 0 p.gatherCd--
    res = resources.find(r => r.id===p.gatherTarget && r.deadUntil<0); if !res { p.gatherTarget=null; continue }
    if isAdjacent(p, res):
      p.path = []
      if p.gatherCd === 0:
        if !hasAxe(p) { p.gatherTarget=null; /* feedback handled in server via skillChanged? no */ note "needs axe" ; continue }
        if !inventoryHasRoomForLogs(p) { p.gatherTarget=null; note "inv full"; continue }
        addToInventory logs(1); add WOODCUTTING_XP_PER_LOG to p.skills.woodcutting (level-up detect via levelForXp before/after); this.skillChanged.add(p.id)
        p.gatherCd = GATHER_COOLDOWN_TICKS; res.charges--
        if res.charges <= 0 { res.deadUntil = tick + RESOURCE_RESPAWN_TICKS; clear gatherers targeting it }
    else stepToward(p, res.x, res.y)
  ```
  Add `const GATHER_COOLDOWN_TICKS = 30;` (or reuse a constant). `hasAxe(p)` = inventory has a slot with `item==="bronze_axe"`. Room check: `addToInventory(p.inventory, {item:"logs",qty:1})` → use it and check `leftover===null`; on success keep the returned slots.
- For "needs axe"/"inventory full" feedback, record a per-player notice the server can read, OR keep it minimal: a method `consumeGatherNotices(): {id;text}[]`. (Spec §2.7 wants feedback; a lightweight notice queue is fine.)
- `getPlayerSkills(id)`: returns `Record<string,{xp,level}>` computing level via `levelForXp` from stored xp. Ensure `woodcutting` key exists (default xp 0) so the client HUD has a value.
- `consumeSkillChanges(): string[]` returns + clears `skillChanged` (player ids whose skills changed this tick). `consumeLevelUps()` returns + clears `levelUps`.
- `snapshot()` += `resources: this.resources.filter(r=>r.deadUntil<0).map(r=>({id,type,x,y}))`.
- Run `bun test packages/server/src/game.test.ts` + whole server suite green; `bun run typecheck` (game.ts clean). Commit: `feat(server): woodcutting engine — resources, gather pass, xp/levels, respawn`.

---

## Unit 4 — Server wiring + world spawns

**Files:** modify `server.ts`, `world.ts`; tests as needed.

- `world.ts`: `export interface ResourceSpawn { type: string; x: number; y: number; }` and `export const RESOURCE_SPAWNS: ResourceSpawn[] = [ {type:"tree",x:26,y:26}, {type:"tree",x:22,y:23} ];` (near spawn, on walkable tiles — verify against `createDefaultMap`/`isWalkable`).
- `server.ts`:
  - On startup, after seeding NPCs, loop `RESOURCE_SPAWNS` → `game.spawnResource(...)`.
  - `gather` handler in the authed branch: `else if (msg.t === "gather") { game.gather(ws.data.username, msg.targetId); }`.
  - On login (where `InventoryMsg` is sent): also send `SkillsMsg` with `game.getPlayerSkills(username)`.
  - In the tick loop after `game.step`: for each id in `game.consumeSkillChanges()` that is online, send that socket a fresh `SkillsMsg`; for each level-up in `game.consumeLevelUps()`, send that player's socket a `chatMsg` like `{t:"chatMsg",from:"",text:\`Woodcutting level \${level}!\`}`; for each gather notice from `consumeGatherNotices()`, send a `chatMsg` to that player.
  - Update the periodic `savePlayerState(...)` call to pass `state.skills` (now on `RestoredState`/`getPlayerState`). Fix the db.ts signature usage.
- `bun test` whole server green; `bun run typecheck` server-clean. Commit: `feat(server): wire gather, skills delivery, level-up notices, tree spawns`.

---

## Unit 5 — Client: state, connection, render, input, index

**Files:** modify `game-state.ts`, `connection.ts`, `render/rasterize.ts`, `render/renderer.ts`, `index.ts`; tests.

TDD (state):
- `game-state.test.ts`: applying a snapshot with `resources` stores them (`sampleResources()` returns them with elevation `h`); `setSkills({woodcutting:{xp:25,level:1}})` then `skillsLine()` returns a string containing `Woodcutting` and the level; nearest-resource pick helper if you add one.

Implementation:
- `game-state.ts`: `import { type ResourceState } from "@termenor/protocol"`. Add `resources: ResourceState[] = []` set in `applySnapshot` (`this.resources = snap.resources`). `skills: Record<string,{xp:number;level:number}> = {}`; `setSkills(s)`. `sampleResources(): (ResourceState & {h:number})[]` (attach `sampleElevation` like `sampleNpcs`, no interpolation). `skillsLine(): string` → e.g. `\`Woodcutting: ${this.skills.woodcutting?.level ?? 1} (${this.skills.woodcutting?.xp ?? 0} xp)\``.
- `connection.ts`: `sendGather(targetId)` (build `GatherMsg`); in `handle()`, on `welcome`-seeded snapshot literal add `resources: []`; add a `skills` case → `this.state.setSkills(msg.skills); this.onSkills?.()`. Add `onSkills?` to the connection callbacks if that pattern is used (mirror `onInventory`). Add `GatherMsg`/`SkillsMsg` to imports.
- `render/rasterize.ts`: add a `resources: (ResourceState & {h:number})[] = []` param to `rasterizeIso` and draw a tree billboard for each (reuse `drawBillboard` with the `RESOURCE_TYPES` color; static, no HP bar). Fix `rasterize.test.ts`/`camera.test.ts` calls if the new param breaks them (it's optional/defaulted, so likely fine).
- `render/renderer.ts`: pass `state.sampleResources(now)` into `rasterizeIso`. Add `onGather?(id)` to `RendererHooks`. Add key `c` (chat-gated, beside `a`): pick nearest resource to the local player from `sampleResources` → `hooks.onGather?.(id)`. Draw the skills HUD line via the existing text/label overlay (one line, a corner of the screen).
- `index.ts`: add `onGather: (id) => conn.sendGather(id)` to the hooks; if `onSkills` callback exists on Connection, no UI wiring needed beyond state.
- `bun run typecheck` fully clean; `bun test` whole monorepo green; `bun run verify:render` green (assert a tree renders if practical — extend `scripts/pty-render-check.py` only if low-risk). Commit: `feat(client): trees, woodcutting HUD, 'c' chops nearest tree`.

---

## Unit 6 — Integration test + review

- Add an engine integration test (server): new player (gets starter axe) gathers a tree to depletion, accumulating `TREE_CHARGES` logs and `TREE_CHARGES * WOODCUTTING_XP_PER_LOG` xp; the tree disappears from snapshot then respawns at its spot after `RESOURCE_RESPAWN_TICKS`. Commit.
- Run `/review` (reviewer agent, fresh context) vs the spec. Fix blocking findings. Mark slice 8 done in `docs/ROADMAP.md` + `docs/OPERATING-PROCEDURE.md`, merge `feat/woodcutting` → main.

---

## Self-Review (plan vs spec)
- §2.1 xp math → Unit 1. §2.2 items/tool → Unit 1. §2.3 protocol → Unit 1. §2.4 engine → Unit 3.
  §2.5 persistence → Unit 2 + Unit 4 save wiring. §2.6 snapshot+skills delivery → Unit 3 (snapshot)
  + Unit 4 (SkillsMsg). §2.7 client render+input → Unit 5. §2.8 no regressions → Units 5–6.
- §4 error handling: unknown/depleted target ignored (gather validate + gather pass clears vanished);
  no-axe/full-inv refuse with notice; respawn dedupe via deadUntil; xp≥0 & level≤MAX_LEVEL (levelForXp
  caps); skills parse failure → {} (Unit 2). Covered.
- DRY risk (gather vs combat path-and-stop): addressed by extracting `stepToward` (Unit 3).

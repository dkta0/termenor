# Termenor — Vertical Slice 8: Woodcutting (first gathering skill)

Status: **spec** · Branch: `feat/woodcutting` · Date: 2026-06-15

## 1. Goal

The first gathering skill and the **skill engine** that later skills (mining, fishing, cooking,
firemaking — slice 9) reuse. Walk up to a tree, chop it (you need an axe), receive logs into
your inventory, gain woodcutting XP, level up; trees deplete and respawn. Server-authoritative;
reuses the slice-6/7 tick + entity + respawn patterns and the slice-5 inventory.

"Done" = press chop near a tree → player auto-walks to it and chops on a cadence; logs land in
your inventory and your woodcutting XP rises; at an XP threshold you level up (feedback shown);
the tree depletes after a few logs and respawns later at its spot; chopping without an axe is
refused with feedback.

### Non-goals
- Only **woodcutting** this slice (the engine is generic, but we author one skill). Mining/
  fishing/cooking/firemaking are slice 9 — do NOT build them now.
- No tree tiers / multiple log types / bird nests / random events. One tree → `logs`.
- No combat interaction with trees, no tool tiers affecting speed beyond a single axe check.
- No banking (slice 10). Full inventory stops gathering with feedback.

## 2. Success criteria (concrete & checkable)
1. **XP/level math (pure, tested).** `packages/protocol/src/skills.ts`: `levelForXp(xp): number`
   (1..99, RuneScape curve) and `xpForLevel(level): number`. Monotonic; `xpForLevel(1)===0`;
   `levelForXp(xpForLevel(L))===L`. Unit-tested at boundaries.
2. **Items + tool.** `ITEMS` gains `bronze_axe` (tool, non-stackable). `logs` already exists.
   `WOODCUTTING_XP_PER_LOG` constant.
3. **Resource nodes + protocol.** `ResourceState {id,type,x,y}` (depleted nodes are absent from
   the snapshot, like dead NPCs). `SnapshotMsg` gains `resources: ResourceState[]`. Client→server
   `GatherMsg {t:"gather"; targetId:string}`. Server→client `SkillsMsg {t:"skills"; skills:
   Record<string,{xp:number;level:number}>}`. Round-trip tested.
4. **Skill engine in Game (tested, deterministic via injected rng).**
   - Player gains `skills: Record<string, number>` (xp per skill); `target`-style `gatherTarget:
     string|null` and `gatherCd:number`.
   - `spawnResource(type,x,y)` adds a tree node with `charges` (e.g. 5) and `deadUntil:-1`.
   - `gather(playerId,targetId)` validates a live node → sets `gatherTarget`.
   - Each tick (a gather pass, mirroring combat): a player with a live gather target either
     (a) if **adjacent** and gather cooldown ready: require an axe in inventory (else clear target
     + flag "needs axe"); require inventory room for logs (else clear target + flag "inventory
     full"); on success add 1 `logs` to inventory, add `WOODCUTTING_XP_PER_LOG` to woodcutting xp,
     reset cooldown, decrement the node's charges; when charges hit 0 the node depletes (absent
     from snapshot) and respawns with full charges after `RESOURCE_RESPAWN_TICKS`, clearing
     gatherers; or (b) if not adjacent: path one step toward an adjacent tile (reuse the combat
     path-and-stop logic).
   - Leveling: level is derived from xp via `levelForXp`; a level increase is detectable so the
     server can notify (see §3.2 — emit a chat-style level-up broadcast or include in SkillsMsg).
   - Tested: chopping adds logs + xp; cooldown gates cadence; no axe → no logs (refused);
     full inventory → no logs; node depletes after N chops and is absent, then respawns with full
     charges after the timer; out-of-range walks closer; xp crossing a threshold raises level.
5. **Persistence.** Player `skills` JSON persists to SQLite (new column, mirroring the slice-5
   `inventory` column + migration guard). Restored on login; `SkillsMsg` sent at login.
6. **Snapshot + skills delivery.** `snapshot()` includes `resources` (live only). Skill xp is
   per-player private state → delivered via `SkillsMsg` at login and whenever a player's xp
   changes (not in the broadcast snapshot). Starter axe: seed a `bronze_axe` into a new player's
   inventory (or a ground item by spawn) so chopping is reachable immediately.
7. **Client render + input.** Tree nodes rendered as billboards (reuse the entity billboard path;
   a green/brown tree). A skills HUD line shows `Woodcutting: <level> (<xp> xp)` for the local
   player (from `SkillsMsg`). Key `c` (chat-gated) chops the nearest tree from the sampled
   resources → `onGather(id)` → `sendGather(id)`. Level-up / "you need an axe" / "inventory full"
   surfaced via the existing chat/feedback line.
8. **No regressions.** Full `bun test` green, `bun run typecheck` clean, `verify:render` green
   (ideally assert a tree renders).

## 3. Architecture

### 3.1 Protocol
- `skills.ts` (new): `levelForXp`, `xpForLevel`, `WOODCUTTING_XP_PER_LOG`, `MAX_LEVEL=99`.
  Re-export from `index.ts`.
- `items.ts`: add `bronze_axe: { name:"Bronze axe", glyph:"T", color:[150,110,70], stackable:false }`.
- `resources.ts` (new, mirrors `npcs.ts`): `ResourceState {id;type;x;y}` and
  `RESOURCE_TYPES: Record<string,{name;color:[number,number,number]}>` with `tree`.
  `RESOURCE_RESPAWN_TICKS`, `TREE_CHARGES` constants (here or skills.ts).
- `index.ts`: `GatherMsg {t:"gather";targetId:string}` → `ClientMsg`/`CLIENT_TYPES`.
  `SkillsMsg {t:"skills";skills:Record<string,{xp:number;level:number}>}` → `ServerMsg`/
  `SERVER_TYPES`. `SnapshotMsg` += `resources: ResourceState[]` (update snapshot literals to
  `resources: []`).

### 3.2 Server
- `game.ts`:
  - `Player` += `skills: Record<string,number>` (xp), `gatherTarget:string|null`, `gatherCd:number`.
    `addPlayer` seeds empty skills (or from RestoredState) and a starter `bronze_axe` for brand-new
    players (only when no restored inventory).
  - `Resource` interface (`id;type;x;y;home;charges;maxCharges;deadUntil`). `spawnResource`.
    Dead/ depleted resources excluded from snapshot + respawn at `deadUntil` like NPCs.
  - `gather(playerId,targetId)`: validate live node → `player.gatherTarget = targetId`.
  - In `step`: a **gather pass** after the combat pass. Reuse the adjacency + path-and-stop helper
    (extract the "walk toward target tile, drop last step" into a shared private method if it
    isn't already, so combat + gather share it — DRY). Axe check via inventory; inventory-room
    check; on success mutate inventory + xp + charges; deplete + schedule respawn.
  - Level-up detection: compute `levelForXp` before/after adding xp; if it increased, record a
    pending notice for that player.
  - `getPlayerSkills(id)`: returns `Record<string,{xp,level}>` for `SkillsMsg`.
  - `consumeSkillEvents()` or similar: lets `server.ts` learn which players' skills changed this
    tick (to push `SkillsMsg`) and any level-up text (to broadcast/notify).
- `world.ts`: `RESOURCE_SPAWNS` (a few trees near spawn). Optionally a `bronze_axe` SEED_ITEM.
- `db.ts`: add a `skills` TEXT column (JSON) with a migration guard mirroring `inventory`;
  `savePlayerState` gains skills; load parses it. `getPlayerState`/`RestoredState` += `skills?`.
- `server.ts`: handle `gather` → `game.gather(...)`; on login send `SkillsMsg`; each tick, for any
  player whose skills changed, send that player a fresh `SkillsMsg`; broadcast/notify level-ups
  (reuse chat broadcast: `{t:"chatMsg",from:"",text:"You advance your Woodcutting level..."}` to
  that socket, or a dedicated path — keep it simple, send only to that player's socket).

### 3.3 Client
- `game-state.ts`: store `resources` from snapshots; store `skills` from `SkillsMsg`
  (`setSkills`). `sampleResources()` (no interpolation needed — static; attach elevation like
  ground/npcs). Accessor `skillsLine()` → `"Woodcutting: L (xp)"`.
- `connection.ts`: `sendGather(targetId)`; handle `SkillsMsg` → `state.setSkills` + `onSkills?`.
- `render/rasterize.ts`: draw tree billboards from `resources` (reuse the billboard drawing;
  trees are static, no HP bar). Add a `resources` param like `npcs`.
- `render/renderer.ts`: `onGather?(id)` hook; key `c` (chat-gated) → nearest resource from
  `sampleResources` → `onGather`. Draw the skills HUD line (reuse the label/text overlay).
- `index.ts`: wire `onGather: (id)=>conn.sendGather(id)`.

## 4. Error handling
- `gather` with unknown/depleted targetId → ignored. Node depletes mid-gather → gatherer clears
  target (no chopping a stump). No axe → clear target + one-time feedback, no logs. Full inventory
  → clear target + feedback, no logs, no xp, charges unchanged. Respawn must not duplicate a node.
  xp clamped ≥0; level clamped ≤ MAX_LEVEL. Skills JSON parse failure on load → empty skills.

## 5. Testing
- **Unit:** `skills.ts` boundaries (`xpForLevel(1)=0`, monotonic, round-trip, level 99 cap);
  protocol round-trip (snapshot with resources, gather msg, skills msg).
- **Server (seeded rng):** chop adds 1 log + XP and decrements charges; cooldown gates cadence;
  no-axe refuses (no log, target cleared); full-inventory refuses; node depletes after
  `TREE_CHARGES` chops (absent from snapshot) then respawns full after `RESOURCE_RESPAWN_TICKS`;
  out-of-range walks closer; xp crossing a threshold increases level; skills persist round-trip
  through db save/load.
- **Client:** resources stored from snapshot; `setSkills` + `skillsLine()`; nearest-tree pick.
- **Visual/PTY:** `verify:render` green; assert a tree billboard/label renders if practical.

## 6. Sequencing (for `/plan`)
1. Protocol: `skills.ts` (xp math + consts), `resources.ts`, `bronze_axe` item, `GatherMsg`,
   `SkillsMsg`, `SnapshotMsg.resources` (+ fix snapshot literals) + tests.
2. `db.ts`: `skills` column + migration + save/load + `RestoredState.skills` + tests.
3. `Game`: skills/gather fields, `spawnResource`, `gather`, gather pass in `step` (DRY the
   path-and-stop helper with combat), deplete/respawn, level-up detection, `getPlayerSkills`,
   skill-change events, starter axe + tests.
4. Server wiring: `gather` handler, `SkillsMsg` at login + on change, level-up notify.
5. `world.ts`: tree spawns (+ axe seed).
6. Client state: resources + skills + `sendGather` + handler.
7. Renderer: tree billboards, skills HUD line, `c` key + `onGather`.
8. index wiring.
9. Integration test (gather → logs+xp → deplete → respawn) + render verify.
10. Review.

**Risk:** the gather pass duplicating combat's path-and-stop logic — extract a shared helper to
stay DRY. Keep all randomness on the injected `rng`. Skills are private per-player state — deliver
via `SkillsMsg`, never the broadcast snapshot.

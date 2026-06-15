# Termenor — Vertical Slice 7: Combat v1

Status: **spec** · Branch: `feat/combat` · Date: 2026-06-14

## 1. Goal

Melee combat against NPCs: attack a goblin/rat, it fights back, someone dies and respawns,
with floating damage splats and HP bars. Server-authoritative; reuses the slice-6 entity
system and tick loop. This is the combat *engine* (HP, attack cadence, death/respawn,
damage events) that later slices (ranged/magic, more NPCs) extend.

"Done" = press attack near a goblin → player auto-walks to it and trades blows; damage
numbers pop over both; when the goblin's HP hits 0 it dies and respawns later at its spawn;
if the player dies they respawn at SPAWN with full HP.

### Non-goals
- No XP/levels/accuracy formulas (combat is flat random 0..maxHit; XP is slice 8+).
- No weapons/equipment affecting damage (slice 11), no ranged/magic/prayer (slice 11).
- No loot drops on NPC death (keep it to the combat loop; drops can come with skills/economy).
- No PvP (players attack NPCs only this slice).

## 2. Success criteria (concrete & checkable)
1. **HP on entities + protocol.** `PlayerState`/`NpcState` gain `hp,maxHp`. `AttackMsg
   {t:"attack",targetId}` (client). `SnapshotMsg` gains `hits: HitEvent[]` (damage dealt this
   tick). `HitEvent {targetId,amount,tick}`. Round-trip tested.
2. **Pure combat helpers (tested).** `rollDamage(maxHit, rng)` → integer 0..maxHit; `isAdjacent(a,b)`
   → Chebyshev distance ≤ 1. Unit-tested (deterministic rng; bounds).
3. **Combat engine in Game (tested, deterministic via injected rng).**
   - `attack(playerId, targetId)` sets the player's combat target (NPC).
   - Each tick: a combatant with a living target either (a) if adjacent and its attack cooldown
     is ready, deals `rollDamage` to the target, resets cooldown, and emits a `HitEvent`; or
     (b) if not adjacent, paths one step toward an adjacent tile of the target.
   - NPC **retaliates**: being hit sets the NPC's target to the attacker.
   - **Death:** target HP ≤ 0 → NPC marked dead, removed from active set, scheduled to respawn
     at its home with full HP after `RESPAWN_TICKS`; attackers clear their target. Player HP ≤ 0
     → respawn at SPAWN with full HP, target cleared.
   - Tested: damage reduces HP; death+respawn timing; retaliation; out-of-range walks closer;
     dead NPC absent from snapshot until respawn.
4. **Snapshot carries hp + hits.** `snapshot()` includes per-entity hp/maxHp and the tick's
   `hits`. Wander AI yields to combat (a targeted NPC stops wandering).
5. **Client render.** HP bar above each entity (green/red proportion); damage splats: a red
   number that floats over the hit entity for ~600 ms then fades (driven by `hits`). HP is NOT
   interpolated — read from the newest snapshot.
6. **Attack input.** Key `a` attacks the nearest NPC (client picks nearest from `sampleNpcs`,
   sends `attack` with its id). Gated while chatting. (Clicking an NPC tile MAY also attack —
   optional; keep `a` as the reliable path.)
7. **No regressions.** Full `bun test` green, `bun run typecheck` clean, `verify:render` green.

## 3. Architecture

### 3.1 Protocol
- `PlayerState` += `hp:number; maxHp:number`. `npcs.ts` `NpcState` += `hp:number; maxHp:number`;
  `NPC_TYPES` entries gain `maxHp` and `maxHit` (combat stats). Player combat consts central.
- `index.ts`: `AttackMsg {t:"attack"; targetId:string}` → `ClientMsg`/`CLIENT_TYPES`.
  `HitEvent {targetId:string; amount:number; tick:number}`; `SnapshotMsg` += `hits: HitEvent[]`.
  Update snapshot literals (game.ts, connection seed, tests) with `hits: []` and hp fields.
- `combat.ts` (protocol or server) constants: `PLAYER_MAX_HP`, `PLAYER_MAX_HIT`,
  `ATTACK_COOLDOWN_TICKS`, `RESPAWN_TICKS`.

### 3.2 Server
- `combat.ts` (new, pure): `rollDamage(maxHit, rng): number` (floor(rng()*(maxHit+1))),
  `isAdjacent(a:Point,b:Point): boolean` (Chebyshev ≤ 1, excluding identical? — adjacent or
  same tile counts as in-range). Unit-tested.
- `game.ts`:
  - `Player` gains `hp,maxHp,target:string|null,attackCd:number`. Spawn/respawn sets full hp.
  - `Npc` gains `hp,maxHp,maxHit,target:string|null,attackCd:number`, plus respawn bookkeeping
    (`deadUntil:number`, original spawn args retained). Dead NPCs excluded from `snapshot().npcs`
    and from wander, re-added with full hp at `deadUntil`.
  - `attack(playerId,targetId)`: validate target is a live npc; set `player.target`.
  - `step(dt)`: after movement, run a combat pass for every combatant (players + npcs) with a
    target — adjacency check via `isAdjacent`, cooldown gate (`attackCd` counts down per tick),
    `rollDamage` using `this.rng`, push `HitEvent`, apply death/respawn; if not adjacent, set a
    one-step path toward the target (pathfind to the target's tile, drop the last step so it
    stops adjacent — or path to target and stop when adjacent). A targeted NPC does not wander.
  - `snapshot()`: include hp/maxHp on players+npcs and the `hits` accumulated THIS tick (clear
    the buffer each tick after snapshotting).
- `server.ts`: handle `attack` in the authed branch → `game.attack(username, msg.targetId)`.

### 3.3 Client
- `game-state.ts`: store hp/maxHp on the render player/npc (from the NEWEST frame, not lerped);
  collect `hits` from each applied snapshot into an active-splats list with an expiry time
  (`now + SPLAT_MS`); a `activeSplats(now)` accessor prunes expired.
- `connection.ts`: `sendAttack(targetId)`; snapshot handler already stores players/npcs — also
  feed `snap.hits` to the splat list.
- `render/rasterize.ts` or overlay: draw an HP bar (a 1-row colored cell run) above each
  entity billboard, proportion = hp/maxHp.
- `render/renderer.ts`: draw damage splats (red number near the entity) for active splats; key
  `a` (when chat inactive) → pick nearest npc from `sampleNpcs` and `hooks.onAttack(id)`. Add
  `onAttack(id)` hook.
- `index.ts`: wire `onAttack: (id) => conn.sendAttack(id)`.

## 4. Error handling
- `attack` with an unknown/dead targetId → ignored. Target dies mid-combat → attacker clears
  target (no crash, no attacking a corpse).
- Player at full hp / no target → no combat work. Splats for an entity that vanished → just
  render at last-known cell or skip if no position; never throw.
- Respawn must not duplicate an NPC (guard the dead/respawn state). HP never below 0 in snapshot
  (clamp at 0 before death handling).

## 5. Testing
- **Unit:** protocol round-trip (snapshot with hp+hits, attack msg); `rollDamage` bounds +
  determinism; `isAdjacent`.
- **Server (seeded rng):** attack reduces target hp by the rolled amount; cooldown gates cadence
  (no damage every tick); NPC retaliates after being hit; NPC death removes it from snapshot and
  it respawns at home with full hp after RESPAWN_TICKS; player death respawns at SPAWN; out-of-
  range attacker walks toward target then lands hits; targeted NPC stops wandering.
- **Client:** splat list expiry (active within window, pruned after); hp read from newest frame.
- **Visual/PTY:** keep `verify:render` green; optionally assert an HP-bar / splat color renders.

## 6. Sequencing (for `/plan`)
1. Protocol: hp on states, `AttackMsg`, `HitEvent`, `SnapshotMsg.hits`, NPC_TYPES combat stats,
   combat consts (+ fix snapshot literals).  2. Server `combat.ts` (`rollDamage`,`isAdjacent`)
   + tests.  3. `Game`: hp fields, `attack`, combat pass in `step`, death/respawn, snapshot
   hp+hits + tests.  4. Server wiring (`attack` handler).  5. Client state: hp + splats list +
   `sendAttack`.  6. Renderer: HP bars + damage splats + `a` key + `onAttack`.  7. index wiring.
   8. Integration test (attack→damage→death→respawn).  9. Review.

**Risk:** the combat pass interacting with wander/movement (a targeted NPC must stop wandering
and chase) — make combat take priority over wander in `step`, and reuse `findPath`/
`advanceAlongPath`. Keep all randomness on the injected `rng` for deterministic tests.

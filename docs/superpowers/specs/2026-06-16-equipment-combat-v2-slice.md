# Termenor — Vertical Slice 11: Equipment (combat v2, lean cut)

> **Scope decision (2026-06-16):** Roadmap slice 11 is written as "Equipment + combat v2 —
> ranged/magic, prayer." That is 4–5 slices of work, and ranged/magic/prayer are all meaningless
> without an equipment + gear-stats foundation that does not yet exist. This slice delivers **only
> that foundation**: equip/unequip gear that feeds the *existing* flat melee combat. No new combat
> skills, no accuracy/hit-chance roll, no ranged/magic/prayer. Those become their own later slices.

## 1. Goal

Let a player **equip and unequip gear** (weapon + armour) that changes melee combat outcomes,
server-authoritative and persisted. A better weapon raises your max hit; armour reduces incoming
damage. Gear is managed through a modal **equipment panel** in the client, mirroring the slice-10
bank panel. After this slice, combat has a *gear progression knob* — the prerequisite every future
combat slice (ranged, magic, prayer, combat skills) builds on.

### Non-goals (explicitly deferred)

- **Combat skills / leveling** (attack/strength/defence/hitpoints XP) — no accuracy roll, no
  level-driven stats. Damage stays the existing flat `rollDamage` model, only the inputs change.
- **Ranged, Magic, Prayer** — separate later slices.
- **Accuracy / hit-chance** — defence is *flat damage reduction*, not a to-hit roll.
- **Gear visible on other players** — equipment is private per-player (like inventory/skills); no
  billboard/nameplate changes, no renderer iso-path changes (additive panel only).
- **Equip requirements** (level to wear), degradation, two-handed rules, ammo, ring/amulet/etc.
  slots beyond the fixed three, gear on NPCs.

## 2. Success criteria (concrete & checkable)

1. A player can **equip** an equippable inventory item: it leaves the inventory and fills its
   equipment slot; the inventory slot it occupied is freed (or holds the swapped-out item).
2. A player can **unequip** an equipped item: it returns to the inventory. If the inventory is
   full, the unequip is **refused with a notice and nothing is lost** (slice-10 sell lesson).
3. Equipping a **non-equippable** item (e.g. logs), or an item for an **already-occupied** slot,
   behaves correctly: non-equippable → no-op + notice; occupied slot → **swap** (old gear returns
   to the freed inventory slot, net inventory count unchanged).
4. **Weapon affects offense:** unarmed player max hit = `BASE_MAX_HIT`; with `bronze_sword`
   (weapon bonus +2) equipped, max hit = `BASE_MAX_HIT + 2`. Verified deterministically.
5. **Armour affects defense:** incoming melee damage = `max(0, rolled − totalDefence)` where
   `totalDefence` = sum of equipped armour `defence`. With armour equipped, a fixed-rng incoming
   hit deals strictly less (or zero) damage than unarmoured. NPCs have no armour (defence 0).
6. Equipment **persists**: equip gear, save via `savePlayerState`, reload (relogin-equivalent) →
   gear still equipped, stats still applied.
7. **Equipment panel**: `e` toggles it (client-local). Default EQUIP mode; `u` → UNEQUIP mode;
   digits `1-9` act (equip inventory slot / unequip equipped slot by index); `Esc` closes. Panel
   branch sits at the top of the not-chatting key handler and returns, so digits never fall through
   to `onDrop`. Additive overlay only — iso render path untouched (`verify:render` stays green).
8. **No regressions**: full suite green, `bun run typecheck` clean, `verify:render` green.

## 3. Architecture

Reuse the slice-10 shapes wholesale: a command-style system over `GameWorld`, a JSON persistence
column with a migration guard, request/response protocol messages, and a modal client panel with a
locked key scheme.

### 3.1 Protocol (`packages/protocol`)

- New `equipment.ts`:
  ```ts
  export type EquipSlot = "weapon" | "body" | "shield";
  export const EQUIP_SLOTS: EquipSlot[] = ["weapon", "body", "shield"]; // fixed display/index order
  export const BASE_MAX_HIT = 1; // unarmed player max hit (replaces the old flat PLAYER_MAX_HIT input)
  export interface EquipStats { slot: EquipSlot; maxHit?: number; defence?: number; }
  export const EQUIPMENT: Record<string, EquipStats> = {
    bronze_sword:     { slot: "weapon", maxHit: 2 },
    bronze_platebody: { slot: "body",   defence: 2 },
    bronze_shield:    { slot: "shield", defence: 1 },
  };
  export const isEquippable = (item: string): boolean => item in EQUIPMENT;
  ```
- `index.ts`: `export * from "./equipment";`. Add items to `ITEM_KINDS`: `bronze_platebody`,
  `bronze_shield` (non-stackable; `bronze_sword` already exists).
- Messages (mirror `bankAction`/`bank`):
  - Client: `EquipActionMsg { t: "equipAction"; action: "equip" | "unequip"; slot: number; }`
    — equip: `slot` = inventory index; unequip: `slot` = equipment index into `EQUIP_SLOTS`.
  - Server: `EquipmentMsg { t: "equipment"; weapon: string | null; body: string | null; shield: string | null; }`
    (current equipped item ids; no `open` flag — the panel is client-local, no adjacency gating).
  - Register `"equipAction"` in `CLIENT_TYPES`, `"equipment"` in `SERVER_TYPES`; add to the
    `ClientMsg`/`ServerMsg` unions.
- Keep the existing `PLAYER_MAX_HIT` constant only if still referenced; combat now computes player
  max hit from gear (see 3.3), so `PLAYER_MAX_HIT` is replaced by `BASE_MAX_HIT` as the unarmed base.

### 3.2 Server: `equipment-system.ts` + `GameWorld` state

- `entities.ts`: `PlayerEntity` += `equipment: Record<EquipSlot, string | null>`.
- `game.ts`: `addPlayer` seeds `equipment` from restored state or `{weapon:null,body:null,shield:null}`;
  `RestoredState` += `equipment?`; `getPlayerState` returns it. Thin command wrappers delegating to
  the system: `getEquipment(id)`, `equip(id, invSlot)`, `unequip(id, equipIndex)`.
- `equipment-system.ts` (functions over `GameWorld`, pattern = `bank-system.ts`):
  - `getEquipment(w, id)` → the player's equipment record.
  - `equip(w, id, invSlot)`: read inv slot; empty or not `isEquippable` → notice + false. Determine
    `slot` from `EQUIPMENT`. **Swap**: `old = equipment[slot]`; set `equipment[slot] = item`;
    set `inv[invSlot] = old ? {item: old, qty: 1} : null`. (Net inventory count unchanged — no room
    check needed.) Return true.
  - `unequip(w, id, equipIndex)`: `slot = EQUIP_SLOTS[equipIndex]`; `item = equipment[slot]`; null →
    false. **All-or-nothing** (slice-10 lesson): trial `addToInventory(inv, {item, qty:1})`; if
    `leftover !== null` → notice "no inventory space" + false (gear stays equipped). Else commit
    `inv = slots`, `equipment[slot] = null`. Return true.
  - Stat helpers (exported, pure over a player/equipment): `playerMaxHit(p)` =
    `BASE_MAX_HIT + (weapon's maxHit ?? 0)`; `playerDefence(p)` = sum of equipped `defence`.
  - Refusal notices push to `w.events.gatherNotices` (the generic per-player channel).
- `combat-system.ts` integration (minimal, surgical):
  - Player attacker max hit: replace the constant `PLAYER_MAX_HIT` passed to `combatStepActor`
    with `playerMaxHit(p)`.
  - Defence on the victim: when a hit lands on a **player** victim, reduce the rolled damage by that
    player's `playerDefence` before applying (`dmg = max(0, dmg - playerDefence(victim))`). NPC
    victims have no defence. (Implementation detail for `/plan`: `combatStepActor` currently takes a
    generic `findTarget`; pass victim-defence in, or look up whether the target id is a player.)

### 3.3 Server wiring (`server.ts`, `world.ts`, `db.ts`)

- `db.ts`: `equipment TEXT` column in CREATE + `try{ALTER TABLE…}catch{}` migration guard;
  `PlayerStateRecord` += `equipment`; `getOrCreateAccount` parses with try/catch → default
  `{weapon:null,body:null,shield:null}`; `savePlayerState` takes a trailing `equipment` arg and
  persists `JSON.stringify`. Update **both** existing call sites in `server.ts` to pass
  `state.equipment ?? {…}`.
- `server.ts`: on login, send `EquipmentMsg` alongside the existing inventory/skills sends. Handle
  `equipAction` in the authed branch: `equip`/`unequip` then reply fresh `EquipmentMsg` +
  `InventoryMsg` to that socket.
- `world.ts`: seed one `bronze_sword`, `bronze_platebody`, `bronze_shield` on the ground near spawn
  (extend `SEED_ITEMS` or add a `STARTER_GEAR` list like `STARTER_AXE`) **and** add the three gear
  items to the slice-10 `general_store` stock so the buy-then-equip loop is exercisable.

### 3.4 Client (`game-state.ts`, `connection.ts`, `render/renderer.ts`, `index.ts`)

- `game-state.ts`: `equipment: {weapon,body,shield: string|null} = {…null}`, `equipOpen = false`;
  `setEquipment(eq)`, `toggleEquip()` / `closeEquip()`.
- `connection.ts`: `sendEquipAction(action, slot)`; handle `equipment` → `setEquipment`. Optional
  `onEquipment?` callback for parity.
- `render/renderer.ts`: hooks `onEquipAction?(action, slot)`. **Locked key scheme** (panel branch at
  top of not-chatting handler, returns after; mirrors bank):
  - `e` (no panel open) → `state.toggleEquip()` (client-local; no server round-trip to open).
  - Equip panel open: `Esc` closes; default EQUIP mode, `u` → unequip mode, `q` → equip mode;
    digits `1-9` → EQUIP mode `onEquipAction("equip", invSlot=digit-1)`, UNEQUIP mode
    `onEquipAction("unequip", equipIndex=digit-1)`. (Use `q` for "equip mode" since `e` toggles the
    panel and `d`/`w` are bank-coded — keep per-panel keys non-overlapping; `/plan` may pick the
    final mode-toggle letters but they must not collide within the panel.)
  - Additive panel listing the three slots (`1 Weapon: Bronze sword`, …) + a one-line key hint and
    the current mode. Drawn after the iso blit like the bank/shop panels.
- `index.ts`: wire `onEquipAction` to `conn.sendEquipAction`.

## 4. Error handling

- Equip empty/out-of-range inventory slot → no-op (false).
- Equip non-equippable item → notice "You can't equip that.", no change.
- Equip into an occupied slot → swap (old gear back to the now-free inventory slot); never drops gear.
- Unequip an empty slot → no-op.
- Unequip into a full inventory → refuse + notice; gear stays equipped (no item loss).
- Damage never negative: `max(0, rolled − defence)`. Defence never makes a player un-hittable by
  design here (flat reduction can floor a small hit to 0 — acceptable for bronze-tier numbers).
- Corrupt equipment JSON on load → default empty equipment.

## 5. Testing

- `equipment.test.ts` (protocol): `EQUIPMENT`/`EQUIP_SLOTS`/`isEquippable`; round-trip
  `EquipActionMsg`/`EquipmentMsg`.
- `equipment-system.test.ts` (server, minimal `GameWorld`, no server boot): equip moves item→slot
  and frees inv slot; equip swaps when slot occupied; equip non-equippable refused; unequip returns
  to inventory; **unequip into full inventory refused, gear retained**; `playerMaxHit`/`playerDefence`
  computed from gear.
- `combat-system` tests: equipped weapon raises a player's max hit (deterministic rng); equipped
  armour reduces incoming NPC damage vs unarmoured baseline (fixed rng); unarmed/unarmoured behaviour
  unchanged (regression).
- `db.test.ts`: equipment round-trips; new account → empty; corrupt JSON → empty.
- Client: `game-state.test.ts` (setEquipment/toggleEquip/closeEquip); `connection.test.ts`
  (sendEquipAction serialization; `equipment` msg updates state + fires `onEquipment`).
- Integration (`equipment.integration.test.ts`): equip a sword + body from inventory; attack an NPC
  and confirm damage can exceed the unarmed cap; have an NPC hit an armoured player and confirm
  reduced damage; persist + reload and confirm gear + stats survive.
- `bun run typecheck` clean; `bun test` green; `bun run verify:render` green.

## 6. Sequencing (for `/plan`)

1. **Protocol** — `equipment.ts` (slots, stats, consts), gear items in `ITEM_KINDS`, the two
   messages + registrations; tests.
2. **Persistence** — `equipment` column + migration + `savePlayerState` arg; tests (call sites in
   `server.ts` pass a placeholder until Unit 5).
3. **Engine** — `entities.ts`/`game.ts` state + command wrappers; `equipment-system.ts`
   (equip/unequip/swap/stat helpers); tests.
4. **Combat integration** — `combat-system.ts` uses `playerMaxHit` + applies player `playerDefence`;
   tests.
5. **Server wiring + world** — login `EquipmentMsg`, `equipAction` handler, both `savePlayerState`
   call sites, ground seed + shop stock.
6. **Client** — state, connection, modal equipment panel (locked keys), `index.ts` wiring; tests +
   `verify:render`.
7. **Integration test + `/review` + local merge** to `main`.

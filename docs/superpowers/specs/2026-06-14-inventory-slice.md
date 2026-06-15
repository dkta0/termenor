# Termenor — Vertical Slice 5: Inventory + Ground Items

Status: **spec** · Branch: `feat/inventory` · Date: 2026-06-14

## 1. Goal

Items exist in the world: players pick them up off the ground into a 28-slot inventory and
drop them back. All item state is **server-authoritative**; inventory **persists** across
reconnect (it would feel broken otherwise, given slice 3 persists position). Ground items are
visible to everyone.

"Done" = log in, walk onto a seeded item, press grab → it appears in the inventory panel;
press drop → it returns to the ground where others see it; reconnect → inventory restored.

### Non-goals
- No equipping/using items, banking, shops, or trading (later slices).
- No item examine text, weight, or noted items. No drag-and-drop UI.
- Fixed small item registry (no data-driven content pipeline yet).

## 2. Success criteria (concrete & checkable)
1. **Item types + registry (tested).** `protocol/items.ts`: `ItemStack {item,qty}`, an
   `ITEMS` registry (a handful: coins, logs, bronze_sword, shrimp) with display name + render
   glyph/color; helper `isItem(id)`.
2. **Server inventory ops (tested).** `inventory.ts` pure helpers: `addToInventory(slots,
   stack)` stacks same item / fills first empty slot / returns `{slots, leftover}` when full
   (28 cap); `removeSlot(slots, i)` empties a slot and returns its stack. Unit-tested incl.
   full-inventory and stacking.
3. **Ground/pickup/drop in Game (tested).** `Game` holds `groundItems: GroundItem
   {id,item,qty,x,y}[]`; `pickup(username)` moves items on the player's tile into inventory
   (partial if it fills up; leftover stays on ground); `drop(username, slot)` moves a slot's
   stack to a new ground item at the player's tile. Tested.
4. **Protocol.** `SnapshotMsg` gains `ground: GroundItem[]` (everyone renders ground items).
   Client→server `PickupMsg {t:"pickup"}` and `DropMsg {t:"drop",slot}`. Server→owner
   `InventoryMsg {t:"inventory",slots}` sent on change + once at login.
5. **Persistence.** `accounts` gains an `inventory TEXT` (JSON) column; restored on login,
   saved on disconnect + periodically. New accounts start empty.
6. **Client render.** Ground items render as small colored sprites on their tiles; an
   inventory panel (text overlay, right or bottom) lists the 28 slots (`name xqty`). Keys:
   grab (`g`) → pickup; drop the selected slot (`d` drops slot 0, or number keys 1–9 drop that
   slot — keep minimal). Movement/chat gating respected (no pickup while typing chat).
7. **No regressions.** Full `bun test` green, `bun run typecheck` clean, `verify:render` green.

## 3. Architecture

### 3.1 Protocol (`packages/protocol/`)
- New `items.ts`: `export interface ItemStack { item: string; qty: number }`; `GroundItem
  { id: number; item: string; qty: number; x: number; y: number }`; `ITEMS: Record<string,
  { name: string; glyph: string; color: [number,number,number]; stackable: boolean }>`;
  `isItem(id): boolean`. Re-export from `index.ts`.
- `index.ts`: `SnapshotMsg` += `ground: GroundItem[]`. Add `PickupMsg`, `DropMsg` to
  `ClientMsg`; `InventoryMsg` to `ServerMsg`. Update type-sets + decode guards. `INV_SIZE=28`.

### 3.2 Server
- `inventory.ts` (new, pure): `addToInventory`, `removeSlot`, `emptyInventory()` (length-28
  null array). Stacking: stackable items merge qty; non-stackable take a slot each.
- `game.ts`: `Player` gains `inventory: (ItemStack|null)[]`. `Game` holds `groundItems` +
  `nextItemId`. `addPlayer(id, state?)` restores `state.inventory`. `getPlayerState` returns
  inventory. `pickup(id)`/`drop(id, slot)` mutate state, return whether inventory changed.
  `snapshot()` includes `ground`. `addGroundItem(item, qty, x, y)` for seeding.
- `world.ts`: seed a few ground items near spawn (e.g. coins, logs) via the Game after build,
  or expose seed data the server applies on start.
- `server.ts`: handle `pickup`/`drop` in the authed branch → call Game → if changed, send
  `InventoryMsg` to that ws. Send `InventoryMsg` once right after `welcome`. Persist inventory
  in the disconnect/periodic save.
- `db.ts`: `accounts.inventory TEXT`; `getOrCreateAccount` returns parsed inventory (empty for
  new); `savePlayerState(..., inventory)` serializes JSON. Migration: `ALTER TABLE ... ADD
  COLUMN inventory TEXT` guarded so existing dbs upgrade (or just include in CREATE — fresh
  dbs are fine; for existing, attempt the ADD COLUMN in a try/catch).

### 3.3 Client
- `game-state.ts`: store `ground: GroundItem[]` (from snapshot) and `inventory:
  (ItemStack|null)[]` (from `InventoryMsg`).
- `connection.ts`: `sendPickup()`, `sendDrop(slot)`; handle `inventory` → store; `snapshot`
  already carries `ground` → store.
- `render/rasterize.ts`: `rasterizeIso(..., ground)` draws each ground item as a small sprite
  (its `ITEMS[item].color`) at the item's tile center, depth = x+y (sits on ground, occluded
  by walls in front). New `Kind.ITEM`.
- `render/renderer.ts`: inventory panel overlay (reuse `textCells`): list non-empty slots as
  `${i}: ${ITEMS[item].name} x${qty}`. Keys (when chat inactive): `g` → `hooks.onPickup()`;
  number keys `1`–`9` → `hooks.onDrop(n-1)` (drop that slot). Add hooks `onPickup`/`onDrop`.
- `index.ts`: wire `onPickup: () => conn.sendPickup()`, `onDrop: (s) => conn.sendDrop(s)`.

## 4. Error handling
- Pickup on an empty tile → no-op (no inventory message). Drop of an empty slot → no-op.
- Inventory full on pickup → take what fits, leave the rest on the ground (partial).
- Unknown item id in registry → render a default glyph/color; never throw.
- `drop` slot out of range → ignored. All item state changes validated server-side.

## 5. Testing
- **Unit:** `items` registry/`isItem`; `inventory` add/remove/stack/full; protocol round-trips
  (pickup/drop/inventory + snapshot-with-ground); `db` inventory save/restore.
- **Server unit:** `Game.pickup`/`drop` (stack, partial-when-full, ground create/remove, tile
  match); snapshot carries ground.
- **Integration:** login → server seeds an item on spawn tile (or move onto a seeded tile) →
  `pickup` → receive `inventory` with the item; `drop(slot)` → item reappears in `ground`
  snapshot at the player tile; reconnect → inventory restored from DB.
- **Visual/PTY:** keep `verify:render` green; manually confirm ground sprites + inventory
  panel render.

## 6. Sequencing (for `/plan`)
1. Protocol `items.ts` (ItemStack/GroundItem/ITEMS/isItem) + INV_SIZE.  2. Protocol messages
(pickup/drop/inventory + snapshot.ground).  3. Server `inventory.ts` pure helpers + tests.
4. `Game` ground/inventory/pickup/drop/snapshot + tests.  5. `db.ts` inventory column +
restore/save + tests.  6. Server wiring (pickup/drop handlers, InventoryMsg, seed, persist).
7. Client state + connection (ground, inventory, sendPickup/sendDrop).  8. Renderer (ground
sprites + inventory panel + g/number keys).  9. index wiring.  10. Integration test.  11. Review.

**Risk:** inventory persistence migration on an existing db (ADD COLUMN) — guard it. Keep the
drop UX minimal (number keys) to avoid a slot-selection cursor this slice.

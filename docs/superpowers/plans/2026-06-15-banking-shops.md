# Banking + Shops (Slice 10) Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. TDD each unit; commit per unit; `bun test` green + `bun run typecheck` clean before moving on.

> **Status (2026-06-15):** this branch was rebased onto `refactor/game-systems`. The server is now
> a `GameWorld` store + System modules (ADR-0002) with `*State`/`*Entity`/`*Kind` naming (ADR-0001).
> **Units 1–2 are already implemented** (protocol + bank persistence column). Units 3–6 below are
> updated to the new architecture: bank/shop logic lives in dedicated **command-style systems**
> (`bank-system.ts`, `shop-system.ts`) over `GameWorld` — like `InventorySystem`, no per-tick `step()`.

**Goal:** A persistent per-player bank (deposit/withdraw at a booth) and a general store (buy/sell for coins at a shopkeeper), server-authoritative, with bank + shop panels in the client.

**Architecture:** Bank booth and shop are non-gatherable **`ResourceEntity`s** (reuse slice-9 resources: they render as billboards, never wander/deplete, and aren't targeted by `a`/`c`). Bank is a flat `ItemStack[]` on `PlayerEntity` (everything stacks), persisted as a JSON column like inventory/skills. Shop stock is in-memory on `GameWorld`, seeded from a `SHOPS` table. Bank/shop logic is two new systems (`bank-system.ts`, `shop-system.ts`) of functions over `GameWorld`; `GameWorld` holds the state and exposes thin command methods that delegate to them. Open/action messages are request/response: client sends an action, server mutates via the command, and replies with the fresh Bank/Shop message to that socket.

**Tech Stack:** TypeScript, Bun, monorepo. Spec: `docs/superpowers/specs/2026-06-15-banking-shops-slice.md`. Branch: `feat/banking-shops`.

Verified reuse points (post-refactor):
- `inventory.ts` (pure helper): `addToInventory(slots,{item,qty})=>{slots,leftover}`, `removeSlot(slots,i)=>{slots,removed}`, `emptyInventory()`. The `InventorySystem` (`inventory-system.ts`) is the model for a command-style system: pure functions `f(w: GameWorld, ...)`, thin wrappers on `GameWorld`, no `step()`.
- `entities.ts`: `PlayerEntity` (fields incl. `inventory`, `skills`), `NpcEntity`, `ResourceEntity`, `FireEntity`, `GameEvents`. Add `bank: ItemStack[]` to `PlayerEntity` here.
- `game.ts` (`GameWorld`): `isAdjacent` from `./combat` (pure helper); resources via `spawnResource(type,x,y)` reading `RESOURCE_KINDS`; per-socket delivery in `server.ts` via the `sockets: Map<username,ws>` map; `getPlayerState`/persistence (`savePlayerState(db,u,x,y,facing,inventory,skills,bank)` — `bank` param added in Unit 2); the unified `events: GameEvents` buffer (`events.gatherNotices` is the generic per-player notice channel). System-shared fields on `GameWorld` are accessible (`/** @internal */`); add `shops` there the same way.
- `db.ts`: JSON column + `try{ALTER TABLE...}catch{}` migration pattern; `RestoredState`/`PlayerStateRecord` (already extended with `bank` in Unit 2).
- `RESOURCE_KINDS` (in `resources.ts`, type `ResourceKind`) entries have a `gatherable` flag; the gather pass (`gather-system.ts`) skips/clears non-gatherable.
- `renderer.ts` (client): keypress handler, chat-gated; digit `1-9`→`onDrop` (MUST be intercepted by panel-open state first); inventory panel drawn at right edge from `state.inventory`.

**Concrete panel key scheme (lock this — do not expand):**
- Open (no panel open, chat inactive): `b` → if adjacent to a `bank_booth`, `onOpen("bank", boothId)`. `o` → if adjacent to a `general_store`, `onOpen("shop", storeId)`.
- Bank open: `Esc` closes (client-side: `state.bankOpen=false`). Default DEPOSIT mode; `w` → withdraw mode, `d` → deposit mode. Digit `1-9`: deposit mode → `onBankAction("deposit", invSlot=digit-1, qty=-1)` (all of that inventory slot); withdraw mode → `onBankAction("withdraw", bankIndex=digit-1, qty=-1)` (all of that bank entry). (`qty=-1` = "all".)
- Shop open: `Esc` closes. Default BUY mode; `s` → sell mode, `b` → buy mode. Digit `1-9`: buy mode → `onShopAction("buy", entry[digit-1].item, 1)`; sell mode → `onShopAction("sell", entry[digit-1].item, 1)`.
- Panel-open branches sit at the TOP of the not-chatting handler and `return` after handling, so digits don't fall through to `onDrop`.

---

## Unit 1 — Protocol: shops table, consts, five messages — ✅ DONE (commit `bf661b4`)

**Files:** create `shops.ts`; modify `index.ts`; tests `index.test.ts` (+ a shops assertion).

1. `shops.ts`:
```typescript
export interface ShopEntry { item: string; price: number; stock: number; }
export const SELL_RATE = 0.5; // sell price = floor(price * SELL_RATE)
export const BANK_CAP = 200;  // max distinct bank entries
export const SHOPS: Record<string, { name: string; entries: ShopEntry[] }> = {
  general_store: { name: "General Store", entries: [
    { item: "logs",          price: 4,   stock: 100 },
    { item: "raw_shrimp",    price: 3,   stock: 100 },
    { item: "bronze_axe",    price: 16,  stock: 5 },
    { item: "bronze_pickaxe",price: 16,  stock: 5 },
    { item: "tinderbox",     price: 8,   stock: 5 },
    { item: "small_net",     price: 8,   stock: 5 },
  ] },
};
```
2. `index.ts` — add and register (ClientMsg/CLIENT_TYPES + ServerMsg/SERVER_TYPES):
```typescript
export interface OpenMsg { t: "open"; what: "bank" | "shop"; targetId: string; }
export interface BankActionMsg { t: "bankAction"; action: "deposit" | "withdraw"; slot: number; qty: number; }
export interface ShopActionMsg { t: "shopAction"; action: "buy" | "sell"; item: string; qty: number; }
export interface BankMsg { t: "bank"; items: ItemStack[]; open: boolean; }
export interface ShopMsg { t: "shop"; shopId: string; name: string; entries: ShopEntry[]; open: boolean; }
```
Add `"open","bankAction","shopAction"` to CLIENT_TYPES; `"bank","shop"` to SERVER_TYPES. `export * from "./shops";`. Import `ShopEntry` for `ShopMsg`.
3. Tests: round-trip each of the five messages; assert `SHOPS.general_store` exists with entries; `SELL_RATE === 0.5`.
4. `bun test packages/protocol/src/` green; protocol typechecks. Commit: `feat(protocol): banking+shops messages, SHOPS table, SELL_RATE/BANK_CAP`.

---

## Unit 2 — Persistence: bank column — ✅ DONE (commit `af0f5cf`)

**Files:** modify `db.ts`; test `db.test.ts`.

- `PlayerStateRecord` += `bank: ItemStack[]`. `openDb`: `bank TEXT` in CREATE + migration guard. `getOrCreateAccount`: SELECT `bank`; new → `[]`; existing → parse with try/catch → `[]`. `savePlayerState`: add `bank: ItemStack[]` param (after skills), persist `JSON.stringify(bank)`. Callers in `server.ts` pass `[]` for now (Unit 4 wires the real bank).
- Tests: bank round-trips; new account → `[]`; corrupt JSON → `[]`.
- `bun test packages/server/src/db.test.ts` green; server suite green. Commit: `feat(server): persist player bank (JSON column + migration)`.

---

## Unit 3 — Bank + shop systems + booth/keeper entities — ⬜ TODO

**Files:** create `bank-system.ts` + `bank-system.test.ts`, `shop-system.ts` + `shop-system.test.ts`; modify `resources.ts`, `entities.ts`, `game.ts`. (Split the two systems into two commits if it keeps the diff reviewable.)

Pattern to follow: `inventory-system.ts` — a command-style system is a set of exported functions `f(w: GameWorld, ...)` that read/mutate state on `w`; `GameWorld` keeps a thin command method that delegates. No `step()` (these aren't per-tick).

1. **`resources.ts` (`RESOURCE_KINDS: Record<string, ResourceKind>`):** add two non-gatherable kinds —
   `bank_booth: { name:"Bank booth", color:[180,170,60], skill:"", tool:null, yield:"", xp:0, charges:0, respawnTicks:0, cooldownTicks:0, gatherable:false }` and
   `general_store: { name:"General Store", color:[200,120,200], ... gatherable:false }`. (Match the exact `ResourceKind` field list. These render via the resource billboard; never gathered — the gather pass skips `gatherable:false`.)

2. **`entities.ts`:** `PlayerEntity` += `bank: ItemStack[]`.

3. **`game.ts` (`GameWorld` — state + thin commands):**
   - `addPlayer`: seed `bank: state?.bank ?? []` into the new player. `RestoredState` += `bank?: ItemStack[]`. `getPlayerState` returns `bank`.
   - Add in-memory shop stock: a field `shops: Record<string, { name: string; entries: ShopEntry[] }>` initialized in the constructor as a DEEP COPY of `SHOPS` (so stock mutates without touching the imported catalog). Mark it `/** @internal */` (system-shared), import `SHOPS` (and `ShopEntry` type). Keep it accessible to `shop-system` like the other internal fields.
   - Thin command wrappers delegating to the systems (these are the command surface `server.ts` calls — keep signatures stable):
     `openBank(id, boothId)`, `getBank(id)`, `deposit(id, invSlot, qty)`, `withdraw(id, bankIndex, qty)` → `bankSys.*(this, ...)`;
     `openShop(id, npcId)`, `getShop(shopId)`, `buy(id, shopId, item, qty)`, `sell(id, shopId, item, qty)` → `shopSys.*(this, ...)`.

4. **`bank-system.ts`** (functions over `GameWorld`; import `addToInventory`/`removeSlot` from `./inventory`, `isAdjacent` from `./combat`, `BANK_CAP` from protocol, types from `./entities` + `import type { GameWorld }`):
   - `openBank(w, playerId, boothId): boolean` — player exists, a `bank_booth` `ResourceEntity` with that id exists and `isAdjacent(player, booth)` → true (server then sends BankMsg). Else false.
   - `getBank(w, playerId): ItemStack[]`.
   - `deposit(w, playerId, invSlot, qty)`: read inventory slot; empty → no-op. Move `min(qty<0?slot.qty:qty, slot.qty)`: decrement/clear the inventory slot, merge into bank (existing entry by item → add qty; else push new, respecting `BANK_CAP` — at cap with no existing entry → refuse + notice).
   - `withdraw(w, playerId, bankIndex, qty)`: read bank entry; move `min(qty<0?entry.qty:qty, entry.qty)` into inventory via `addToInventory` (respect 28 cap → partial; only remove from bank what was actually added). Remove emptied bank entries.

5. **`shop-system.ts`** (import `SHOPS`/`SELL_RATE` from protocol, `addToInventory`/`removeSlot`, `isAdjacent`, types + `import type { GameWorld }`):
   - `openShop(w, playerId, npcId): string|null` — a `general_store` `ResourceEntity` with that id, adjacent → return shopId (`"general_store"`); else null.
   - `getShop(w, shopId)` — reads `w.shops`.
   - `buy(w, playerId, shopId, item, qty)`: entry exists + `stock>=qty` + coins ≥ `price*qty` + inventory room → remove `price*qty` coins, add `qty` item, `stock-=qty`. Else refuse + notice (insufficient coins / no stock / no room).
   - `sell(w, playerId, shopId, item, qty)`: player has ≥1 of item; sellQty = `min(qty, owned)`; price = `floor(entryPrice * SELL_RATE)` (item not listed → refuse this slice). Remove sellQty item, add `price*sellQty` coins via `addToInventory`, `stock+=sellQty`. Else refuse + notice.
   - Coin helpers (module-local, not on `GameWorld`): `coinCount(p)`, `removeCoins(p, n)`; coins added via `addToInventory`. Coins are item id `coins` (stackable).

6. **Notices:** refusals push to `w.events.gatherNotices` (the unified generic per-player notice channel the server already drains into the snapshot) — no new buffer.

7. **Tests (write first, construct a minimal `GameWorld` — do NOT boot the server):**
   - `bank-system.test.ts`: deposit moves+merges+clears slot; deposit "all" (qty=-1); withdraw respects 28-slot capacity (fill inventory, partial withdraw leaves remainder in bank); withdraw clamps qty; `BANK_CAP` refusal; bank persists via a db round-trip (save bank, reload); `openBank` requires adjacency (not adjacent → false).
   - `shop-system.test.ts`: buy success (coins--, item+, stock--); buy insufficient coins refused (no change); buy no room refused; buy out of stock refused; sell success (item-, coins+ = `floor(price*SELL_RATE)*qty`, stock+); sell nothing refused; coin totals exact; `openShop` requires adjacency (not adjacent → null).

8. `bun test packages/server/src/` + full suite green; `bun run typecheck` clean. Commit(s): `feat(server): extract BankSystem (deposit/withdraw/open)` and `feat(server): extract ShopSystem (buy/sell/open)` (or a single `feat(server): bank + shop systems, booth/keeper entities` if kept small).

---

## Unit 4 — Server wiring + world spawns — ⬜ TODO

**Files:** modify `server.ts`, `world.ts`.

`game` in `server.ts` is the `GameWorld` instance, so the command calls below are unchanged (`game.openBank(...)`, etc. — they delegate to the systems internally).

- `world.ts`: add `RESOURCE_SPAWNS` entries `{type:"bank_booth",x:25,y:22}` and `{type:"general_store",x:22,y:24}` (verify walkable, near spawn, not overlapping). 
- `server.ts`: handle the three client msgs in the authed branch:
  - `open`: if `msg.what==="bank"` → `if (game.openBank(u, msg.targetId)) send BankMsg{items:getBank, open:true}`. If `"shop"` → `const sid = game.openShop(u, msg.targetId); if (sid) send ShopMsg{shopId:sid, name, entries:getShop(sid).entries, open:true}`.
  - `bankAction`: `game.deposit/withdraw(...)`; then send fresh `BankMsg{items:getBank(u), open:true}` to that socket. Refusal notices ride along generically via `events.gatherNotices` drained in the tick loop.
  - `shopAction`: `game.buy/sell(...)`; then send fresh `ShopMsg{... open:true}` AND an `InventoryMsg` (coins/items changed) to that socket.
  - After bank changes, also send `InventoryMsg` (inventory changed).
  - Persist `bank`: the periodic `savePlayerState(...)` already takes a trailing `bank` arg (Unit 2, currently the placeholder `[]`) — switch it to `state.bank ?? []` at both call sites.
- `bun test packages/server/src/` green; typecheck server-clean. Commit: `feat(server): wire open/bank/shop actions + responses; spawn booth+store`.

---

## Unit 5 — Client: state, connection, panels, inputs — ⬜ TODO

**Files:** modify `game-state.ts`, `connection.ts`, `render/renderer.ts`, `index.ts`; tests. (Client-side only — unaffected by the server systems split; the new `BankMsg`/`ShopMsg`/`OpenMsg`/`BankActionMsg`/`ShopActionMsg` types from Unit 1 are already in the protocol.)

- `game-state.ts` (TDD): `bank: ItemStack[]=[]`, `bankOpen=false`, `shop:{shopId;name;entries}|null=null`, `shopOpen=false`; setters `setBank(items,open)`, `setShop(shopId,name,entries,open)`, `closeBank()`, `closeShop()`; nearest-target helper `nearestResourceOfType(type, now): id|null` (from sampleResources). Tests: setBank/setShop set state+flags; closeBank clears flag; nearestResourceOfType picks nearest matching.
- `connection.ts`: `sendOpen(what,targetId)`, `sendBankAction(action,slot,qty)`, `sendShopAction(action,item,qty)`; handle `bank`→`setBank(msg.items,msg.open)`, `shop`→`setShop(...)`. Import the message types.
- `render/renderer.ts`: implement the locked key scheme above (panel-open branches FIRST, return after). Add hooks `onOpen?`, `onBankAction?`, `onShopAction?` to `RendererHooks`. Render the bank panel when `bankOpen` (list `state.bank` with index+qty) and shop panel when `shopOpen` (list entries with `price`/`stock`, show current mode), reusing the inventory-panel drawing approach; show a one-line hint of the keys. Track deposit/withdraw + buy/sell mode as local renderer state.
- `index.ts`: wire `onOpen`, `onBankAction`, `onShopAction` to the connection send helpers.
- `bun run typecheck` fully clean; `bun test` green; `bun run verify:render` green. Commit: `feat(client): bank + shop panels, open/deposit/withdraw/buy/sell inputs`.

---

## Unit 6 — Integration test + review — ⬜ TODO

- Server integration test: give a player coins + items + a bank booth + store adjacent; deposit items → bank holds them, inventory slot cleared; withdraw → back in inventory; round-trip the bank through `savePlayerState`/`getOrCreateAccount` (relogin-equivalent) and confirm persistence; buy an item (coins decrease by price, stock decreases) then sell it back (coins increase by floor(price*SELL_RATE)); assert exact coin totals. Commit.
- `/review` vs spec. Fix blocking findings. Mark slice 10 done in ROADMAP + OPERATING-PROCEDURE; merge to main.

---

## Self-Review (plan vs spec)
- §2.1 bank+protocol → Units 1,3. §2.2 shop+protocol → Units 1,3. §2.3 bank engine → Unit 3.
  §2.4 shop engine → Unit 3. §2.5 booth/keeper → Unit 3 (resources) + Unit 4 (spawns). §2.6
  persistence → Unit 2 + Unit 4 save wiring (shop stock in-memory, noted). §2.7 client UI/input →
  Unit 5 (locked key scheme). §2.8 no regressions → Units 5-6.
- §4 error handling: open requires adjacency; out-of-range/unknown/zero-qty no-op; withdraw partial
  on full inv; buy insufficient/no-room/no-stock refused (no partial coin loss); sell nothing
  refused; bank parse failure → []; move semantics (remove before/with add — no dupes); coins never
  negative. Covered in Unit 3 + tests.
- Scope guard: ONE locked key scheme; bank/shop reuse inventory helpers + resources; no noted items,
  tabs, or dynamic pricing.

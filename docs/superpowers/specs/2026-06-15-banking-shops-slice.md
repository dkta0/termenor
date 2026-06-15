# Termenor — Vertical Slice 10: Banking + Shops

Status: **spec** · Branch: `feat/banking-shops` · Date: 2026-06-15

> **Architecture note (updated 2026-06-15):** this branch was rebased onto the
> `refactor/game-systems` work. The server is now a `GameWorld` state store + focused
> **System** modules (see [ADR-0002](../../adr/0002-systems-over-shared-world.md)), and types
> follow the `*State`/`*Entity`/`*Kind` convention (see
> [ADR-0001](../../adr/0001-three-layer-type-naming.md)). This spec reflects that: bank/shop
> logic lives in dedicated systems over `GameWorld`, not in a `Game` god-object. Units 1–2
> (protocol + persistence) are already implemented on this branch.

## 1. Goal

Two item-economy features built on the slice-5 inventory + slice-3 persistence + slice-6 NPCs:

- **Banking:** a per-player **bank** (large store, everything stacks) opened at a bank booth.
  Deposit/withdraw between inventory and bank. Bank persists across sessions.
- **Shops:** a **general store** opened at a shopkeeper. Buy items for coins (fixed price), sell
  inventory items for coins. Shop stock is server-authoritative.

"Done" = stand by the bank booth, open the bank, deposit your logs/ore, withdraw them later (and
they're still there after relogin); stand by the shopkeeper, buy an item with coins and sell one
for coins, with balances updating correctly. Server-authoritative; client shows a bank panel and a
shop panel.

### Non-goals
- No grand-exchange / player economy / price fluctuation (fixed shop prices this slice).
- No bank tabs, placeholders, search, or noted items. One flat bank store.
- No shop stock depletion/restock dynamics beyond a simple per-item stock count (keep it minimal —
  may even be "infinite stock" for buys; see §3). No buy/sell of un-tradeable/quest items.
- No equipment (slice 11). Bank/shop operate on plain inventory items.

## 2. Success criteria (concrete & checkable)
1. **Bank store + protocol.** `PlayerEntity` gains a `bank: ItemStack[]` (compact list, not fixed
   slots; everything stacks regardless of `ITEM_KINDS.stackable`). Messages: client `BankActionMsg
   {t:"bankAction"; action:"deposit"|"withdraw"; slot:number; qty:number}` (slot indexes the
   inventory for deposit, the bank list for withdraw; `qty` may exceed available → clamp; a
   sentinel like `qty:-1` or a large number means "all"). Server `BankMsg {t:"bank"; items:
   ItemStack[]; open:boolean}` pushes bank contents + whether the bank UI should be open. Open via
   `OpenMsg {t:"open"; what:"bank"|"shop"; targetId:string}` (client requests open near a booth/NPC).
   Round-trip tested.
2. **Shop stock + protocol.** A shop definition (id, name, list of `{item, price, stock}`). Server
   `ShopMsg {t:"shop"; shopId:string; name:string; entries:{item:string;price:number;stock:number}[];
   open:boolean}`. Client `ShopActionMsg {t:"shopAction"; action:"buy"|"sell"; item:string;
   qty:number}`. Buy price = listed price; sell price = `floor(price * SELL_RATE)` (e.g. 0.5; items
   not stocked by the shop sell at a small default or are refused — pick one and test it).
3. **Bank engine (`bank-system.ts`, tested).** `openBank(playerId, boothId)` validates the player is adjacent
   to a bank booth → marks bank open + returns contents. `deposit(playerId, invSlot, qty)` moves up
   to qty of that inventory slot's item into the bank (merging stacks); `withdraw(playerId,
   bankIndex, qty)` moves up to qty from the bank into the inventory (respecting 28-slot capacity;
   partial if inventory fills). Coins work like any item. Tested: deposit merges + clears slot;
   withdraw respects capacity; qty clamping; deposit-all; bank persists in snapshot-independent
   state.
4. **Shop engine (`shop-system.ts`, tested).** `openShop(playerId, npcId)` validates adjacency to a shopkeeper
   → returns shop. `buy(playerId, shopId, item, qty)`: requires coins ≥ price*qty and inventory room
   and stock; deduct coins, add item, decrement stock. `sell(playerId, shopId, item, qty)`: requires
   the item in inventory; remove up to qty, add coins = sellPrice*qty, increment stock. Tested: buy
   success + insufficient coins refused + no room refused + stock limit; sell success + nothing-to-
   sell refused; coin math exact.
5. **Booths/shopkeeper in world.** A `bank` booth (a resource-like static object OR a flagged NPC)
   and a `shopkeeper` NPC near spawn. Opening requires adjacency. (Reuse the resource billboard or
   NPC system — choose the simpler; a non-wandering NPC of type `banker`/`shopkeeper` is fine.)
6. **Persistence.** `bank` persists to SQLite (JSON column, mirroring inventory/skills). Restored on
   login. Shop stock may be in-memory (resets on server restart) — acceptable this slice; note it.
7. **Client UI + input.** A **bank panel** (list of bank items with index + qty) and a **shop panel**
   (entries with price + stock, and a hint to buy/sell). Open with a key (e.g. `b` near a bank
   booth → opens bank; `o` near a shopkeeper → opens shop) — client sends `OpenMsg` for the nearest
   matching target; server replies with Bank/Shop msg with `open:true`. While a panel is open,
   number/letter keys perform deposit/withdraw or buy/sell on the highlighted/important entries
   (keep the interaction minimal but usable: e.g. digit picks an entry, modifier or second key
   chooses deposit-vs-withdraw / buy-vs-sell — define a concrete, documented scheme). `Esc` closes.
   All gated while chatting. Panels render via the existing panel/overlay mechanism (like the
   inventory panel).
8. **No regressions.** Full `bun test` green, `bun run typecheck` clean, `verify:render` green.

## 3. Architecture

### 3.1 Protocol
- `bank.ts` or extend `items.ts`: nothing new for item shape (reuse `ItemStack`). Add `SELL_RATE`
  and `BANK_CAP` (max distinct bank entries, e.g. 200) consts.
- `shops.ts` (new): `ShopEntry {item:string; price:number; stock:number}`, `SHOPS:
  Record<string,{name:string; entries:ShopEntry[]}>` with one `general_store`. `SELL_RATE = 0.5`.
- `index.ts`: add the four/five messages from §2.1–2.2 to `ClientMsg`/`ServerMsg` unions +
  type sets: `OpenMsg`, `BankActionMsg`, `ShopActionMsg` (client); `BankMsg`, `ShopMsg` (server).
  Round-trip test each.

### 3.2 Server: `GameWorld` state + `bank-system.ts` / `shop-system.ts`

Follow ADR-0002: `GameWorld` (in `game.ts`) owns the state and exposes thin command methods;
the logic lives in **System** modules of functions over `GameWorld`. Bank and shop are
**command-style systems** (no per-tick `step()`, like `InventorySystem`).

- **`entities.ts`:** `PlayerEntity` += `bank: ItemStack[]`. `RestoredState` (in `game.ts`) += `bank?`.
- **`GameWorld` state + commands (`game.ts`):** `addPlayer` seeds `bank` from `state?.bank ?? []`;
  `getPlayerState` returns `bank`. Add an in-memory `shops` field (a deep copy of `SHOPS` so stock
  mutates without touching the imported catalog), made accessible to the systems (`/** @internal */`,
  same as the other system-shared fields). Thin command wrappers `openBank`, `deposit`, `withdraw`,
  `getBank`, `openShop`, `buy`, `sell`, `getShop` delegate to the systems (signatures are the command
  surface `server.ts` calls).
- **`bank-system.ts`:** `openBank(w, playerId, boothId)`, `deposit(w, playerId, invSlot, qty)`,
  `withdraw(w, playerId, bankIndex, qty)`, `getBank(w, playerId)`. Use `addToInventory`/`removeSlot`
  (`./inventory`) for the inventory side; the bank side is a flat merge-by-item list. Validate
  adjacency with `isAdjacent` (`./combat`).
- **`shop-system.ts`:** `openShop(w, playerId, npcId)`, `buy(w, playerId, shopId, item, qty)`,
  `sell(w, playerId, shopId, item, qty)`, `getShop(w, shopId)`, plus the coin helpers
  (`coinCount`/`removeCoins`, coins added via `addToInventory`). Coin item id is `coins`. Reads
  `w.shops`. Validate adjacency with `isAdjacent`.
- **Booth/keeper:** static, non-gatherable `ResourceEntity`s (`bank_booth`, `general_store` kinds in
  `RESOURCE_KINDS`) — they render as billboards, never wander/deplete, and aren't targeted by the
  gather pass. Opening validates `isAdjacent(player, target)`.
- **Notices/delivery:** refusals push to the unified event buffer `w.events.gatherNotices` (the
  generic per-player notice channel drained when the server builds the snapshot). Bank/Shop contents
  are delivered request/response: `server.ts` calls the command, then sends the requesting socket the
  fresh `BankMsg`/`ShopMsg`. No new per-tick buffer needed.
- **Persistence:** `getPlayerState` returns `bank`; the periodic `savePlayerState(...)` already takes
  a trailing `bank` arg (Unit 2).

### 3.3 Server wiring (`server.ts`, `world.ts`, `db.ts`)
- `db.ts`: `bank TEXT` column + migration guard; save/load `bank`; `RestoredState.bank`. **(done — Unit 2.)**
- `world.ts`: add `RESOURCE_SPAWNS` entries for a `bank_booth` and a `general_store` near spawn; seed
  the general store stock via `SHOPS`.
- `server.ts`: handle `open`/`bankAction`/`shopAction` → call the matching `GameWorld` command; after
  each, send the requesting socket the fresh `BankMsg`/`ShopMsg` (with `open` set appropriately).
  `bank` is already passed to the periodic `savePlayerState(...)` (Unit 2) — switch the placeholder
  `[]` to the player's real `bank` (`state.bank ?? []`).

### 3.4 Client
- `game-state.ts`: store `bank: ItemStack[]`, `bankOpen:boolean`, `shop` (entries+name+id),
  `shopOpen:boolean`; setters from Bank/Shop msgs. Accessors for the panels.
- `connection.ts`: `sendOpen(what,targetId)`, `sendBankAction(action,slot,qty)`,
  `sendShopAction(action,item,qty)`; handle `bank`/`shop` msgs → set state + callbacks.
- `render/renderer.ts`: render the bank panel when `bankOpen` and shop panel when `shopOpen` (reuse
  the inventory-panel drawing). Inputs (chat-gated, and only when the panel is open): a concrete
  scheme — e.g. while bank open: digit `1-9` deposits that inventory slot (all), `Shift`+digit or a
  withdraw mode toggles to withdraw bank index; `Esc` closes. While shop open: digit picks an entry,
  a buy key and a sell key. KEEP IT SIMPLE and document the exact keys in the spec/plan. Add hooks
  `onOpen`, `onBankAction`, `onShopAction`. Open keys: `b` (bank) / `o` (shop) when near a target.
- `index.ts`: wire the new hooks.

## 4. Error handling
- Open when not adjacent to the right target → ignored (no panel). Deposit/withdraw/buy/sell with
  out-of-range slot, unknown item, or zero/negative qty (except the documented "all" sentinel) →
  no-op. Withdraw into a full inventory → partial (move what fits), rest stays in bank. Buy with
  insufficient coins / no room / no stock → refused with feedback, no partial coin loss. Sell an
  item you don't have → refused. Bank JSON parse failure on load → empty bank. Never let coins go
  negative or items duplicate (move semantics: removed from one side before/with adding to the
  other). Closing a panel is always safe.

## 5. Testing
- **Unit:** protocol round-trip for all five messages; SHOPS has general_store; SELL_RATE applied.
- **Server (deterministic):** deposit moves+merges and clears the inventory slot; withdraw respects
  28-slot capacity (partial fill) and clamps qty; deposit/withdraw "all"; bank persists via db
  round-trip. buy: success (coins--, item+, stock--), insufficient coins refused, no room refused,
  out of stock refused; sell: success (item-, coins+ at SELL_RATE), nothing-to-sell refused; coin
  totals exact. open requires adjacency.
- **Client:** bank/shop state set from msgs; panel-open flags; nearest-target pick for open.
- **Visual/PTY:** `verify:render` green; optionally assert a banker/shopkeeper or panel renders.

## 6. Sequencing (for `/plan`)
1. Protocol: shops.ts + consts + the five messages; round-trip tests. 2. db.ts: bank column +
   migration + save/load + RestoredState.bank + tests. 3. Game: bank store + deposit/withdraw/open;
   shop stock + buy/sell/open; booth/keeper entities; getPlayerState bank; tests. 4. Server wiring
   (open/bankAction/shopAction handlers + Bank/Shop responses + persist bank) + world spawns. 5.
   Client: state + connection + bank/shop panels + inputs + hooks + index. 6. Integration test
   (deposit→withdraw across relogin-equivalent; buy→sell coin math) + render verify. 7. Review.

**Risk / scope guard:** the panel input scheme can balloon — pick ONE concrete, minimal, documented
key scheme and stop. Bank/shop are server-authoritative with move semantics (no dupes). Reuse
`addToInventory`/`removeSlot` and `isAdjacent`. Don't build noted items, tabs, or dynamic pricing.

# Termenor — Slice B: Standing Orders / AFK Floor

**Date:** 2026-06-17
**Status:** Approved — ready for planning
**Parent design:** `docs/superpowers/specs/2026-06-17-ambient-coach-interaction-design.md` §3 (passive floor) and §7 (decomposition)
**Builds on:** Slice A — Intent boundary (command line) — `docs/superpowers/plans/2026-06-17-slice-a-intent-boundary.md`

## Design principle

Future-proof the seams, keep the first resolver dumb. A standing order is registered
through the same Intent boundary Slice A established — new activities and stop-conditions
are added by extension, not by editing a parser or a tick-loop switch. The first
implementation is deliberately small.

## 1. Concept

A **standing order** is an *activity* (re-targetable) plus a **stop-condition**, executed
autonomously by the server across ticks. The existing one-shot actions already stop on
their own — gather clears `gatherTarget` when a rock depletes or the inventory fills;
combat clears `target` when an NPC dies. A standing order is a **supervisor** layered on
top: when the low-level action goes idle, it re-acquires the next target of the same
*type* and checks the stop-condition.

Scope for v1 (decided during brainstorming):

- **Activities:** `gather` (mine/chop/fish a resource type) and `combat` (fight an NPC type).
- **Sequencing:** a single active order per player, plus a `stop` command to cancel.
- **Syntax:** suffix the existing verbs with a stop-clause (no clause = today's one-shot action).

**Session-scoped.** The order lives on the player entity and dies on disconnect
(`removePlayer` drops the entity). No persistence / DB changes — this matches the parent
design's "closing the client pauses progress" model.

**Key implementation property:** the supervisor is **purely observational**. It reads
inventory / skill / target state and re-sets existing target fields. It does **not** modify
the gather-system or combat-system modules.

## 2. Protocol (`packages/protocol/src/intents.ts`)

```ts
export type StopCondition =
  | { kind: "forever" }
  | { kind: "count"; n: number }
  | { kind: "untilFull" }                  // gather only
  | { kind: "untilLevel"; level: number }; // gather only

// new Intent variants (added to the discriminated union):
| { kind: "order"; activity: "gather" | "combat"; targetType: string; stop: StopCondition }
| { kind: "stopOrder" }
```

- `order` / `stopOrder` ride **inside** the existing `IntentMsg` wire type — no new
  top-level client message, so `CLIENT_TYPES` (the runtime decode-validation set) is
  untouched.
- `targetType` is the entity `.type` key (`"tree"`, `"rock"`, `"fishing_spot"`,
  `"goblin"`, `"rat"`), resolved client-side from the current world snapshot. The server
  re-finds the nearest live entity of that type each acquisition cycle.
- The executor's handler map is exhaustiveness-checked, so adding these two variants
  forces two new handlers (compile error otherwise).

## 3. Server — the supervisor (`packages/server/src/order-system.ts`, new module)

### State

`PlayerEntity` (`entities.ts`) gains:

```ts
order: ActiveOrder | null;
```

`ActiveOrder` (defined in `entities.ts`, pure type — no import cycle):

```ts
interface ActiveOrder {
  activity: "gather" | "combat";
  targetType: string;
  stop: StopCondition;
  unitsDone: number;          // progress counter for `count`
  baselineYield: number;      // gather: yield-item count in inv at last sample
  engagedNpcId: string | null; // combat: npc currently engaged, for kill detection
}
```

The order is cleared automatically when the player disconnects (whole entity dropped).

### Tick integration

`GameWorld.step()` calls `orderSys.stepOrders(this)` at the **top** of the tick (after
`tick++`, before movement/combat/gather), so a freshly-acquired target acts the same tick.

`stepOrders(w)` — per player with an active order:

1. **Account progress** (observational):
   - gather: `currentYield = count of RESOURCE_KINDS[targetType].yield in inventory`;
     `unitsDone += max(0, currentYield − baselineYield)`; `baselineYield = currentYield`.
   - combat: if `engagedNpcId` is set and that NPC is now dead/gone (`respawnAt >= 0`
     or not found) → `unitsDone++`, `engagedNpcId = null`.
2. **Check stop-condition** (see below). If met → clear order, **safe-idle**, push a
   completion notice.
3. **Else acquire**: if the low-level action is idle (`gatherTarget`/`target` null), find
   the nearest live entity of `targetType` and engage it:
   - gather → set `p.gatherTarget` (nearest live, gatherable resource of that type).
   - combat → `combatSys.setTarget(...)`; remember `engagedNpcId`.
   - If none available → wait (it may respawn); no spammy notice.

### Stop-condition evaluation

A small switch keyed on `stop.kind` (extensible — new conditions register here):

- `forever` → never true.
- `count` → `unitsDone >= n`.
- `untilFull` → dry-run `addToInventory(inv, { item: yield, qty: 1 })` returns a non-null
  `leftover` (exactly the gather-system's fullness semantics). Gather only.
- `untilLevel` → `levelForXp(skills[RESOURCE_KINDS[targetType].skill] ?? 0) >= level`.
  Gather only.

### Safe-idle (v1 default = stop & hold)

On completion or cancel: clear `gatherTarget`, `target`, and `path`; stay put. Richer
policies (return-to-spot, configurable per loadout) are a documented seam, deferred.

### Feedback channel

New `GameEvents.orderNotices: { id: string; text: string }[]` + `consumeOrderNotices()`,
drained in the server tick loop exactly like `gatherNotices` and delivered as a
`chatMsg` from `""`. Messages: order set, order complete, order cancelled.

### GameWorld methods

- `setOrder(playerId, intent)` — build `ActiveOrder`, baseline the gather counter,
  clear conflicting low-level state, return the "Order set: …" notice text.
- `clearOrder(playerId)` — safe-idle + "Order cancelled." notice text.

## 4. Server — executor (`packages/server/src/intent-executor.ts`)

Two new handlers:

- `order` → `game.setOrder(playerId, intent)`; return the notice as a `self` `chatMsg`.
- `stopOrder` → `game.clearOrder(playerId)`; return the notice as a `self` `chatMsg`.

Progress/completion notices are delivered later via the tick-loop `orderNotices` drain
(§3), not from the executor.

## 5. Client — resolver (`packages/client/src/resolve.ts`)

- `parseStopCondition(args)` helper: peels a trailing clause from the arg tokens —
  `forever` | `count N` | `until full` | `until level N`. Returns `{ stop, nameTokens }`
  (`stop = null` when no clause present).
- Gather verbs (`mine`/`chop`/`fish`/`gather`) and attack verbs (`attack`/`fight`/`kill`):
  - With a stop-clause → resolve `nameTokens` to an entity via `matchEntity`, emit
    `{ kind: "order", activity, targetType: ref.type, stop }`.
  - **No clause → today's one-shot intent (back-compat, unchanged).**
- **Validation:** combat accepts only `forever` / `count`. `until full` / `until level N`
  on a combat verb → friendly error ("can't use that stop-condition with combat").
- New `stop` / `halt` verb → `{ kind: "stopOrder" }`.

## 6. Testing (TDD — tests precede implementation)

- **order-system** (server, seeded rng, deterministic per-tick):
  - re-targeting picks the nearest live entity of the type;
  - gather counting; `count`, `untilFull`, `untilLevel` each fire and trigger safe-idle;
  - combat `count` (kills) and `forever`; re-acquire after depletion / death;
  - no target available → waits without error.
- **resolver** (client): each suffix → correct order intent & `targetType`; back-compat
  one-shot path; combat invalid-combo errors; `stop` → `stopOrder`.
- **executor** (server): `order` / `stopOrder` delegate to `setOrder` / `clearOrder` and
  return the expected notices.

## 7. Out of scope (deferred)

- Order queue / `then`-chaining / `repeat` loop.
- Banking-as-order activity (needs pathing-to-booth + deposit-all).
- Richer safe-idle policies (return-to-spot, per-loadout policy).
- Persistence of orders across logout.
- Combat `untilLevel` (no combat skill until the slice 11 follow-up).
- Event-tier / escalation system + single-key responses (**Slice C**).
- Status-panel "current task" display (notices-only feedback for v1).
- Slice A deferrals (hotkey→executor migration, Tab→completions) — left untouched.

## 8. Done criteria

- New `order` / `stopOrder` intents flow client→server through the existing boundary.
- `mine rock until full`, `chop tree count 50`, `fish ... until level N`, `fight goblin
  count 10`, `fight rat forever` all set autonomous orders that run across ticks.
- Orders re-acquire targets, count progress, fire their stop-condition, and safe-idle.
- `stop` cancels the active order and safe-idles.
- All three test suites pass; full `bun test` + typecheck green.

# Goal — "Feels good to play": polish ship, then the ambient-coach event system

**Date:** 2026-06-18
**Type:** North-star / direction doc spanning two ship cycles.
**Status:** Approved (direction). Each phase below runs its own `/spec → /plan →
/implement → /review → /ship`.

## Why this goal

The game has 12 shipped slices and a working core loop, but the next payoff the
project owner wants is in *the moment-to-moment experience*, not more content. Two
sequenced cycles: a quick polish ship to remove friction, then the missing third leg
of the Ambient-Coach model — making the world talk back and letting the player answer
with one key.

This is the natural completion of the Ambient-Coach arc: Slice A
(`2026-06-17-ambient-coach-interaction-design.md`) gave the command line, Slice B
(`2026-06-17-slice-b-standing-orders-design.md`) gave autonomous AFK activity, and
Slice C closes the loop with feedback + response.

---

## Phase 1 — Polish sweep *(small, one cycle)*

Fix the three confirmed client bugs. No new systems. Likely a single session.

1. **Click leaks through HUD / modals** — `packages/client/src/render/renderer.ts:363`.
   The full-screen `clickLayer.onMouseDown` gates clicks only while typing
   (`if (cmd.active) return`). Clicking on the skills HUD (top-left) or an open
   bank/shop/equip panel still resolves to a world tile and walks the player toward it.
   **Fix:** gate clicks when a modal is open (`state.bankOpen || state.shopOpen ||
   state.equipOpen`) or when the cursor is over a HUD region — only treat clicks on the
   open world as move-to.

2. **Login arrow-key toggle** — `packages/client/src/render/login.ts:63`.
   `if (name === "left" || name === "right") { form.toggleMode(); }` — ←/→ silently
   flip login↔register mode, which is surprising and collides with normal field
   editing. **Fix:** make the mode switch explicit/intentional rather than bound to bare
   arrow presses.

3. **9-item modal cap** — `packages/client/src/render/renderer.ts:378, 386, 397`.
   All three modal handlers use `/^([1-9])$/`, so bank/shop/equip rows past #9 are
   unreachable by keyboard. **Fix:** address all rows (paging or two-key entry).

**Done when:** all three bugs fixed with tests, typecheck clean, shipped as its own
small cycle separate from Slice C.

---

## Phase 2 — Slice C: Ambient-coach event system *(the centerpiece, its own full cycle)*

Make the world emit feedback the player can act on with a single key. Four parts:

1. **Server emits tiered events.** Gameplay moments (leveled up, inventory full, under
   attack, order completed/failed, resource depleted) tagged
   `ambient | notable | critical`. Homes already exist: `packages/client/src/log.ts`
   defines `LogTier`, and `packages/server/src/order-system.ts` (Slice B) is the natural
   emitter for autonomous-activity events.

2. **Protocol carries events.** A wire shape for events — and for the response that
   goes back — alongside the existing `Intent` boundary in `packages/protocol/src`.

3. **Client routes events into the 3-tier log.** `LogState` exists and is currently fed
   only by command confirmations; route server events into it and give each tier real
   visual weight in the renderer.

4. **Full single-key response framework.** A critical event can register key-bound
   choices (e.g. `inventory full → [b]ank / [d]rop / [s]top`). The client renders the
   prompt and routes the pressed key back **through the existing intent boundary**, so
   responses reuse the typed intent-executor rather than a parallel code path.

### Scope discipline for Phase 2

The owner deliberately chose the *full framework* (general mechanism, not a one-off
prompt). To keep that from ballooning:

- Ship the framework with a **small fixed set** of event types and **one or two** real
  prompts wired end-to-end as proof.
- It is a general mechanism, **not** a complete event catalog — new event types are
  cheap to add later and we do not enumerate the whole game now.
- Responses route through the **existing** intent boundary; do not introduce a second
  dispatch path.

**Done criteria** live in Slice C's own spec when its cycle starts.

---

## Roadmap note

Phase 2 is "Slice C" in the Ambient-Coach track (deferred out of both Slice A and Slice
B). It sits alongside roadmap Slice 12 (Quests), which remains the next *content* slice
and is intentionally **not** part of this goal.

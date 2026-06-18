# Polish Sweep (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the three confirmed client interaction bugs (click-through HUD/modals, login arrow-key mode toggle, 9-item modal cap) with no new game systems.

**Architecture:** Each fix follows the codebase's established pattern — extract the
decision logic into a pure, render-agnostic helper module with its own `bun:test` unit
tests (like `resolve.ts`, `legend.ts`, `command-line.ts`), then wire it into the
OpenTUI surface (`renderer.ts` / `login.ts`). The renderer recomputes layout every
frame and exposes it to event handlers via closure variables it mutates each frame.

**Tech Stack:** TypeScript, Bun, `bun:test`, OpenTUI 0.4 (`@opentui/core`).

## Global Constraints

- No new game systems; this is a bug-fix sweep only. (goal doc Phase 1)
- Follow existing patterns: pure logic in a tested helper, OpenTUI wiring stays thin.
- The gate for every task is `just check` (= `bun test` + `tsc --noEmit` + three PTY
  smokes: `verify:render`, `verify:click`, `verify:login`). It must pass before commit.
- Commit per completed task, not in bulk.
- Key events: control keys arrive on `key.name`, printable text on `key.sequence`
  (see `login.ts` header comment + [[opentui-0.4-gotchas]]).
- Coordinate systems: mouse events give terminal-**cell** coords (`e.x`, `e.y`); the iso
  pick converts to pixel rows via `e.y * 2` in halfblock tier. HUD chrome is drawn in
  cells, so the click gate works in cell coords.

## File Structure

- `packages/client/src/render/click-gate.ts` *(new)* — pure `isHudClick(x, y, regions)`
  predicate + `HudRegions` type. One responsibility: decide if a click lands on HUD chrome.
- `packages/client/src/render/click-gate.test.ts` *(new)* — unit tests for the above.
- `packages/client/src/render/paging.ts` *(new)* — pure pagination math (`pageCount`,
  `clampPage`, `indexForDigit`, `pageSlice`). One responsibility: 9-per-page index math.
- `packages/client/src/render/paging.test.ts` *(new)* — unit tests for the above.
- `packages/client/src/render/login-form.ts` *(modify)* — add `setMode`.
- `packages/client/src/render/login-form.test.ts` *(modify)* — test `setMode`.
- `packages/client/src/render/login.ts` *(modify)* — directional arrow → mode; hint text.
- `packages/client/src/render/renderer.ts` *(modify)* — wire click gate + modal paging.

---

### Task 1: Login — directional mode select (replace blind arrow toggle)

**Problem:** `login.ts:63` binds *both* ←/→ to `form.toggleMode()`, a non-directional
blind flip between login/register. Confirmed in observation 3296.

**Decision (deviates slightly from the goal doc's "off bare arrows" wording — flag at
review):** The mode widget is a horizontal radio (`(•) Log in   ( ) Register`). The
correct, discoverable fix is to make the arrows **directional**: ← selects `login` (the
left option), → selects `register` (the right option). The login fields are
append/backspace only (no text cursor), so there is nothing for arrows to "fall through"
to — moving the toggle to an undiscoverable key like Ctrl+T would be strictly worse.
This eliminates the actual defect (the blind non-directional flip) while keeping the
on-screen hint honest.

**Files:**
- Modify: `packages/client/src/render/login-form.ts`
- Modify: `packages/client/src/render/login.ts:47-49` (hint), `:63` (key handler)
- Test: `packages/client/src/render/login-form.test.ts`

**Interfaces:**
- Produces: `LoginForm.setMode(mode: "login" | "register"): void` — sets mode
  absolutely (idempotent), unlike `toggleMode()` which flips.

- [ ] **Step 1: Write the failing test**

Add to `packages/client/src/render/login-form.test.ts`:

```ts
test("setMode selects an explicit mode and is idempotent", () => {
  const f = new LoginForm();          // default mode is "register"
  f.setMode("login");
  expect(f.view().mode).toBe("login");
  f.setMode("login");                 // idempotent — no flip
  expect(f.view().mode).toBe("login");
  f.setMode("register");
  expect(f.view().mode).toBe("register");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/client/src/render/login-form.test.ts`
Expected: FAIL — `f.setMode is not a function`.

- [ ] **Step 3: Add `setMode` to `LoginForm`**

In `packages/client/src/render/login-form.ts`, directly below `toggleMode()`:

```ts
  setMode(mode: AuthMode): void {
    this.mode = mode;
  }
```

(Leave `toggleMode()` in place — it remains covered by existing tests and is harmless.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/client/src/render/login-form.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire directional arrows in `login.ts`**

Replace line 63:

```ts
      if (name === "left" || name === "right") { form.toggleMode(); return; }
```

with:

```ts
      if (name === "left") { form.setMode("login"); return; }
      if (name === "right") { form.setMode("register"); return; }
```

- [ ] **Step 6: Make the on-screen hint directional**

Replace the `modeLabel` block at `login.ts:47-49`:

```ts
      const modeLabel = v.mode === "register"
        ? "( ) Log in    (•) Register   [Tab: switch field · ←/→: toggle]"
        : "(•) Log in    ( ) Register   [Tab: switch field · ←/→: toggle]";
```

with:

```ts
      const modeLabel = v.mode === "register"
        ? "( ) Log in    (•) Register   [Tab: field · ← Log in · Register →]"
        : "(•) Log in    ( ) Register   [Tab: field · ← Log in · Register →]";
```

- [ ] **Step 7: Run the full gate**

Run: `just check`
Expected: PASS — all unit/integration tests, typecheck, and the three PTY smokes
(`verify:login` exercises the login screen end-to-end).

- [ ] **Step 8: Commit**

```bash
git add packages/client/src/render/login-form.ts packages/client/src/render/login-form.test.ts packages/client/src/render/login.ts
git commit -m "fix(client): login ←/→ select mode directionally instead of blind toggle

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Click gate — stop clicks leaking through HUD chrome and modals

**Problem:** `renderer.ts:363` `clickLayer.onMouseDown` only early-returns on
`cmd.active`. Clicks on the always-on inventory panel (`x >= PANEL_COL`, where
`PANEL_COL = cols - 22`), the top-left skills HUD, or an open bank/shop/equip modal all
fall through to `pickTile` and walk the player. Confirmed in observation 3294.

**Files:**
- Create: `packages/client/src/render/click-gate.ts`
- Create: `packages/client/src/render/click-gate.test.ts`
- Modify: `packages/client/src/render/renderer.ts` (closure var + frame update + handler)

**Interfaces:**
- Produces:
  - `interface HudRegions { modalOpen: boolean; panelCol: number; panelBottomRow: number; skillsRows: number; skillsWidth: number; }`
  - `isHudClick(x: number, y: number, h: HudRegions): boolean`

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/render/click-gate.test.ts`:

```ts
import { test, expect } from "bun:test";
import { isHudClick, type HudRegions } from "./click-gate";

const base: HudRegions = {
  modalOpen: false, panelCol: 58, panelBottomRow: 6, skillsRows: 5, skillsWidth: 18,
};

test("an open modal swallows every click", () => {
  const m = { ...base, modalOpen: true };
  expect(isHudClick(0, 0, m)).toBe(true);
  expect(isHudClick(40, 12, m)).toBe(true);
});

test("clicks inside the inventory panel are HUD clicks", () => {
  expect(isHudClick(60, 3, base)).toBe(true);   // inside the right panel
  expect(isHudClick(58, 1, base)).toBe(true);   // header row, left edge of panel
});

test("clicks below the inventory panel fall through to the world", () => {
  expect(isHudClick(60, 7, base)).toBe(false);  // y past panelBottomRow
});

test("clicks inside the skills HUD are HUD clicks", () => {
  expect(isHudClick(1, 0, base)).toBe(true);
  expect(isHudClick(18, 4, base)).toBe(true);   // within width and rows
});

test("clicks in the open world fall through", () => {
  expect(isHudClick(30, 12, base)).toBe(false);
  expect(isHudClick(25, 0, base)).toBe(false);  // top row but right of skills HUD
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/client/src/render/click-gate.test.ts`
Expected: FAIL — cannot resolve `./click-gate`.

- [ ] **Step 3: Implement the pure helper**

Create `packages/client/src/render/click-gate.ts`:

```ts
/** Screen regions occupied by HUD chrome, in terminal-cell coordinates.
 *  Recomputed each frame by the renderer and consumed by the click gate so
 *  clicks on panels don't leak through to world movement. */
export interface HudRegions {
  /** A bank/shop/equip modal is open — it owns the screen; ignore world clicks. */
  modalOpen: boolean;
  /** Left edge (col) of the always-on inventory panel. */
  panelCol: number;
  /** Last row (inclusive) the inventory panel occupies; its header sits at row 1. */
  panelBottomRow: number;
  /** Number of rows the top-left skills HUD occupies (rows 0..skillsRows-1). */
  skillsRows: number;
  /** Width (cols) of the skills HUD block, measured from col 1. */
  skillsWidth: number;
}

/** True when a click at cell (x, y) lands on HUD chrome rather than the world. */
export function isHudClick(x: number, y: number, h: HudRegions): boolean {
  if (h.modalOpen) return true;
  if (x >= h.panelCol && y >= 1 && y <= h.panelBottomRow) return true; // inventory panel
  if (y >= 0 && y < h.skillsRows && x >= 1 && x <= h.skillsWidth) return true; // skills HUD
  return false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/client/src/render/click-gate.test.ts`
Expected: PASS.

- [ ] **Step 5: Import and add a frame-updated closure var in `renderer.ts`**

Add to the imports at the top of `renderer.ts` (with the other `./` render imports):

```ts
import { isHudClick, type HudRegions } from "./click-gate";
```

Next to the existing closure vars (after `let equipMode ...` at `renderer.ts:102`), add:

```ts
  const hud: HudRegions = { modalOpen: false, panelCol: 0, panelBottomRow: 0, skillsRows: 0, skillsWidth: 0 };
```

- [ ] **Step 6: Populate `hud` each frame**

In the frame callback, immediately after the inventory-panel render loop (the
`for (let row = 0; row < maxSlots; row++)` block that ends near `renderer.ts:268`),
add — this runs where `PANEL_COL`, `maxSlots`, and `skillLines` are in scope:

```ts
    // Expose this frame's HUD layout to the click handler (cell coords).
    hud.modalOpen = state.bankOpen || state.shopOpen || state.equipOpen;
    hud.panelCol = PANEL_COL;
    hud.panelBottomRow = maxSlots + 1; // header at row 1, items at rows 2..(maxSlots+1)
    hud.skillsRows = skillLines.length;
    hud.skillsWidth = skillLines.reduce((w, l) => Math.max(w, l.length), 0);
```

- [ ] **Step 7: Gate the click handler**

In `clickLayer.onMouseDown` (`renderer.ts:363`), add the gate right after the
`cmd.active` guard:

```ts
  clickLayer.onMouseDown = (e: TuiMouseEvent) => {
    if (cmd.active) return; // gate clicks while typing in Direct mode
    if (isHudClick(e.x, e.y, hud)) return; // gate clicks on HUD chrome / open modals
    if (!lastFrame || !state.map) return;
    const px = e.x;
    const py = tier === "halfblock" ? e.y * 2 : e.y;
    const t = pickTile(lastFrame, px, py, state.map.width);
    if (t) hooks.onMoveTo(t.x, t.y);
  };
```

- [ ] **Step 8: Run the full gate**

Run: `just check`
Expected: PASS. `verify:click` clicks in the open world (not on panels), so it must
still register movement; the new gate only blocks panel/modal regions.

- [ ] **Step 9: Commit**

```bash
git add packages/client/src/render/click-gate.ts packages/client/src/render/click-gate.test.ts packages/client/src/render/renderer.ts
git commit -m "fix(client): gate world clicks that land on HUD panels and open modals

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Pagination helper (pure math for the modal 9-item cap)

**Problem groundwork:** bank/shop modals select items with `/^([1-9])$/`, hard-capping
at 9 (observation 3295). This task adds the pure paging math; Task 4 wires it in.

**Files:**
- Create: `packages/client/src/render/paging.ts`
- Create: `packages/client/src/render/paging.test.ts`

**Interfaces:**
- Produces (all default to page size 9):
  - `pageCount(count: number, size?: number): number` — pages needed, min 1.
  - `clampPage(page: number, count: number, size?: number): number` — into `[0, pages-1]`.
  - `indexForDigit(page: number, d: number, count: number, size?: number): number` —
    absolute list index for 1-based digit `d` on `page`, or `-1` if `d` is outside
    `1..size` or the index falls past `count`.
  - `pageSlice(page: number, count: number, size?: number): { start: number; end: number }` —
    `[start, end)` of items visible on `page`.

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/render/paging.test.ts`:

```ts
import { test, expect } from "bun:test";
import { pageCount, clampPage, indexForDigit, pageSlice } from "./paging";

test("pageCount groups by 9 and is at least 1", () => {
  expect(pageCount(0)).toBe(1);
  expect(pageCount(9)).toBe(1);
  expect(pageCount(10)).toBe(2);
  expect(pageCount(19)).toBe(3);
});

test("clampPage bounds a page index into range", () => {
  expect(clampPage(-1, 30)).toBe(0);
  expect(clampPage(99, 30)).toBe(3); // 30 items -> 4 pages (0..3)
  expect(clampPage(2, 30)).toBe(2);
});

test("indexForDigit maps page + digit to an absolute index", () => {
  expect(indexForDigit(0, 1, 30)).toBe(0);
  expect(indexForDigit(0, 9, 30)).toBe(8);
  expect(indexForDigit(1, 1, 30)).toBe(9);
  expect(indexForDigit(2, 5, 30)).toBe(22);
});

test("indexForDigit returns -1 past the end or out of 1..9", () => {
  expect(indexForDigit(3, 4, 30)).toBe(-1); // would be index 30, == count
  expect(indexForDigit(0, 0, 30)).toBe(-1);
  expect(indexForDigit(0, 10, 30)).toBe(-1);
});

test("pageSlice clips the final page", () => {
  expect(pageSlice(0, 30)).toEqual({ start: 0, end: 9 });
  expect(pageSlice(3, 30)).toEqual({ start: 27, end: 30 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/client/src/render/paging.test.ts`
Expected: FAIL — cannot resolve `./paging`.

- [ ] **Step 3: Implement the helper**

Create `packages/client/src/render/paging.ts`:

```ts
const PAGE_SIZE = 9;

/** Number of pages needed to show `count` items, 9 per page (always >= 1). */
export function pageCount(count: number, size = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(count / size));
}

/** Clamp `page` into [0, pageCount(count)-1]. */
export function clampPage(page: number, count: number, size = PAGE_SIZE): number {
  return Math.min(Math.max(0, page), pageCount(count, size) - 1);
}

/** Absolute list index for 1-based digit `d` (1..size) on `page`,
 *  or -1 when `d` is out of range or the index falls past the list end. */
export function indexForDigit(page: number, d: number, count: number, size = PAGE_SIZE): number {
  if (d < 1 || d > size) return -1;
  const idx = page * size + (d - 1);
  return idx < count ? idx : -1;
}

/** The half-open range [start, end) of items visible on `page`. */
export function pageSlice(page: number, count: number, size = PAGE_SIZE): { start: number; end: number } {
  const start = page * size;
  return { start, end: Math.min(start + size, count) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/client/src/render/paging.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/render/paging.ts packages/client/src/render/paging.test.ts
git commit -m "feat(client): pure pagination helper for modal item lists

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Wire paging into the bank and shop modals

**Problem:** Remove the 9-item cap in the bank and shop modals using the Task 3 helper.
The equipment modal is intentionally left unchanged — it lists exactly 3 fixed slots
(`EQUIP_SLOTS`), so `1-9` already covers it and paging would be dead weight.

**Bank asymmetry (verified in server `bank-system.ts`):** `withdraw(playerId, bankIndex)`
indexes the **bank**; `deposit(playerId, invSlot)` indexes an **inventory slot**. So the
bank panel must show — and page over — the *bank* in withdraw mode and the player's
*non-empty inventory slots* in deposit mode, mapping the chosen row back to the real
inventory slot index. A frame-updated closure var (`bankRows`) carries that mapping from
the render pass to the key handler, mirroring the `hud` pattern from Task 2.

**Files:**
- Modify: `packages/client/src/render/renderer.ts` — closure vars; modal-page reset on
  transition; bank panel render (mode-aware) + handler; shop panel render + handler.

**Interfaces:**
- Consumes: `pageCount`, `clampPage`, `indexForDigit`, `pageSlice` from `./paging`.

- [ ] **Step 1: Import paging + add closure vars**

Add to the `./` render imports in `renderer.ts`:

```ts
import { pageCount, clampPage, indexForDigit, pageSlice } from "./paging";
```

Next to the other closure vars (after the `hud` var added in Task 2), add:

```ts
  let modalPage = 0;
  let lastModal: "bank" | "shop" | "equip" | null = null;
  // Bank rows for the current frame/mode: withdraw -> bank entries, deposit -> the
  // player's non-empty inventory slots. `slot` is the index the server action expects.
  let bankRows: { slot: number; item: string; qty: number }[] = [];
```

- [ ] **Step 2: Reset the page when the open modal changes**

At the very start of the `renderer.setFrameCallback(...)` body (before any rendering),
add:

```ts
    const curModal = state.bankOpen ? "bank" : state.shopOpen ? "shop" : state.equipOpen ? "equip" : null;
    if (curModal !== lastModal) { modalPage = 0; lastModal = curModal; }
```

- [ ] **Step 3: Make the bank panel render mode-aware and paged**

Replace the entire `if (state.bankOpen) { ... }` render block (`renderer.ts:271-289`) with:

```ts
    if (state.bankOpen) {
      const BANK_COLOR = RGBA.fromInts(210, 195, 90, 255);
      const startRow = skillLines.length + 2;
      // Withdraw picks from the bank; deposit picks from your inventory slots.
      bankRows = bankMode === "withdraw"
        ? state.bank.map((it, i) => ({ slot: i, item: it.item, qty: it.qty }))
        : state.inventory
            .map((s, i) => ({ s, i }))
            .filter((e): e is { s: NonNullable<typeof e.s>; i: number } => e.s !== null)
            .map(({ s, i }) => ({ slot: i, item: s.item, qty: s.qty }));
      const pages = pageCount(bankRows.length);
      const header = `[ Bank — ${bankMode.toUpperCase()} ]`;
      for (const cell of textCells(header, 2, startRow, cols, rows)) buffer.setCell(cell.col, cell.row, cell.char, BANK_COLOR, BLACK);
      const hint = `d deposit · w withdraw · 1-9 item · [ ] page ${modalPage + 1}/${pages} · Esc close`;
      for (const cell of textCells(hint, 2, startRow + 1, cols, rows)) buffer.setCell(cell.col, cell.row, cell.char, DIM, BLACK);
      const { start, end } = pageSlice(modalPage, bankRows.length);
      for (let i = start; i < end; i++) {
        const r = bankRows[i];
        const label = `${i - start + 1}: ${ITEM_KINDS[r.item]?.name ?? r.item} x${r.qty}`;
        for (const cell of textCells(label, 2, startRow + 2 + (i - start), cols, rows)) buffer.setCell(cell.col, cell.row, cell.char, BANK_COLOR, BLACK);
      }
    }
```

- [ ] **Step 4: Make the shop panel render paged**

Replace the entire `if (state.shopOpen && state.shop) { ... }` render block
(`renderer.ts:292-306`) with:

```ts
    if (state.shopOpen && state.shop) {
      const SHOP_COLOR = RGBA.fromInts(210, 130, 210, 255);
      const startRow = skillLines.length + 2;
      const entries = state.shop.entries;
      const pages = pageCount(entries.length);
      const header = `[ ${state.shop.name} — ${shopMode.toUpperCase()} ]`;
      for (const cell of textCells(header, 2, startRow, cols, rows)) buffer.setCell(cell.col, cell.row, cell.char, SHOP_COLOR, BLACK);
      const hint = `b buy · s sell · 1-9 item · [ ] page ${modalPage + 1}/${pages} · Esc close`;
      for (const cell of textCells(hint, 2, startRow + 1, cols, rows)) buffer.setCell(cell.col, cell.row, cell.char, DIM, BLACK);
      const { start, end } = pageSlice(modalPage, entries.length);
      for (let i = start; i < end; i++) {
        const e = entries[i];
        const label = `${i - start + 1}: ${ITEM_KINDS[e.item]?.name ?? e.item}  ${e.price}gp (${e.stock})`;
        for (const cell of textCells(label, 2, startRow + 2 + (i - start), cols, rows)) buffer.setCell(cell.col, cell.row, cell.char, SHOP_COLOR, BLACK);
      }
    }
```

- [ ] **Step 5: Update the bank key handler (mode reset + paging + index map)**

Replace the `if (state.bankOpen) { ... }` handler block (`renderer.ts:375-382`) with:

```ts
    if (state.bankOpen) {
      if (key.name === "escape") { state.closeBank(); return; }
      if (key.name === "d") { bankMode = "deposit"; modalPage = 0; return; }
      if (key.name === "w") { bankMode = "withdraw"; modalPage = 0; return; }
      if (key.name === "]" || key.sequence === "]") { modalPage = clampPage(modalPage + 1, bankRows.length); return; }
      if (key.name === "[" || key.sequence === "[") { modalPage = clampPage(modalPage - 1, bankRows.length); return; }
      const m = /^([1-9])$/.exec(key.name ?? "");
      if (m) {
        const idx = indexForDigit(modalPage, parseInt(m[1], 10), bankRows.length);
        if (idx >= 0) hooks.onBankAction?.(bankMode, bankRows[idx].slot, -1); // -1 = all
      }
      return;
    }
```

- [ ] **Step 6: Update the shop key handler (mode reset + paging + index map)**

Replace the `if (state.shopOpen) { ... }` handler block (`renderer.ts:384-393`) with:

```ts
    if (state.shopOpen) {
      if (key.name === "escape") { state.closeShop(); return; }
      if (key.name === "b") { shopMode = "buy"; modalPage = 0; return; }
      if (key.name === "s") { shopMode = "sell"; modalPage = 0; return; }
      const entries = state.shop?.entries ?? [];
      if (key.name === "]" || key.sequence === "]") { modalPage = clampPage(modalPage + 1, entries.length); return; }
      if (key.name === "[" || key.sequence === "[") { modalPage = clampPage(modalPage - 1, entries.length); return; }
      const m = /^([1-9])$/.exec(key.name ?? "");
      if (m) {
        const idx = indexForDigit(modalPage, parseInt(m[1], 10), entries.length);
        const entry = entries[idx];
        if (idx >= 0 && entry) hooks.onShopAction?.(shopMode, entry.item, 1);
      }
      return;
    }
```

- [ ] **Step 7: Run the full gate**

Run: `just check`
Expected: PASS. (`verify:render` confirms the panels still render; bank/shop paging has
no PTY smoke, so also sanity-check typecheck is clean for the `bankRows` mapping.)

- [ ] **Step 8: Manual smoke (optional but recommended)**

In one terminal: `just server`. In another: `just client-dev`. Open the general store
(`/shop`), confirm `[`/`]` flip pages and `page N/M` updates; open the bank (`/bank`),
toggle `d`/`w` and confirm the list switches between inventory and bank and selection
deposits/withdraws the right item.

- [ ] **Step 9: Commit**

```bash
git add packages/client/src/render/renderer.ts
git commit -m "fix(client): page bank/shop modals past 9 items; bank list is mode-aware

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage** (goal doc Phase 1, three bugs):
- Bug 1 "click leaks through HUD/modals" → Task 2. ✓
- Bug 2 "login arrow-key toggle" → Task 1. ✓
- Bug 3 "9-item modal cap" → Tasks 3 (helper) + 4 (wiring). ✓
- No new systems introduced; all changes are client render/input. ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases" — every code step shows full code. ✓

**3. Type consistency:** `HudRegions`/`isHudClick` (Task 2) used verbatim in Task 2 wiring.
`pageCount`/`clampPage`/`indexForDigit`/`pageSlice` (Task 3) used with matching signatures
in Task 4. `bankRows` row shape `{slot,item,qty}` is produced and consumed consistently
within Task 4. `setMode` (Task 1) matches the `AuthMode` type already in `login-form.ts`. ✓

**4. Known pre-existing items deliberately NOT addressed** (out of scope for this sweep):
small-terminal viewport overflow (Omp's 4th, polish-tier); per-action adjacency re-checks
on bank/shop (server-integrity nit). Equipment modal left on `1-9` by design (3 slots).

## Notes / flags for review
- **Task 1** makes ←/→ *directional* rather than removing them from the arrows entirely;
  this diverges from the goal doc's "off bare arrow presses" phrasing but is the better
  UX for a horizontal radio with no text cursor. Confirm or override at review.

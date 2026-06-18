# Control Model Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconcile the two parallel control schemes into a coherent two-mode model (Play / Direct) and make the main game screen self-document its controls.

**Architecture:** A single renderer-level typing layer replaces the split `cmd.active`/`chat.active` contexts. In Play mode only reflex keys (arrows/mouse/`a`/`c`/`g`) are live; pressing `/` or `Enter` enters Direct mode (one input line). On submit, a leading `/` routes the line through the existing `resolveCommand` → intent path; anything else is chat. A new pure `legend` module generates the on-screen control hints from live world state, rendered as a bottom strip. The intent boundary (`resolve.ts`, server executor) is unchanged — every pruned key already has an equivalent command.

**Tech Stack:** TypeScript, Bun (test runner: `bun test`), OpenTUI (`@opentui/core`), monorepo workspaces (`packages/client`, `packages/protocol`, `packages/server`).

**Spec:** `docs/superpowers/specs/2026-06-17-control-model-redesign-design.md`

**Deviation from spec (intentional, flagged for review):** The spec says modal panels are "opened by a command." This is already true for bank (`/bank` → `openBank` intent) and shop (`/shop` → `openShop` intent), but the **equipment panel is a client-only view** (`state.toggleEquip()`) with no server intent. To keep it reachable after `e` is removed, a **bare `/equip` (or `/gear`) command toggles the equipment panel** as a client-only action handled in the renderer; `/equip <item>` still equips via the intent path. No change to `resolve.ts`.

---

## File Structure

- **Create** `packages/client/src/render/legend.ts` — pure function: live-world context → control-legend lines. One responsibility: deciding what the legend says.
- **Create** `packages/client/src/render/legend.test.ts` — unit tests for the legend.
- **Modify** `packages/client/src/command-line.ts` — add a pure `classifyDirectInput` helper (command-vs-chat by `/` prefix). The `CommandLine` class itself is unchanged.
- **Modify** `packages/client/src/command-line.test.ts` — add tests for `classifyDirectInput`.
- **Modify** `packages/client/src/render/renderer.ts` — collapse to the two-mode keypress model, route Direct-mode submits, prune Play keys, render the prefix-aware prompt + the legend strip.

No server, protocol, or `resolve.ts` changes.

---

## Task 1: Legend module (pure)

**Files:**
- Create: `packages/client/src/render/legend.ts`
- Test: `packages/client/src/render/legend.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/render/legend.test.ts`:

```ts
import { test, expect } from "bun:test";
import { legendLines } from "./legend";

const PLAY_HINT = "[move] arrows/click   [/] command   [Enter] chat";
const DIRECT_HINT = "[Esc] play   ·   type to chat, /verb for commands";

test("direct mode shows only the exit/usage hint", () => {
  expect(
    legendLines({ mode: "direct", nearestEnemy: null, nearestResource: null, itemUnderfoot: null }),
  ).toEqual([DIRECT_HINT]);
});

test("play mode with nothing actionable shows just the persistent hint", () => {
  expect(
    legendLines({ mode: "play", nearestEnemy: null, nearestResource: null, itemUnderfoot: null }),
  ).toEqual([PLAY_HINT]);
});

test("play mode lists only the contextual actions that are available", () => {
  expect(
    legendLines({ mode: "play", nearestEnemy: "Goblin", nearestResource: null, itemUnderfoot: null }),
  ).toEqual(["[a] attack Goblin", PLAY_HINT]);
});

test("play mode orders actions attack, gather, pickup, then the hint", () => {
  expect(
    legendLines({ mode: "play", nearestEnemy: "Goblin", nearestResource: "Tree", itemUnderfoot: "Logs" }),
  ).toEqual(["[a] attack Goblin", "[c] gather Tree", "[g] pick up Logs", PLAY_HINT]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/client/src/render/legend.test.ts`
Expected: FAIL — `Cannot find module './legend'`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/client/src/render/legend.ts`:

```ts
export type Mode = "play" | "direct";

export interface LegendContext {
  mode: Mode;
  /** Display name of the nearest attackable NPC, or null if none in view. */
  nearestEnemy: string | null;
  /** Display name of the nearest gatherable resource, or null if none in view. */
  nearestResource: string | null;
  /** Display name of an item on the player's tile, or null if none. */
  itemUnderfoot: string | null;
}

const PLAY_HINT = "[move] arrows/click   [/] command   [Enter] chat";
const DIRECT_HINT = "[Esc] play   ·   type to chat, /verb for commands";

/**
 * Control-legend lines, generated from live world state so the UI always
 * reflects exactly what the keys will do right now. The renderer joins these
 * onto a single bottom row.
 */
export function legendLines(ctx: LegendContext): string[] {
  if (ctx.mode === "direct") return [DIRECT_HINT];
  const lines: string[] = [];
  if (ctx.nearestEnemy) lines.push(`[a] attack ${ctx.nearestEnemy}`);
  if (ctx.nearestResource) lines.push(`[c] gather ${ctx.nearestResource}`);
  if (ctx.itemUnderfoot) lines.push(`[g] pick up ${ctx.itemUnderfoot}`);
  lines.push(PLAY_HINT);
  return lines;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/client/src/render/legend.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/render/legend.ts packages/client/src/render/legend.test.ts
git commit -m "feat(client): control-legend module — live-state control hints"
```

---

## Task 2: Direct-input classifier (pure)

**Files:**
- Modify: `packages/client/src/command-line.ts`
- Test: `packages/client/src/command-line.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/client/src/command-line.test.ts`:

```ts
import { classifyDirectInput } from "./command-line";

test("classifyDirectInput: leading slash is a command with the slash stripped", () => {
  expect(classifyDirectInput("/mine copper")).toEqual({ kind: "command", command: "mine copper" });
});

test("classifyDirectInput: no prefix is chat verbatim", () => {
  expect(classifyDirectInput("hey anyone selling logs?")).toEqual({
    kind: "chat",
    text: "hey anyone selling logs?",
  });
});

test("classifyDirectInput: bare slash is an empty command", () => {
  expect(classifyDirectInput("/")).toEqual({ kind: "command", command: "" });
});
```

Note: the top of `command-line.test.ts` already imports `{ test, expect }` from `bun:test`; do not duplicate that import.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/client/src/command-line.test.ts`
Expected: FAIL — `classifyDirectInput` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `packages/client/src/command-line.ts` (after the `CommandLine` class):

```ts
export type DirectInput =
  | { kind: "command"; command: string }
  | { kind: "chat"; text: string };

/**
 * Route a submitted Direct-mode line. A leading "/" marks a command (the slash
 * is stripped and the remainder trimmed); anything else is chat, verbatim.
 */
export function classifyDirectInput(line: string): DirectInput {
  if (line.startsWith("/")) return { kind: "command", command: line.slice(1).trim() };
  return { kind: "chat", text: line };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/client/src/command-line.test.ts`
Expected: PASS (all existing CommandLine tests + 3 new).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/command-line.ts packages/client/src/command-line.test.ts
git commit -m "feat(client): classifyDirectInput — split command vs chat by / prefix"
```

---

## Task 3: Renderer — two-mode keypress + Direct routing

**Files:**
- Modify: `packages/client/src/render/renderer.ts` (imports; the `keyInput.on("keypress", …)` handler at lines ~325–483; add a `routeDirectLine` closure inside `startRenderer`)

This task rewrites input handling. The legend *rendering* is Task 4.

- [ ] **Step 1: Add imports**

At the top of `renderer.ts`, add to the existing `../command-line` import and add the legend import. Change:

```ts
import { CommandLine } from "../command-line";
```

to:

```ts
import { CommandLine, classifyDirectInput } from "../command-line";
import { legendLines, type Mode } from "./legend";
```

(`Mode` is used in Task 4; importing it now keeps the import block stable.)

- [ ] **Step 2: Add the `routeDirectLine` closure**

Inside `startRenderer`, immediately after `const log = new LogState();` (around line 92), add:

```ts
  // Route a submitted Direct-mode line. Commands (leading "/") go through the
  // shared intent boundary; bare "/equip"|"/gear" toggles the client-only
  // equipment view (it has no server intent); everything else is chat.
  const routeDirectLine = (line: string): void => {
    const input = classifyDirectInput(line);
    if (input.kind === "chat") { hooks.onChat(input.text); return; }
    const verb = input.command.split(/\s+/)[0]?.toLowerCase() ?? "";
    if ((verb === "equip" || verb === "gear") && !/\s/.test(input.command)) {
      equipMode = "equip";
      state.toggleEquip();
      log.push("ambient", "» equip");
      return;
    }
    if (input.command.length === 0) { log.push("notable", "type a command, e.g. /mine copper"); return; }
    const result = resolveCommand(input.command, buildResolveContext(state, log));
    if (result.ok) { hooks.onIntent?.(result.intent); log.push("ambient", `» ${input.command}`); }
    else log.push("notable", result.message);
  };
```

- [ ] **Step 3: Replace the entire keypress handler**

Replace the whole `renderer.keyInput.on("keypress", (key: KeyEvent) => { … });` block (lines ~325–483) with:

```ts
  renderer.keyInput.on("keypress", (key: KeyEvent) => {
    // --- Modal panels (bank/shop/equip): consume all keys while open ---
    if (state.bankOpen) {
      if (key.name === "escape") { state.closeBank(); return; }
      if (key.name === "d") { bankMode = "deposit"; return; }
      if (key.name === "w") { bankMode = "withdraw"; return; }
      const m = /^([1-9])$/.exec(key.name ?? "");
      if (m) hooks.onBankAction?.(bankMode, parseInt(m[1], 10) - 1, -1); // -1 = all
      return;
    }
    if (state.shopOpen) {
      if (key.name === "escape") { state.closeShop(); return; }
      if (key.name === "b") { shopMode = "buy"; return; }
      if (key.name === "s") { shopMode = "sell"; return; }
      const m = /^([1-9])$/.exec(key.name ?? "");
      if (m) {
        const entry = state.shop?.entries[parseInt(m[1], 10) - 1];
        if (entry) hooks.onShopAction?.(shopMode, entry.item, 1);
      }
      return;
    }
    if (state.equipOpen) {
      if (key.name === "escape") { state.closeEquip(); return; }
      if (key.name === "q") { equipMode = "equip"; return; }
      if (key.name === "u") { equipMode = "unequip"; return; }
      const m = /^([1-9])$/.exec(key.name ?? "");
      if (m) hooks.onEquipAction?.(equipMode, parseInt(m[1], 10) - 1);
      return;
    }

    // --- Direct mode: the typing layer (commands + chat share one line) ---
    if (cmd.active) {
      if (key.name === "return" || key.name === "enter") {
        const line = cmd.submit();
        if (line) routeDirectLine(line);
      } else if (key.name === "escape") {
        cmd.cancel();
      } else if (key.name === "backspace") {
        cmd.backspace();
      } else if (key.name === "up") {
        cmd.historyPrev();
      } else if (key.name === "down") {
        cmd.historyNext();
      } else {
        cmd.type(key.sequence ?? key.name ?? "");
      }
      return;
    }

    // --- Play mode ---
    // Enter opens the typing layer chat-ready; "/" opens it command-ready.
    if (key.name === "return" || key.name === "enter") { cmd.open(); return; }
    if (key.sequence === "/") { cmd.open(); cmd.type("/"); return; }

    // Pick up the item underfoot.
    if (key.name === "g") { hooks.onPickup?.(); return; }

    // Attack nearest NPC.
    if (key.name === "a") {
      const attackNow = performance.now();
      const meAtk = state.samplePositions(attackNow).find((p) => p.id === state.localId);
      const attackNpcs = state.sampleNpcs(attackNow);
      if (meAtk && attackNpcs.length > 0) {
        let best = attackNpcs[0], bestD = Infinity;
        for (const n of attackNpcs) {
          const d = Math.hypot(n.x - meAtk.x, n.y - meAtk.y);
          if (d < bestD) { bestD = d; best = n; }
        }
        hooks.onAttack?.(best.id);
      }
      return;
    }

    // Gather nearest gatherable resource.
    if (key.name === "c") {
      const gatherNow = performance.now();
      const gatherMe = state.samplePositions(gatherNow).find((p) => p.id === state.localId);
      const gatherResources = state.sampleResources().filter((r) => RESOURCE_KINDS[r.type]?.gatherable);
      if (gatherMe && gatherResources.length > 0) {
        let best = gatherResources[0], bestD = Infinity;
        for (const r of gatherResources) {
          const d = Math.hypot(r.x - gatherMe.x, r.y - gatherMe.y);
          if (d < bestD) { bestD = d; best = r; }
        }
        hooks.onGather?.(best.id);
      }
      return;
    }

    // Arrow-key movement.
    const d = arrowDelta(key.name);
    if (!d) return;
    const players = state.samplePositions(performance.now());
    const meMove = players.find((p) => p.id === state.localId);
    if (!meMove) return;
    hooks.onMoveTo(Math.round(meMove.x) + d.dx, Math.round(meMove.y) + d.dy);
  });
```

This removes the legacy `f`/`k`/`b`/`o`/`e`/`1-9` Play-mode handlers and the separate `chat.active` branch, and replaces the `:` opener with `/` + `Enter` openers.

- [ ] **Step 4: Verify the chat module's input methods are no longer referenced in the keypress handler**

Run: `grep -n "chat.open\|chat.submit\|chat.cancel\|chat.backspace\|chat.type\|chat.active" packages/client/src/render/renderer.ts`
Expected: matches only in the *frame callback* rendering (handled in Task 4), NOT in the keypress handler. `chat.receive`/`chat.recent` remain in use (message storage/display).

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: PASS. (If it flags an unused `Mode` import, that resolves in Task 4 — but the import is used there, so leave it. If it flags an unused `chat` parameter, ignore; `chat` is still used by the frame callback.)

- [ ] **Step 6: Run the full test suite**

Run: `bun test`
Expected: PASS — no client test exercises the keypress handler directly; `game-state.test.ts` (which calls `toggleEquip`) is unaffected.

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/render/renderer.ts
git commit -m "feat(client): two-mode input — Play reflex keys + Direct typing layer"
```

---

## Task 4: Renderer — prefix-aware prompt + legend strip

**Files:**
- Modify: `packages/client/src/render/renderer.ts` (frame callback: the input-line/chat-log rendering at lines ~174–214; add a module-scope `nearest` helper and the legend render)

- [ ] **Step 1: Add a module-scope nearest helper**

Near the top of `renderer.ts` (after the `BLACK` const, ~line 56), add:

```ts
/** Nearest entity to (ox, oy) by Euclidean distance, or null for an empty list. */
function nearest<T extends { x: number; y: number }>(list: T[], ox: number, oy: number): T | null {
  let best: T | null = null;
  let bestD = Infinity;
  for (const e of list) {
    const d = Math.hypot(e.x - ox, e.y - oy);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}
```

- [ ] **Step 2: Remove the standalone `chat.active` input block**

Delete this block from the frame callback (lines ~187–193):

```ts
    // Input line: shown when chat is active
    if (chat.active) {
      const inputLine = `> ${chat.input}_`;
      for (const cell of textCells(inputLine, 1, rows - 1, cols, rows)) {
        buffer.setCell(cell.col, cell.row, cell.char, CYAN, BLACK);
      }
    }
```

- [ ] **Step 3: Make the chat-log row depend on `cmd.active`, not `chat.active`**

Change (line ~177):

```ts
    const logStartRow = rows - LOG_LINES - (chat.active ? 2 : 1);
```

to:

```ts
    const logStartRow = rows - LOG_LINES - (cmd.active ? 2 : 1);
```

- [ ] **Step 4: Make the command input prompt reflect command-vs-chat**

Replace the command input block (lines ~209–214):

```ts
    // Command input line: shown when cmd is active
    if (cmd.active) {
      const cmdLine = `» ${cmd.input}_`;
      for (const cell of textCells(cmdLine, 1, rows - 1, cols, rows))
        buffer.setCell(cell.col, cell.row, cell.char, CYAN, BLACK);
    }
```

with:

```ts
    // Direct-mode input line: "»" prompt for commands (leading "/"), ">" for chat.
    if (cmd.active) {
      const prompt = cmd.input.startsWith("/") ? "»" : ">";
      const cmdLine = `${prompt} ${cmd.input}_`;
      for (const cell of textCells(cmdLine, 1, rows - 1, cols, rows))
        buffer.setCell(cell.col, cell.row, cell.char, CYAN, BLACK);
    }
```

- [ ] **Step 4b: Gate mouse clicks while in Direct mode (bug fix)**

The `clickLayer.onMouseDown` handler currently gates on `chat.active`, which is now always false — so a click would fire movement while the player is typing. Change the guard to `cmd.active`.

Find in `clickLayer.onMouseDown`:

```ts
    if (chat.active) return; // gate clicks while typing
```

Replace with:

```ts
    if (cmd.active) return; // gate clicks while typing in Direct mode
```

- [ ] **Step 4c: Refresh stale hook JSDoc**

The legacy hotkeys named in `RendererHooks` JSDoc (`onDrop` "number key", `onUse` "'f' or 'k'", `onOpen` "'b'/'o'") no longer exist. These hooks remain part of the public hook surface (wired in `index.ts`) but are now reached via the command/intent path, not hotkeys. Update only the comments (not the signatures):

```ts
  /** Drop an inventory slot (now via the `/drop` command → intent path). */
  onDrop?(slot: number): void;
```
```ts
  /** Use a skill on an inventory slot (now via the `/use` command → intent path). */
  onUse?(action: string, slot: number): void;
```
```ts
  /** Open a bank booth / store (now via the `/bank` / `/shop` command → intent path). */
  onOpen?(what: "bank" | "shop", targetId: string): void;
```

- [ ] **Step 5: Render the legend strip**

At the very end of the frame callback, just before the closing `});` of `setFrameCallback` (after the equipment-panel block, ~line 298), add:

```ts
    // --- Control legend: a single bottom strip, generated from live state ---
    const LEGEND_COLOR = RGBA.fromInts(120, 200, 160, 255);
    const mode: Mode = cmd.active ? "direct" : "play";
    const meTileX = me ? Math.round(me.x) : null;
    const meTileY = me ? Math.round(me.y) : null;
    const under = meTileX !== null
      ? state.ground.find((gi) => gi.x === meTileX && gi.y === meTileY)
      : undefined;
    const enemy = me ? nearest(npcs, me.x, me.y) : null;
    const gatherables = resources.filter((r) => RESOURCE_KINDS[r.type]?.gatherable);
    const res = me ? nearest(gatherables, me.x, me.y) : null;
    const legend = legendLines({
      mode,
      nearestEnemy: enemy ? (NPC_KINDS[enemy.type]?.name ?? enemy.type) : null,
      nearestResource: res ? (RESOURCE_KINDS[res.type]?.name ?? res.type) : null,
      itemUnderfoot: under ? (ITEM_KINDS[under.item]?.name ?? under.item) : null,
    });
    // Bottom row in Play mode; one row up in Direct mode so it clears the input line.
    const legendRow = rows - 1 - (cmd.active ? 1 : 0);
    for (const cell of textCells(legend.join("   "), 1, legendRow, cols, rows)) {
      buffer.setCell(cell.col, cell.row, cell.char, LEGEND_COLOR, BLACK);
    }
```

(`me`, `npcs`, `resources` are already in scope from the top of the frame callback. `NPC_KINDS`, `RESOURCE_KINDS`, `ITEM_KINDS` are already imported.)

- [ ] **Step 6: Typecheck**

Run: `bun run typecheck`
Expected: PASS — `Mode`, `legendLines`, and `nearest` are now all used.

- [ ] **Step 7: Run the full test suite**

Run: `bun test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/client/src/render/renderer.ts
git commit -m "feat(client): prefix-aware prompt + live control-legend strip"
```

---

## Task 5: Full verification gate

**Files:** none (verification only)

- [ ] **Step 1: Run the full pre-commit gate**

Run: `just check`
Expected: all green — `test` (bun), `typecheck` (tsc), `render` / `click` / `login` (PTY smokes). The render smoke uses only arrow keys, so the pruned keys don't affect it.

- [ ] **Step 2: Manual smoke (optional but recommended)**

Run: `./play` (or `bun run client` with a running server). Confirm:
- Bottom strip shows `[move] … [/] command [Enter] chat` in Play mode, with `[a]/[c]/[g]` lines appearing only when an enemy/resource/item is in range/underfoot.
- `/` opens the input pre-filled with `/` and the prompt shows `»`; typing without `/` shows `>`.
- `Enter` opens an empty input (chat-ready).
- `/mine copper until full`, `/bank`, `/shop`, `/equip bronze sword`, `/use firemaking logs`, `/drop logs` all work.
- Bare `/equip` (or `/gear`) toggles the equipment panel.
- `Esc` returns from Direct to Play.
- `a`/`c`/`g`/arrows still work in Play mode; `f`/`k`/`b`/`o`/`e`/number keys no longer do anything in Play mode.

- [ ] **Step 3: Final commit (only if Step 2 surfaced fixes)**

```bash
git add -A
git commit -m "fix(client): control-model redesign follow-ups from manual smoke"
```

---

## Self-Review notes (already applied)

- **Spec coverage:** two-mode model (Tasks 3–4), pruned Play keymap (Task 3), `/`-prefix command/chat split (Tasks 2–3), contextual legend (Tasks 1, 4), prefix-aware prompt (Task 4). Modal panels unchanged except the documented equip-open deviation.
- **Equip-panel gap:** resolved via the bare-`/equip` client toggle (flagged above for user review).
- **Type consistency:** `Mode`/`LegendContext`/`legendLines` (Task 1) match their use in Task 4; `classifyDirectInput`/`DirectInput` (Task 2) match Task 3's `routeDirectLine`.
- **No new server/protocol/`resolve.ts` surface** — every command path uses intents that the executor already handles.

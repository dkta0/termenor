# Discoverability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the controls and commands the client already contains, so the player can discover and operate every system (`?` cheat-sheet overlay, `/help [verb]` command, and an always-visible `[?] help` legend anchor).

**Architecture:** A new pure module `packages/client/src/help.ts` owns all help content, the `/help` routing decision, and the overlay's display lines — derived from the existing `COMMANDS` registry plus a small static control table. The renderer is thin wiring only: it binds `?`, intercepts `/help`, and `textCells`-draws the overlay. A `helpOpen` flag on `GameState` mirrors the existing `bankOpen`/`equipOpen` modal pattern. No protocol or server changes.

**Tech Stack:** TypeScript, Bun (`bun test`, `bun run typecheck`), OpenTUI renderer. Tests use `bun:test`.

## Global Constraints

- Runtime is **Bun**; test runner is **`bun test`**; do not introduce another runtime or framework.
- TypeScript: prefer `const` over `let`, **named exports only**, **no `any`** (use `unknown` if needed).
- **Pure client slice** — do NOT modify `packages/protocol` or `packages/server`.
- Follow existing client patterns: pure helpers are unit-tested; renderer-closure behavior is covered by the PTY smokes in `just check`.
- Before claiming any task "works": its unit tests pass, `bun run typecheck` is clean, and (for the wiring task) `just check` is green.
- `just check` runs `test typecheck render click login` (unit tests + typecheck + three PTY smokes).

---

### Task 1: `help.ts` — content, routing, and panel layout (pure module)

**Files:**
- Create: `packages/client/src/help.ts`
- Create: `packages/client/src/help.test.ts`
- Modify: `packages/client/src/resolve.ts` (export a public `suggestVerb`)

**Interfaces:**
- Consumes: `COMMANDS` (exported `CommandSpec[]` from `resolve.ts`; each spec has `verbs: string[]` with the canonical verb first, and `help: string`). The private `closestVerb(verb)` (Levenshtein ≤ 2) already exists in `resolve.ts`.
- Produces (relied on by Task 3):
  - `interface HelpSection { title: string; lines: string[]; }`
  - `helpOverlayContent(): HelpSection[]`
  - `helpPanelLines(): string[]`
  - `type HelpAction = { kind: "open" } | { kind: "verb"; lines: string[] } | { kind: "unknown"; verb: string; suggestion: string | null }`
  - `resolveHelp(command: string): HelpAction`
  - From `resolve.ts`: `suggestVerb(verb: string): string | null`

- [ ] **Step 1: Write the failing tests**

Create `packages/client/src/help.test.ts`:

```typescript
import { test, expect } from "bun:test";
import { helpOverlayContent, helpPanelLines, resolveHelp } from "./help";
import { COMMANDS } from "./resolve";

test("overlay content lists every command verb", () => {
  const text = helpOverlayContent().flatMap((s) => s.lines).join("\n");
  for (const spec of COMMANDS) expect(text).toContain(spec.verbs[0]);
});

test("overlay content includes the core non-command controls", () => {
  const text = helpOverlayContent().flatMap((s) => [s.title, ...s.lines]).join("\n");
  expect(text).toContain("arrows / click");
  expect(text).toContain("g — pick up");
  expect(text).toContain("a — attack");
  expect(text).toContain("c — gather");
  expect(text).toContain("? — toggle this help");
  expect(text).toContain("Esc — close");
});

test("panel lines start with a closable header and include a command line", () => {
  const lines = helpPanelLines();
  expect(lines[0]).toContain("Esc");
  expect(lines.some((l) => l.includes("attack"))).toBe(true);
});

test("bare /help opens the overlay", () => {
  expect(resolveHelp("help")).toEqual({ kind: "open" });
});

test("/help <verb> returns that verb's help lines", () => {
  const action = resolveHelp("help drop");
  expect(action.kind).toBe("verb");
  if (action.kind === "verb") expect(action.lines.join(" ")).toContain("drop");
});

test("/help <unknown> reports unknown with a did-you-mean suggestion", () => {
  const action = resolveHelp("help atack");
  expect(action.kind).toBe("unknown");
  if (action.kind === "unknown") {
    expect(action.verb).toBe("atack");
    expect(action.suggestion).toBe("attack");
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test packages/client/src/help.test.ts`
Expected: FAIL — cannot resolve module `./help` (and `suggestVerb` not yet exported).

- [ ] **Step 3: Export `suggestVerb` from `resolve.ts`**

In `packages/client/src/resolve.ts`, immediately after the existing `closestVerb` function definition, add:

```typescript
/** Public did-you-mean: the closest known verb within edit distance 2, or null. */
export function suggestVerb(verb: string): string | null {
  return closestVerb(verb.toLowerCase());
}
```

- [ ] **Step 4: Create `help.ts`**

Create `packages/client/src/help.ts`:

```typescript
import { COMMANDS, suggestVerb } from "./resolve";

export interface HelpSection {
  title: string;
  lines: string[];
}

/** Non-command controls, kept here so the help sheet is the single source of truth. */
const CONTROLS: HelpSection = {
  title: "Moving & acting",
  lines: [
    "arrows / click — move",
    "g — pick up the item underfoot",
    "a — attack the nearest enemy",
    "c — gather the nearest resource",
    "Enter — chat   ·   / — command   ·   ? — toggle this help",
  ],
};

const PANEL_KEYS: HelpSection = {
  title: "While a panel is open",
  lines: [
    "1-9 — choose item / slot",
    "[ ] — previous / next page",
    "d / w — deposit / withdraw (bank)",
    "b / s — buy / sell (shop)",
    "q / u — equip / unequip (gear)",
    "Esc — close the panel",
  ],
};

/** The full control + command reference, grouped into ordered sections. */
export function helpOverlayContent(): HelpSection[] {
  return [
    CONTROLS,
    { title: "Commands ( / then a verb )", lines: COMMANDS.map((c) => c.help) },
    PANEL_KEYS,
  ];
}

/** Flatten the sections into display lines: a header, then each section's title
 *  and its (indented) lines, with a blank line between sections. */
export function helpPanelLines(): string[] {
  const out: string[] = ["[ Help — Esc or ? to close ]"];
  for (const section of helpOverlayContent()) {
    out.push("");
    out.push(section.title);
    for (const line of section.lines) out.push("  " + line);
  }
  return out;
}

/** Help lines for a single verb (canonical help + aliases), or null if unknown. */
function helpForVerb(verb: string): string[] | null {
  const v = verb.toLowerCase();
  const spec = COMMANDS.find((s) => s.verbs.includes(v));
  if (!spec) return null;
  const lines = [spec.help];
  if (spec.verbs.length > 1) lines.push(`aliases: ${spec.verbs.join(", ")}`);
  return lines;
}

export type HelpAction =
  | { kind: "open" }
  | { kind: "verb"; lines: string[] }
  | { kind: "unknown"; verb: string; suggestion: string | null };

/** Decide what a `/help [verb]` command should do. `command` is the full text
 *  after the slash, e.g. "help" or "help drop". Pure — the renderer applies it. */
export function resolveHelp(command: string): HelpAction {
  const rest = command.trim().split(/\s+/).slice(1); // drop the leading "help" verb
  if (rest.length === 0) return { kind: "open" };
  const verb = rest[0];
  const lines = helpForVerb(verb);
  if (lines) return { kind: "verb", lines };
  return { kind: "unknown", verb, suggestion: suggestVerb(verb) };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test packages/client/src/help.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Typecheck**

Run: `bun run typecheck`
Expected: clean (no errors).

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/help.ts packages/client/src/help.test.ts packages/client/src/resolve.ts
git commit -m "feat(client): help content + /help routing as a pure module

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `helpOpen` state flag + persistent legend anchor

**Files:**
- Modify: `packages/client/src/game-state.ts` (add `helpOpen`, `toggleHelp`, `closeHelp`)
- Modify: `packages/client/src/game-state.test.ts` (add flag tests)
- Modify: `packages/client/src/render/legend.ts` (add `[?] help` to the play-mode hint)
- Modify: `packages/client/src/render/legend.test.ts` (update expected `PLAY_HINT`, add anchor test)

**Interfaces:**
- Produces (relied on by Task 3): `GameState.helpOpen: boolean`, `GameState.toggleHelp(): void`, `GameState.closeHelp(): void`; the play-mode legend always contains the substring `[?] help`.

- [ ] **Step 1: Write the failing GameState tests**

Append to `packages/client/src/game-state.test.ts`:

```typescript
test("toggleHelp flips the help overlay flag", () => {
  const gs = new GameState();
  expect(gs.helpOpen).toBe(false);
  gs.toggleHelp();
  expect(gs.helpOpen).toBe(true);
  gs.toggleHelp();
  expect(gs.helpOpen).toBe(false);
});

test("closeHelp always clears the help overlay flag", () => {
  const gs = new GameState();
  gs.toggleHelp();
  gs.closeHelp();
  expect(gs.helpOpen).toBe(false);
});
```

- [ ] **Step 2: Update the legend test expectations**

In `packages/client/src/render/legend.test.ts`, change the `PLAY_HINT` constant near the top to:

```typescript
const PLAY_HINT = "[move] arrows/click   [/] command   [Enter] chat   [?] help";
```

Then append this test:

```typescript
test("play mode always advertises the help key", () => {
  const withTargets = legendLines({ mode: "play", nearestEnemy: "Goblin", nearestResource: "Tree", itemUnderfoot: "Logs" });
  const without = legendLines({ mode: "play", nearestEnemy: null, nearestResource: null, itemUnderfoot: null });
  expect(withTargets.some((l) => l.includes("[?] help"))).toBe(true);
  expect(without.some((l) => l.includes("[?] help"))).toBe(true);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun test packages/client/src/game-state.test.ts packages/client/src/render/legend.test.ts`
Expected: FAIL — `toggleHelp`/`helpOpen` do not exist; the existing play-mode legend tests fail because the source `PLAY_HINT` lacks `[?] help`.

- [ ] **Step 4: Add the `helpOpen` flag and methods to GameState**

In `packages/client/src/game-state.ts`, add the field right after the `equipOpen = false;` line:

```typescript
  helpOpen = false;
```

And add these methods right after the existing `closeEquip()` method:

```typescript
  toggleHelp(): void { this.helpOpen = !this.helpOpen; }
  closeHelp(): void { this.helpOpen = false; }
```

- [ ] **Step 5: Add the legend anchor**

In `packages/client/src/render/legend.ts`, change the `PLAY_HINT` constant to:

```typescript
const PLAY_HINT = "[move] arrows/click   [/] command   [Enter] chat   [?] help";
```

(`legendLines` already pushes `PLAY_HINT` on every play-mode call, so the anchor is now always present.)

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test packages/client/src/game-state.test.ts packages/client/src/render/legend.test.ts`
Expected: PASS (including the four pre-existing legend tests, now matching the updated constant).

- [ ] **Step 7: Typecheck**

Run: `bun run typecheck`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add packages/client/src/game-state.ts packages/client/src/game-state.test.ts packages/client/src/render/legend.ts packages/client/src/render/legend.test.ts
git commit -m "feat(client): helpOpen state flag + persistent [?] help legend anchor

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Renderer wiring — `?` overlay, `/help` intercept, click gate

**Files:**
- Modify: `packages/client/src/render/renderer.ts`

**Interfaces:**
- Consumes: `helpPanelLines()`, `resolveHelp()` from Task 1 (`../help`); `state.helpOpen`, `state.toggleHelp()`, `state.closeHelp()` from Task 2.
- Produces: end-user behavior only (no exported API). Covered by `just check` PTY smokes + manual verification.

This task is thin wiring inside the `startRenderer` closure, which the project does not unit-test (it requires a live OpenTUI renderer). Its gate is `just check` (the render/click/login PTY smokes exercise the new code paths) plus the manual check in Step 7.

- [ ] **Step 1: Import the help module**

In `packages/client/src/render/renderer.ts`, near the other `../` imports (e.g. just below the `import { resolveCommand, ... } from "../resolve";` line), add:

```typescript
import { helpPanelLines, resolveHelp } from "../help";
```

- [ ] **Step 2: Intercept `/help` in `routeDirectLine`**

In `routeDirectLine`, immediately after the existing equip-toggle `if` block (the one matching `verb === "equip" || verb === "gear"`), add:

```typescript
    if (verb === "help") {
      const action = resolveHelp(input.command);
      if (action.kind === "open") { state.helpOpen = true; log.push("ambient", "» help"); }
      else if (action.kind === "verb") { for (const l of action.lines) log.push("ambient", l); }
      else log.push("notable", action.suggestion
        ? `no help for "${action.verb}" — did you mean "${action.suggestion}"?`
        : `no help for "${action.verb}"`);
      return;
    }
```

- [ ] **Step 3: Gate clicks over the help panel**

Find the `hud.modalOpen = ...` assignment (around the inventory-panel layout block) and add `state.helpOpen`:

```typescript
    hud.modalOpen = state.bankOpen || state.shopOpen || state.equipOpen || state.helpOpen;
```

- [ ] **Step 4: Render the help overlay**

Immediately after the equipment-panel render block (the `if (state.equipOpen) { ... }` block) and before the `// --- Control legend` section, add:

```typescript
    // Help overlay (modal, left side). A static control + command reference.
    if (state.helpOpen) {
      const HELP_HEADER = RGBA.fromInts(120, 200, 160, 255);
      const HELP_BODY = RGBA.fromInts(200, 200, 200, 255);
      const startRow = skillLines.length + 2;
      const lines = helpPanelLines();
      for (let i = 0; i < lines.length; i++) {
        const color = i === 0 ? HELP_HEADER : HELP_BODY;
        for (const cell of textCells(lines[i], 2, startRow + i, cols, rows)) {
          buffer.setCell(cell.col, cell.row, cell.char, color, BLACK);
        }
      }
    }
```

- [ ] **Step 5: Bind keys — consume while open, `?` to toggle**

At the very top of the `renderer.keyInput.on("keypress", (key: KeyEvent) => { ... })` handler body (before the `if (state.bankOpen)` block), add:

```typescript
    // Help overlay: consume keys while open; ? or Esc closes it.
    if (state.helpOpen) {
      if (key.name === "escape" || key.sequence === "?") state.closeHelp();
      return;
    }
```

Then, in the **Play mode** section, immediately after the line `if (key.sequence === "/") { cmd.open(); cmd.type("/"); return; }`, add:

```typescript
    if (key.sequence === "?") { state.toggleHelp(); return; }
```

- [ ] **Step 6: Typecheck and run the full check gate**

Run: `bun run typecheck`
Expected: clean.

Run: `just check`
Expected: all unit tests pass, typecheck clean, and the `render` / `click` / `login` PTY smokes PASS.

- [ ] **Step 7: Manual verification**

Start the dev client (check `just --list` for the auto-login dev recipe, e.g. `just dev`) and confirm:
1. The bottom legend always shows `[?] help` in play mode.
2. Pressing `?` opens the help overlay; the world keeps rendering behind it.
3. Pressing `?` again or `Esc` closes it.
4. Typing `/help` opens the overlay; `/help drop` prints the drop help line into the log; `/help atack` logs a "did you mean \"attack\"?" message.
5. Clicking on the open help panel does **not** walk the player.

- [ ] **Step 8: Commit**

```bash
git add packages/client/src/render/renderer.ts
git commit -m "feat(client): wire ? help overlay and /help command into the renderer

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- "`help.ts` (new, pure module)" with `helpOverlayContent` + `helpForVerb` → Task 1 (plus `helpPanelLines` and `resolveHelp` to keep layout/routing pure and tested).
- "`?` cheat-sheet overlay" (blocking, reuses overlay pattern, gated by `helpOpen`) → Task 2 (flag) + Task 3 (render + key binding + click gate).
- "`/help [verb]` command" (client intercept, bare opens overlay, verb logs help, unknown reuses did-you-mean) → Task 1 (`resolveHelp`) + Task 3 (intercept).
- "Persistent legend anchor" (`[?] help` always in play mode) → Task 2.
- Non-goals respected: no did-you-mean rebuild (reuses `closestVerb` via `suggestVerb`); no welcome/tutorial; no on-map affordances; no protocol/server changes.
- Testing requirements (help content, focused verb, null verb, legend anchor, overlay toggle state) → covered across Task 1 (`help.test.ts`) and Task 2 (`game-state.test.ts` toggle/close, `legend.test.ts` anchor). The keypress→state and `/help`→route wiring is thin and covered by `just check` + manual Step 7, consistent with the codebase's renderer-testing pattern.

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to" — every code step shows complete code.

**Type consistency:** `HelpSection`, `HelpAction`, `helpOverlayContent`, `helpPanelLines`, `resolveHelp`, `suggestVerb`, `helpOpen`, `toggleHelp`, `closeHelp` are used with identical names/signatures across Tasks 1→3. `resolveHelp` returns the discriminated `HelpAction` consumed in Task 3 Step 2 with matching `kind` values (`open`/`verb`/`unknown`) and fields (`lines`, `verb`, `suggestion`).

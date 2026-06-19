# Discoverability — surface the controls & commands that already exist

**Date:** 2026-06-19
**Type:** Slice design. Part of the UX track ("feels good to play").
**Status:** Approved (design). Runs its own `/spec → /plan → /implement → /review →
/ship`.

## Why this slice

The game has a rich, working command and control surface — but no way to find it.
The project owner (currently the only player) cannot operate the systems because they
cannot discover what actions exist or how to invoke them. Feedback polish on actions
you can't trigger is premature; **discoverability is the floor.**

Crucially, the substance already exists and is simply never surfaced:

- Every verb in `packages/client/src/resolve.ts` (`attack, gather, take, drop, use,
  bank, shop, deposit, withdraw, buy, sell, equip, unequip, stop`) already carries a
  `help:` string and alias list in the `COMMANDS` registry. No player ever sees them.
- **Did-you-mean already works** — `resolveCommand` runs a Levenshtein match
  (`closestVerb`, ≤2 edits) and already returns
  `unknown command "ming" — did you mean "mine"?`.
- **Tab-completion data exists** — `completions(prefix)` returns matching verbs.
- Most systems **already render their state** — the inventory panel, skills HUD, and
  bank/shop/equip modals all show current state. So once the player can *find* the
  trigger (`/drop`, `/equip`, `/bank`), the panel updating is itself the confirmation
  that the system works.

The gap is therefore narrow: surface the help/control information the codebase already
contains. This is the smallest slice that unblocks the owner from operating — and thus
verifying — every system.

This slice deliberately precedes the **Perceptible Feedback** slice (animated damage
splats + a client-side feedback-derivation log that diffs `SkillsMsg`/`InventoryMsg`/
`npcs` snapshots), which sharpens the *transient* feedback panels can't show (XP ticks,
hits, level-ups). That slice remains next and is **not** part of this one.

## Non-goals (explicit YAGNI cuts)

- **No did-you-mean work** — already implemented via `closestVerb`.
- **No welcome / tutorial / scripted first-run walkthrough** — the cheat-sheet overlay
  plus a persistent legend cover "how do I operate this?" without a guided tour.
- **No on-map affordance prompts** (e.g. "approach the bank booth to open") — deferred.
- **No protocol or server changes** — this is a pure client slice.
- **No perceptible-feedback work** (splat animation, derivation log) — that is the
  next slice.

## Architecture

Four units, isolated and meeting only at the help-content functions:

```
help.ts (new, pure) ──content──▶ ? overlay (render, gated by helpOpen flag)
        │                        ▲
        └──content──▶ /help command (renderer intercept) ┘
legend.ts (additive change) ── always-present [?] help anchor
```

### Component 1 — `help.ts` (new, pure module)

Single source of truth for help content. Lives at
`packages/client/src/help.ts`. Pure functions, no rendering, fully unit-testable.

Derives content from two sources:
- The exported `COMMANDS` registry in `resolve.ts` (verbs, aliases, `help:` strings).
- A small **static control table** for non-command controls: movement
  (arrows / click), `:` to open the command line, `Enter` to chat, play-mode hotkeys
  (`g` pick up, `a` attack nearest, `c` gather nearest), `?` help, and the modal keys
  (`1-9` item, `[` `]` page, `d`/`w`, `b`/`s`, `q`/`u`, `Esc` close).

Public functions:
- `helpOverlayContent(): HelpSection[]` — grouped, ordered sections (e.g. "Moving &
  acting", "Commands", "While a panel is open") for the full sheet.
- `helpForVerb(verb: string): string[] | null` — focused lines for one verb (canonical
  + aliases + the `help:` string), or `null` if the verb is unknown.

`HelpSection` is `{ title: string; lines: string[] }`.

### Component 2 — `?` cheat-sheet overlay

A toggleable, **blocking** help panel (consistent with the existing
bank/shop/equip modals). Implementation:
- Add a `helpOpen: boolean` flag to the client UI state alongside `bankOpen` /
  `shopOpen` / `equipOpen`.
- Bind `?` in **play mode** to toggle `helpOpen`. `?` again or `Esc` closes it.
- While `helpOpen`, the help modal renders `helpOverlayContent()` using the existing
  overlay rendering helpers (`render/overlay.ts`), and — like the other modals —
  consumes input until closed.
- Clicks are already gated over HUD/modal regions by `click-gate.ts`; ensure the help
  panel region participates so a click on it does not leak to move-to.

### Component 3 — `/help [verb]` command

Intercepted **client-side** in the renderer's Direct-mode command handler (around
`renderer.ts:118-129`), *before* `resolveCommand`, because help is not an `Intent` and
must never reach `onIntent`. Behaviour:
- Bare `/help` → opens the same overlay as `?` (sets `helpOpen = true`). One content
  source, two entry points (DRY).
- `/help <verb>` → `helpForVerb(verb)`; push the returned lines into the log (ambient
  tier). If `helpForVerb` returns `null`, reuse the existing did-you-mean path
  (`closestVerb`) to suggest the nearest verb.

`help` is **not** added to the `COMMANDS` registry (those specs return Intents); it is a
renderer-level intercept.

### Component 4 — Persistent legend anchor

`legend.ts` today hides action keys when no target is near, so help is invisible from a
cold start. Change (additive):
- In **play mode**, always include a `[?] help` anchor and keep the core
  `[:] command` / `[Enter] chat` baseline visible.
- Context-sensitive target hints (`[a] attack X`, `[c] gather Y`, `[g] pick up Z`) stay
  exactly as-is, appended when targets are present.

## Data flow

1. `help.ts` reads `COMMANDS` (import) + its static control table → produces sections /
   per-verb lines. No I/O, no state.
2. `?` keypress (play mode) → toggle `helpOpen` → renderer draws the overlay from
   `helpOverlayContent()`.
3. `/help` submitted → renderer intercept → either `helpOpen = true` (bare) or
   `log.push("ambient", …helpForVerb(verb))` (with verb).
4. `legendLines(ctx)` → always emits the `[?] help` anchor in play mode.

## Error handling

- `/help <unknown-verb>` → `helpForVerb` returns `null` → fall through to the existing
  `closestVerb` suggestion; if none within edit distance 2, a plain
  `no help for "<verb>"` line.
- Opening `?` while a bank/shop/equip modal is already open: the `?` key is only bound
  in play mode, so it is inert while another modal owns input. (No nested modals.)

## Testing

Tests must exist and pass before any "works" claim, and `just check` + typecheck must be
clean.

- `help.test.ts`:
  - `helpOverlayContent()` includes every canonical verb from `COMMANDS`.
  - `helpOverlayContent()` includes the core non-command controls (`:`, `Enter`, `?`,
    `g`/`a`/`c`, modal keys).
  - `helpForVerb("drop")` returns the drop help line and lists its aliases.
  - `helpForVerb("nope")` returns `null`.
- `legend.test.ts`:
  - play-mode legend always contains the `[?] help` anchor, with and without nearby
    targets.
- Overlay/state test:
  - `?` in play mode toggles `helpOpen`; `Esc` clears it.
  - `/help` (bare) sets `helpOpen`; `/help drop` does not, and logs help text.

## Done when

- `help.ts` exists with the two pure functions and passing unit tests.
- `?` toggles a blocking help overlay in play mode; `Esc`/`?` closes it.
- `/help` opens the overlay; `/help <verb>` prints focused help; unknown verb reuses
  did-you-mean.
- The play-mode legend always shows `[?] help`.
- `just check` green, typecheck clean, PTY smokes pass.
- Shipped as its own small cycle, separate from the Perceptible Feedback slice.

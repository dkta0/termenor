# Termenor — Control Model Redesign: Two-Mode Input

**Date:** 2026-06-17
**Status:** Design approved, pending implementation plan

## Problem

The UI does not reflect the actual controls. Two parallel control schemes
have accreted, and the main game screen documents neither:

1. **Single-key direct actions** (legacy, pre-intent-boundary) in `renderer.ts`:
   arrows/mouse = move, `Enter` = chat, `:` = command line, `b` = bank, `o` =
   shop, `e` = equip panel, `g` = pickup, `1-9` = drop slot, `a` = attack
   nearest, `c` = gather nearest, `f` = firemaking, `k` = cooking.
2. **Command line** (`:` → `resolve.ts`) — the Slice A intent boundary:
   `attack/gather/take/drop/use/bank/shop/deposit/withdraw/buy/sell/equip/
   unequip/stop`, with stop-conditions (`forever`, `count N`, `until full`,
   `until level N`).

The modal panels (bank/shop/equip) print their own key hints inline, but the
main game screen shows **no legend at all** — a new player has no way to
discover that `:` exists or what any single-key bind does. There is also a
coherence gap: the resolved project direction is keyboard-native command line
over an intent boundary, yet a pile of ad-hoc single-key binds run alongside it.

## Resolved direction (from project memory)

Keyboard-native command line over an `Intent` boundary; LM/NL front-end
deferred; not point-n-click. This redesign reconciles the legacy keymap with
that direction rather than replacing it.

## The model: one intent boundary, two modes

Every action — reflex keypress or typed command — produces the same `Intent`
and travels the same path to the server. The "modes" describe only *how the
player is currently talking to the game*:

- **Play mode** (default, no text cursor): twitch keys are live. Reflexive,
  positional actions only.
- **Direct mode** (the typing layer): a persistent input line is open.
  Commands and chat both go here, split by prefix. `Esc` returns to Play.

Mode is a single piece of renderer state (`mode: "play" | "direct"`),
replacing the current `cmd.active` / `chat.active` split. The UI always shows
which mode is active, and Play mode always shows what its keys will do *right
now* — the UI becomes the generated source of truth for the controls.

## Play mode

**Keymap (reflexes + positional interact):**

| Key            | Action                    | Notes      |
|----------------|---------------------------|------------|
| Arrows / mouse | Move                      | unchanged  |
| `a`            | Attack nearest enemy      | unchanged  |
| `c`            | Gather nearest resource   | unchanged  |
| `g`            | Pick up item underfoot    | unchanged  |
| `/`            | → Direct mode (command)   | pre-fills `/` |
| `Enter`        | → Direct mode (chat)      | empty line |

**Removed from Play mode** (they become typed commands / panel actions, all of
which already exist in `resolve.ts`): firemaking (`f`), cooking (`k`), bank
(`b`), shop (`o`), equip (`e`), drop (`1-9`). The `:` opener is retired in
favor of `/`.

**Contextual legend overlay (new):** a pinned strip that lists only the keys
that do something *given the current world state* — e.g. `a attack goblin`
appears only when an enemy is in range, `g pick up logs` only when standing on
an item; the rest dim or hide. Always shows the persistent hint
`/ command · Enter chat` and a mode indicator.

## Direct mode (the typing layer)

**One input line, chat-default.** Entered via `/` or `Enter` from Play. While
open, all keys feed the line; `Esc` returns to Play.

**Disambiguation:**
- **No prefix → chat.** `hey, anyone selling logs?` → `onChat`.
- **Leading `/` → command.** `/mine copper until full` → strip the `/`, run
  `resolveCommand`, emit `onIntent`.

**Entry keys from Play:** `Enter` opens the line empty (chat-ready); `/` opens
it with `/` pre-filled (command-ready). Both land in the same input line; the
prefix is what distinguishes a command at submit time.

**What Direct mode shows** (mostly already present, now unified):
- The prompt with live tab-completion of verbs (`completions()` exists).
- Inline validation: the resolver's friendly errors render under the line.
- The active standing order (`mine copper — 14/50`) and tiered event log.

## Implementation shape

**`renderer.ts`** (bulk of the work):
- Add `mode: "play" | "direct"` state; collapse `cmd.active` / `chat.active`
  into the single typing layer.
- Prune Play-mode keypress branches: remove `f`/`k`/`b`/`o`/`e`/`1-9`; keep
  arrows/mouse, `a`, `c`, `g`; add `/` and `Enter` as Direct openers.
- On submit in Direct: leading `/` → `resolveCommand` → `onIntent`; otherwise
  → `onChat`.
- Add the contextual Play-mode legend overlay (new module
  `render/legend.ts`): pure function from world sample → lines, plus mode
  indicator and persistent hint.

**`resolve.ts`:** unchanged — every verb the pruned keys used already exists.

**Tests:**
- New `render/legend.ts` gets a unit test (world sample → expected lines).
- `command-line.test.ts` and renderer-adjacent tests updated for the new mode
  model and pruned binds.

## Out of scope

- LM/NL command front-end (deferred).
- Point-n-click redesign.
- Modal panel (bank/shop/equip) redesign — they already self-document and are
  opened by commands.
- Server-side changes — none required.

## Success criteria

- A new player can see, on the main screen, every control available to them in
  the current context without prior knowledge.
- There is exactly one way each action reaches the server (the intent
  boundary); no action is reachable by a key the UI doesn't surface.
- Chat and commands share one input line, disambiguated by the `/` prefix.
- All tests pass; typecheck clean.

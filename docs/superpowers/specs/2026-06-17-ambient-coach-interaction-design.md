# Termenor — Ambient Coach Interaction Model

**Date:** 2026-06-17
**Status:** Design approved; awaiting decomposition into slices
**Supersedes:** the previously-open input-scheme question (hotkey-heavy hybrid vs RuneScape point-n-click). This design resolves it: a keyboard-native command line over a structured intent boundary.

## Design principle

Do not size this system to the codebase's current state (today's protocol, today's action set). The interaction surface will keep growing — quests, dialogue, trading, emergent goals. Future-proof the **seams and abstractions** so growth is cheap; keep the first implementation behind each seam simple. Extensible boundary, dumb first resolver.

## 1. The experience

Your character lives in the world and works a **standing order** on its own while you're heads-down in real terminal work (client open, RuneScape-style presence — closing the client logs out and pauses progress). You are a **coach, not an operator**: you set the character up well, then catch the moments worth catching.

- Most events whisper into a quiet log; only rare high-stakes moments escalate.
- **Every event has a safe default.** Ignoring the game for an hour costs you *upside*, never causes disaster.
- Active attention — reacting well to events, tuning your loadout/policies — is what beats the passive floor.

This straddles passive/active the way RuneScape already does (AFK floor vs active play), reframed for someone living in a terminal: ambient by default, rewarding when engaged, never demanding.

## 2. Architecture — the intent boundary (the spine)

Every input flows through one seam. `Intent` becomes the shared client↔server vocabulary, defined in the `protocol` package — a normalized, structured command that replaces flat one-off messages as the thing the client expresses.

```
raw input → [resolver] → Intent → [intent registry] → effect
(text now;             (normalized,   (each feature registers
 NL/voice later)        structured)    its verbs + executor)
```

- **Intent** is a stable normalized type everything downstream consumes. Nothing downstream cares how an Intent was resolved.
- **Registry, not a switch.** Each feature/slice registers its intents: verb + aliases + arg schema + executor (the effect it produces, one-shot or standing). Adding a new interaction is "register an intent," never "edit the parser."
- **Resolver is a swappable strategy.** The first resolver is a deterministic grammar whose verbs *come from* the registry, so it grows automatically as features register. A natural-language / small-LM layer can be added later as `text → Intent` in front of the same registry; voice, saved macros, and the parked "route programming" idea are likewise just new producers of Intent. The LM is designed-*for*, not pre-built, and choosing the grammar now forecloses nothing.

Name resolution (e.g. "goblin", "copper rock" → an entity id) is a fuzzy/substring match against the entities in the current world snapshot, plus `did you mean` — deterministic, not a model task.

## 3. The passive floor — standing orders (server-side)

A **standing order** is an Intent plus a **stop-condition** that the server executes autonomously across ticks:

- Examples: `gather copper until full`, `fight goblin until level 50`, `mine, then bank, repeat`.
- The server holds a per-player task state machine: path → act → check stop-condition → advance to next queued order → safe-idle.
- **Stop-conditions** (`until full`, `until level N`, `count N`, `forever`) are a small, extensible grammar registered alongside intents.
- On completion or interruption with an empty queue, the character performs the **safe-idle** default (stop / hold / return to a safe spot), configurable via the player's loadout/policy.

This is the passive floor: set an order, it runs while the client is open. Active engagement = redirecting it (a new order) or reacting to events that offer a better one.

## 4. The active boost — event system

The server emits events during autonomous execution. Each event carries:

- a **tier**: `ambient` | `notable` | `critical`
- a human-readable **message**
- a **safe default**: what happens if you do nothing. *An event without a safe default is a bug* (or a deliberately rare hard-block that genuinely requires you — minimize these).
- zero or more **offered intents**: quick responses (e.g. "`mine gem` to switch").

Tier drives presentation:

- `ambient` → log line only, no interruption.
- `notable` → log line + subtle highlight/color.
- `critical` → log line + terminal bell / color pulse + optional OS notification.

Event types are registered alongside intents, so new features add their own events without touching the notification core.

## 5. The surface (TUI)

- Isometric world view (main panel).
- Glanceable ambient panels: status (HP, current task, elapsed/xp), skills, loadout.
- Tiered **log** with tier-based styling (ambient dim, notable colored, critical bold + marker).
- A **command line** with registry-driven tab-completion, history, and `did you mean`.
- The most recent escalated event is answerable with a **single key**, so reflex moments don't require typing a full command.
- Manual movement stays available but is rare — the standing order paths for you.

## 6. Testing

The boundary makes the three core systems unit-testable in isolation:

- **Resolver:** pure `text → Intent` tests, including aliases, fuzzy name resolution, and friendly errors.
- **Standing-order state machine:** deterministic per-tick tests (given world + order, assert the actions taken over ticks and the stop-condition firing).
- **Event emission:** assert events fire with the correct tier and that ignoring an event yields its declared safe default.

Tests exist before any system is claimed working.

## 7. Decomposition into slices

This is three coupled subsystems — too large for one slice. Build vertically:

- **Slice A — Intent boundary + grammar resolver + command-line UI.** Route today's one-shot actions through the Intent pipeline; ship the REPL and the tiered-log skeleton. No autonomy yet. Delivers the spine end-to-end, thin and independently playable (commands replace hotkeys).
- **Slice B — Standing orders / AFK floor.** Stop-conditions, autonomous server-side task execution, safe-idle defaults.
- **Slice C — Event system + tiered notification.** Emission, safe-defaults, tiers, escalation + single-key responses.

Loadout/policy optimization threads through B and C (setting targets and safe-idle policy).

**Recommended start: Slice A** — it is the seam itself, de-risks everything built on top, and is playable on its own. Each slice gets its own spec → plan → implementation cycle.

### Roadmap sequencing (open decision for the user)

The roadmap has **slice 12 = quests** next. This initiative likely wants to come first or interleave, because quests will themselves produce intents and events — building the intent/event boundary first makes quests cheaper to implement. Sequencing is the user's call at planning time.

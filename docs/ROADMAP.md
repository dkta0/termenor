# Termenor — Roadmap

The whole game, built as ordered vertical slices. Each row is one `/spec → /plan →
/implement → /review → /ship` cycle. Pull the next slice; don't build ahead.

## Foundation (engine & presence)

1. ✅ **Smooth multiplayer movement** — tile world, interpolated movement, server-authoritative. *(merged)*
2. ✅ **Isometric renderer** — 2:1 dimetric projection, rolling terrain elevation (+ climb
   collision), extruded walls with walk-behind, face-normal lighting + terrain skirts, entity
   billboards + shadows, z-interpolation, pick-buffer picking. *(merged)*
3. ✅ **Accounts + persistence** — login (hashed pw), save/load player state via SQLite (bun:sqlite) on a Docker volume. *(merged)*
4. ✅ **Chat + nearby-player presence** — name labels above players, public chat (broadcast, sanitized), in-TUI chat input. *(merged)*

## Core loop

5. ✅ **Inventory + ground items** — 28-slot inventory, server-authoritative ground items, pickup/drop, persisted inventory, rendered ground sprites + inventory panel. *(merged)*
6. ✅ **NPCs** — tick-driven entity system: server-authoritative spawns + wander AI (leash radius, pathfinding-aware), interpolated NPC billboards + labels. *(merged)*
7. ✅ **Combat v1** — melee, HP, death/respawn, damage splats. *(merged)*
8. ✅ **First gathering skill (woodcutting)** — XP, levels, tool checks, resource nodes/respawn. *(merged)*

## Content scale-out (reuse the engines)

9. ✅ **Skill framework** generalized → mining, fishing, cooking, firemaking. *(merged)*
10. ✅ **Banking + shops** — persistent per-player bank (deposit/withdraw at a booth) + general
    store (buy/sell for coins), server-authoritative, with bank/shop panels in the client. *(merged)*
11. ⏳ **Equipment + combat v2** — ranged/magic, prayer. *(equipment foundation shipped: equip/unequip
    weapon+armour feeding flat melee — weapon→max hit, armour→damage reduction. Ranged/magic/prayer +
    combat skills remain as follow-up slices.)*
A. ✅ **Intent boundary (command line)** — shared `Intent` vocabulary + `IntentMsg` wire format;
   server typed intent-executor (handler registry + dispatch); client command line (`:` to open,
   history, verb registry + name resolution + did-you-mean + completions, tiered event-log
   skeleton). *(merged — sits alongside the quests slice as infrastructure groundwork)*
   Deferred: existing hotkey handlers not yet migrated onto the executor; Tab key not yet bound
   to completions; standing orders / AFK loop = future Slice B; real event tiers + single-key
   responses = future Slice C.
B. ✅ **Standing orders / AFK floor** — server-side per-player order supervisor (`order-system.ts`)
   running gather + combat activities autonomously across ticks; stop-conditions
   (`forever` / `count N` / `until full` / `until level N`) registered alongside intents;
   command grammar suffixes (`mine tree count 50`, `fight goblin forever`) + `stop` verb;
   safe-idle (stop & hold) on completion/cancel. *(merged)* Deferred to later slices: order
   queue / `then` / `repeat`, banking-as-order, richer safe-idle policies, order persistence,
   combat `until level` (needs combat skills), and the event-tier system (Slice C).
12. **Quests** — scripting/state-machine system + one real quest.
13. **World scale** — multiple regions, region streaming.

## Polish / live

14. Player trading.
15. Minigames.
16. Anti-cheat hardening.
17. Day/night & ambient polish.

---

*Done criteria for the active slice live in its spec under `docs/superpowers/specs/`.*

# Termenor — Roadmap

The whole game, built as ordered vertical slices. Each row is one `/spec → /plan →
/implement → /review → /ship` cycle. Pull the next slice; don't build ahead.

## Foundation (engine & presence)

1. ✅ **Smooth multiplayer movement** — tile world, interpolated movement, server-authoritative. *(merged)*
2. ✅ **Isometric renderer** — 2:1 dimetric projection, rolling terrain elevation (+ climb
   collision), extruded walls with walk-behind, face-normal lighting + terrain skirts, entity
   billboards + shadows, z-interpolation, pick-buffer picking. *(merged)*
3. **Accounts + persistence** — login, save/load player state (SQLite/Postgres, Docker).
4. **Chat + nearby-player presence** — names, public chat.

## Core loop

5. **Inventory + ground items** — pick up / drop, server-authoritative item state.
6. **NPCs** — spawns, wander AI, tick-driven entity system.
7. **Combat v1** — melee, HP, death/respawn, damage splats.
8. **First gathering skill (woodcutting)** — XP, levels, tool checks, resource nodes/respawn.

## Content scale-out (reuse the engines)

9. **Skill framework** generalized → mining, fishing, cooking, firemaking.
10. **Banking + shops.**
11. **Equipment + combat v2** — ranged/magic, prayer.
12. **Quests** — scripting/state-machine system + one real quest.
13. **World scale** — multiple regions, region streaming.

## Polish / live

14. Player trading.
15. Minigames.
16. Anti-cheat hardening.
17. Day/night & ambient polish.

---

*Done criteria for the active slice live in its spec under `docs/superpowers/specs/`.*

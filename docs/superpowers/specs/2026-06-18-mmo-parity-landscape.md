# Termenor → OSRS-parity: the system landscape

**Date:** 2026-06-18
**Type:** Landscape / gap-analysis roadmap. A prioritization map, **not** a build
commitment. Reference archetype: **RuneScape / OSRS**.
**Status:** Reference doc. The active pull-queue remains `docs/ROADMAP.md`; this file is
the wider map that roadmap is drawn from.

## How to read this

Each system below lists: *what it is · what foundation already exists · rough size ·
what it depends on*. Sizes are gut-feel relative (Small / Med / Large), not estimates.
"On roadmap" means it already appears in `docs/ROADMAP.md`; "net-new" means it is a gap
this analysis surfaces that the current roadmap does not cover.

This is a landscape, not a sequence. Pull from `ROADMAP.md`; don't build ahead.

---

## The floor — what's already shipped

A real core loop already exists. None of the below is a gap:

- Tick world + isometric renderer (server-authoritative, interpolated client view)
- Accounts + persistence (SQLite on a Docker volume, hashed login)
- Chat + nearby-player presence
- Inventory (28-slot) + server-authoritative ground items (pickup/drop)
- NPCs (tick-driven spawns, wander AI with leash, aggro-on-hit)
- Melee combat v1 (HP, death/respawn, damage splats)
- Five skills on a shared framework: woodcutting, mining, fishing, cooking, firemaking
- Banking + general shops (persistent per-player bank, buy/sell for coins)
- Equipment + melee combat v2 *foundation* (equip weapon/armour → max-hit / damage reduction)
- Intent boundary / command line (`:` to open, verb registry, did-you-mean, completions)
- Standing orders / AFK floor (autonomous gather + combat across ticks, stop-conditions)

---

## The gap — OSRS systems Termenor lacks

### A. Combat depth *(foundation started — roadmap slice 11)*

- **Combat skill leveling** *(net-new)* — Attack / Strength / Defence / Hitpoints train
  via XP. Combat currently has no progression; this is the cheapest high-leverage gap
  and unblocks the deferred combat `until level N` stop-condition from Slice B.
  *Small-Med · deps: skill framework ✓, combat-system ✓*
- **Ranged + Magic styles & combat triangle** *(on roadmap, slice 11 follow-up)* —
  projectiles, ammo, runes; melee > ranged > magic > melee. *Med · deps: equipment ✓*
- **Prayer** *(on roadmap, slice 11 follow-up)* — bones/altars, drain mechanic.
  *Med · deps: item/inventory ✓*
- **Food / potions, combat styles, special attacks** *(net-new detail)* —
  accurate/aggressive/defensive style XP split, eating to heal. *Med*

### B. Progression & content

- **Quests** *(on roadmap, slice 12)* — scripting / state-machine system + one real
  quest (dialogue, quest flags, completion rewards). *Med · deps: dialogue + flag store*
- **Bosses / drop tables / loot** *(net-new)* — weighted drop tables, distinct
  high-HP NPCs, loot-on-death. The reason to fight anything. *Med-Large · deps: A*
- **More skills** *(net-new — framework reuse)* — smithing, crafting, thieving, agility,
  slayer, etc. Each rides the existing skill framework. *Small-Med each*

### C. World scale *(on roadmap, slice 13)*

- **Multiple regions + streaming, teleports, world map / minimap** — the world is
  currently single-region. *Large · deps: renderer, persistence*

### D. Economy & trading

- **Player trading** *(on roadmap, slice 14)* — secure two-party offer/accept. *Med*
- **Grand-Exchange-style market** *(net-new)* — order book, price discovery, coin
  sink/faucet balance, item value model. The economy backbone. *Large · deps: trading,
  persistence*

### E. Social systems *(net-new — not on current roadmap)*

- **Friends / ignore list + private messaging** — see who's online, whisper, block.
  *Small-Med · deps: presence ✓, persistence ✓*
- **Clans / clan chat + grouped activities** — named groups, shared channel, grouped
  bossing/minigames. *Med*

### F. Minigames & ambient

- **Ambient-coach event system** *(Slice C — current set direction)* — server emits
  tiered events (`ambient | notable | critical`); client routes them into the 3-tier
  log; critical events register single-key responses routed back through the intent
  boundary. *Med · deps: order-system ✓, intent boundary ✓, log tiers ✓*
- **Minigames** *(on roadmap, slice 15)* — discrete activities with their own rules.
  *Med*
- **Day/night & ambient polish** *(on roadmap, slice 17)* — lighting cycle, atmosphere.
  *Med · deps: renderer*

### G. Live-ops & integrity *(mostly net-new)*

- **Anti-cheat hardening** *(on roadmap, slice 16)* — validate client intents, rate
  limits, server-side authority audits. *Med-Large*
- **Moderation** *(net-new)* — mute / ban / report, admin tooling. *Med · deps:
  accounts ✓*
- **Multiple worlds / capacity** *(net-new)* — world selection, per-world player caps,
  sharding. *Large · deps: server, persistence*
- **Account management** *(net-new)* — settings, password change, multiple characters
  per account. *Small-Med · deps: accounts ✓*

---

## Net-new gaps surfaced by this analysis

These are not in `docs/ROADMAP.md` (which currently runs slices 12–17 + Slice C):

- **Combat skill leveling** (A) — cheapest high-leverage; unblocks combat `until level`.
- **Bosses / drop tables / loot** (B) — gives combat a purpose.
- **Grand-Exchange-style market** (D) — economy backbone beyond plain player trading.
- **Social systems** (E) — friends/ignore/PM and clans.
- **Moderation + multiple worlds + account management** (G) — live-ops integrity.

---

## Rough dependency notes

- **A (combat skills)** is a prerequisite for B (bosses worth fighting) and for the
  deferred combat `until level N` order.
- **D's market** depends on **D's player trading** landing first.
- **E's clans** are lighter without **C's world scale**, but don't require it.
- **G's multiple worlds** is the heaviest single item and touches the most subsystems;
  treat it as a late, deliberate effort.

*This file is a map. Done criteria for any active slice live in its own spec under
`docs/superpowers/specs/`.*

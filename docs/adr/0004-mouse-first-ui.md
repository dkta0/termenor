# 4. Mouse-first UI: reserved side panel + click-to-act

Status: accepted

## Context

The first playable client grew three unaligned input grammars: play-mode single
keys (`a`/`c`/`g`, acting on "nearest"), the `/verb` command line (the *only* way
to touch the inventory), and modal single-letters (`d`/`w`/`b`/`s`/`q`/`u`). The
HUD made it worse: all 23 skills were painted as a permanent column down the left
edge over the world, and the inventory panel was a read-only text list with no way
to act on an item. Players had no single mental model — "select a thing, see what I
can do, do it" did not exist.

## Decision

Adopt a **mouse-first, RuneScape-faithful** model (Lean v1):

- **Reserved opaque side panel** (right ~28 cols, full height) with **tabs**:
  Inventory (default) · Skills · Gear · Quest, one at a time. The camera offsets so
  the player stays centered in the *visible* play area, not under the panel. The
  23-skill dump moves into the Skills tab — off the world.
- **Click-to-act on the world**: click an NPC → attack (`maxHit > 0`) or talk
  (`questGivenBy`); a gatherable resource → gather; a ground item → walk, or pick
  up when underfoot; empty tile → walk. Left-click is the one sensible default
  (no right-click context menu in v1).
- **Interactive inventory**: click a slot to select it → an action row (`Equip`
  when `isEquippable`, `Drop`, `Examine`); click an action to fire it. Gear tab:
  click an equipped slot to remove it.
- **`/` command line stays the power layer** (stop-conditions, scripting). `Use`
  stays CLI-only in v1 (it needs a target/action).
- **Shallow onboarding**: a clean contextual legend, a `?` help overlay, and a
  first-run hint. An NPC-guided tutorial is deferred.

Pure, testable units carry the logic: `render/panel.ts` (tabs, views, item
actions), `render/hit.ts` (entity pick + region hit-testing), `render/help.ts`
(overlay copy), with the renderer wiring them and routing clicks.

## Consequences

- All inventory/skill/gear interaction is now mouse-reachable; the world is no
  longer occluded by always-on text.
- The **Quest tab shows the catalog only** — per-player quest progress is not yet
  synced to the client (no `QuestsMsg`). Live progress will land with the NPC
  tutorial work, alongside a `QuestsMsg` + `GameState.setQuests`.
- Floating right-click context menus are deferred; left-click defaults cover v1.
- `GameState.skillsLine(s)` and the equip-modal toggle (`equipOpen`/`toggleEquip`/
  `closeEquip`) were removed as dead — equipment is a tab, skills render via
  `panel.skillLines`.
- Bank/shop remain modal but were repositioned (no longer anchored to the removed
  skill column) and their rows are now click-able as well as digit-driven.

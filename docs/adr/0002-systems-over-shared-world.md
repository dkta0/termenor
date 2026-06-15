# Server game logic is systems over a shared World store

The server's game logic is organized as a `GameWorld` that owns all entity collections
(players, NPCs, resources, fires, ground items) and the tick, plus a set of **System**
modules that each operate on the World through a focused interface (MovementSystem,
CombatSystem, ResourceSystem, GatherSystem, SkillsSystem, InventorySystem). `GameWorld`
owns the fixed tick order and remains the single command surface the WebSocket layer
talks to (`queueMove`, `attack`, `gather`, `use`, `pickup`, `drop`); commands delegate to
systems. We chose this over making each entity a deep module because the cross-entity
actions — combat between two entities, gather touching a Resource, Inventory, and Skills
at once — have no single-entity home and would regrow a coordinator god-object.

## Considered options

- **Entity-centric deep modules** (Player/Npc/Resource own their behavior) — rejected:
  cross-entity actions force a coordinator that becomes the next god-module.
- **Incremental pure-helper extraction** (keep the orchestrator, move logic to functions)
  — viable and lower-risk, but the shared mutable Player state stays implicit; systems
  make the shared store and the tick order explicit, which is the actual deepening.

## Consequences

- The external interface stays stable: the WebSocket layer keeps calling the same command
  methods on `GameWorld` — only the internals split.
- Each System is testable by constructing a minimal World, not by booting the whole game.
- Per-tick notices (skill changes, level-ups, gather notices) move to one event buffer on
  the World that `GameWorld` drains when it builds the Snapshot, replacing the current
  `consume*()` methods.
- The fixed tick order (combat → resolve deaths → resource respawn/expire → gather) is
  owned and documented in one place: `GameWorld.step()`.

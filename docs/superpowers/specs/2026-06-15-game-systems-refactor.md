# Spec: Game systems refactor

**Date:** 2026-06-15
**Branch:** `refactor/game-systems`
**Status:** ready to plan

## Background

`packages/server/src/game.ts` is a 537-line god-module owning movement, combat,
resources, skills, firemaking/cooking, inventory, snapshot building, and persistence
state. An architecture review (see ADRs below) selected two coupled changes:

- **ADR-0001** — three-layer type naming `*State` (wire) / `*Entity` (server) / `*Kind`
  (catalog).
- **ADR-0002** — reorganize server logic as Systems over a shared `GameWorld` store.

Canonical domain language is fixed in [`CONTEXT.md`](../../../CONTEXT.md): **Resource** is a
gatherable node only; **Fire** is a distinct concept.

This refactor is a clean base for the in-progress `feat/banking-shops` slice, which will
be rebased on top of it. The diff must stay reviewable and staged.

## Goals

1. Apply the `*State`/`*Entity`/`*Kind` naming convention without breaking the wire.
2. Separate Fire from Resource in the server's data model.
3. Split `Game` into a `GameWorld` store + focused Systems, each unit-testable in
   isolation.

## Non-goals

- **No protocol/wire break.** `*State` types and the `Snapshot` shape are unchanged.
- **No full ECS.** Systems are plain modules with focused interfaces, not a generic
  component framework.
- **No external interface churn.** `server.ts` keeps calling the same command methods.
- No new gameplay. Behavior is preserved; only structure changes.

## Stage A — renames (mechanical, test-guarded)

1. Server-internal entity interfaces in `game.ts`: `Resource` → `ResourceEntity`,
   `Player` → `PlayerEntity`, `Npc` → `NpcEntity`.
2. Protocol catalogs: `RESOURCE_TYPES` → `RESOURCE_KINDS`, `NPC_TYPES` → `NPC_KINDS`,
   `ITEMS` → `ITEM_KINDS`, with value types `ResourceKind` / `NpcKind` / `ItemKind`.
   Update every importer in `server` and `client`.
3. Wire types (`PlayerState`, `NpcState`, `ResourceState`, `GroundItem`) and the
   `Snapshot`/`SnapshotMsg` shape are **unchanged**.
4. Split the overloaded `deadUntil` field: `ResourceEntity.respawnAt` (depletion respawn)
   and a new `FireEntity.expiresAt` (fire lifetime).
5. Lift Fire out of Resource: introduce a `FireEntity` type and a separate `fires`
   collection on the world. `snapshot()` still emits fires as `ResourceState` entries with
   `type: "fire"` so the wire is unchanged.

## Stage B — systems split

1. `GameWorld` owns all state: `players`, `npcs`, `resources`, `fires`, `groundItems`,
   `tick`, `map`, `rng`, and an event buffer. It owns the fixed tick order:
   **combat → resolveDeaths → resource respawn → fire expire → gather**.
2. `GameWorld` stays the single command surface `server.ts` calls — unchanged signatures:
   `addPlayer`, `removePlayer`, `getPlayerState`, `getInventory`, `getPlayerSkills`,
   `queueMove`, `attack`, `gather`, `use`, `pickup`, `drop`, `snapshot`.
3. Extract Systems with focused interfaces over `GameWorld`, building on the existing
   pure-helper modules (`movement.ts`, `combat.ts`, `npc.ts`, `inventory.ts`):
   - `MovementSystem` — path advance + facing.
   - `CombatSystem` — combat step, resolveDeaths, aggro.
   - `ResourceSystem` — respawn + fire expire.
   - `GatherSystem` — gather progress, charges, yields.
   - `SkillsSystem` — awardXp, level-up detection.
   - `InventorySystem` — pickup, drop, ground items.
4. Replace `consumeSkillChanges` / `consumeLevelUps` / `consumeGatherNotices` with a
   single event buffer on `GameWorld`, drained when the server builds the Snapshot.

## Acceptance criteria

- [ ] All existing tests pass unchanged in behavior: `game.test.ts`, `world.test.ts`,
      `server.test.ts`, `inventory.test.ts`, `combat.test.ts`, `npc*.test.ts`, the
      `protocol` suite, and all `client` tests.
- [ ] No diff to wire types or the `Snapshot` shape; `decodeClient`/`decodeServer`
      untouched.
- [ ] `server.ts` command call sites are unchanged (signature-compatible).
- [ ] Each System has a unit test constructing a minimal `GameWorld`, not the full server.
- [ ] No occurrences of `deadUntil`, bare `RESOURCE_TYPES`/`NPC_TYPES`/`ITEMS`, or the
      bare `Resource`/`Player`/`Npc` server interfaces remain.
- [ ] `render-smoke` / PTY check still passes (client renders unchanged).
- [ ] Tests run green before each commit; one commit per completed task.

## References

- [`docs/adr/0001-three-layer-type-naming.md`](../../adr/0001-three-layer-type-naming.md)
- [`docs/adr/0002-systems-over-shared-world.md`](../../adr/0002-systems-over-shared-world.md)
- [`CONTEXT.md`](../../../CONTEXT.md)

# Conventions

## Architecture & Systems
- **Systems-over-Shared-World**: The `GameWorld` store (`packages/server/src/game.ts`) owns all entity collections and the tick order; discrete game logic lives in flat `*-system.ts` modules in `packages/server/src/` (e.g. `movement-system.ts`, `combat-system.ts`, `gather-system.ts`) that operate on the World through focused interfaces. There is no `systems/` subdirectory. Avoid storing server state outside `GameWorld`. Read `docs/adr/0002-systems-over-shared-world.md` for context.

## Type Naming Rule
- **Three-Layer Type Naming** (per `docs/adr/0001-three-layer-type-naming.md` — read it for full layout): every game concept exists in three layers, named by suffix:
  - **Wire / protocol**: `*State` (e.g. `PlayerState`, `NpcState`, `ResourceState`) — the shape that crosses the network seam.
  - **Server-internal**: `*Entity` (e.g. `PlayerEntity`, `NpcEntity`, `ResourceEntity`) — the authoritative mutable thing on the server.
  - **Catalog**: `*Kind` for entries + `*_KINDS` for the lookup (e.g. `ResourceKind` / `RESOURCE_KINDS`, `ItemKind` / `ITEM_KINDS`) — static metadata.
  - Domain vocabulary for these concepts (Tick, Snapshot, Entity, Resource, …) is fixed in `CONTEXT.md`.

## Code Design
- **Keep it Simple**: Prioritize performance, flat architectures, and low-allocations. Avoid unnecessary layers of abstraction.

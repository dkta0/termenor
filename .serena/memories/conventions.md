# Conventions

## Architecture & Systems
- **Systems-over-Shared-World**: Decoupled systems under `packages/server/src/systems/` implement discrete game logic (e.g. movement, entities). Avoid storing server state outside the central `World` map (`packages/server/src/world.ts`). Read `docs/adr/0002-systems-over-shared-world.md` for context.

## Type Naming Rule
- **Three-Layer Type Naming**: Always enforce suffixes based on layer boundaries:
  - **Server-specific**: Suffixed with `Server` (e.g., `PlayerServer`, `ItemServer`).
  - **Client-specific**: Suffixed with `Client` (e.g., `PlayerClient`, `ItemClient`).
  - **Protocol / Wire**: Suffixed with `Proto` (e.g., `PlayerProto`, `ItemProto`).
  - Read `docs/adr/0001-three-layer-type-naming.md` for full layout.

## Code Design
- **Keep it Simple**: Prioritize performance, flat architectures, and low-allocations. Avoid unnecessary layers of abstraction.

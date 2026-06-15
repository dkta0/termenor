# Three-layer type naming: `*State` (wire), `*Entity` (server), `*Kind` (catalog)

Every game concept exists in three layers: the shape that crosses the network seam, the
authoritative mutable thing on the server, and the static catalog of metadata. We name
them by suffix — `*State` for wire types (`PlayerState`, `NpcState`, `ResourceState`),
`*Entity` for server-internal mutable types (`PlayerEntity`, `NpcEntity`,
`ResourceEntity`), and `*Kind` for catalog entries plus `*_KINDS` for the lookup
(`ResourceKind` / `RESOURCE_KINDS`, `ItemKind` / `ITEM_KINDS`). We chose this because the
wire layer already used `*State` consistently, so it keeps the network seam untouched
while giving the previously bare server types (`Player`, `Npc`, `Resource`) and the
inconsistent catalogs (`RESOURCE_TYPES` vs `ITEMS`) one rule each.

## Considered options

- **`*Wire` / `*Entity` / `*Def`** — most explicit about the network seam, but renames
  every existing `*State` type and both decode paths. Rejected: churns the one layer that
  was already consistent.
- **Location-based, keep bare names** — rely on which package a type lives in, no renames.
  Rejected: leaves the collision that motivated this (a reader importing `Resource` can't
  tell wire from entity).

## Consequences

- Server renames: `Resource` → `ResourceEntity`, `Player` → `PlayerEntity`, `Npc` →
  `NpcEntity`.
- Catalog renames: `RESOURCE_TYPES` → `RESOURCE_KINDS`, `NPC_TYPES` → `NPC_KINDS`,
  `ITEMS` → `ITEM_KINDS`, with value types `ResourceKind` / `NpcKind` / `ItemKind`.
- Wire types (`*State`) and the `Snapshot` shape are unchanged — no protocol break.

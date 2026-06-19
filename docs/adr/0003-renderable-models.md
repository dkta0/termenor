# ADR-0003: Renderable Models and Scenery

## Status
Accepted (2026-06-18)

## Context
World objects were special-cased: a thing was either a single-tile extruded wall block
or a flat billboard whose pixels lived in a hardcoded `getSpritePixels` switch. There
was no shared, data-driven way to author buildings, props, or environment features, and
agents (the primary change vector) could not add one without editing the rasterizer.

## Decision
Introduce one catalog of `Model` definitions (`@termenor/protocol`) with two kinds behind
one interface: `billboard` (data-driven glyph-grid sprite) and `block` (footprint of
extruded cells). Placed instances are `Scenery`, carried in `MapData` at join. Models are
authored as glyph grids + palettes (agent-readable), schema-validated at server start,
and previewable as text via `renderModelToAscii`. A block Scenery's `solid` footprint is
stamped into `map.tiles` so existing pathfinding handles collision unchanged.

## Consequences
- Adding a building/prop/environment piece is a single catalog edit + a `Scenery`
  placement — no rasterizer changes.
- Deferred (additive) seams: voxel stacks (extensible block-cell), block-model rotation
  (`Scenery.facing` kept), in-game editor (mutates `Scenery[]`).
- Deferred (needs new plumbing): stateful objects require a per-tick scenery-state
  channel in `Snapshot`; the Model/Scenery abstraction itself is reused unchanged.
- Interaction is unchanged: scenery reuses the existing proximity + intent path.

# Renderable Engine — unified data-driven Model/Scenery system

**Date:** 2026-06-18
**Type:** Slice design / spec. Runs its own `/spec → /plan → /implement → /review →
/ship` cycle.
**Status:** Approved (design). Done criteria below.

## Why

The renderer (`packages/client/src/render/rasterize.ts`) already does a solid 2:1
dimetric projection with per-tile elevation, depth-sorted walk-behind occlusion, terrain
skirts, shadows, and animated billboards. But world *objects* are special-cased two
incompatible ways: a thing is either a single-tile extruded wall block (`drawBlock`) or
a flat 4×2 billboard whose pixels live in a **hardcoded `getSpritePixels` if/else**.
There is no shared notion of a renderable object — no multi-tile footprints, no
data-driven definitions, no reusable structure/prop/environment path. Adding a building
today means editing the rasterizer.

This slice introduces **one consistent, data-driven engine** through which buildings,
props, and environment features are all authored as data and rendered through one path.

### Primary design constraint: agents are the change vector

Agents (Claude sessions) are the primary vector for change in this project. The engine
is therefore optimized for *agent iterability*, not just runtime correctness. The
subtle problem an agent faces: **it cannot see the screen.** The design below makes the
common change ("add a building/prop/environment piece") a single readable data edit that
an agent can author, preview in text, and verify with a test — in one file, in one
session.

## Approach

**Hybrid under one interface (Approach 3 of 3 considered).** One catalog, one render
entry point, two model *kinds* behind a shared interface. Rejected alternatives:
pure-voxel (punishes every flat object) and pure-billboard (a multi-tile building is one
flat plane at one depth — cannot walk behind part of it, fails the primary use case).

## Core abstraction: `Model` + `Scenery`

- **`Model`** — a reusable render + collision *definition* in `@termenor/protocol`,
  looked up by string key (same pattern as today's `NPC_KINDS` / `RESOURCE_KINDS`). Two
  kinds behind one interface:
  - **`block`** — a footprint of cells; each cell extrudes at its **own** tile coord
    (generalized `drawBlock`), so depth = `(anchorX+dx)+(anchorY+dy)` yields correct
    **per-cell walk-behind for free**. `solid` cells define collision. This is
    buildings and environment features (cliffs, raised water).
  - **`billboard`** — a data-driven pixel grid with optional per-facing variants and
    simple anim flags. This is the **data version of today's `getSpritePixels` switch** —
    props *and* the existing players / NPCs / resources / booths.
- **`Scenery`** — a *placed instance* in the world: `{ model: string, x, y, facing? }`.
  The umbrella concept for placed buildings / props / environment instances. (Chosen to
  avoid the `CONTEXT.md`-banned word "object".)

## Data flow & authority

- `MapData` (protocol) gains `scenery: Scenery[]`, sent **at join** — static world
  geometry, **not** per-tick. No new `Snapshot` path (the stateful-object option is
  deliberately deferred; see below).
- **Server** computes blocked tiles from each `Scenery`'s `solid` footprint (model +
  anchor) and merges them into the existing movement-collision set, reusing the
  `tiles===1` wall-blocking that movement (`movement-system.ts`) and pathfinding
  (`pathfinding.ts`) already respect.
- **Interaction is unchanged.** The existing proximity + intent path (bank/shop booths)
  stays exactly as-is. No second dispatch path is introduced.

## Authoring format — readable for agents (not RGB arrays)

Models are authored as **glyph grids + a palette map**, never raw `[r,g,b]` arrays. An
agent can write and read this reliably; an array of color triples it cannot.

- **Billboard** example (a tree, facing south):
  ```
  palette: { T: trunk, L: leaf, l: lightLeaf, ".": transparent }
  south:  ["lL", "Ll", "LL", "TT"]
  ```
- **Block** model: a footprint authored as a glyph grid, each glyph mapping to a cell
  `{ height, color, solid }` (e.g. `W`=wall cell height 3 solid, `r`=roof cell, `.`=no
  cell / doorway gap).

Palettes reference shared named colors. `"."` is transparent (no pixel / no cell). A
palette may also include a **runtime-tint glyph** resolved per-draw (e.g. the player
torso glyph resolves to the caller-supplied color — local player yellow vs other player
blue today), so migrating players/NPCs off `getSpritePixels` keeps their dynamic
coloring.

## Renderer integration (`packages/client/src/render/`)

New focused files (do **not** bloat `rasterize.ts` at 17.5KB or `renderer.ts` at
24.5KB — agents iterate better on small files):

- `render/model-types.ts` — the `Model` / `Scenery` / cell / palette types.
- `render/models.ts` — **the catalog**: every model definition + a header recipe block
  ("how to add a Model/Scenery"). The one obvious place to add an object.
- `render/model.ts` — `drawModel(frame, model, anchor, facing, now)`, dispatching block
  vs billboard; the single render entry point. Generalizes `drawBlock` to an
  arbitrary-height colored cell.
- `render/model-preview.ts` — `renderModelToAscii(model, facing?)`: dumps a model to a
  glyph/kinds grid so an agent (and tests) can *see* output as text.

`rasterize.ts` refactor: **delete the `getSpritePixels` switch**; route
players/NPCs/resources/booths through the billboard catalog; draw `MapData.scenery` in
the tile pass. The object-pixel pick resolves to the anchor tile (reuses tile-picking →
existing proximity interaction). Terrain / skirt / shadow / HP-bar / walk-anim machinery
is untouched.

## Validation

Models are **schema-validated at load** (palette refs resolve, heights in range,
billboard rows equal width, block footprints non-empty). A malformed model fails fast
with a clear message — never a silent render glitch an agent wouldn't notice.

## Future-proofing seams (locked in now, ~zero cost)

Approach 3 was chosen because the deferred features are *additive*. Two seams are
pre-wired so they stay additive:

1. **`Scenery.facing` is kept** even though `block` models ignore it in v1 — pre-wires
   block-model rotation (later = a footprint transform + per-rotation face shading,
   local to `drawModel`; no wire change).
2. **The block-cell type is extensible** — `{ height, color }` shorthand now, with room
   for an optional `segments: { height, color }[]` later — pre-wires voxel stacks
   (later = the extrusion loop iterates segments; no protocol/collision/depth change).

The **in-game editor** is also fully additive later (it just mutates the `Scenery[]`
data; the data-driven catalog v1 ships is its only prerequisite).

The **one deliberate non-additive deferral** is **stateful objects** (doors, switches).
The `Model`/`Scenery` abstraction is reusable for them (a door = two Model variants), so
the *rendering engine does not change* — but they require new plumbing: a per-tick
scenery-state channel in `Snapshot` + collision recompute on change. This is new code
built *on top of* v1, not rework of it.

## Proof content — scope discipline

This slice ships the **engine + a deliberately small proof set**, NOT a content catalog:

- **1 block building** — a small multi-tile house/bank: walls + roof + a door gap;
  walk-behind + footprint collision.
- **2 billboard props** — e.g. a crate + a fence, authored as pure glyph-grid data.
- **1 environment feature** — e.g. a raised rock cliff cluster (block cells), proving
  environment uses the same path.
- **Migration** — move the existing tree/rock/goblin/booth sprites into the catalog,
  proving the `getSpritePixels` switch is gone.

Everything else is cheap data added later. The engine is a *mechanism, not a complete
object catalog*; we do not enumerate the world now.

## Explicit YAGNI cuts (v1)

- No voxel *stacks* (one `{height,color}` per cell; seam pre-wired above).
- No block-model rotation (billboards keep their 4 facings; buildings authored at a
  fixed orientation; seam pre-wired above).
- No stateful/animated objects beyond the existing `now`-driven bob/flicker.
- No in-game editor (additive later).

## Testing

- **Unit:** `model → pixels/depth` assertions (mirrors `rasterize.test.ts`); golden
  ASCII snapshots via `renderModelToAscii` for each catalog model; schema-validation
  rejects malformed models; server collision-footprint tests (a `solid` footprint blocks
  movement + pathfinding).
- **Gate:** `just check` (full suite + typecheck + the 3 PTY smokes) stays green.

## Docs

- Ratify **`Model`** and **`Scenery`** into `CONTEXT.md` (glossary), noting "object" stays
  banned.
- Short **ADR** for the renderable abstraction (precedent: ADR-0001, ADR-0002).
- The "how to add a Model/Scenery" recipe lives in the `render/models.ts` header.

## Done when

- `Model`/`Scenery` types + validated catalog exist in protocol/client; `getSpritePixels`
  switch is deleted; all existing sprites render through the catalog.
- `MapData.scenery` flows server→client at join; `solid` footprints block movement and
  pathfinding.
- The proof set (1 building + 2 props + 1 environment feature) renders with correct
  walk-behind and collision.
- `renderModelToAscii` + golden tests exist; schema validation rejects bad models.
- New focused files in place; `rasterize.ts`/`renderer.ts` not bloated.
- `CONTEXT.md` terms + ADR + catalog recipe written.
- `just check` green.

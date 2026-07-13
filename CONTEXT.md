# termenor

A terminal MMO — a RuneScape-style world rendered in the terminal. The server is
authoritative; clients render an interpolated view of the world it broadcasts.

This file is the glossary. It fixes the canonical word for each domain concept and
lists the words to avoid. It holds no implementation details — for the type-naming
convention behind these concepts (`*State` / `*Entity` / `*Kind`), see
[ADR-0001](docs/adr/0001-three-layer-type-naming.md).

## Language

### World

**Tick**:
One server simulation step. The world advances one Tick at a time; the server is the
sole authority on what is true at each Tick.
_Avoid_: step, frame.

**Snapshot**:
The authoritative state of the whole world at one Tick — every Player, NPC, Resource,
Fire, Ground Item, and combat event — broadcast to clients.
_Avoid_: state, update.

**Frame**:
A Snapshot the client has received and buffered, tagged with its arrival time, used to
interpolate motion. A Frame is a Snapshot at rest on the client.
_Avoid_: snapshot (when you specifically mean the buffered client-side copy).

**Scenario**:
A validated authored setup and guided objective sequence run over normal Zones, Systems,
and catalogs. A Scenario chooses initial conditions and observes authoritative outcomes;
it does not redefine game rules.
_Avoid_: quest, level, mode, script, fixture, tutorial engine.

**Gameplay Fact**:
An immutable record of a successful authoritative transition at one Tick, emitted in
deterministic order for objective evaluation and diagnostics. It is not World state and
cannot mutate the World.

### Entities

**Player**:
A human-controlled character in the world. Has an Inventory, Skills, and hit points.
_Avoid_: user, character, avatar.

**NPC**:
A server-controlled character. Can be attacked, wanders within a home radius, and
turns aggressive (targets its attacker) when hit.
_Avoid_: mob, monster, enemy.

**Resource**:
A gatherable node fixed in the world (tree, rock, fishing spot). Server-spawned, holds
charges, depletes as it is gathered, and respawns after a delay. A Fire is **not** a
Resource.
_Avoid_: node, deposit, spawn, object.

**Fire**:
A temporary, player-made object you cook on. Created by Firemaking, sits at a tile, and
expires on its own. You do not Gather a Fire — you cook at it.
_Avoid_: campfire, resource, station.

### World objects

**Model**:
A reusable render + collision definition in the shared catalog (`MODELS`), keyed by a
string. Two kinds: a `billboard` (flat glyph-grid sprite) or a `block` (footprint of
extruded cells). A Model is a *definition*, never a placed thing.
_Avoid_: sprite, mesh, asset.

**Scenery**:
A placed instance of a Model in the world — a building, prop, or environment feature.
Carried in `MapData` at join (static). A block Scenery's solid cells block movement.
_Avoid_: object, prop (as a type name), entity (Scenery is not server-ticked).

### Items

**Item**:
A kind of thing a Player can hold (e.g. logs, raw fish). The catalog of Items is shared
by client and server.
_Avoid_: object, thing.

**Item Stack**:
A quantity of one Item occupying one Inventory slot.
_Avoid_: stack (alone), slot (the slot is the container; the stack is its contents).

**Ground Item**:
An Item Stack lying at a tile in the world, available to pick up.
_Avoid_: drop, loot, pickup.

**Inventory**:
A Player's fixed set of slots, each holding an Item Stack or empty.
_Avoid_: bag, pack.

### Skills

**Skill**:
A trainable proficiency with experience and a derived level (Woodcutting, Mining,
Fishing, Firemaking, Cooking).
_Avoid_: ability, stat.

**Gather**:
The act of collecting from a Resource using a gathering Skill (Woodcutting, Mining,
Fishing). "Mine", "chop", and "fish" are flavour for specific Resources — Gather is the
canonical verb for the action.
_Avoid_: harvest, collect.

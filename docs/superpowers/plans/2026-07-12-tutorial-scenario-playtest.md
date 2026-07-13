# Tutorial Scenario and Agent Playtest Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship one guided exploration-to-skilling tutorial Scenario that runs through the real multi-Zone simulation and can be playtested by an agent through both a deterministic headless adapter and the production terminal client.

**Architecture:** Keep `GameWorld`, `Zones`, and the existing System modules as the engine. Add typed Scenario definitions, authoritative Gameplay Facts, a per-Player objective evaluator, and narrow Scenario progress persistence/wire state. Drive the same Scenario through `Zones` from a deterministic headless runner and a reusable PTY harness that combines semantic waits with a normalized real-terminal screen.

**Tech Stack:** TypeScript 6, Bun 1.3, Bun test, Bun WebSocket server, SQLite/Postgres stores, OpenTUI terminal client, Python 3 PTY harness, pyte 0.8.2.

## Global Constraints

- Preserve the authoritative 15 Hz server, Snapshot/delta replication, client interpolation, and accepted ADR-0001/0002/0003/0004 decisions.
- Use canonical `CONTEXT.md` terms: Tick, Snapshot, Frame, Player, NPC, Resource, Fire, Model, Scenery, Item, Item Stack, Inventory, Skill, Gather, Scenario, and Gameplay Fact.
- Both headless and live Scenario adapters drive `Zones`; neither may bypass portal transfer through a bare `GameWorld`.
- The initial mandatory journey is movement → dialogue → Gather → Item processing → Inventory interaction → Skill feedback → overworld exit.
- Valid early actions count when sensible; objective presentation remains ordered and one objective transitions at most once.
- No ECS, lockstep, rollback, arbitrary scripting/trigger DSL, JSON Scenario authoring, soft World hot reload, visual editor, production analytics, or tutorial-only game rules.
- No combat, death, banking, shop, Gear, or Standing Order tutorial branch in this plan.
- Do not migrate all WebSocket actions onto a next-Tick queue. Headless execution is reproducible; live PTY execution retains production callback timing and uses condition-based waits.
- Player-facing acceptance actions enter through the production terminal client; semantic state may diagnose but may not replace visible validation.
- Every task follows red-green-refactor: focused failing test, observed failure, minimal implementation, focused passing test, then commit.

---

## File Structure

### New server modules

- `packages/server/src/scenario.ts` — Scenario types, validator, objective evaluator, progress state, and fact matching. It contains no game-rule mutation.
- `packages/server/src/gameplay-facts.ts` — closed Gameplay Fact union and deterministic per-World fact buffer helpers.
- `packages/server/src/tutorial.ts` — tutorial Map/Zone/Scenario authored data only.
- `packages/server/src/scenario-runner.ts` — deterministic headless adapter over `Zones`; input trace and digest generation.

### Existing server modules modified

- `packages/server/src/entities.ts` — add Scenario progress to `PlayerEntity`; add Gameplay Fact storage to `GameEvents`.
- `packages/server/src/game.ts` — restore/export Scenario progress, drain facts, and transfer complete Player state without using persistence state as transfer state.
- `packages/server/src/{quest,gather,train,action,inventory,skills}-system.ts` — emit only the facts created by successful tutorial-relevant transitions.
- `packages/server/src/world.ts` — keep ordinary Zone definitions and import the tutorial Zone without moving rules into content data.
- `packages/server/src/zones.ts` — accept deterministic construction options, own Scenario evaluation, preserve transfer state, and emit transition facts.
- `packages/server/src/{db,store}.ts` — persist compact Scenario progress for SQLite and Postgres.
- `packages/server/src/server.ts` — accept injected Scenario/Zone options, send Scenario progress, and preserve existing immediate WebSocket action semantics.

### Protocol/client modules modified

- `packages/protocol/src/scenarios.ts` — wire-safe Scenario progress types only.
- `packages/protocol/src/index.ts` — export/add `ScenarioMsg` to `ServerMsg`.
- `packages/client/src/{connection,game-state}.ts` — receive/store Scenario progress.
- `packages/client/src/render/{panel,renderer}.ts` — render one compact current objective and live Quest-tab progress.

### Playtest tools

- `scripts/requirements-playtest.txt` — pin `pyte==0.8.2`.
- `scripts/pty_harness.py` — shared server/client lifecycle, input, terminal emulation, semantic waits, timing, teardown, and artifacts.
- `scripts/pty-{render,click,login}-check.py` — reduce to scenarios over the shared harness.
- `scripts/pty-tutorial-check.py` — real-client tutorial acceptance path.
- `scripts/scenario.ts` — headless Scenario CLI for deterministic run/replay.
- `package.json` and `justfile` — focused Scenario/playtest commands.

---

### Task 1: Scenario vocabulary, definitions, and startup validation

**Files:**
- Create: `packages/server/src/scenario.ts`
- Create: `packages/server/src/scenario.test.ts`
- Modify: `CONTEXT.md`

**Interfaces:**
- Produces: `ScenarioDef`, `ObjectiveDef`, `ScenarioProgress`, `ScenarioEvidence`, `validateScenario(def, zones)`, `initialScenarioProgress(def)`, and `currentObjective(def, progress)`.
- Consumes: existing `ZoneDef`, `ITEM_KINDS`, `NPC_KINDS`, `RESOURCE_KINDS`, `RECIPES`, `SKILLS`, and map/portal data.

- [ ] **Step 1: Write failing validator and progress tests**

Create `packages/server/src/scenario.test.ts` with focused contracts:

```ts
import { describe, expect, test } from "bun:test";
import type { MapData } from "@termenor/protocol";
import { currentObjective, initialScenarioProgress, validateScenario, type ScenarioDef } from "./scenario";
import type { ZoneDef } from "./world";

const map: MapData = { width: 5, height: 5, tiles: Array(25).fill(0), heights: Array(25).fill(0), scenery: [] };
const zones: ZoneDef[] = [
  { id: "tutorial", map, spawn: { x: 1, y: 1 }, seedItems: [], npcs: [{ type: "cook", x: 1, y: 2, radius: 0 }], resources: [{ type: "tree", x: 2, y: 2 }], portals: [{ x: 3, y: 3, toZone: "overworld", toX: 1, toY: 1 }] },
  { id: "overworld", map, spawn: { x: 1, y: 1 }, seedItems: [], npcs: [], resources: [], portals: [] },
];

const valid: ScenarioDef = {
  id: "first_steps",
  version: 1,
  startZone: "tutorial",
  initialItems: [],
  objectives: [
    { id: "meet_guide", text: "Talk to the guide.", when: { kind: "talkedTo", npcType: "cook" } },
    { id: "gather_logs", text: "Gather logs from a tree.", when: { kind: "gathered", resourceType: "tree", item: "logs" } },
    { id: "leave", text: "Cross into Termenor.", when: { kind: "enteredZone", zone: "overworld" } },
  ],
  exit: { fromZone: "tutorial", toZone: "overworld" },
};

describe("validateScenario", () => {
  test("accepts a reachable typed scenario", () => expect(validateScenario(valid, zones)).toEqual([]));
  test("reports the exact missing reference path", () => {
    const broken = structuredClone(valid);
    broken.objectives[1] = { id: "gather_logs", text: "Gather.", when: { kind: "gathered", resourceType: "missing", item: "logs" } };
    expect(validateScenario(broken, zones)).toContain("scenario first_steps objective gather_logs: unknown Resource missing");
  });
  test("rejects duplicate objective ids", () => {
    const broken = { ...valid, objectives: [valid.objectives[0], valid.objectives[0]] };
    expect(validateScenario(broken, zones)).toContain("scenario first_steps: duplicate objective meet_guide");
  });
  test("rejects an exit that is not backed by a matching portal", () => {
    const broken = { ...valid, exit: { fromZone: "tutorial", toZone: "missing" } };
    expect(validateScenario(broken, zones)).toContain("scenario first_steps exit: unknown destination Zone missing");
  });
});

test("new progress presents the first objective", () => {
  const progress = initialScenarioProgress(valid);
  expect(progress).toEqual({ scenarioId: "first_steps", version: 1, completed: [], evidence: [], done: false });
  expect(currentObjective(valid, progress)?.id).toBe("meet_guide");
});
```

- [ ] **Step 2: Run the focused test and observe the missing module failure**

Run: `bun test packages/server/src/scenario.test.ts`

Expected: FAIL with `Cannot find module './scenario'`.

- [ ] **Step 3: Implement the closed objective vocabulary and validator**

Create `packages/server/src/scenario.ts` with these exact public shapes:

```ts
import { ITEM_KINDS, NPC_KINDS, RECIPES, RESOURCE_KINDS, SKILLS } from "@termenor/protocol";
import type { ZoneDef } from "./world";

export type ObjectiveWhen =
  | { kind: "talkedTo"; npcType: string }
  | { kind: "gathered"; resourceType: string; item: string }
  | { kind: "produced"; source: "recipe" | "action"; operation: string; item: string }
  | { kind: "inventoryAction"; action: "drop" | "equip" | "examine"; item: string }
  | { kind: "gainedSkillXp"; skill: string; atLeast: number }
  | { kind: "enteredZone"; zone: string };

export interface ObjectiveDef { id: string; text: string; when: ObjectiveWhen }
export interface ScenarioDef {
  id: string;
  version: number;
  startZone: string;
  initialItems: { item: string; qty: number }[];
  objectives: ObjectiveDef[];
  exit: { fromZone: string; toZone: string };
}
export interface ScenarioEvidence { objectiveId: string; tick: number }
export interface ScenarioProgress {
  scenarioId: string;
  version: number;
  completed: string[];
  evidence: ScenarioEvidence[];
  done: boolean;
}

export function initialScenarioProgress(def: ScenarioDef): ScenarioProgress {
  return { scenarioId: def.id, version: def.version, completed: [], evidence: [], done: false };
}
export function currentObjective(def: ScenarioDef, progress: ScenarioProgress): ObjectiveDef | null {
  return def.objectives.find((objective) => !progress.completed.includes(objective.id)) ?? null;
}
export function validateScenario(def: ScenarioDef, zones: ZoneDef[]): string[] {
  const errors: string[] = [];
  const byId = new Map(zones.map((zone) => [zone.id, zone]));
  const seen = new Set<string>();
  const start = byId.get(def.startZone);
  for (const [index, stack] of def.initialItems.entries()) {
    if (!ITEM_KINDS[stack.item]) errors.push(`scenario ${def.id} initialItems ${index}: unknown Item ${stack.item}`);
    if (!Number.isInteger(stack.qty) || stack.qty < 1) errors.push(`scenario ${def.id} initialItems ${index}: qty must be a positive integer`);
  }
  if (!Number.isInteger(def.version) || def.version < 1) errors.push(`scenario ${def.id}: version must be a positive integer`);
  if (!start) errors.push(`scenario ${def.id}: unknown start Zone ${def.startZone}`);
  for (const objective of def.objectives) {
    const at = `scenario ${def.id} objective ${objective.id}`;
    if (seen.has(objective.id)) errors.push(`scenario ${def.id}: duplicate objective ${objective.id}`);
    seen.add(objective.id);
    if (objective.text.trim() === "") errors.push(`${at}: text must not be blank`);
    switch (objective.when.kind) {
      case "talkedTo":
        if (!NPC_KINDS[objective.when.npcType]) errors.push(`${at}: unknown NPC ${objective.when.npcType}`);
        break;
      case "gathered":
        if (!RESOURCE_KINDS[objective.when.resourceType]) errors.push(`${at}: unknown Resource ${objective.when.resourceType}`);
        if (!ITEM_KINDS[objective.when.item]) errors.push(`${at}: unknown Item ${objective.when.item}`);
        break;
      case "produced":
        if (objective.when.source === "recipe" && !RECIPES[objective.when.operation]) errors.push(`${at}: unknown Recipe ${objective.when.operation}`);
        if (objective.when.source === "action" && !new Set(["light", "cook"]).has(objective.when.operation)) errors.push(`${at}: unknown action ${objective.when.operation}`);
        if (!ITEM_KINDS[objective.when.item]) errors.push(`${at}: unknown Item ${objective.when.item}`);
        break;
      case "inventoryAction":
        if (!ITEM_KINDS[objective.when.item]) errors.push(`${at}: unknown Item ${objective.when.item}`);
        break;
      case "gainedSkillXp":
        if (!(SKILLS as readonly string[]).includes(objective.when.skill)) errors.push(`${at}: unknown Skill ${objective.when.skill}`);
        if (!Number.isFinite(objective.when.atLeast) || objective.when.atLeast <= 0) errors.push(`${at}: atLeast must be positive`);
        break;
      case "enteredZone":
        if (!byId.has(objective.when.zone)) errors.push(`${at}: unknown Zone ${objective.when.zone}`);
        break;
    }
  }
  const from = byId.get(def.exit.fromZone);
  if (!from) errors.push(`scenario ${def.id} exit: unknown source Zone ${def.exit.fromZone}`);
  if (!byId.has(def.exit.toZone)) errors.push(`scenario ${def.id} exit: unknown destination Zone ${def.exit.toZone}`);
  if (from && !from.portals.some((portal) => portal.toZone === def.exit.toZone)) {
    errors.push(`scenario ${def.id} exit: no portal from ${def.exit.fromZone} to ${def.exit.toZone}`);
  }
  for (const zone of zones) {
    const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < zone.map.width && y < zone.map.height;
    const walkable = (x: number, y: number) => inBounds(x, y) && zone.map.tiles[y * zone.map.width + x] === 0;
    if (!walkable(zone.spawn.x, zone.spawn.y)) errors.push(`Zone ${zone.id} spawn: tile is blocked or out of bounds`);
    for (const [index, portal] of zone.portals.entries()) {
      if (!walkable(portal.x, portal.y)) errors.push(`Zone ${zone.id} portal ${index}: source tile is blocked or out of bounds`);
      const target = byId.get(portal.toZone);
      if (!target) {
        errors.push(`Zone ${zone.id} portal ${index}: unknown destination Zone ${portal.toZone}`);
      } else if (portal.toX < 0 || portal.toY < 0 || portal.toX >= target.map.width || portal.toY >= target.map.height ||
                 target.map.tiles[portal.toY * target.map.width + portal.toX] !== 0) {
        errors.push(`Zone ${zone.id} portal ${index}: destination tile is blocked or out of bounds`);
      }
    }
  }
  return errors;
}
```

Keep the implementation exhaustive as shown; do not introduce generic callbacks or string expressions. Extend the validator test table when the final tutorial selects a concrete action operation. Add the approved `Scenario` and `Gameplay Fact` glossary entries to `CONTEXT.md` immediately after the World concepts.


- [ ] **Step 4: Run validator tests and the protocol/server type gate**

Run: `bun test packages/server/src/scenario.test.ts && bun run typecheck`

Expected: scenario tests PASS; typecheck exits 0.

- [ ] **Step 5: Commit the validated authored-content seam**

```bash
git add CONTEXT.md packages/server/src/scenario.ts packages/server/src/scenario.test.ts
git commit -m "feat(server): add validated scenario definitions"
```

---

### Task 2: Authoritative Gameplay Facts and guided objective evaluation

**Files:**
- Create: `packages/server/src/gameplay-facts.ts`
- Create: `packages/server/src/gameplay-facts.test.ts`
- Modify: `packages/server/src/entities.ts`
- Modify: `packages/server/src/game.ts`
- Modify: `packages/server/src/scenario.ts`
- Modify: `packages/server/src/scenario.test.ts`
- Modify: `packages/server/src/gather-system.ts`
- Modify: `packages/server/src/train-system.ts`
- Modify: `packages/server/src/action-system.ts`
- Modify: `packages/server/src/inventory-system.ts`
- Modify: `packages/server/src/skills-system.ts`
- Modify: `packages/server/src/quest-system.ts`

**Interfaces:**
- Consumes: `ScenarioDef`, `ScenarioProgress`, and successful existing System transitions.
- Produces: `GameplayFact`, `FactDraft`, `emitFact(world, draft)`, `GameWorld.consumeFacts()`, and `advanceScenario(def, progress, facts)`.

- [ ] **Step 1: Write failing fact-order and early-evidence tests**

Create tests proving successful-only emission, deterministic sequence, retained early evidence, one-time completion, and Player isolation:

```ts
import { expect, test } from "bun:test";
import { GameWorld } from "./game";
import { advanceScenario, initialScenarioProgress, type ScenarioDef } from "./scenario";

const def: ScenarioDef = {
  id: "first_steps", version: 1, startZone: "tutorial",
  objectives: [
    { id: "talk", text: "Talk.", when: { kind: "talkedTo", npcType: "cook" } },
    { id: "gather", text: "Gather.", when: { kind: "gathered", resourceType: "tree", item: "logs" } },
  ],
  exit: { fromZone: "tutorial", toZone: "overworld" },
};

test("facts keep deterministic sequence within a Tick", () => {
  const world = new GameWorld({ width: 3, height: 3, tiles: Array(9).fill(0), heights: Array(9).fill(0), scenery: [] }, { x: 1, y: 1 }, () => 0);
  world.addPlayer("p");
  world.emitFact({ kind: "skillXpGained", playerId: "p", skill: "woodcutting", amount: 25 });
  world.emitFact({ kind: "resourceGathered", playerId: "p", resourceType: "tree", item: "logs", qty: 1 });
  expect(world.consumeFacts().map((fact) => [fact.tick, fact.sequence, fact.kind])).toEqual([
    [0, 0, "skillXpGained"], [0, 1, "resourceGathered"],
  ]);
});

test("early facts are retained and objectives advance once in authored order", () => {
  const progress = initialScenarioProgress(def);
  const facts = [
    { kind: "resourceGathered", tick: 4, sequence: 0, playerId: "p", resourceType: "tree", item: "logs", qty: 1 },
    { kind: "playerTalked", tick: 5, sequence: 0, playerId: "p", npcType: "cook" },
  ] as const;
  const next = advanceScenario(def, progress, facts, "p");
  expect(next.completed).toEqual(["talk", "gather"]);
  expect(next.done).toBe(true);
  expect(advanceScenario(def, next, facts, "p")).toEqual(next);
});
```

Add focused System tests: wrong/nonexistent target emits no fact; successful Gather emits XP then Resource fact in the documented order; successful Recipe/action emits `itemProduced`; successful drop/equip/examine emits `inventoryActionPerformed`; successful talk emits `playerTalked`.

- [ ] **Step 2: Run focused tests and observe missing APIs**

Run: `bun test packages/server/src/gameplay-facts.test.ts packages/server/src/scenario.test.ts packages/server/src/gather-system.test.ts packages/server/src/train-system.test.ts packages/server/src/action-system.test.ts packages/server/src/inventory-system.test.ts packages/server/src/quest-system.test.ts`

Expected: FAIL on missing `emitFact`, `consumeFacts`, and `advanceScenario`.

- [ ] **Step 3: Implement the closed fact union and buffer**

Create `packages/server/src/gameplay-facts.ts`:

```ts
export type FactDraft =
  | { kind: "playerTalked"; playerId: string; npcType: string }
  | { kind: "resourceGathered"; playerId: string; resourceType: string; item: string; qty: number }
  | { kind: "itemProduced"; playerId: string; source: "recipe" | "action"; operation: string; item: string; qty: number }
  | { kind: "inventoryActionPerformed"; playerId: string; action: "drop" | "equip" | "examine"; item: string }
  | { kind: "skillXpGained"; playerId: string; skill: string; amount: number }
  | { kind: "skillLevelGained"; playerId: string; skill: string; level: number }
  | { kind: "playerEnteredZone"; playerId: string; zone: string }
  | { kind: "scenarioExitCrossed"; playerId: string; scenarioId: string; fromZone: string; toZone: string };

export type GameplayFact = FactDraft & { tick: number; sequence: number };
```

Add `facts: GameplayFact[]` and `factSequence: number` to `GameEvents`. Add these exact `GameWorld` methods:

```ts
emitFact(draft: FactDraft): void {
  this.events.facts.push({ ...draft, tick: this.tick, sequence: this.events.factSequence++ });
}
consumeFacts(): GameplayFact[] {
  const facts = this.events.facts;
  this.events.facts = [];
  this.events.factSequence = 0;
  return facts;
}
```

- [ ] **Step 4: Emit facts at successful System transitions and implement evaluation**

Instrument only tutorial-relevant success paths. Keep rule decisions inside each existing System. Emit after state mutation and before returning success. Route XP facts through `skills-system.ts::awardXp` so every caller gets identical semantics. Add `advanceScenario` to `scenario.ts` as a pure evaluator that:

1. filters facts by Player;
2. records matching early evidence by objective ID;
3. advances consecutive authored objectives whose evidence exists;
4. marks `done` only when all objectives complete;
5. returns the original value when nothing changed.

Do not emit facts for attempts, missing targets, insufficient Items, cooldown rejection, or full-Inventory rejection.

- [ ] **Step 5: Run focused System/evaluator tests**

Run the same focused command from Step 2.

Expected: all listed tests PASS.

- [ ] **Step 6: Commit Gameplay Facts and evaluation**

```bash
git add packages/server/src/{gameplay-facts.ts,gameplay-facts.test.ts,entities.ts,game.ts,scenario.ts,scenario.test.ts,gather-system.ts,train-system.ts,action-system.ts,inventory-system.ts,skills-system.ts,quest-system.ts} packages/server/src/{gather-system.test.ts,train-system.test.ts,action-system.test.ts,inventory-system.test.ts,quest-system.test.ts}
git commit -m "feat(server): evaluate scenario objectives from gameplay facts"
```

---

### Task 3: Deterministic multi-Zone execution and lossless transfer

**Files:**
- Modify: `packages/server/src/game.ts`
- Modify: `packages/server/src/entities.ts`
- Modify: `packages/server/src/zones.ts`
- Modify: `packages/server/src/zones.test.ts`
- Create: `packages/server/src/scenario-runner.ts`
- Create: `packages/server/src/scenario-runner.test.ts`

**Interfaces:**
- Consumes: `ScenarioDef`, `advanceScenario`, `GameplayFact`, existing `ZoneDef[]`.
- Produces: `ZonesOptions`, `PlayerTransferState`, `Zones.progressOf`, `Zones.consumeScenarioChanges`, `runScenario`, `ScenarioTrace`, and deterministic state digests.

- [ ] **Step 1: Write failing transfer and determinism tests**

Add tests that construct two custom Zones and assert:

```ts
const zones = new Zones(defs, { rngForZone: (zone) => seededRng(zone === "tutorial" ? 1 : 2), scenario });
zones.addPlayer("p", restored);
const p = zones.worldOf("p").players.get("p")!;
p.hp = 3;
p.gatherCd = 7;
p.trainReadyTick = 9;
zones.worldOf("p").queueMove("p", portal.x, portal.y);
while (zones.zoneOf("p") === "tutorial") zones.step(1 / 15);
const moved = zones.worldOf("p").players.get("p")!;
expect({ hp: moved.hp, gatherCd: moved.gatherCd, trainReadyTick: moved.trainReadyTick }).toEqual({ hp: 3, gatherCd: 7, trainReadyTick: 9 });
expect(zones.consumeTransitions()).toHaveLength(1);
```

In `scenario-runner.test.ts`, run the same definition/seed/input trace twice and compare complete `facts`, `transitions`, and `digests`. Add a regression that the destination World's Tick increments once, not twice, during transfer.

- [ ] **Step 2: Run focused tests and observe transfer/determinism failures**

Run: `bun test packages/server/src/zones.test.ts packages/server/src/scenario-runner.test.ts`

Expected: FAIL because `ZonesOptions`, lossless transfer, progress APIs, and runner do not exist; existing transfer resets transient fields.

- [ ] **Step 3: Separate persistence state from simulation transfer state**

Add an exact `PlayerTransferState` shape containing every mutable `PlayerEntity` field except `id`, then implement:

```ts
export interface PlayerTransferState extends Omit<PlayerEntity, "id"> {}

removePlayerForTransfer(id: string): PlayerTransferState | null {
  const player = this.players.get(id);
  if (!player) return null;
  this.players.delete(id);
  const { id: _id, ...state } = player;
  return structuredClone(state);
}

addTransferredPlayer(id: string, state: PlayerTransferState, x: number, y: number): void {
  this.players.set(id, { ...state, id, x, y, path: [], target: null, gatherTarget: null });
}
```

The explicit policy is: preserve HP, Inventory, Skills, bank, equipment, quests, Scenario progress, Order, and cooldown counters; clear movement path and target references because destination entity IDs/coordinates are Zone-local. Tests must enumerate this policy so a future field addition fails visibly.

- [ ] **Step 4: Inject Zone RNG and Scenario evaluation**

Add:

```ts
export interface ZonesOptions {
  rngForZone?: (zoneId: string) => () => number;
  scenario?: ScenarioDef;
}
```

Construct each `GameWorld` with `opts.rngForZone?.(def.id)`. Preserve `Map` insertion order from validated `ZoneDef[]`. During `Zones.step`, drain each World's facts after stepping, apply transitions, append transition facts, and call `advanceScenario` for affected Players. Expose progress via `progressOf(id)` and changed Player IDs via `consumeScenarioChanges()`.

- [ ] **Step 5: Implement the deterministic headless runner**

Create `scenario-runner.ts` with:

```ts
export interface ScenarioInput { tick: number; playerId: string; intent: Intent }
export interface ScenarioTrace {
  scenarioId: string;
  version: number;
  seed: number;
  facts: GameplayFact[];
  transitions: ZoneTransition[];
  digests: { tick: number; digest: string }[];
}
export function runScenario(args: {
  scenario: ScenarioDef;
  zones: ZoneDef[];
  seed: number;
  players: { id: string; state?: RestoredState }[];
  inputs: ScenarioInput[];
  ticks: number;
}): ScenarioTrace;
```

Use a stable seeded RNG derived from `(seed, zoneId)`. Before each outer Tick, apply inputs whose `tick` matches the upcoming Tick through the same `executeIntent`/`GameWorld` command vocabulary. Serialize digest input with sorted Zone IDs, sorted entity IDs, stable object keys, and no presentation queues; hash with `Bun.CryptoHasher("sha256")`.

- [ ] **Step 6: Run deterministic/transfer tests**

Run: `bun test packages/server/src/zones.test.ts packages/server/src/scenario-runner.test.ts`

Expected: PASS, including byte-identical traces across repeated runs.

- [ ] **Step 7: Commit multi-Zone Scenario execution**

```bash
git add packages/server/src/{entities.ts,game.ts,zones.ts,zones.test.ts,scenario-runner.ts,scenario-runner.test.ts}
git commit -m "feat(server): run scenarios deterministically across zones"
```

---

### Task 4: Scenario progress persistence and authoritative client message

**Files:**
- Create: `packages/protocol/src/scenarios.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/protocol.test.ts`
- Modify: `packages/server/src/{db,db.test,store,store.test,game,server,server.test}.ts`
- Modify: `packages/client/src/{connection,connection.test,game-state,game-state.test}.ts`

**Interfaces:**
- Consumes: server `ScenarioProgress` and `Zones.progressOf`.
- Produces: wire `ScenarioState`, `ScenarioMsg`, persisted `scenario: ScenarioState | null`, and `GameState.setScenario`.

- [ ] **Step 1: Write failing protocol, persistence, and client-state tests**

Define expected wire shape in tests:

```ts
const msg: ScenarioMsg = {
  t: "scenario",
  scenarioId: "first_steps",
  version: 1,
  objectiveId: "gather_logs",
  objectiveText: "Find a tree and gather logs.",
  completed: ["meet_guide"],
  done: false,
};
expect(decodeServer(encode(msg))).toEqual(msg);
```

Add SQLite round-trip and migration tests for `scenario` JSON. Add `Connection` test proving `scenario` messages call `GameState.setScenario`. Add server test proving welcome is followed by authoritative Scenario progress for a Player in the tutorial.

- [ ] **Step 2: Run focused tests and observe missing message/storage failures**

Run: `bun test packages/protocol/src/protocol.test.ts packages/server/src/db.test.ts packages/server/src/store.test.ts packages/server/src/server.test.ts packages/client/src/connection.test.ts packages/client/src/game-state.test.ts`

Expected: FAIL on missing `ScenarioMsg`, `scenario` persistence, and client setter.

- [ ] **Step 3: Add the narrow wire type**

Create `packages/protocol/src/scenarios.ts`:

```ts
export interface ScenarioState {
  scenarioId: string;
  version: number;
  objectiveId: string | null;
  objectiveText: string | null;
  completed: string[];
  done: boolean;
}
```

Add `ScenarioMsg = { t: "scenario" } & ScenarioState`, export it, and include it in `ServerMsg`.

- [ ] **Step 4: Persist compact Scenario progress in both stores**

Add `scenario TEXT` to SQLite and Postgres schemas, with an idempotent SQLite migration. Extend `PlayerStateRecord` with `scenario: ScenarioState | null`. Parse invalid/null data to `null`; do not silently coerce incompatible versions into active progress. Update every save/load callsite and tests.

Keep atomic tutorial completion observable at the store interface: one `savePlayerState` call contains destination `zone`, destination coordinates, and completed Scenario state. The server must await this save before sending the final `ZoneMsg`/completed `ScenarioMsg`; on failure it leaves the Player in the tutorial and sends an actionable system message.

- [ ] **Step 5: Send and receive Scenario state**

Add `GameState.scenario: ScenarioState | null` and `setScenario(state)`. `Connection.handle` routes `scenario`. `startServer` sends progress after login and whenever `consumeScenarioChanges()` returns a Player ID. Do not send facts or evaluator internals.

- [ ] **Step 6: Run focused protocol/store/server/client tests**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 7: Commit persistence and wire progress**

```bash
git add packages/protocol/src/{scenarios.ts,index.ts,protocol.test.ts} packages/server/src/{db.ts,db.test.ts,store.ts,store.test.ts,game.ts,server.ts,server.test.ts} packages/client/src/{connection.ts,connection.test.ts,game-state.ts,game-state.test.ts}
git commit -m "feat: persist and sync scenario progress"
```

---

### Task 5: Tutorial content and compact objective UX

**Files:**
- Create: `packages/server/src/tutorial.ts`
- Create: `packages/server/src/tutorial.test.ts`
- Modify: `packages/server/src/world.ts`
- Modify: `packages/server/src/server.ts`
- Modify: `packages/client/src/render/panel.ts`
- Modify: `packages/client/src/render/panel.test.ts`
- Modify: `packages/client/src/render/renderer.ts`
- Modify: `packages/client/src/render/overlay.test.ts`
- Modify: `packages/protocol/src/index.ts`, `packages/client/src/connection.ts`, and `packages/server/src/server.ts` for the authenticated `inventoryAction` message used to observe Examine; no catalog change is needed because `fletch_arrow_shafts`, `logs`, and `arrow_shafts` already exist.

**Interfaces:**
- Consumes: `ScenarioDef`, `ZoneDef`, existing catalogs, `GameState.scenario`.
- Produces: `TUTORIAL_SCENARIO`, `TUTORIAL_ZONE`, `scenarioLines(state)`, and server selection of tutorial start for new accounts.

- [ ] **Step 1: Write failing content and presentation tests**

In `tutorial.test.ts`, assert startup validation, reachable spawn/guide/Resource/work area/portal, reacquirable required Items, and successful deterministic completion with a scripted headless trace. The trace must include talk, Gather, processing, Inventory action, and exit; do not grant completion directly.

In `panel.test.ts`:

```ts
expect(scenarioLines({
  scenarioId: "first_steps", version: 1,
  objectiveId: "gather_logs", objectiveText: "Find a tree and gather logs.",
  completed: ["meet_guide"], done: false,
})).toEqual(["First Steps", "• Find a tree and gather logs."]);
```

Add renderer snapshot/overlay assertions that one compact objective line is visible without overlapping the world or side-panel tabs at 80×24 and 100×40.

- [ ] **Step 2: Run focused tests and observe missing tutorial/UX failures**

Run: `bun test packages/server/src/tutorial.test.ts packages/client/src/render/panel.test.ts packages/client/src/render/overlay.test.ts`

Expected: FAIL on missing `TUTORIAL_SCENARIO`, `TUTORIAL_ZONE`, and `scenarioLines`.

- [ ] **Step 3: Author the smallest complete tutorial Zone**

Create a compact typed map with three beats: arrival guide, discoverable grove/work area, and exit overlook. Use existing Resource, Item, Skill, Model, and Recipe/action IDs wherever possible. Keep the map nonlethal. `TUTORIAL_SCENARIO` objectives must be exactly the approved mandatory journey and use one genuine post-tutorial processing mechanic.

Export:

```ts
function createTutorialMap(): MapData {
  const width = 16;
  const height = 12;
  const tiles = Array(width * height).fill(0);
  const heights = Array(width * height).fill(0);
  for (let x = 0; x < width; x++) {
    tiles[x] = 1;
    tiles[(height - 1) * width + x] = 1;
  }
  for (let y = 0; y < height; y++) {
    tiles[y * width] = 1;
    tiles[y * width + width - 1] = 1;
  }
  return { width, height, tiles, heights, scenery: [] };
}

export const TUTORIAL_ZONE: ZoneDef = {
  id: "tutorial",
  map: createTutorialMap(),
  spawn: { x: 2, y: 2 },
  seedItems: [],
  npcs: [{ type: "cook", x: 3, y: 3, radius: 0 }],
  resources: [
    { type: "tree", x: 8, y: 4 },
    { type: "tree", x: 9, y: 5 },
  ],
  portals: [{ x: 14, y: 9, toZone: "overworld", toX: SPAWN.x, toY: SPAWN.y }],
};

export const TUTORIAL_SCENARIO: ScenarioDef = {
  id: "first_steps",
  version: 1,
  startZone: "tutorial",
  initialItems: [{ item: "bronze_axe", qty: 1 }],
  objectives: [
    { id: "meet_guide", text: "Talk to the guide.", when: { kind: "talkedTo", npcType: "cook" } },
    { id: "gather_logs", text: "Find a tree and gather logs.", when: { kind: "gathered", resourceType: "tree", item: "logs" } },
    { id: "fletch_logs", text: "Select the logs and make arrow shafts.", when: { kind: "produced", source: "recipe", operation: "fletch_arrow_shafts", item: "arrow_shafts" } },
    { id: "use_inventory", text: "Examine the arrow shafts in your Inventory.", when: { kind: "inventoryAction", action: "examine", item: "arrow_shafts" } },
    { id: "gain_fletching_xp", text: "Review your new Fletching experience.", when: { kind: "gainedSkillXp", skill: "fletching", atLeast: 5 } },
    { id: "enter_world", text: "Cross into Termenor.", when: { kind: "enteredZone", zone: "overworld" } },
  ],
  exit: { fromZone: "tutorial", toZone: "overworld" },
};
```

Add a normal Inventory `Make` action for Items that are the sole input of an available Recipe; for `logs`, it dispatches the existing `train` Intent with `fletch_arrow_shafts`. Keep `Examine` client-visible and also send a narrow authenticated `inventoryAction` message so the authoritative Scenario evaluator can observe it; the server validates the referenced slot still contains the Item before emitting the fact. Do not grant Item, XP, or objective state from the client.

New accounts start in the tutorial with `TUTORIAL_SCENARIO.initialItems` applied to their per-Player Inventory; existing accounts retain their saved Zone and Inventory. Initial Items are never shared Ground Items, so concurrent Players cannot consume another Player's required axe. Required Resource respawn/availability must allow at least two Players to progress without permanent interference.

- [ ] **Step 4: Render current progress without a text wall**

Add pure `scenarioLines(state)` to `panel.ts`. Quest tab shows Scenario title/current objective/completed state. Renderer places one compact current-objective line in existing HUD space, clips to the visible play width, and uses existing palette constants. No modal overlay, flashing animation, or second guidance system.

Rejected required interactions use existing system chat/log feedback; add exact missing/full/wrong-target messages only where the playtest contract demonstrates ambiguity.

- [ ] **Step 5: Run tutorial, panel, renderer, and headless completion tests**

Run: `bun test packages/server/src/tutorial.test.ts packages/server/src/scenario-runner.test.ts packages/client/src/render/panel.test.ts packages/client/src/render/overlay.test.ts`

Expected: PASS.

- [ ] **Step 6: Run a focused manual smoke through the real client**

Run server and client using the existing commands with a fresh temporary DB, complete the mandatory path once, and record any blocking interaction mismatch in the task notes before committing. Do not change scope for cosmetic preferences; fix only behavior that prevents or obscures the approved path.

Expected: the Player reaches overworld with persisted `done: true` Scenario state.

- [ ] **Step 7: Commit tutorial content and UX**

```bash
git add packages/server/src/{tutorial.ts,tutorial.test.ts,world.ts,server.ts} packages/client/src/render/{panel.ts,panel.test.ts,renderer.ts,overlay.test.ts} packages/protocol/src
git commit -m "feat: add guided first steps tutorial"
```

---

### Task 6: Deterministic Scenario CLI and failure traces

**Files:**
- Create: `scripts/scenario.ts`
- Create: `scripts/scenario.test.ts`
- Modify: `package.json`
- Modify: `justfile`

**Interfaces:**
- Consumes: `runScenario`, `TUTORIAL_SCENARIO`, tutorial/overworld Zone definitions.
- Produces: `bun run scenario -- run first_steps`, `bun run scenario -- replay <trace>`, and retained JSON traces.

- [ ] **Step 1: Write failing CLI parse and replay tests**

Test exact parsing and exit behavior:

```ts
expect(parseScenarioArgs(["run", "first_steps", "--seed", "42", "--trace", out])).toEqual({
  command: "run", scenarioId: "first_steps", seed: 42, tracePath: out,
});
```

Write a trace, replay it, and assert digest equality. Change one input and assert replay reports the first divergent outer Tick with expected/actual digest.

- [ ] **Step 2: Run focused test and observe missing CLI failure**

Run: `bun test scripts/scenario.test.ts`

Expected: FAIL because `scripts/scenario.ts` does not exist.

- [ ] **Step 3: Implement run/replay with explicit artifacts**

The CLI must:

- select only registered validated Scenarios;
- default seed to `1` and print it;
- run headlessly without a WebSocket or renderer;
- write Scenario/version/seed/inputs/facts/transitions/digests as JSON;
- reject Scenario-version mismatch;
- on replay divergence, print the first Tick and nonzero exit;
- never treat notices or Snapshots as the replay source of truth.

Add scripts:

```json
"scenario": "bun run scripts/scenario.ts",
"verify:tutorial-headless": "bun run scripts/scenario.ts run first_steps --seed 1"
```

Add corresponding `just tutorial-headless` recipe.

- [ ] **Step 4: Run CLI tests and one real headless Scenario**

Run: `bun test scripts/scenario.test.ts && bun run verify:tutorial-headless`

Expected: tests PASS; command exits 0 and prints completed Scenario, seed, Tick count, and final digest.

- [ ] **Step 5: Commit the headless driver**

```bash
git add scripts/{scenario.ts,scenario.test.ts} package.json justfile
git commit -m "feat(dev): add deterministic scenario runner"
```

---

### Task 7: Consolidated PTY harness with normalized terminal perception

**Files:**
- Create: `scripts/requirements-playtest.txt`
- Create: `scripts/pty_harness.py`
- Create: `scripts/pty_harness_test.py`
- Modify: `scripts/pty-render-check.py`
- Modify: `scripts/pty-click-check.py`
- Modify: `scripts/pty-login-check.py`
- Modify: `justfile`

**Interfaces:**
- Produces: `PtyHarness`, `TerminalScreen`, `wait_for_text`, `wait_for_change`, `press`, `type_text`, `click`, `capture`, and failure artifact directory.
- Consumes: production server/client entrypoints and pyte 0.8.2 `Screen`/`ByteStream` APIs.

- [ ] **Step 1: Pin pyte and write failing terminal/lifecycle tests**

Create `scripts/requirements-playtest.txt`:

```text
pyte==0.8.2
```

Tests must feed truecolor SGR, cursor movement, clear-screen, synchronized-output markers, `▀`, and Unicode labels into `TerminalScreen`, then assert normalized text and per-cell foreground/background colors. Lifecycle tests use a short-lived child process to prove timeout logs, `finally` teardown, and temporary-directory cleanup.

- [ ] **Step 2: Install the focused dev dependency and observe missing harness failure**

Run: `python3 -m pip install --user -r scripts/requirements-playtest.txt && python3 -m unittest scripts/pty_harness_test.py`

Expected: dependency installs; tests FAIL because `pty_harness` is missing.

- [ ] **Step 3: Implement normalized terminal perception**

Use `pyte.Screen(cols, rows)` and `pyte.ByteStream(screen)`. Feed every raw PTY byte chunk to the stream while retaining the raw bytes. Expose:

```py
@dataclass(frozen=True)
class Cell:
    text: str
    fg: str
    bg: str

class TerminalScreen:
    def text(self) -> str: ...
    def line(self, row: int) -> str: ...
    def cell(self, col: int, row: int) -> Cell: ...
    def contains(self, text: str) -> bool: ...
```

Normalize trailing spaces per line for text assertions but preserve exact cell coordinates and colors for click/render contracts.

- [ ] **Step 4: Implement shared process, PTY, waits, timing, and artifacts**

`PtyHarness` must:

- allocate an OS-selected free port;
- create and later remove a temporary SQLite directory;
- capture server stdout/stderr instead of sending it to `DEVNULL`;
- poll the existing HTTP 200 readiness endpoint;
- spawn the production client with fixed PTY dimensions and configured credentials;
- expose keyboard and SGR mouse input;
- replace fixed sleeps with monotonic-deadline `wait_for` conditions;
- collect server-ready, auth-ready, first-world-frame, action-sent, expected-visible, total time, byte count, and repaint count;
- copy logs, raw PTY, normalized screen, action timeline, and timings into `/tmp/termenor-playtest-<timestamp>/` on failure;
- close fds, terminate/wait child processes, and clean the transient DB in `finally`.

- [ ] **Step 5: Port existing PTY checks without weakening contracts**

Rewrite render/click/login scripts as small scenarios over `PtyHarness`. Keep byte-level checks for truecolor and half-block output. Replace output-volume/tail heuristics with visible screen/cell assertions where possible. Preserve their existing command-line exit codes and root package scripts.

- [ ] **Step 6: Run harness unit tests and all three focused PTY checks**

Run: `python3 -m unittest scripts/pty_harness_test.py && bun run verify:render && bun run verify:click && bun run verify:login`

Expected: all PASS; output includes condition-driven phase timings; no fixed-port collision or unconditional 1.5-second server sleep remains.

- [ ] **Step 7: Commit the shared PTY adapter**

```bash
git add scripts/{requirements-playtest.txt,pty_harness.py,pty_harness_test.py,pty-render-check.py,pty-click-check.py,pty-login-check.py} justfile
git commit -m "test(dev): add reusable terminal playtest harness"
```

---

### Task 8: Full production-client tutorial playtest

**Files:**
- Create: `scripts/pty-tutorial-check.py`
- Modify: `package.json`
- Modify: `justfile`
- Modify: `docs/OPERATING-PROCEDURE.md`
- Modify: `docs/ROADMAP.md`

**Interfaces:**
- Consumes: tutorial Scenario, production server/client, `PtyHarness`, normalized screen, Scenario progress message.
- Produces: `bun run verify:tutorial`, attach/linger mode for agent or human continuation, and final vertical-slice evidence.

- [ ] **Step 1: Write the failing PTY tutorial scenario**

Implement the intended script against the harness before production wiring is considered complete. It must:

1. start with a fresh isolated DB and register/login a Player;
2. wait until the guide and first objective are visible;
3. click world cells to move and talk;
4. wait for the Gather objective;
5. locate/click the Resource through the production renderer;
6. wait for logs and Skill feedback;
7. perform the real processing action;
8. perform the required Inventory action through the side panel;
9. wait for the exit objective;
10. cross the real portal;
11. assert overworld map/guidance/completion visibility;
12. disconnect, reconnect with the same temporary DB, and assert completed progress persists.

The script may read semantic Scenario state for waits/diagnosis, but each acceptance action and visible assertion must pass through the real client/PTY surface.

- [ ] **Step 2: Run it and observe the first real UX failure**

Run: `python3 scripts/pty-tutorial-check.py`

Expected: FAIL at the first missing or ambiguous end-to-end behavior. Preserve the generated artifact directory and use it to fix the source, not the assertion.

- [ ] **Step 3: Close only demonstrated integration gaps**

Fix source behavior exposed by the PTY path: hit regions, objective visibility, rejection copy, Scenario message timing, reconnect restoration, portal commit ordering, or terminal clipping. For each gap, first add the narrowest unit/integration regression test in the owning package, then apply the minimal production fix.

Do not add optional tutorial branches or generic tooling in this step.

- [ ] **Step 4: Add commands and attach mode**

Add:

```json
"verify:tutorial": "python3 scripts/pty-tutorial-check.py"
```

Add `just tutorial` and an `--attach` option that stops after reaching the initial world, keeps the same PTY/server alive, prints the artifact/session location, and lets an agent or human continue sending harness actions. Attach mode must still clean up on interrupt.

- [ ] **Step 5: Run the complete focused vertical-slice gate**

Run:

```bash
bun test packages/server/src/scenario.test.ts packages/server/src/gameplay-facts.test.ts packages/server/src/scenario-runner.test.ts packages/server/src/tutorial.test.ts packages/server/src/zones.test.ts packages/server/src/db.test.ts packages/server/src/store.test.ts packages/server/src/server.test.ts packages/protocol/src/protocol.test.ts packages/client/src/game-state.test.ts packages/client/src/connection.test.ts packages/client/src/render/panel.test.ts packages/client/src/render/overlay.test.ts scripts/scenario.test.ts
bun run typecheck
bun run verify:tutorial-headless
bun run verify:tutorial
bun run verify:render
bun run verify:click
bun run verify:login
```

Expected: every command exits 0. Capture the headless final digest, PTY phase timings, and tutorial completion time in the task result.

- [ ] **Step 6: Perform one qualitative agent playthrough**

Use `--attach` and record factual observations: hesitation points, landmark discoverability, rejected/repeated interactions, traversal time between beats, objective completion times, causal clarity, and whether progress felt discovered or dictated. Fix only critical/high issues that violate the approved experience; record lower-priority tuning observations for the next content iteration rather than expanding this slice.

Expected: mandatory path is understandable without reading `?` help or typing a power command.

- [ ] **Step 7: Update operating docs and roadmap after the slice works**

Document exact install/run commands for the pinned Python playtest dependency, headless runner, PTY tutorial check, attach mode, fresh/persist behavior, and artifact paths in `docs/OPERATING-PROCEDURE.md`. Mark only the delivered tutorial Scenario/playtest substrate in `docs/ROADMAP.md`; do not mark deferred tutorial branches complete.

- [ ] **Step 8: Commit the completed vertical slice**

```bash
git add scripts/pty-tutorial-check.py package.json justfile docs/OPERATING-PROCEDURE.md docs/ROADMAP.md packages
git commit -m "feat: ship tutorial scenario playtest loop"
```

---

## Final acceptance

The plan is complete only when this exact path works:

> Start a fresh tutorial Scenario through the reusable harness; inspect the production terminal; click through movement, dialogue, Gather, Item processing, Inventory interaction, and Skill feedback; cross the real portal through `Zones`; arrive in the overworld with completion persisted; replay the same authored Scenario headlessly with deterministic results; retain actionable artifacts for any failed step.

No narrowed unit test or semantic-only driver substitutes for that path.

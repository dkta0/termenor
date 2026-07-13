import { readFileSync, writeFileSync } from "node:fs";
import { runScenario, type ScenarioInput, type ScenarioTrace } from "../packages/server/src/scenario-runner";
import { validateScenario, type ScenarioDef } from "../packages/server/src/scenario";
import { TUTORIAL_SCENARIO, TUTORIAL_ZONE } from "../packages/server/src/tutorial";
import { ZONE_DEFS, type ZoneDef } from "../packages/server/src/world";

const USAGE = [
  "Usage:",
  "  bun run scenario -- run <scenario> [--seed <integer>] [--trace <path>]",
  "  bun run scenario -- replay <trace>",
].join("\n");

export type ScenarioArgs =
  | { command: "run"; scenarioId: string; seed: number; tracePath?: string }
  | { command: "replay"; tracePath: string };

export interface ScenarioTraceArtifact {
  scenarioId: string;
  version: number;
  seed: number;
  inputs: ScenarioInput[];
  facts: ScenarioTrace["facts"];
  transitions: ScenarioTrace["transitions"];
  digests: ScenarioTrace["digests"];
}

export interface ScenarioCliOutput {
  log(message: string): void;
  error(message: string): void;
}

interface RegisteredScenario {
  definition: ScenarioDef;
  zones: ZoneDef[];
  playerId: string;
  inputs: ScenarioInput[];
  ticks: number;
}

interface ReplayTrace {
  scenarioId: string;
  version: number;
  seed: number;
  inputs: ScenarioInput[];
  digests: ScenarioTrace["digests"];
}

const tutorialInputs = [
  { tick: 1, playerId: "learner", intent: { kind: "talk", targetId: "npc-1" } },
  { tick: 2, playerId: "learner", intent: { kind: "gather", targetId: "res-1" } },
  { tick: 30, playerId: "learner", intent: { kind: "train", recipe: "fletch_arrow_shafts" } },
  { tick: 31, playerId: "learner", inventoryAction: { action: "examine", slot: 2 } },
  { tick: 32, playerId: "learner", intent: { kind: "move", x: 14, y: 9 } },
] satisfies ScenarioInput[];

function registerScenarios(entries: RegisteredScenario[]): ReadonlyMap<string, RegisteredScenario> {
  const registered = new Map<string, RegisteredScenario>();
  for (const entry of entries) {
    if (registered.has(entry.definition.id)) {
      throw new Error(`Duplicate registered Scenario: ${entry.definition.id}`);
    }
    const validationErrors = validateScenario(entry.definition, entry.zones);
    if (validationErrors.length > 0) {
      throw new Error(`Invalid registered Scenario ${entry.definition.id}:\n${validationErrors.join("\n")}`);
    }
    registered.set(entry.definition.id, entry);
  }
  return registered;
}

const REGISTERED_SCENARIOS = registerScenarios([
  {
    definition: TUTORIAL_SCENARIO,
    zones: [TUTORIAL_ZONE, ...ZONE_DEFS],
    playerId: "learner",
    inputs: tutorialInputs,
    ticks: 100,
  },
]);

export function parseScenarioArgs(args: string[]): ScenarioArgs {
  if (args[0] === "replay") {
    if (args.length !== 2 || !args[1]) throw new Error(USAGE);
    return { command: "replay", tracePath: args[1] };
  }

  if (args[0] !== "run" || args.length < 2 || !args[1]) throw new Error(USAGE);

  const scenarioId = args[1];
  let seed = 1;
  let tracePath: string | undefined;
  let hasSeed = false;
  for (let index = 2; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (!value) throw new Error(USAGE);

    if (option === "--seed") {
      if (hasSeed) throw new Error("duplicate --seed");
      if (!/^-?\d+$/.test(value)) throw new Error(`invalid seed: ${value}`);
      seed = Number(value);
      if (!Number.isSafeInteger(seed)) throw new Error(`invalid seed: ${value}`);
      hasSeed = true;
      continue;
    }

    if (option === "--trace") {
      if (tracePath !== undefined) throw new Error("duplicate --trace");
      tracePath = value;
      continue;
    }

    throw new Error(USAGE);
  }

  const parsed: ScenarioArgs = { command: "run", scenarioId, seed };
  if (tracePath !== undefined) parsed.tracePath = tracePath;
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStopCondition(value: unknown): boolean {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  switch (value.kind) {
    case "forever":
    case "untilFull":
      return true;
    case "count":
      return isFiniteNumber(value.n);
    case "untilLevel":
      return isFiniteNumber(value.level);
    default:
      return false;
  }
}

function isIntent(value: unknown): boolean {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  switch (value.kind) {
    case "move":
      return isFiniteNumber(value.x) && isFiniteNumber(value.y);
    case "attack":
    case "gather":
    case "talk":
    case "openBank":
    case "openShop":
      return typeof value.targetId === "string";
    case "pickup":
    case "stopOrder":
      return true;
    case "drop":
    case "equip":
      return isFiniteNumber(value.slot);
    case "unequip":
      return isFiniteNumber(value.index);
    case "use":
      return typeof value.action === "string" && isFiniteNumber(value.slot);
    case "train":
      return typeof value.recipe === "string";
    case "deposit":
      return isFiniteNumber(value.slot) && isFiniteNumber(value.qty);
    case "withdraw":
      return isFiniteNumber(value.index) && isFiniteNumber(value.qty);
    case "buy":
    case "sell":
      return typeof value.item === "string" && isFiniteNumber(value.qty);
    case "order":
      return (value.activity === "gather" || value.activity === "combat")
        && typeof value.targetType === "string"
        && isStopCondition(value.stop);
    default:
      return false;
  }
}

function isScenarioInput(value: unknown): value is ScenarioInput {
  if (
    !isRecord(value)
    || typeof value.tick !== "number"
    || !Number.isSafeInteger(value.tick)
    || value.tick < 1
    || typeof value.playerId !== "string"
  ) {
    return false;
  }

  const hasIntent = value.intent !== undefined;
  const hasInventoryAction = value.inventoryAction !== undefined;
  if (hasIntent === hasInventoryAction) return false;
  if (hasIntent) return isIntent(value.intent);

  return isRecord(value.inventoryAction)
    && value.inventoryAction.action === "examine"
    && isFiniteNumber(value.inventoryAction.slot);
}


function readTraceArtifact(path: string): ReplayTrace {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (
    !isRecord(value)
    || typeof value.scenarioId !== "string"
    || typeof value.version !== "number"
    || !Number.isInteger(value.version)
    || typeof value.seed !== "number"
    || !Number.isSafeInteger(value.seed)
    || !Array.isArray(value.inputs)
    || !Array.isArray(value.facts)
    || !Array.isArray(value.transitions)
    || !Array.isArray(value.digests)
  ) {
    throw new Error(`Invalid Scenario trace: ${path}`);
  }

  const inputs: ScenarioInput[] = [];
  for (const [index, input] of value.inputs.entries()) {
    if (!isScenarioInput(input)) {
      throw new Error(`Invalid Scenario trace input at index ${index}: ${path}`);
    }
    inputs.push(input);
  }

  const digests: ScenarioTrace["digests"] = [];
  for (let index = 0; index < value.digests.length; index++) {
    const digest = value.digests[index];
    if (
      !isRecord(digest)
      || typeof digest.tick !== "number"
      || digest.tick !== index + 1
      || typeof digest.digest !== "string"
      || !/^[0-9a-f]{64}$/.test(digest.digest)
    ) {
      throw new Error(`Invalid Scenario trace digest at index ${index}: ${path}`);
    }
    digests.push({ tick: digest.tick, digest: digest.digest });
  }

  return {
    scenarioId: value.scenarioId,
    version: value.version,
    seed: value.seed,
    inputs,
    digests,
  };
}

function runRegisteredScenario(registration: RegisteredScenario, seed: number, inputs: ScenarioInput[], ticks: number) {
  return runScenario({
    scenario: registration.definition,
    zones: registration.zones,
    seed,
    players: [{ id: registration.playerId, newScenarioPlayer: true }],
    inputs,
    ticks,
  });
}

function printSummary(
  output: ScenarioCliOutput,
  verb: "Completed" | "Replayed",
  scenario: ScenarioDef,
  seed: number,
  digests: ScenarioTrace["digests"],
): void {
  output.log(`${verb} Scenario: ${scenario.id} (version ${scenario.version})`);
  output.log(`Seed: ${seed}`);
  output.log(`Ticks: ${digests.length}`);
  output.log(`Final digest: ${digests.at(-1)?.digest ?? "<none>"}`);
}

function executeRun(args: Extract<ScenarioArgs, { command: "run" }>, output: ScenarioCliOutput): number {
  const registration = REGISTERED_SCENARIOS.get(args.scenarioId);
  if (!registration) {
    output.error(`Unknown Scenario: ${args.scenarioId}`);
    return 2;
  }

  const trace = runRegisteredScenario(
    registration,
    args.seed,
    registration.inputs,
    registration.ticks,
  );
  const artifact: ScenarioTraceArtifact = {
    scenarioId: trace.scenarioId,
    version: trace.version,
    seed: trace.seed,
    inputs: registration.inputs,
    facts: trace.facts,
    transitions: trace.transitions,
    digests: trace.digests,
  };
  if (args.tracePath !== undefined) {
    writeFileSync(args.tracePath, `${JSON.stringify(artifact, null, 2)}\n`);
  }

  if (!trace.progress[registration.playerId]?.done) {
    output.error(
      `Scenario ${registration.definition.id} did not complete after ${registration.ticks} Ticks; final digest ${trace.digests.at(-1)?.digest ?? "<none>"}`,
    );
    return 1;
  }

  printSummary(output, "Completed", registration.definition, args.seed, trace.digests);
  return 0;
}

function executeReplay(args: Extract<ScenarioArgs, { command: "replay" }>, output: ScenarioCliOutput): number {
  const artifact = readTraceArtifact(args.tracePath);
  const registration = REGISTERED_SCENARIOS.get(artifact.scenarioId);
  if (!registration) {
    output.error(`Unknown Scenario: ${artifact.scenarioId}`);
    return 2;
  }
  if (artifact.version !== registration.definition.version) {
    output.error(
      `Scenario version mismatch for ${artifact.scenarioId}: trace ${artifact.version}, registered ${registration.definition.version}`,
    );
    return 2;
  }
  if (artifact.digests.length !== registration.ticks) {
    output.error(
      `Scenario trace Tick count mismatch for ${artifact.scenarioId}: trace ${artifact.digests.length}, expected ${registration.ticks}`,
    );
    return 2;
  }
  const outOfRangeInputIndex = artifact.inputs.findIndex((input) => input.tick > registration.ticks);
  if (outOfRangeInputIndex !== -1) {
    const input = artifact.inputs[outOfRangeInputIndex];
    output.error(
      `Invalid Scenario trace input at index ${outOfRangeInputIndex}: Tick ${input?.tick} is outside registered range 1..${registration.ticks}: ${args.tracePath}`,
    );
    return 2;
  }

  const replay = runRegisteredScenario(
    registration,
    artifact.seed,
    artifact.inputs,
    registration.ticks,
  );
  for (let index = 0; index < artifact.digests.length; index++) {
    const expected = artifact.digests[index];
    const actual = replay.digests[index];
    if (expected?.tick !== actual?.tick || expected?.digest !== actual?.digest) {
      const tick = expected?.tick ?? actual?.tick ?? index + 1;
      output.error(
        `Replay diverged at Tick ${tick}: expected ${expected?.digest ?? "<missing>"}, actual ${actual?.digest ?? "<missing>"}`,
      );
      return 1;
    }
  }
  if (!replay.progress[registration.playerId]?.done) {
    output.error(
      `Replayed Scenario ${registration.definition.id} did not complete after ${registration.ticks} Ticks; final digest ${replay.digests.at(-1)?.digest ?? "<none>"}`,
    );
    return 1;
  }

  printSummary(output, "Replayed", registration.definition, artifact.seed, replay.digests);
  return 0;
}

export function executeScenarioCli(args: string[], output: ScenarioCliOutput = console): number {
  try {
    const parsed = parseScenarioArgs(args);
    return parsed.command === "run"
      ? executeRun(parsed, output)
      : executeReplay(parsed, output);
  } catch (error) {
    output.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
}

if (import.meta.main) {
  process.exitCode = executeScenarioCli(process.argv.slice(2));
}

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  executeScenarioCli,
  parseScenarioArgs,
  type ScenarioTraceArtifact,
} from "./scenario";

interface CapturedExecution {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function capture(args: string[]): CapturedExecution {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCode = executeScenarioCli(args, {
    log: (message) => stdout.push(message),
    error: (message) => stderr.push(message),
  });
  return { exitCode, stdout: stdout.join("\n"), stderr: stderr.join("\n") };
}

function readTrace(path: string): ScenarioTraceArtifact {
  return JSON.parse(readFileSync(path, "utf8")) as ScenarioTraceArtifact;
}

let root: string;
let tracePath: string;
let initialRun: CapturedExecution;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "termenor-scenario-"));
  tracePath = join(root, "first-steps.json");
  initialRun = capture(["run", "first_steps", "--seed", "42", "--trace", tracePath]);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

test("parseScenarioArgs parses run options exactly", () => {
  expect(parseScenarioArgs(["run", "first_steps", "--seed", "42", "--trace", tracePath])).toEqual({
    command: "run",
    scenarioId: "first_steps",
    seed: 42,
    tracePath,
  });
  expect(parseScenarioArgs(["run", "first_steps"])).toEqual({
    command: "run",
    scenarioId: "first_steps",
    seed: 1,
  });
});

test("parseScenarioArgs parses replay exactly and rejects extra or malformed arguments", () => {
  expect(parseScenarioArgs(["replay", tracePath])).toEqual({ command: "replay", tracePath });
  expect(() => parseScenarioArgs(["replay", tracePath, "extra"])).toThrow("Usage:");
  expect(() => parseScenarioArgs(["run", "first_steps", "--seed", "42x"])).toThrow("invalid seed");
  expect(() => parseScenarioArgs(["run", "first_steps", "--trace", tracePath, "extra"])).toThrow("Usage:");
});

test("run completes first_steps and writes a byte-stable explicit trace", () => {
  expect(initialRun.exitCode).toBe(0);
  expect(initialRun.stderr).toBe("");
  expect(initialRun.stdout).toContain("Completed Scenario: first_steps (version 2)");
  expect(initialRun.stdout).toContain("Seed: 42");
  expect(initialRun.stdout).toContain("Ticks: 100");
  expect(initialRun.stdout).toMatch(/Final digest: [0-9a-f]{64}/);

  const firstBytes = readFileSync(tracePath, "utf8");
  const trace = readTrace(tracePath);
  expect(Object.keys(trace)).toEqual([
    "scenarioId",
    "version",
    "seed",
    "inputs",
    "facts",
    "transitions",
    "digests",
  ]);
  expect(trace).toMatchObject({ scenarioId: "first_steps", version: 2, seed: 42 });
  expect(trace.inputs).toHaveLength(6);
  expect(trace.facts.length).toBeGreaterThan(0);
  expect(trace.transitions).toHaveLength(1);
  expect(trace.digests).toHaveLength(100);

  const secondPath = join(root, "first-steps-again.json");
  expect(capture(["run", "first_steps", "--seed", "42", "--trace", secondPath]).exitCode).toBe(0);
  expect(readFileSync(secondPath, "utf8")).toBe(firstBytes);
});

test("replay accepts matching digests", () => {
  const replay = capture(["replay", tracePath]);
  const trace = readTrace(tracePath);

  expect(replay.exitCode).toBe(0);
  expect(replay.stderr).toBe("");
  expect(replay.stdout).toContain("Replayed Scenario: first_steps (version 2)");
  expect(replay.stdout).toContain("Seed: 42");
  expect(replay.stdout).toContain("Ticks: 100");
  expect(replay.stdout).toContain(`Final digest: ${trace.digests.at(-1)?.digest}`);
});

test("replay rejects a syntactically valid input for an unregistered Player", () => {
  const unknownPlayerPath = join(root, "unknown-player-input.json");
  const unknownPlayer = readTrace(tracePath);
  unknownPlayer.inputs.push({
    tick: 100,
    playerId: "ghost",
    intent: { kind: "pickup" },
  });
  writeFileSync(unknownPlayerPath, `${JSON.stringify(unknownPlayer, null, 2)}\n`);

  const replay = capture(["replay", unknownPlayerPath]);

  expect(replay.exitCode).toBe(2);
  expect(replay.stdout).toBe("");
  expect(replay.stderr).toContain(
    'Scenario input at index 6 names unregistered Player "ghost"',
  );
});

test("replay reports expected and actual digests at the first divergent outer Tick", () => {
  const changedPath = join(root, "changed-input.json");
  const changed = readTrace(tracePath);
  const gather = changed.inputs[1];
  if (!gather || !gather.intent || gather.intent.kind !== "gather") {
    throw new Error("expected the registered gather input at index 1");
  }
  gather.intent.targetId = "res-999";
  writeFileSync(changedPath, `${JSON.stringify(changed, null, 2)}\n`);

  const replay = capture(["replay", changedPath]);
  expect(replay.exitCode).toBe(1);
  expect(replay.stdout).toBe("");
  expect(replay.stderr).toMatch(
    new RegExp(`Replay diverged at Tick 2: expected ${changed.digests[1]?.digest}, actual [0-9a-f]{64}`),
  );
  expect(replay.stderr).not.toContain(`actual ${changed.digests[1]?.digest}`);
});

test("replay rejects an empty digest stream instead of reporting success", () => {
  const emptyPath = join(root, "empty-digests.json");
  const empty = readTrace(tracePath);
  empty.digests = [];
  writeFileSync(emptyPath, `${JSON.stringify(empty, null, 2)}\n`);

  const replay = capture(["replay", emptyPath]);
  expect(replay.exitCode).toBe(2);
  expect(replay.stdout).toBe("");
  expect(replay.stderr).toContain(
    "Scenario trace Tick count mismatch for first_steps: trace 0, expected 100",
  );
});

test("replay rejects a matching digest prefix instead of verifying a partial run", () => {
  const truncatedPath = join(root, "truncated-digests.json");
  const truncated = readTrace(tracePath);
  truncated.digests = truncated.digests.slice(0, 50);
  writeFileSync(truncatedPath, `${JSON.stringify(truncated, null, 2)}\n`);

  const replay = capture(["replay", truncatedPath]);
  expect(replay.exitCode).toBe(2);
  expect(replay.stdout).toBe("");
  expect(replay.stderr).toContain(
    "Scenario trace Tick count mismatch for first_steps: trace 50, expected 100",
  );
});

test("replay rejects an extended digest stream", () => {
  const extendedPath = join(root, "extended-digests.json");
  const extended = readTrace(tracePath);
  extended.digests.push({ tick: 101, digest: extended.digests.at(-1)!.digest });
  writeFileSync(extendedPath, `${JSON.stringify(extended, null, 2)}\n`);

  const replay = capture(["replay", extendedPath]);
  expect(replay.exitCode).toBe(2);
  expect(replay.stdout).toBe("");
  expect(replay.stderr).toBe(
    "Scenario trace Tick count mismatch for first_steps: trace 101, expected 100",
  );
});

test("replay rejects a reordered digest stream", () => {
  const reorderedPath = join(root, "reordered-digests.json");
  const reordered = readTrace(tracePath);
  [reordered.digests[0], reordered.digests[1]] = [reordered.digests[1]!, reordered.digests[0]!];
  writeFileSync(reorderedPath, `${JSON.stringify(reordered, null, 2)}\n`);

  const replay = capture(["replay", reorderedPath]);
  expect(replay.exitCode).toBe(2);
  expect(replay.stdout).toBe("");
  expect(replay.stderr).toBe(`Invalid Scenario trace digest at index 0: ${reorderedPath}`);
});

test("replay rejects a structurally invalid Scenario input", () => {
  const invalidPath = join(root, "invalid-input.json");
  const invalid = readTrace(tracePath) as Omit<ScenarioTraceArtifact, "inputs"> & { inputs: unknown[] };
  invalid.inputs = [{ tick: 1, playerId: "learner" }];
  writeFileSync(invalidPath, `${JSON.stringify(invalid, null, 2)}\n`);

  const replay = capture(["replay", invalidPath]);
  expect(replay.exitCode).toBe(2);
  expect(replay.stdout).toBe("");
  expect(replay.stderr).toContain(`Invalid Scenario trace input at index 0: ${invalidPath}`);
});

test("replay rejects inputs scheduled after the registered Tick horizon", () => {
  const outOfRangePath = join(root, "out-of-range-input.json");
  const outOfRange = readTrace(tracePath);
  outOfRange.inputs.push({
    tick: 101,
    playerId: "learner",
    intent: { kind: "talk", targetId: "npc-1" },
  });
  writeFileSync(outOfRangePath, `${JSON.stringify(outOfRange, null, 2)}\n`);

  const replay = capture(["replay", outOfRangePath]);
  expect(replay.exitCode).toBe(2);
  expect(replay.stdout).toBe("");
  expect(replay.stderr).toContain(
    `Invalid Scenario trace input at index 6: Tick 101 is outside registered range 1..100: ${outOfRangePath}`,
  );
});

test("run and replay reject unregistered Scenarios", () => {
  const run = capture(["run", "missing"]);
  expect(run.exitCode).toBe(2);
  expect(run.stderr).toContain("Unknown Scenario: missing");

  const unknownPath = join(root, "unknown.json");
  const unknown = { ...readTrace(tracePath), scenarioId: "missing" };
  writeFileSync(unknownPath, `${JSON.stringify(unknown, null, 2)}\n`);
  const replay = capture(["replay", unknownPath]);
  expect(replay.exitCode).toBe(2);
  expect(replay.stderr).toContain("Unknown Scenario: missing");
});

test("replay rejects a Scenario version mismatch", () => {
  const mismatchPath = join(root, "version-mismatch.json");
  const mismatch = readTrace(tracePath);
  mismatch.version += 1;
  writeFileSync(mismatchPath, `${JSON.stringify(mismatch, null, 2)}\n`);

  const replay = capture(["replay", mismatchPath]);
  expect(replay.exitCode).toBe(2);
  expect(replay.stderr).toContain("Scenario version mismatch for first_steps: trace 3, registered 2");
});

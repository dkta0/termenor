import { expect, test } from "bun:test";
import { decodeServer, encode, type ScenarioMsg } from "./index";

test("ScenarioMsg round-trips authoritative objective progress", () => {
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
});

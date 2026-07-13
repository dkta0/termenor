import { expect, test } from "bun:test";
import { decodeClient, decodeServer, encode, type InventoryActionMsg, type ScenarioMsg } from "./index";

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

test("InventoryActionMsg round-trips the narrow authenticated Examine request", () => {
  const msg: InventoryActionMsg = { t: "inventoryAction", action: "examine", slot: 7 };
  expect(decodeClient(encode(msg))).toEqual(msg);
});

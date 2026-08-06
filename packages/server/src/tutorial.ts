import type { MapData, Scenery } from "@termenor/protocol";
import { MODELS, solidFootprint } from "@termenor/protocol";
import type { ScenarioDef } from "./scenario";
import { SPAWN, type ZoneDef } from "./world";

export function createTutorialMap(): MapData {
  const width = 16;
  const height = 12;
  const tiles = Array(width * height).fill(0);
  const heights = Array(width * height).fill(0);
  const scenery: Scenery[] = [
    // Low fence-post landmarks lead from the arrival clearing toward the grove.
    { model: "fence", x: 5, y: 3 },
    { model: "fence", x: 7, y: 5 },
    // The crate marks the processing beat; the cliff marks the exit overlook.
    { model: "crate", x: 10, y: 7 },
    { model: "cliff", x: 12, y: 8 },
  ];

  for (let x = 0; x < width; x++) {
    tiles[x] = 1;
    tiles[(height - 1) * width + x] = 1;
  }
  for (let y = 0; y < height; y++) {
    tiles[y * width] = 1;
    tiles[y * width + width - 1] = 1;
  }
  for (const placed of scenery) {
    const model = MODELS[placed.model];
    if (!model) continue;
    for (const cell of solidFootprint(model, placed.x, placed.y)) {
      tiles[cell.y * width + cell.x] = 1;
    }
  }
  return { width, height, tiles, heights, scenery };
}

export const TUTORIAL_ZONE: ZoneDef = {
  id: "tutorial",
  map: createTutorialMap(),
  spawn: { x: 2, y: 2 },
  seedItems: [],
  npcs: [{ type: "chef", x: 3, y: 3, radius: 0 }],
  resources: [
    { type: "tree", x: 8, y: 4 },
    { type: "tree", x: 9, y: 5 },
  ],
  portals: [{ x: 12, y: 5, toZone: "overworld", toX: SPAWN.x, toY: SPAWN.y }],
};

export const TUTORIAL_SCENARIO: ScenarioDef = {
  id: "first_steps",
  version: 3,
  startZone: "tutorial",
  initialItems: [{ item: "bronze_axe", qty: 1 }],
  objectives: [
    { id: "meet_guide", text: "Talk to the guide.", when: { kind: "talkedTo", npcType: "chef" } },
    { id: "gather_logs", text: "Find a tree and gather logs.", when: { kind: "gathered", resourceType: "tree", item: "logs" } },
    { id: "fletch_logs", text: "Select the logs and make arrow shafts.", when: { kind: "produced", source: "recipe", operation: "fletch_arrow_shafts", item: "arrow_shafts" } },
    { id: "use_inventory", text: "Examine the arrow shafts in your Inventory.", when: { kind: "inventoryAction", action: "examine", item: "arrow_shafts" } },
    { id: "review_fletching_xp", text: "Review your new Fletching experience.", when: { kind: "viewedPanel", panel: "skills", afterObjective: "fletch_logs" } },
    { id: "enter_world", text: "Cross into Termenor.", when: { kind: "enteredZone", zone: "overworld" } },
  ],
  exit: { fromZone: "tutorial", toZone: "overworld" },
};

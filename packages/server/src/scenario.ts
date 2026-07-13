import { ITEM_KINDS, NPC_KINDS, RECIPES, RESOURCE_KINDS, SKILLS } from "@termenor/protocol";
import type { ZoneDef } from "./world";
import type { GameplayFact } from "./gameplay-facts";
import { addToInventory, emptyInventory } from "./inventory";

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
function factMatches(when: ObjectiveWhen, fact: GameplayFact): boolean {
  switch (when.kind) {
    case "talkedTo":
      return fact.kind === "playerTalked" && fact.npcType === when.npcType;
    case "gathered":
      return fact.kind === "resourceGathered"
        && fact.resourceType === when.resourceType
        && fact.item === when.item;
    case "produced":
      return fact.kind === "itemProduced"
        && fact.source === when.source
        && fact.operation === when.operation
        && fact.item === when.item;
    case "inventoryAction":
      return fact.kind === "inventoryActionPerformed"
        && fact.action === when.action
        && fact.item === when.item;
    case "gainedSkillXp":
      return fact.kind === "skillXpGained"
        && fact.skill === when.skill
        && fact.amount >= when.atLeast;
    case "enteredZone":
      return fact.kind === "playerEnteredZone" && fact.zone === when.zone;
  }
}

export function advanceScenario(
  def: ScenarioDef,
  progress: ScenarioProgress,
  facts: readonly GameplayFact[],
  playerId: string,
): ScenarioProgress {
  const evidenced = new Set(progress.evidence.map((evidence) => evidence.objectiveId));
  const evidence = [...progress.evidence];

  for (const objective of def.objectives) {
    if (evidenced.has(objective.id)) continue;
    const matchingFact = facts.find(
      (fact) => fact.playerId === playerId && factMatches(objective.when, fact),
    );
    if (!matchingFact) continue;
    evidence.push({ objectiveId: objective.id, tick: matchingFact.tick });
    evidenced.add(objective.id);
  }

  const completed = [...progress.completed];
  for (const objective of def.objectives) {
    if (completed.includes(objective.id)) continue;
    if (!evidenced.has(objective.id)) break;
    completed.push(objective.id);
  }

  const done = completed.length === def.objectives.length;
  if (
    evidence.length === progress.evidence.length
    && completed.length === progress.completed.length
    && done === progress.done
  ) {
    return progress;
  }
  return { ...progress, evidence, completed, done };
}


export function validateScenario(def: ScenarioDef, zones: ZoneDef[]): string[] {
  const errors: string[] = [];
  const byId = new Map(zones.map((zone) => [zone.id, zone]));
  const seen = new Set<string>();
  const start = byId.get(def.startZone);

  let initialInventory = emptyInventory();
  let loadoutOverflow = false;
  for (const [index, stack] of def.initialItems.entries()) {
    const knownItem = ITEM_KINDS[stack.item] !== undefined;
    const validQty = Number.isInteger(stack.qty) && stack.qty >= 1;
    if (!knownItem) errors.push(`scenario ${def.id} initialItems ${index}: unknown Item ${stack.item}`);
    if (!validQty) errors.push(`scenario ${def.id} initialItems ${index}: qty must be a positive integer`);
    if (knownItem && validQty && !loadoutOverflow) {
      const added = addToInventory(initialInventory, stack);
      loadoutOverflow = added.leftover !== null;
      initialInventory = added.slots;
    }
  }
  if (loadoutOverflow) {
    errors.push(`scenario ${def.id}: initialItems exceed Inventory capacity`);
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
        if (objective.when.source === "action" && objective.when.operation !== "light" && objective.when.operation !== "cook") errors.push(`${at}: unknown action ${objective.when.operation}`);
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

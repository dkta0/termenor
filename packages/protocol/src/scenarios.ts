export interface ScenarioState {
  scenarioId: string;
  version: number;
  objectiveId: string | null;
  objectiveText: string | null;
  completed: string[];
  done: boolean;
}

export type ScenarioMsg = { t: "scenario" } & ScenarioState;

import { describe, expect, test } from "bun:test";
import { MODELS, validateAllModels, validateModel, solidFootprint, type BlockModel } from "./models";

describe("MODELS catalog", () => {
  test("every existing sprite type has a model", () => {
    for (const k of ["player", "goblin", "rat", "tree", "rock", "fishing_spot", "fire", "bank_booth", "general_store"])
      expect(MODELS[k]).toBeDefined();
  });

  test("catalog passes validation", () => {
    expect(validateAllModels()).toEqual([]);
  });

  test("validateModel rejects ragged billboard rows", () => {
    const errs = validateModel("bad", { kind: "billboard", palette: { A: [1, 2, 3] }, facings: { south: ["AA", "A"] } });
    expect(errs.length).toBeGreaterThan(0);
  });

  test("validateModel rejects a footprint glyph with no cell", () => {
    const m: BlockModel = { kind: "block", cells: { W: { height: 3, color: [1, 1, 1], solid: true } }, footprint: ["WX"] };
    expect(validateModel("bad", m).length).toBeGreaterThan(0);
  });
});

describe("solidFootprint", () => {
  test("returns solid block cells offset by anchor; skips non-solid and '.'", () => {
    const m: BlockModel = {
      kind: "block",
      cells: { W: { height: 3, color: [1, 1, 1], solid: true }, r: { height: 1, color: [2, 2, 2], solid: false } },
      footprint: ["W.", "rW"],
    };
    expect(solidFootprint(m, 10, 20).sort((a, b) => a.x - b.x || a.y - b.y)).toEqual([
      { x: 10, y: 20 },
      { x: 11, y: 21 },
    ]);
  });

  test("billboard models contribute no collision", () => {
    expect(solidFootprint(MODELS.tree, 5, 5)).toEqual([]);
  });
});

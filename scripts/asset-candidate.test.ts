import { describe, expect, test } from "bun:test";
import { MODELS } from "@termenor/protocol";
import type { BlockModel } from "@termenor/protocol";
import { createCandidateMap, encodePreviewPng, renderCandidate, validateCandidate } from "./asset-candidate";
import type { AssetCandidate } from "./asset-candidate";

const model: BlockModel = {
  kind: "block",
  cells: {
    W: { height: 3, color: [96, 72, 44], solid: true },
    R: { height: 4, color: [52, 78, 92], solid: true },
  },
  footprint: ["WRW", "W.W", "WWW"],
};

const candidate: AssetCandidate = {
  key: "candidate_gatehouse",
  brief: "A compact stone-and-timber gatehouse.",
  model,
};

describe("asset candidate workflow", () => {
  test("rejects promoted catalog keys and malformed models", () => {
    expect(validateCandidate({ ...candidate, key: "small_house" })).toContain(
      "small_house: key already exists in the promoted MODELS catalog",
    );
    expect(validateCandidate({
      ...candidate,
      model: { ...model, footprint: ["WX"] },
    })).toContain("candidate_gatehouse: footprint glyph 'X' has no cell");
  });

  test("stamps the real solid footprint into collision tiles", () => {
    const map = createCandidateMap(candidate);
    expect(map.scenery).toEqual([{ model: candidate.key, x: 7, y: 7, facing: "south" }]);
    expect(map.tiles[7 * map.width + 7]).toBe(1);
    expect(map.tiles[8 * map.width + 8]).toBe(0);
    expect(map.tiles[9 * map.width + 9]).toBe(1);
  });

  test("renders through production rasterization without promoting the model", () => {
    const frame = renderCandidate(candidate);
    expect(frame.buf.rgb.some((channel) => channel !== 0)).toBe(true);
    expect(MODELS[candidate.key]).toBeUndefined();
    const png = encodePreviewPng(frame);
    expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const dimensions = new DataView(png.buffer, png.byteOffset + 16, 8);
    expect([dimensions.getUint32(0), dimensions.getUint32(4)]).toEqual([320, 240]);
  });

  test("passes activation state and time into the production block animation", () => {
    const animated: AssetCandidate = {
      ...candidate,
      model: {
        kind: "block",
        cells: {
          S: {
            height: 0,
            color: [20, 30, 40],
            solid: false,
            activated: { color: [40, 80, 160], pulse: [80, 180, 255], periodMs: 1_200 },
          },
        },
        footprint: ["S"],
      },
    };
    const inactiveStart = renderCandidate(animated, 0, false);
    const inactiveLater = renderCandidate(animated, 600, false);
    const activeStart = renderCandidate(animated, 0, true);
    const activePeak = renderCandidate(animated, 600, true);
    expect(inactiveLater.buf.rgb).toEqual(inactiveStart.buf.rgb);
    expect(activeStart.buf.rgb).not.toEqual(inactiveStart.buf.rgb);
    expect(activePeak.buf.rgb).not.toEqual(activeStart.buf.rgb);
    expect(createCandidateMap(animated, true).scenery?.[0].activated).toBe(true);
  });
});

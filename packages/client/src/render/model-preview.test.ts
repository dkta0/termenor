import { describe, expect, test } from "bun:test";
import { MODELS } from "@termenor/protocol";
import { renderModelToAscii } from "./model-preview";

describe("renderModelToAscii", () => {
  test("billboard renders a glyph block with '.' for transparent", () => {
    const out = renderModelToAscii(MODELS.fence, "south");
    expect(out).toBe("#.#\n###\n#.#");
  });

  test("block renders its footprint with cell glyphs and '.' gaps", () => {
    const out = renderModelToAscii(MODELS.small_house);
    expect(out).toBe("###\n#.#\n#.#");
  });
});

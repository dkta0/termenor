import { test, expect } from "bun:test";
import { textCells, centerCol } from "./overlay";

test("centerCol does not jitter as the anchor drifts sub-pixel (odd or even length)", () => {
  // Regression: the camera-pinned player's screen-x sits at a fixed integer ± a sub-pixel
  // wobble (e.g. ~98.0..98.49). Centering must yield ONE stable column across that wobble,
  // for both odd and even label lengths — `round(x - len/2)` flipped ±1 for odd lengths.
  // The pinned player's screen-x spans [F-0.5, F+0.5) (here F=98) as it drifts sub-pixel.
  for (const len of [3, 4, 5, 6, 7, 8]) {
    const out = new Set<number>();
    for (let i = 0; i <= 50; i++) out.add(centerCol(97.5 + i * 0.0199, len)); // x in [97.5, 98.49]
    expect(out.size).toBe(1);
  }
});

test("centerCol centers a label on its anchor column", () => {
  expect(centerCol(98, 1)).toBe(98);      // single char sits on the anchor
  expect(centerCol(98, 5)).toBe(96);      // 5-wide → starts 2 left, spans 96..100, centered on 98
});

test("places a string starting at (col, row) within bounds", () => {
  const cells = textCells("hi", 2, 1, 10, 5);
  expect(cells).toEqual([
    { col: 2, row: 1, char: "h" },
    { col: 3, row: 1, char: "i" },
  ]);
});

test("clips characters that fall outside grid width", () => {
  const cells = textCells("hello", 8, 0, 10, 5);
  // cols 8 and 9 are in-bounds; col 10+ are clipped
  expect(cells).toHaveLength(2);
  expect(cells[0]).toEqual({ col: 8, row: 0, char: "h" });
  expect(cells[1]).toEqual({ col: 9, row: 0, char: "e" });
});

test("clips entirely when col is >= cols", () => {
  const cells = textCells("hello", 10, 0, 10, 5);
  expect(cells).toHaveLength(0);
});

test("clips entirely when row is out of bounds", () => {
  const cells = textCells("hi", 0, 5, 10, 5);
  expect(cells).toHaveLength(0);
});

test("clips entirely when col is negative", () => {
  const cells = textCells("hi", -5, 0, 10, 5);
  // col -5 and col -4 both < 0 — neither placed
  expect(cells).toHaveLength(0);
});

test("partial clip when string starts before col 0", () => {
  // start at col -1; "ab" → 'a' at -1 (clipped), 'b' at 0 (in-bounds)
  const cells = textCells("ab", -1, 0, 10, 5);
  expect(cells).toEqual([{ col: 0, row: 0, char: "b" }]);
});

test("empty string produces no cells", () => {
  expect(textCells("", 0, 0, 10, 5)).toEqual([]);
});

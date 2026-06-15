import { test, expect } from "bun:test";
import { textCells } from "./overlay";

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

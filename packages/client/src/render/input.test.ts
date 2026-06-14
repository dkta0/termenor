import { test, expect } from "bun:test";
import { arrowDelta } from "./input";

test("maps arrow key names to tile deltas", () => {
  expect(arrowDelta("ArrowUp")).toEqual({ dx: 0, dy: -1 });
  expect(arrowDelta("ArrowDown")).toEqual({ dx: 0, dy: 1 });
  expect(arrowDelta("ArrowLeft")).toEqual({ dx: -1, dy: 0 });
  expect(arrowDelta("ArrowRight")).toEqual({ dx: 1, dy: 0 });
});

test("returns null for non-arrow keys", () => {
  expect(arrowDelta("a")).toBeNull();
  expect(arrowDelta("Enter")).toBeNull();
});

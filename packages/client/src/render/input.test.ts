import { test, expect } from "bun:test";
import { arrowDelta } from "./input";

test("maps OpenTUI directional key names to tile deltas", () => {
  expect(arrowDelta("up")).toEqual({ dx: 0, dy: -1 });
  expect(arrowDelta("down")).toEqual({ dx: 0, dy: 1 });
  expect(arrowDelta("left")).toEqual({ dx: -1, dy: 0 });
  expect(arrowDelta("right")).toEqual({ dx: 1, dy: 0 });
});

test("also accepts Arrow* aliases", () => {
  expect(arrowDelta("ArrowUp")).toEqual({ dx: 0, dy: -1 });
  expect(arrowDelta("ArrowRight")).toEqual({ dx: 1, dy: 0 });
});

test("returns null for non-arrow keys", () => {
  expect(arrowDelta("a")).toBeNull();
  expect(arrowDelta("Enter")).toBeNull();
});

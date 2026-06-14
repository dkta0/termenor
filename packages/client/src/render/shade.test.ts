import { test, expect } from "bun:test";
import { shade } from "./shade";

const base: [number, number, number] = [200, 200, 200];

test("top face is brightest, left darkest, right between", () => {
  const top = shade(base, "top")[0];
  const right = shade(base, "right")[0];
  const left = shade(base, "left")[0];
  expect(top).toBeGreaterThan(right);
  expect(right).toBeGreaterThan(left);
});

test("shade never exceeds the input and stays in 0..255", () => {
  for (const f of ["top", "left", "right"] as const) {
    for (const c of shade([255, 255, 255], f)) {
      expect(c).toBeLessThanOrEqual(255);
      expect(c).toBeGreaterThanOrEqual(0);
    }
  }
});

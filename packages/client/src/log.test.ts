import { test, expect } from "bun:test";
import { LogState } from "./log";

test("starts empty", () => {
  const log = new LogState();
  expect(log.recent(10)).toEqual([]);
});

test("push records entries with a tier, newest last", () => {
  const log = new LogState();
  log.push("ambient", "mining copper");
  log.push("critical", "you are nearly dead");
  expect(log.recent(10)).toEqual([
    { tier: "ambient", text: "mining copper" },
    { tier: "critical", text: "you are nearly dead" },
  ]);
});

test("recent(n) returns the last n entries", () => {
  const log = new LogState();
  for (let i = 0; i < 5; i++) log.push("ambient", `line ${i}`);
  expect(log.recent(2)).toEqual([
    { tier: "ambient", text: "line 3" },
    { tier: "ambient", text: "line 4" },
  ]);
});

test("caps stored entries", () => {
  const log = new LogState();
  for (let i = 0; i < 300; i++) log.push("ambient", `line ${i}`);
  expect(log.recent(1000).length).toBe(200);
});

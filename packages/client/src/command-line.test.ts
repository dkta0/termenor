import { test, expect } from "bun:test";
import { CommandLine } from "./command-line";

test("initially inactive with empty input", () => {
  const c = new CommandLine();
  expect(c.active).toBe(false);
  expect(c.input).toBe("");
});

test("open activates and clears input", () => {
  const c = new CommandLine();
  c.open();
  expect(c.active).toBe(true);
  expect(c.input).toBe("");
});

test("type appends only single printable chars", () => {
  const c = new CommandLine();
  c.open();
  c.type("m");
  c.type("ine"); // multi-char ignored
  c.type("\n");  // control ignored
  expect(c.input).toBe("m");
});

test("submit returns trimmed text, deactivates, and records history", () => {
  const c = new CommandLine();
  c.open();
  "mine copper".split("").forEach((ch) => c.type(ch));
  expect(c.submit()).toBe("mine copper");
  expect(c.active).toBe(false);
});

test("submit returns null for blank input and records no history", () => {
  const c = new CommandLine();
  c.open();
  expect(c.submit()).toBeNull();
  c.open();
  c.historyPrev();
  expect(c.input).toBe("");
});

test("history recall walks previous submissions newest-first", () => {
  const c = new CommandLine();
  for (const cmd of ["bank", "mine copper"]) {
    c.open();
    cmd.split("").forEach((ch) => c.type(ch));
    c.submit();
  }
  c.open();
  c.historyPrev();
  expect(c.input).toBe("mine copper");
  c.historyPrev();
  expect(c.input).toBe("bank");
  c.historyNext();
  expect(c.input).toBe("mine copper");
});

import { test, expect } from "bun:test";
import { ChatState } from "./chat";

test("initially inactive with empty input and no messages", () => {
  const c = new ChatState();
  expect(c.active).toBe(false);
  expect(c.input).toBe("");
  expect(c.recent(10)).toEqual([]);
});

test("open() sets active=true and clears input", () => {
  const c = new ChatState();
  c.open();
  expect(c.active).toBe(true);
  expect(c.input).toBe("");
});

test("cancel() sets active=false and clears input", () => {
  const c = new ChatState();
  c.open();
  c.type("h");
  c.cancel();
  expect(c.active).toBe(false);
  expect(c.input).toBe("");
});

test("type() appends a printable char while active", () => {
  const c = new ChatState();
  c.open();
  c.type("h");
  c.type("i");
  expect(c.input).toBe("hi");
});

test("type() ignores multi-char strings", () => {
  const c = new ChatState();
  c.open();
  c.type("hello"); // multi-char — ignored
  expect(c.input).toBe("");
});

test("type() ignores control characters (char code < 32)", () => {
  const c = new ChatState();
  c.open();
  c.type("\x00");
  c.type("\t");
  c.type("\n");
  expect(c.input).toBe("");
});

test("type() ignores DEL (char code 127)", () => {
  const c = new ChatState();
  c.open();
  c.type("\x7f");
  expect(c.input).toBe("");
});

test("backspace() removes last char while active", () => {
  const c = new ChatState();
  c.open();
  c.type("h");
  c.type("i");
  c.backspace();
  expect(c.input).toBe("h");
});

test("backspace() on empty input is a no-op", () => {
  const c = new ChatState();
  c.open();
  c.backspace();
  expect(c.input).toBe("");
});

test("submit() returns trimmed text, clears input, sets active=false", () => {
  const c = new ChatState();
  c.open();
  "hello".split("").forEach((ch) => c.type(ch));
  const result = c.submit();
  expect(result).toBe("hello");
  expect(c.active).toBe(false);
  expect(c.input).toBe("");
});

test("submit() returns null for empty/whitespace-only input", () => {
  const c = new ChatState();
  c.open();
  expect(c.submit()).toBeNull();
});

test("receive() stores messages accessible via recent()", () => {
  const c = new ChatState();
  c.receive("alice", "hi");
  c.receive("bob", "hey");
  expect(c.recent(10)).toEqual([
    { from: "alice", text: "hi" },
    { from: "bob", text: "hey" },
  ]);
});

test("recent(n) returns last n messages", () => {
  const c = new ChatState();
  for (let i = 0; i < 10; i++) c.receive("x", String(i));
  const last3 = c.recent(3);
  expect(last3).toEqual([{ from: "x", text: "7" }, { from: "x", text: "8" }, { from: "x", text: "9" }]);
});

test("receive() caps buffer at 50 messages", () => {
  const c = new ChatState();
  for (let i = 0; i < 60; i++) c.receive("x", String(i));
  expect(c.recent(100).length).toBe(50);
  // oldest retained is message index 10 ("10")
  expect(c.recent(100)[0].text).toBe("10");
});

test("type/backspace/submit are no-ops when not active", () => {
  const c = new ChatState();
  c.type("x"); // not active — ignored
  expect(c.input).toBe("");
  c.backspace(); // no-op
  expect(c.submit()).toBeNull(); // inactive submit returns null
});

import { test, expect } from "bun:test";
import { sanitizeChat } from "./server";

test("sanitizeChat trims surrounding whitespace", () => {
  expect(sanitizeChat("  hello  ")).toBe("hello");
});

test("sanitizeChat truncates to MAX_CHAT_LEN characters", () => {
  const long = "a".repeat(300);
  expect(sanitizeChat(long).length).toBe(200);
});

test("sanitizeChat returns empty string for whitespace-only input", () => {
  expect(sanitizeChat("   ")).toBe("");
  expect(sanitizeChat("")).toBe("");
});

test("sanitizeChat leaves short clean text unchanged", () => {
  expect(sanitizeChat("hi there")).toBe("hi there");
});

test("sanitizeChat truncates after trimming (trim first, then slice)", () => {
  // 198 a's + 2 spaces on each side → trim → 198 chars → under limit
  const padded = "  " + "a".repeat(198) + "  ";
  expect(sanitizeChat(padded)).toBe("a".repeat(198));
});

import { test, expect } from "bun:test";
import { FIRST_RUN_HINT, FIRST_RUN_HINT_MS, HELP_TITLE, HELP_LINES } from "./help";

test("first-run hint points at movement, the panel, and help", () => {
  expect(FIRST_RUN_HINT.toLowerCase()).toContain("click");
  expect(FIRST_RUN_HINT.toLowerCase()).toContain("inventory");
  expect(FIRST_RUN_HINT).toContain("?");
  expect(FIRST_RUN_HINT_MS).toBeGreaterThan(0);
});

test("help overlay covers the core interactions", () => {
  expect(HELP_TITLE).toContain("?");
  const body = HELP_LINES.join("\n").toLowerCase();
  for (const concept of ["move", "click", "panel", "command", "gear", "make", "examine"]) {
    expect(body).toContain(concept);
  }
});

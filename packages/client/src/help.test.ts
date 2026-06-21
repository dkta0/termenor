import { test, expect } from "bun:test";
import { helpOverlayContent, helpPanelLines, resolveHelp } from "./help";
import { COMMANDS } from "./resolve";

test("overlay content lists every command verb", () => {
  const text = helpOverlayContent().flatMap((s) => s.lines).join("\n");
  for (const spec of COMMANDS) expect(text).toContain(spec.verbs[0]);
});

test("overlay content includes the core non-command controls", () => {
  const text = helpOverlayContent().flatMap((s) => [s.title, ...s.lines]).join("\n");
  expect(text).toContain("arrows / click");
  expect(text).toContain("g — pick up");
  expect(text).toContain("a — attack");
  expect(text).toContain("c — gather");
  expect(text).toContain("? — toggle this help");
  expect(text).toContain("Esc — close");
});

test("panel lines start with a closable header and include a command line", () => {
  const lines = helpPanelLines();
  expect(lines[0]).toContain("Esc");
  expect(lines.some((l) => l.includes("attack"))).toBe(true);
});

test("bare /help opens the overlay", () => {
  expect(resolveHelp("help")).toEqual({ kind: "open" });
});

test("/help <verb> returns that verb's help lines", () => {
  const action = resolveHelp("help drop");
  expect(action.kind).toBe("verb");
  if (action.kind === "verb") expect(action.lines.join(" ")).toContain("drop");
});

test("/help <unknown> reports unknown with a did-you-mean suggestion", () => {
  const action = resolveHelp("help atack");
  expect(action.kind).toBe("unknown");
  if (action.kind === "unknown") {
    expect(action.verb).toBe("atack");
    expect(action.suggestion).toBe("attack");
  }
});

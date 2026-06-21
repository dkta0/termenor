import { COMMANDS, suggestVerb } from "./resolve";

export interface HelpSection {
  title: string;
  lines: string[];
}

/** Non-command controls, kept here so the help sheet is the single source of truth. */
const CONTROLS: HelpSection = {
  title: "Moving & acting",
  lines: [
    "arrows / click — move",
    "g — pick up the item underfoot",
    "a — attack the nearest enemy",
    "c — gather the nearest resource",
    "Enter — chat   ·   / — command   ·   ? — toggle this help",
  ],
};

const PANEL_KEYS: HelpSection = {
  title: "While a panel is open",
  lines: [
    "1-9 — choose item / slot",
    "[ ] — previous / next page",
    "d / w — deposit / withdraw (bank)",
    "b / s — buy / sell (shop)",
    "q / u — equip / unequip (gear)",
    "Esc — close the panel",
  ],
};

/** The full control + command reference, grouped into ordered sections. */
export function helpOverlayContent(): HelpSection[] {
  return [
    CONTROLS,
    { title: "Commands ( / then a verb )", lines: COMMANDS.map((c) => c.help) },
    PANEL_KEYS,
  ];
}

/** Flatten the sections into display lines: a header, then each section's title
 *  and its (indented) lines, with a blank line between sections. */
export function helpPanelLines(): string[] {
  const out: string[] = ["[ Help — Esc or ? to close ]"];
  for (const section of helpOverlayContent()) {
    out.push("");
    out.push(section.title);
    for (const line of section.lines) out.push("  " + line);
  }
  return out;
}

/** Help lines for a single verb (canonical help + aliases), or null if unknown. */
function helpForVerb(verb: string): string[] | null {
  const v = verb.toLowerCase();
  const spec = COMMANDS.find((s) => s.verbs.includes(v));
  if (!spec) return null;
  const lines = [spec.help];
  if (spec.verbs.length > 1) lines.push(`aliases: ${spec.verbs.join(", ")}`);
  return lines;
}

export type HelpAction =
  | { kind: "open" }
  | { kind: "verb"; lines: string[] }
  | { kind: "unknown"; verb: string; suggestion: string | null };

/** Decide what a `/help [verb]` command should do. `command` is the full text
 *  after the slash, e.g. "help" or "help drop". Pure — the renderer applies it. */
export function resolveHelp(command: string): HelpAction {
  const rest = command.trim().split(/\s+/).slice(1); // drop the leading "help" verb
  if (rest.length === 0) return { kind: "open" };
  const verb = rest[0];
  const lines = helpForVerb(verb);
  if (lines) return { kind: "verb", lines };
  return { kind: "unknown", verb, suggestion: suggestVerb(verb) };
}

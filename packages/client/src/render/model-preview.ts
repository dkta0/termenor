import { type Model, type Facing } from "@termenor/protocol";

/** Text dump of a model so an agent can SEE what it authored without a screen.
 *  '#' = a drawn pixel/cell, '.' = transparent/empty. Newline-separated rows. */
export function renderModelToAscii(m: Model, facing: Facing = "south"): string {
  const rows = m.kind === "billboard" ? (m.facings[facing] ?? m.facings.south) : m.footprint;
  return rows
    .map((row) => Array.from(row).map((g) => (g === "." ? "." : "#")).join(""))
    .join("\n");
}

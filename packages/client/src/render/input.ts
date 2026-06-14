export interface Delta { dx: number; dy: number; }

// OpenTUI emits lowercase directional names ("up"/"down"/"left"/"right");
// Arrow* aliases are kept for resilience across terminals/key protocols.
const DELTAS: Record<string, Delta> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
};

/** Tile delta for an arrow-key name, or null if not an arrow. */
export function arrowDelta(name: string): Delta | null {
  return DELTAS[name] ?? null;
}

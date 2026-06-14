export interface Delta { dx: number; dy: number; }

const DELTAS: Record<string, Delta> = {
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
};

/** Tile delta for an arrow-key name, or null if not an arrow. */
export function arrowDelta(name: string): Delta | null {
  return DELTAS[name] ?? null;
}

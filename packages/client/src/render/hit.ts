// Pure click hit-testing. Two concerns:
//  - pickEntity: which world entity (if any) a viewport-pixel click landed on.
//  - regionAt: which UI region (tab / slot / action) a cell click landed on.
// Both are pure so the click router in the renderer can be unit-tested.

export type EntityKind = "npc" | "resource" | "ground" | "player";

export interface HitEntity {
  id: string;
  kind: EntityKind;
  /** Viewport pixel coords of the entity's billboard center (post-camera). */
  vx: number;
  vy: number;
}

/**
 * Nearest entity whose billboard center is within `radius` pixels of the click
 * (px, py), by Euclidean distance. Null when none qualify — the caller then
 * treats the click as plain movement.
 */
export function pickEntity(
  px: number,
  py: number,
  entities: HitEntity[],
  radius: number,
): HitEntity | null {
  let best: HitEntity | null = null;
  let bestD = radius * radius;
  for (const e of entities) {
    const dx = e.vx - px;
    const dy = e.vy - py;
    const d = dx * dx + dy * dy;
    if (d <= bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

/** A clickable UI region on a single cell row, spanning columns [col0, col1]. */
export interface Region<T> {
  row: number;
  col0: number;
  col1: number;
  value: T;
}

/** Value of the first region containing cell (cx, cy), or null. */
export function regionAt<T>(cx: number, cy: number, regions: Region<T>[]): T | null {
  for (const r of regions) {
    if (cy === r.row && cx >= r.col0 && cx <= r.col1) return r.value;
  }
  return null;
}

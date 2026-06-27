import type { SnapshotMsg, DeltaMsg, EntityDelta } from "@termenor/protocol";

/**
 * Shallow field equality for flat entity records (all values are primitives).
 * `a` and `b` are the same entity type, so checking `a`'s keys is sufficient.
 */
function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  for (const k in a) if (a[k] !== b[k]) return false;
  return true;
}

/**
 * Diff one entity category by id: present-only-in-cur → spawn, present-in-both but
 * changed → update (full record), present-only-in-prev → despawn (id).
 */
function diffEntities<S extends { id: string | number }>(prev: S[], cur: S[]): EntityDelta<S> {
  const prevMap = new Map<S["id"], S>(prev.map((e) => [e.id, e] as [S["id"], S]));
  const curIds = new Set<S["id"]>();
  const spawns: S[] = [];
  const updates: S[] = [];
  for (const e of cur) {
    curIds.add(e.id);
    const p = prevMap.get(e.id);
    if (!p) spawns.push(e);
    else if (!shallowEqual(p as Record<string, unknown>, e as Record<string, unknown>)) updates.push(e);
  }
  const despawns: S["id"][] = [];
  for (const e of prev) if (!curIds.has(e.id)) despawns.push(e.id);
  return { spawns, updates, despawns };
}

/**
 * Build the incremental update sent to a client whose last-known world was `prev`
 * (null = the client has nothing yet, so everything is a spawn — used for a fresh
 * join's baseline). Transient `hits` are passed through from the current snapshot.
 */
export function diffSnapshot(prev: SnapshotMsg | null, cur: SnapshotMsg): DeltaMsg {
  const base: Pick<SnapshotMsg, "players" | "npcs" | "ground" | "resources"> =
    prev ?? { players: [], npcs: [], ground: [], resources: [] };
  return {
    t: "delta",
    tick: cur.tick,
    players: diffEntities(base.players, cur.players),
    npcs: diffEntities(base.npcs, cur.npcs),
    ground: diffEntities(base.ground, cur.ground),
    resources: diffEntities(base.resources, cur.resources),
    hits: cur.hits,
  };
}

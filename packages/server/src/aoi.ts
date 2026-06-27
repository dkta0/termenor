import type { SnapshotMsg, PlayerState, NpcState, GroundItem, ResourceState } from "@termenor/protocol";

/** Tiles per spatial cell. Bucketing entities into cells keeps an AOI query O(cells in
 * range + entities in those cells) instead of scanning the whole world per player. */
const CELL = 8;

type Pos = { x: number; y: number };

/**
 * A uniform spatial hash over one entity category, rebuilt each tick. Cell key is a
 * row-major index (`cellY * cols + cellX`); entity coords are always >= 0, so keys are
 * non-negative and query cell ranges clamp to 0.
 */
class Grid<T extends Pos> {
  private cells = new Map<number, T[]>();

  constructor(items: T[], private readonly cols: number) {
    for (const it of items) {
      const k = Math.floor(it.y / CELL) * this.cols + Math.floor(it.x / CELL);
      const bucket = this.cells.get(k);
      if (bucket) bucket.push(it);
      else this.cells.set(k, [it]);
    }
  }

  /** Entities within Chebyshev `r` tiles of (cx, cy). */
  within(cx: number, cy: number, r: number): T[] {
    const out: T[] = [];
    const gx0 = Math.max(0, Math.floor((cx - r) / CELL));
    const gx1 = Math.floor((cx + r) / CELL);
    const gy0 = Math.max(0, Math.floor((cy - r) / CELL));
    const gy1 = Math.floor((cy + r) / CELL);
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const bucket = this.cells.get(gy * this.cols + gx);
        if (!bucket) continue;
        for (const it of bucket) {
          if (Math.abs(it.x - cx) <= r && Math.abs(it.y - cy) <= r) out.push(it);
        }
      }
    }
    return out;
  }
}

/**
 * Spatial index over a full-world snapshot. Built once per tick; `view()` is called once
 * per connected player to produce that player's Area-of-Interest slice of the world,
 * which then feeds the same delta diff as a full snapshot did.
 */
export class WorldIndex {
  private readonly players: Grid<PlayerState>;
  private readonly npcs: Grid<NpcState>;
  private readonly ground: Grid<GroundItem>;
  private readonly resources: Grid<ResourceState>;

  constructor(private readonly cur: SnapshotMsg, mapWidth: number) {
    const cols = Math.ceil(mapWidth / CELL) + 1;
    this.players = new Grid(cur.players, cols);
    this.npcs = new Grid(cur.npcs, cols);
    this.ground = new Grid(cur.ground, cols);
    this.resources = new Grid(cur.resources, cols);
  }

  /**
   * The world as seen from (cx, cy) within Chebyshev `radius` tiles. `hits` are kept only
   * for targets that are themselves in view (no splats for entities you can't see).
   */
  view(cx: number, cy: number, radius: number): SnapshotMsg {
    const players = this.players.within(cx, cy, radius);
    const npcs = this.npcs.within(cx, cy, radius);
    const visible = new Set<string>();
    for (const p of players) visible.add(p.id);
    for (const n of npcs) visible.add(n.id);
    return {
      t: "snapshot",
      tick: this.cur.tick,
      players,
      npcs,
      ground: this.ground.within(cx, cy, radius),
      resources: this.resources.within(cx, cy, radius),
      hits: this.cur.hits.filter((h) => visible.has(h.targetId)),
    };
  }
}

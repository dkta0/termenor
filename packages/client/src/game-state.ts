import type { Facing, MapData, PlayerState, SnapshotMsg, GroundItem, ItemStack } from "@termenor/protocol";

/**
 * How far behind real time we render. ~1.5 server ticks at 15 Hz (~66.7 ms/tick),
 * so the render target almost always falls *between* two buffered snapshots even
 * with network jitter — giving continuous interpolation instead of clamping.
 */
export const INTERP_DELAY_MS = 100;

/** Snapshots retained for bracketing. ~0.8 s of history at 15 Hz. */
const MAX_FRAMES = 12;

export interface RenderPlayer { id: string; x: number; y: number; facing: Facing; h: number; }

interface Frame { time: number; players: Map<string, PlayerState>; }

export class GameState {
  map: MapData | null = null;
  localId: string | null = null;
  ground: GroundItem[] = [];
  inventory: (ItemStack | null)[] = [];
  private frames: Frame[] = []; // chronological, oldest → newest

  setMap(map: MapData): void { this.map = map; }
  setLocalId(id: string): void { this.localId = id; }
  setInventory(slots: (ItemStack | null)[]): void { this.inventory = slots; }

  applySnapshot(snap: SnapshotMsg, now: number): void {
    const players = new Map(snap.players.map((p) => [p.id, p]));
    this.frames.push({ time: now, players });
    if (this.frames.length > MAX_FRAMES) this.frames.shift();
    this.ground = snap.ground;
  }

  /**
   * Interpolated positions at the given render time (ms). Interpolates between
   * the two buffered snapshots that bracket `renderTime - INTERP_DELAY_MS`;
   * clamps to the oldest/newest buffered frame outside that range.
   * Elevation (`h`) is bilinearly sampled from the current map heightmap.
   */
  samplePositions(renderTime: number): RenderPlayer[] {
    return this.attachElevation(this.sampleRaw(renderTime));
  }

  private sampleRaw(renderTime: number): Array<{ id: string; x: number; y: number; facing: Facing }> {
    if (this.frames.length === 0) return [];
    if (this.frames.length === 1) return frameToPlayers(this.frames[0]);

    const target = renderTime - INTERP_DELAY_MS;
    const first = this.frames[0];
    const last = this.frames[this.frames.length - 1];
    if (target <= first.time) return frameToPlayers(first);
    if (target >= last.time) return frameToPlayers(last);

    // find the bracketing pair [a, b] with a.time <= target <= b.time
    let a = first;
    let b = last;
    for (let i = 0; i < this.frames.length - 1; i++) {
      if (this.frames[i].time <= target && target <= this.frames[i + 1].time) {
        a = this.frames[i];
        b = this.frames[i + 1];
        break;
      }
    }

    const span = b.time - a.time;
    const t = span > 0 ? (target - a.time) / span : 0;
    const out: Array<{ id: string; x: number; y: number; facing: Facing }> = [];
    for (const [id, pb] of b.players) {
      const pa = a.players.get(id);
      if (!pa) { out.push({ id, x: pb.x, y: pb.y, facing: pb.facing }); continue; }
      out.push({
        id,
        x: pa.x + (pb.x - pa.x) * t,
        y: pa.y + (pb.y - pa.y) * t,
        facing: pb.facing,
      });
    }
    return out;
  }

  private attachElevation(
    raw: Array<{ id: string; x: number; y: number; facing: Facing }>,
  ): RenderPlayer[] {
    const map = this.map;
    return raw.map((p) => ({ ...p, h: map ? sampleElevation(map, p.x, p.y) : 0 }));
  }
}

function frameToPlayers(f: Frame): Array<{ id: string; x: number; y: number; facing: Facing }> {
  return [...f.players.values()].map((p) => ({ id: p.id, x: p.x, y: p.y, facing: p.facing }));
}

/** Bilinear sample of the heightmap at continuous tile coords (smooth z-interp). */
export function sampleElevation(map: MapData, x: number, y: number): number {
  const at = (tx: number, ty: number) =>
    tx < 0 || ty < 0 || tx >= map.width || ty >= map.height ? 0 : (map.heights[ty * map.width + tx] ?? 0);
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
  const bot = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
  return top * (1 - fy) + bot * fy;
}

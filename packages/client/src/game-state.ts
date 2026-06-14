import type { Facing, MapData, PlayerState, SnapshotMsg } from "@termenor/protocol";

/**
 * How far behind real time we render. ~1.5 server ticks at 15 Hz (~66.7 ms/tick),
 * so the render target almost always falls *between* two buffered snapshots even
 * with network jitter — giving continuous interpolation instead of clamping.
 */
export const INTERP_DELAY_MS = 100;

/** Snapshots retained for bracketing. ~0.8 s of history at 15 Hz. */
const MAX_FRAMES = 12;

export interface RenderPlayer { id: string; x: number; y: number; facing: Facing; }

interface Frame { time: number; players: Map<string, PlayerState>; }

export class GameState {
  map: MapData | null = null;
  localId: string | null = null;
  private frames: Frame[] = []; // chronological, oldest → newest

  setMap(map: MapData): void { this.map = map; }
  setLocalId(id: string): void { this.localId = id; }

  applySnapshot(snap: SnapshotMsg, now: number): void {
    const players = new Map(snap.players.map((p) => [p.id, p]));
    this.frames.push({ time: now, players });
    if (this.frames.length > MAX_FRAMES) this.frames.shift();
  }

  /**
   * Interpolated positions at the given render time (ms). Interpolates between
   * the two buffered snapshots that bracket `renderTime - INTERP_DELAY_MS`;
   * clamps to the oldest/newest buffered frame outside that range.
   */
  samplePositions(renderTime: number): RenderPlayer[] {
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
    const out: RenderPlayer[] = [];
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
}

function frameToPlayers(f: Frame): RenderPlayer[] {
  return [...f.players.values()].map((p) => ({ id: p.id, x: p.x, y: p.y, facing: p.facing }));
}

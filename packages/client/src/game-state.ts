import type { Facing, MapData, PlayerState, SnapshotMsg } from "@termenor/protocol";

/** How far behind real time we render, to always have two snapshots to lerp. */
export const INTERP_DELAY_MS = 100;

export interface RenderPlayer { id: string; x: number; y: number; facing: Facing; }

interface Frame { time: number; players: Map<string, PlayerState>; }

export class GameState {
  map: MapData | null = null;
  localId: string | null = null;
  private frames: Frame[] = []; // chronological; keep last 2

  setMap(map: MapData): void { this.map = map; }
  setLocalId(id: string): void { this.localId = id; }

  applySnapshot(snap: SnapshotMsg, now: number): void {
    const players = new Map(snap.players.map((p) => [p.id, p]));
    this.frames.push({ time: now, players });
    if (this.frames.length > 2) this.frames.shift();
  }

  /** Interpolated positions at the given render time (ms). */
  samplePositions(renderTime: number): RenderPlayer[] {
    if (this.frames.length === 0) return [];
    if (this.frames.length === 1) return frameToPlayers(this.frames[0]);

    const [a, b] = this.frames;
    const target = renderTime - INTERP_DELAY_MS;
    if (target <= a.time) return frameToPlayers(a);
    if (target >= b.time) return frameToPlayers(b);

    const t = (target - a.time) / (b.time - a.time);
    const out: RenderPlayer[] = [];
    for (const [id, pb] of b.players) {
      const pa = a.players.get(id);
      if (!pa) { out.push({ ...pb }); continue; }
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

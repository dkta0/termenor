import type { Facing, MapData, PlayerState, SnapshotMsg, GroundItem, ItemStack, NpcState, ResourceState, ShopEntry } from "@termenor/protocol";
import { SPLAT_MS, SKILLS, type HitEvent } from "@termenor/protocol";

/**
 * How far behind real time we render. ~1.5 server ticks at 15 Hz (~66.7 ms/tick),
 * so the render target almost always falls *between* two buffered snapshots even
 * with network jitter — giving continuous interpolation instead of clamping.
 */
export const INTERP_DELAY_MS = 100;

/** Snapshots retained for bracketing. ~0.8 s of history at 15 Hz. */
const MAX_FRAMES = 12;

export interface RenderPlayer { id: string; x: number; y: number; facing: Facing; h: number; hp: number; maxHp: number; }
export interface NpcRender { id: string; type: string; x: number; y: number; facing: Facing; h: number; hp: number; maxHp: number; }

/** A fading damage number shown over an entity. */
export interface Splat { targetId: string; amount: number; expires: number; }

interface Frame { time: number; players: Map<string, PlayerState>; npcs: Map<string, NpcState>; }

export class GameState {
  map: MapData | null = null;
  localId: string | null = null;
  ground: GroundItem[] = [];
  inventory: (ItemStack | null)[] = [];
  resources: ResourceState[] = [];
  skills: Record<string, { xp: number; level: number }> = {};
  bank: ItemStack[] = [];
  bankOpen = false;
  shop: { shopId: string; name: string; entries: ShopEntry[] } | null = null;
  shopOpen = false;
  private frames: Frame[] = []; // chronological, oldest → newest
  private splats: Splat[] = [];

  setMap(map: MapData): void { this.map = map; }
  setLocalId(id: string): void { this.localId = id; }
  setInventory(slots: (ItemStack | null)[]): void { this.inventory = slots; }
  setSkills(s: Record<string, { xp: number; level: number }>): void { this.skills = s; }
  setBank(items: ItemStack[], open: boolean): void { this.bank = items; this.bankOpen = open; }
  closeBank(): void { this.bankOpen = false; }
  setShop(shopId: string, name: string, entries: ShopEntry[], open: boolean): void {
    this.shop = { shopId, name, entries };
    this.shopOpen = open;
  }
  closeShop(): void { this.shopOpen = false; }

  /** Id of the nearest visible resource of `type` to the local player, or null. */
  nearestResourceOfType(type: string, now: number): string | null {
    if (this.localId === null) return null;
    const me = this.samplePositions(now).find((p) => p.id === this.localId);
    if (!me) return null;
    let bestId: string | null = null;
    let bestD = Infinity;
    for (const r of this.sampleResources()) {
      if (r.type !== type) continue;
      const d = Math.hypot(r.x - me.x, r.y - me.y);
      if (d < bestD) { bestD = d; bestId = r.id; }
    }
    return bestId;
  }

  applySnapshot(snap: SnapshotMsg, now: number): void {
    const players = new Map(snap.players.map((p) => [p.id, p]));
    const npcs = new Map(snap.npcs.map((n) => [n.id, n]));
    this.frames.push({ time: now, players, npcs });
    if (this.frames.length > MAX_FRAMES) this.frames.shift();
    this.ground = snap.ground;
    this.resources = snap.resources;
    for (const h of snap.hits) this.splats.push({ targetId: h.targetId, amount: h.amount, expires: now + SPLAT_MS });
  }

  /** Return resources with elevation attached (same pattern as sampleNpcs). */
  sampleResources(): (ResourceState & { h: number })[] {
    const map = this.map;
    return this.resources.map((r) => ({ ...r, h: map ? sampleElevation(map, r.x, r.y) : 0 }));
  }

  /** Skills HUD line for the woodcutting skill (kept for back-compat). */
  skillsLine(): string {
    return `Woodcutting: ${this.skills.woodcutting?.level ?? 1} (${this.skills.woodcutting?.xp ?? 0} xp)`;
  }

  /** One line per skill in SKILLS order, e.g. "Mining: 1 (50 xp)". */
  skillsLines(): string[] {
    return SKILLS.map((name) => {
      const capitalized = name.charAt(0).toUpperCase() + name.slice(1);
      const entry = this.skills[name];
      const level = entry?.level ?? 1;
      const xp = entry?.xp ?? 0;
      return `${capitalized}: ${level} (${xp} xp)`;
    });
  }

  /** Index of the first inventory slot whose item matches `item`, or -1. */
  firstSlotOf(item: string): number {
    for (let i = 0; i < this.inventory.length; i++) {
      if (this.inventory[i]?.item === item) return i;
    }
    return -1;
  }

  /** Return all splats that haven't expired yet, pruning stale ones in place. */
  activeSplats(now: number): Splat[] {
    this.splats = this.splats.filter((s) => s.expires > now);
    return this.splats;
  }

  /** hp of the entity with the given id from the NEWEST frame; null if not found. */
  hpOf(id: string): number | null {
    const frame = this.frames[this.frames.length - 1];
    if (!frame) return null;
    const p = frame.players.get(id);
    if (p) return p.hp;
    const n = frame.npcs.get(id);
    return n ? n.hp : null;
  }

  /**
   * Interpolated positions at the given render time (ms). Interpolates between
   * the two buffered snapshots that bracket `renderTime - INTERP_DELAY_MS`;
   * clamps to the oldest/newest buffered frame outside that range.
   * Elevation (`h`) is bilinearly sampled from the current map heightmap.
   * hp/maxHp come from the NEWEST frame (not interpolated).
   */
  samplePositions(renderTime: number): RenderPlayer[] {
    return this.attachElevation(this.sampleRaw(renderTime));
  }

  sampleNpcs(renderTime: number): NpcRender[] {
    const map = this.map;
    const newest = this.frames[this.frames.length - 1];
    return this.sampleNpcsRaw(renderTime).map((n) => {
      const { hp, maxHp } = newestNpcHp(newest, n.id);
      return { ...n, h: map ? sampleElevation(map, n.x, n.y) : 0, hp, maxHp };
    });
  }

  /** Find the bracketing frame pair for renderTime - INTERP_DELAY_MS. */
  private bracket(renderTime: number): { a: Frame; b: Frame; t: number } | { single: Frame } {
    if (this.frames.length === 1) return { single: this.frames[0] };
    const target = renderTime - INTERP_DELAY_MS;
    const first = this.frames[0];
    const last = this.frames[this.frames.length - 1];
    if (target <= first.time) return { single: first };
    if (target >= last.time) return { single: last };
    let a = first;
    let b = last;
    for (let i = 0; i < this.frames.length - 1; i++) {
      if (this.frames[i].time <= target && target <= this.frames[i + 1].time) {
        a = this.frames[i]; b = this.frames[i + 1]; break;
      }
    }
    const span = b.time - a.time;
    const t = span > 0 ? (target - a.time) / span : 0;
    return { a, b, t };
  }

  private sampleRaw(renderTime: number): Array<{ id: string; x: number; y: number; facing: Facing; hp: number; maxHp: number }> {
    if (this.frames.length === 0) return [];
    const br = this.bracket(renderTime);
    const newest = this.frames[this.frames.length - 1];
    if ("single" in br) return frameToPlayers(br.single, newest);
    const { a, b, t } = br;
    const out: Array<{ id: string; x: number; y: number; facing: Facing; hp: number; maxHp: number }> = [];
    for (const [id, pb] of b.players) {
      const pa = a.players.get(id);
      const { hp, maxHp } = newestPlayerHp(newest, id);
      if (!pa) { out.push({ id, x: pb.x, y: pb.y, facing: pb.facing, hp, maxHp }); continue; }
      out.push({
        id,
        x: pa.x + (pb.x - pa.x) * t,
        y: pa.y + (pb.y - pa.y) * t,
        facing: pb.facing,
        hp,
        maxHp,
      });
    }
    return out;
  }

  private sampleNpcsRaw(renderTime: number): Array<{ id: string; type: string; x: number; y: number; facing: Facing }> {
    if (this.frames.length === 0) return [];
    const br = this.bracket(renderTime);
    if ("single" in br) return frameToNpcs(br.single);
    const { a, b, t } = br;
    const out: Array<{ id: string; type: string; x: number; y: number; facing: Facing }> = [];
    for (const [id, nb] of b.npcs) {
      const na = a.npcs.get(id);
      if (!na) { out.push({ id, type: nb.type, x: nb.x, y: nb.y, facing: nb.facing }); continue; }
      out.push({ id, type: nb.type, x: na.x + (nb.x - na.x) * t, y: na.y + (nb.y - na.y) * t, facing: nb.facing });
    }
    return out;
  }

  private attachElevation(
    raw: Array<{ id: string; x: number; y: number; facing: Facing; hp: number; maxHp: number }>,
  ): RenderPlayer[] {
    const map = this.map;
    return raw.map((p) => ({ ...p, h: map ? sampleElevation(map, p.x, p.y) : 0 }));
  }
}

/** Read hp/maxHp for a player id from the newest frame; default to 0/0 if missing. */
function newestPlayerHp(newest: Frame | undefined, id: string): { hp: number; maxHp: number } {
  if (!newest) return { hp: 0, maxHp: 0 };
  const p = newest.players.get(id);
  return p ? { hp: p.hp, maxHp: p.maxHp } : { hp: 0, maxHp: 0 };
}

/** Read hp/maxHp for an npc id from the newest frame; default to 0/0 if missing. */
function newestNpcHp(newest: Frame | undefined, id: string): { hp: number; maxHp: number } {
  if (!newest) return { hp: 0, maxHp: 0 };
  const n = newest.npcs.get(id);
  return n ? { hp: n.hp, maxHp: n.maxHp } : { hp: 0, maxHp: 0 };
}

function frameToPlayers(f: Frame, newest: Frame): Array<{ id: string; x: number; y: number; facing: Facing; hp: number; maxHp: number }> {
  return [...f.players.values()].map((p) => {
    const { hp, maxHp } = newestPlayerHp(newest, p.id);
    return { id: p.id, x: p.x, y: p.y, facing: p.facing, hp, maxHp };
  });
}

function frameToNpcs(f: Frame): Array<{ id: string; type: string; x: number; y: number; facing: Facing }> {
  return [...f.npcs.values()].map((n) => ({ id: n.id, type: n.type, x: n.x, y: n.y, facing: n.facing }));
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

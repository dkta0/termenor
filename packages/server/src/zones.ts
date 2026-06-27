import type { Facing, MapData } from "@termenor/protocol";
import { GameWorld, type RestoredState } from "./game";
import { ZONE_DEFS, DEFAULT_ZONE, type ZoneDef, type Portal } from "./world";

/** A player who crossed into a new zone this tick — used to push a ZoneMsg + reset their view. */
export interface ZoneTransition { id: string; zone: string; x: number; y: number; facing: Facing; }

/**
 * The multi-zone world. Each zone is an independent `GameWorld` (its own map, entities, and
 * tick); a player lives in exactly one zone at a time and sees/interacts only within it.
 * Stepping onto a portal tile moves the player — carrying full state — into the target zone.
 * This is the natural sharding seam: a zone could later run in its own process untouched.
 */
export class Zones {
  private readonly worlds = new Map<string, GameWorld>();
  private readonly defs = new Map<string, ZoneDef>();
  private readonly location = new Map<string, string>(); // playerId -> zoneId
  private pending: ZoneTransition[] = [];

  constructor(defs: ZoneDef[] = ZONE_DEFS) {
    for (const def of defs) {
      this.defs.set(def.id, def);
      const w = new GameWorld(def.map, def.spawn);
      for (const s of def.seedItems) w.addGroundItem(s.item, s.qty, s.x, s.y);
      for (const n of def.npcs) w.spawnNpc(n.type, n.x, n.y, n.radius);
      for (const r of def.resources) w.spawnResource(r.type, r.x, r.y);
      this.worlds.set(def.id, w);
    }
  }

  private resolve(zone: string | undefined): string {
    return zone && this.worlds.has(zone) ? zone : DEFAULT_ZONE;
  }

  world(zone: string): GameWorld {
    const w = this.worlds.get(zone);
    if (!w) throw new Error(`unknown zone: ${zone}`);
    return w;
  }
  worldOf(playerId: string): GameWorld { return this.world(this.zoneOf(playerId)); }
  zoneOf(playerId: string): string { return this.location.get(playerId) ?? DEFAULT_ZONE; }
  zoneIds(): string[] { return [...this.worlds.keys()]; }
  mapOf(zone: string): MapData { return this.world(zone).map; }
  addPlayer(id: string, state?: RestoredState): void {
    const zone = this.resolve(state?.zone);
    this.location.set(id, zone);
    this.world(zone).addPlayer(id, state);
  }

  removePlayer(id: string): void {
    const z = this.location.get(id);
    if (z) this.world(z).removePlayer(id);
    this.location.delete(id);
  }

  /** Full restorable state including current zone, for persistence. */
  stateOf(id: string): (RestoredState & { zone: string }) | null {
    const s = this.worldOf(id).getPlayerState(id);
    return s ? { ...s, zone: this.zoneOf(id) } : null;
  }

  /** Step every zone, then move any player standing on a portal into the target zone. */
  step(dt: number): void {
    for (const w of this.worlds.values()) w.step(dt);
    this.applyTransitions();
  }

  private applyTransitions(): void {
    for (const [zoneId, w] of this.worlds) {
      const portals = this.defs.get(zoneId)!.portals;
      if (portals.length === 0) continue;
      // Collect first — moving a player mutates the world's player map we'd be iterating.
      const moves: { id: string; portal: Portal }[] = [];
      for (const p of w.players.values()) {
        const portal = portals.find((pt) => Math.round(p.x) === pt.x && Math.round(p.y) === pt.y);
        if (portal) moves.push({ id: p.id, portal });
      }
      for (const { id, portal } of moves) {
        const state = w.getPlayerState(id);
        if (!state) continue;
        w.removePlayer(id);
        this.world(portal.toZone).addPlayer(id, { ...state, x: portal.toX, y: portal.toY });
        this.location.set(id, portal.toZone);
        this.pending.push({ id, zone: portal.toZone, x: portal.toX, y: portal.toY, facing: state.facing });
      }
    }
  }

  consumeTransitions(): ZoneTransition[] {
    const t = this.pending;
    this.pending = [];
    return t;
  }
}

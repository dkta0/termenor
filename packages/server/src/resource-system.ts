import type { GameWorld } from "./game";

export function stepResources(w: GameWorld): void {
  for (const res of w.resources) {
    if (res.respawnAt >= 0 && w.tick >= res.respawnAt) {
      res.charges = res.maxCharges;
      res.respawnAt = -1;
    }
  }
  w.fires = w.fires.filter((f) => w.tick < f.expiresAt);
}

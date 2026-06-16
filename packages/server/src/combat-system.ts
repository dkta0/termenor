import { rollDamage, isAdjacent } from "./combat";
import { stepToward } from "./movement-system";
import { playerMaxHit, playerDefence } from "./equipment-system";
import { ATTACK_COOLDOWN_TICKS, RESPAWN_TICKS, type Facing } from "@termenor/protocol";
import { type Point } from "./pathfinding";
import type { GameWorld } from "./game";

export function setTarget(w: GameWorld, playerId: string, targetId: string): void {
  const p = w.players.get(playerId);
  if (!p) return;
  const npc = w.npcs.find((n) => n.id === targetId && n.respawnAt < 0);
  if (!npc) return;
  p.target = targetId;
  npc.target = playerId; // aggro: a targeted NPC pursues + stops wandering (spec 2.4)
}

export function stepCombat(w: GameWorld): void {
  // Combat pass: players attack npcs, npcs attack their target
  for (const p of w.players.values()) {
    if (p.attackCd > 0) p.attackCd--;
    // NPC victims have no armour → no defence reduction.
    combatStepActor(w, p, (id) => w.npcs.find((n) => n.id === id && n.respawnAt < 0) ?? null, playerMaxHit(p), () => 0);
  }
  for (const npc of w.npcs) {
    if (npc.respawnAt >= 0) continue;
    if (npc.attackCd > 0) npc.attackCd--;
    // Player victims reduce incoming damage by their equipped armour defence.
    combatStepActor(w, npc, (id) => w.players.get(id) ?? null, npc.maxHit, (id) => {
      const pl = w.players.get(id);
      return pl ? playerDefence(pl) : 0;
    });
  }
}

// Respawn lives in combat-system alongside death resolution (resolveDeaths):
// together they form the NPC death/respawn lifecycle.
export function stepNpcRespawn(w: GameWorld): void {
  for (const npc of w.npcs) {
    if (npc.respawnAt >= 0 && w.tick >= npc.respawnAt) {
      npc.x = npc.home.x; npc.y = npc.home.y; npc.path = [];
      npc.hp = npc.maxHp; npc.target = null; npc.attackCd = 0; npc.respawnAt = -1;
    }
  }
}

export function resolveDeaths(w: GameWorld): void {
  for (const npc of w.npcs) {
    if (npc.respawnAt < 0 && npc.hp <= 0) {
      npc.respawnAt = w.tick + RESPAWN_TICKS;
      npc.path = []; npc.target = null;
      for (const p of w.players.values()) if (p.target === npc.id) p.target = null;
      for (const other of w.npcs) if (other.target === npc.id) other.target = null;
    }
  }
  for (const p of w.players.values()) {
    if (p.hp <= 0) {
      p.x = w.spawn.x; p.y = w.spawn.y; p.path = [];
      p.hp = p.maxHp; p.target = null; p.attackCd = 0;
      for (const npc of w.npcs) if (npc.target === p.id) npc.target = null;
    }
  }
}

function combatStepActor(
  w: GameWorld,
  actor: { x: number; y: number; facing: Facing; path: Point[]; target: string | null; attackCd: number },
  findTarget: (id: string) => { id: string; x: number; y: number; hp: number } | null,
  maxHit: number,
  defenceOf: (targetId: string) => number,
): void {
  if (!actor.target) return;
  const tgt = findTarget(actor.target);
  if (!tgt) { actor.target = null; return; }

  if (isAdjacent(actor, tgt)) {
    actor.path = [];
    if (actor.attackCd === 0) {
      const dmg = Math.max(0, rollDamage(maxHit, w.rng) - defenceOf(tgt.id));
      tgt.hp = Math.max(0, tgt.hp - dmg);
      actor.attackCd = ATTACK_COOLDOWN_TICKS;
      w.hits.push({ targetId: tgt.id, amount: dmg, tick: w.tick });
      // If the victim is an NPC, make it retaliate against the player attacker
      const victimNpc = w.npcs.find((n) => n.id === tgt.id);
      if (victimNpc && !victimNpc.target) {
        const attackerId = idOf(w, actor);
        if (attackerId) victimNpc.target = attackerId;
      }
    }
  } else {
    stepToward(w, actor, tgt.x, tgt.y);
  }
}

// Returns the player id for a player actor, or null for NPC actors.
function idOf(w: GameWorld, actor: object): string | null {
  for (const [id, p] of w.players) if (p === actor) return id;
  return null;
}

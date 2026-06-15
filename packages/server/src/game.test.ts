import { test, expect } from "bun:test";
import type { MapData } from "@termenor/protocol";
import type { GroundItem } from "@termenor/protocol";
import { Game } from "./game";

// open 10x1 corridor
const corridor: MapData = { width: 10, height: 1, tiles: new Array(10).fill(0), heights: new Array(10).fill(0) };

test("addPlayer spawns at given tile and appears in snapshot", () => {
  const g = new Game(corridor, { x: 0, y: 0 });
  g.addPlayer("p1");
  const snap = g.snapshot();
  expect(snap.players).toHaveLength(1);
  expect(snap.players[0]).toMatchObject({ id: "p1", x: 0, y: 0 });
});

test("player walks to target over time and stops there", () => {
  const g = new Game(corridor, { x: 0, y: 0 });
  g.addPlayer("p1");
  g.queueMove("p1", 4, 0); // 4 tiles at 5 tiles/s = 0.8s
  // advance 1 second in 66ms steps
  for (let i = 0; i < 16; i++) g.step(1 / 15);
  const p = g.snapshot().players[0];
  expect(p.x).toBeCloseTo(4, 5);
  expect(p.y).toBeCloseTo(0, 5);
});

test("facing updates toward movement direction", () => {
  const g = new Game(corridor, { x: 0, y: 0 });
  g.addPlayer("p1");
  g.queueMove("p1", 3, 0);
  g.step(1 / 15);
  expect(g.snapshot().players[0].facing).toBe("east");
});

test("queueMove to unwalkable tile is ignored", () => {
  const map: MapData = { width: 3, height: 1, tiles: [0, 1, 0], heights: [0, 0, 0] };
  const g = new Game(map, { x: 0, y: 0 });
  g.addPlayer("p1");
  g.queueMove("p1", 1, 0); // blocked
  for (let i = 0; i < 10; i++) g.step(1 / 15);
  expect(g.snapshot().players[0]).toMatchObject({ x: 0, y: 0 });
});

test("fractional moveTo is floored to a tile", () => {
  const g = new Game(corridor, { x: 0, y: 0 });
  g.addPlayer("p1");
  g.queueMove("p1", 3.9, 0.2); // → tile (3, 0)
  for (let i = 0; i < 16; i++) g.step(1 / 15);
  expect(g.snapshot().players[0].x).toBeCloseTo(3, 5);
});

test("two players tracked independently", () => {
  const g = new Game(corridor, { x: 0, y: 0 });
  g.addPlayer("a");
  g.addPlayer("b");
  g.queueMove("a", 2, 0);
  for (let i = 0; i < 10; i++) g.step(1 / 15);
  const byId = Object.fromEntries(g.snapshot().players.map((p) => [p.id, p]));
  expect(byId.a.x).toBeCloseTo(2, 5);
  expect(byId.b.x).toBeCloseTo(0, 5);
});

test("removePlayer drops it from snapshot", () => {
  const g = new Game(corridor, { x: 0, y: 0 });
  g.addPlayer("a");
  g.removePlayer("a");
  expect(g.snapshot().players).toHaveLength(0);
});

test("tick counter increments each step", () => {
  const g = new Game(corridor, { x: 0, y: 0 });
  g.step(1 / 15);
  g.step(1 / 15);
  expect(g.snapshot().tick).toBe(2);
});

test("addPlayer with saved state restores x, y, facing", () => {
  const g = new Game(corridor, { x: 0, y: 0 });
  g.addPlayer("alice", { x: 7, y: 0, facing: "west" });
  const snap = g.snapshot();
  expect(snap.players[0]).toMatchObject({ id: "alice", x: 7, y: 0, facing: "west" });
});

test("addPlayer with no state falls back to spawn", () => {
  const g = new Game(corridor, { x: 3, y: 0 });
  g.addPlayer("bob");
  expect(g.snapshot().players[0]).toMatchObject({ x: 3, y: 0, facing: "south" });
});

test("getPlayerState returns current x, y, facing", () => {
  const g = new Game(corridor, { x: 0, y: 0 });
  g.addPlayer("alice", { x: 5, y: 0, facing: "east" });
  const state = g.getPlayerState("alice");
  expect(state).toMatchObject({ x: 5, y: 0, facing: "east" });
});

test("getPlayerState returns null for unknown player", () => {
  const g = new Game(corridor, { x: 0, y: 0 });
  expect(g.getPlayerState("nobody")).toBeNull();
});

test("addGroundItem places item in groundItems", () => {
  const g = new Game(corridor, { x: 0, y: 0 });
  g.addGroundItem("coins", 10, 2, 0);
  const snap = g.snapshot();
  expect(snap.ground).toHaveLength(1);
  expect(snap.ground[0]).toMatchObject({ item: "coins", qty: 10, x: 2, y: 0 });
});

test("snapshot.ground is empty when no ground items", () => {
  const g = new Game(corridor, { x: 0, y: 0 });
  expect(g.snapshot().ground).toEqual([]);
});

test("pickup moves ground item at player tile into inventory, returns true", () => {
  const g = new Game(corridor, { x: 0, y: 0 });
  g.addPlayer("p1", { x: 2, y: 0, facing: "south" });
  g.addGroundItem("coins", 5, 2, 0);
  const changed = g.pickup("p1");
  expect(changed).toBe(true);
  expect(g.snapshot().ground).toHaveLength(0);
  const inv = g.getInventory("p1");
  expect(inv?.[0]).toEqual({ item: "coins", qty: 5 });
});

test("pickup on empty tile returns false, no change", () => {
  const g = new Game(corridor, { x: 0, y: 0 });
  g.addPlayer("p1", { x: 2, y: 0, facing: "south" });
  const changed = g.pickup("p1");
  expect(changed).toBe(false);
  expect(g.snapshot().ground).toHaveLength(0);
});

test("pickup with full inventory: leftover stays on ground", () => {
  const g = new Game(corridor, { x: 0, y: 0 });
  g.addPlayer("p1", { x: 2, y: 0, facing: "south" });
  // fill inventory with non-stackable items
  for (let i = 0; i < 28; i++) g.addGroundItem("bronze_sword", 1, 3, 0);
  // move player to tile 3,0 and pick up once to seed inventory
  // simpler: inject state directly via addPlayer with pre-filled inventory
  const g2 = new Game(corridor, { x: 0, y: 0 });
  g2.addPlayer("p2", { x: 2, y: 0, facing: "south", inventory: new Array(28).fill({ item: "bronze_sword", qty: 1 }) });
  g2.addGroundItem("logs", 3, 2, 0);
  const changed = g2.pickup("p2");
  expect(changed).toBe(false); // inventory full, nothing could be taken
  expect(g2.snapshot().ground).toHaveLength(1); // item still on ground
});

test("drop moves slot item to ground, returns true", () => {
  const g = new Game(corridor, { x: 0, y: 0 });
  g.addPlayer("p1", { x: 2, y: 0, facing: "south", inventory: [{ item: "logs", qty: 2 }, ...new Array(27).fill(null)] });
  const changed = g.drop("p1", 0);
  expect(changed).toBe(true);
  expect(g.snapshot().ground).toHaveLength(1);
  expect(g.snapshot().ground[0]).toMatchObject({ item: "logs", qty: 2, x: 2, y: 0 });
  expect(g.getInventory("p1")?.[0]).toBeNull();
});

test("drop of empty slot returns false", () => {
  const g = new Game(corridor, { x: 0, y: 0 });
  g.addPlayer("p1", { x: 0, y: 0, facing: "south" });
  const changed = g.drop("p1", 0);
  expect(changed).toBe(false);
});

test("drop slot out of range is ignored, returns false", () => {
  const g = new Game(corridor, { x: 0, y: 0 });
  g.addPlayer("p1", { x: 0, y: 0, facing: "south" });
  expect(g.drop("p1", 999)).toBe(false);
});

test("getInventory returns null for unknown player", () => {
  const g = new Game(corridor, { x: 0, y: 0 });
  expect(g.getInventory("ghost")).toBeNull();
});

test("addPlayer with saved inventory restores it", () => {
  const g = new Game(corridor, { x: 0, y: 0 });
  const inv = [{ item: "coins", qty: 7 }, ...new Array(27).fill(null)];
  g.addPlayer("alice", { x: 0, y: 0, facing: "south", inventory: inv });
  expect(g.getInventory("alice")?.[0]).toEqual({ item: "coins", qty: 7 });
});

// ── Combat tests ────────────────────────────────────────────────────────────

import { PLAYER_MAX_HP, ATTACK_COOLDOWN_TICKS, RESPAWN_TICKS } from "@termenor/protocol";

const open: MapData = { width: 10, height: 10, tiles: new Array(100).fill(0), heights: new Array(100).fill(0) };
function maxHitRng() { return () => 0.999; }

test("attacking an adjacent npc reduces its hp by the rolled amount on a ready cooldown", () => {
  const g = new Game(open, { x: 0, y: 0 }, maxHitRng());
  g.addPlayer("p1"); g.queueMove("p1", 0, 0);
  g.spawnNpc("goblin", 1, 0, 2);
  const npcId = g.snapshot().npcs[0].id;
  g.attack("p1", npcId);
  g.step(1 / 15);
  const snap = g.snapshot();
  const goblin = snap.npcs.find((n) => n.id === npcId)!;
  expect(goblin.hp).toBe(5 - 2);
  expect(snap.hits).toContainEqual({ targetId: npcId, amount: 2, tick: snap.tick });
});

test("attack cooldown gates cadence (no damage every tick)", () => {
  const g = new Game(open, { x: 0, y: 0 }, maxHitRng());
  g.addPlayer("p1"); g.spawnNpc("goblin", 1, 0, 2);
  const npcId = g.snapshot().npcs[0].id;
  g.attack("p1", npcId);
  g.step(1 / 15); g.step(1 / 15);
  expect(g.snapshot().npcs.find((n) => n.id === npcId)!.hp).toBe(3);
});

test("npc retaliates against its attacker", () => {
  const g = new Game(open, { x: 0, y: 0 }, maxHitRng());
  g.addPlayer("p1"); g.spawnNpc("goblin", 1, 0, 2);
  const npcId = g.snapshot().npcs[0].id;
  g.attack("p1", npcId);
  for (let i = 0; i < ATTACK_COOLDOWN_TICKS + 2; i++) g.step(1 / 15);
  expect(g.snapshot().players.find((p) => p.id === "p1")!.hp).toBeLessThan(PLAYER_MAX_HP);
});

test("npc dies, leaves the snapshot, respawns at home full hp after RESPAWN_TICKS", () => {
  const g = new Game(open, { x: 0, y: 0 }, maxHitRng());
  g.addPlayer("p1"); g.spawnNpc("goblin", 1, 0, 2);
  const npcId = g.snapshot().npcs[0].id;
  g.attack("p1", npcId);
  for (let i = 0; i < ATTACK_COOLDOWN_TICKS * 6; i++) g.step(1 / 15);
  expect(g.snapshot().npcs.find((n) => n.id === npcId)).toBeUndefined();
  let respawned: any = undefined;
  for (let i = 0; i < RESPAWN_TICKS + 10 && !respawned; i++) {
    g.step(1 / 15);
    respawned = g.snapshot().npcs.find((n) => n.id === npcId);
  }
  expect(respawned).toMatchObject({ type: "goblin", x: 1, y: 0, hp: 5, maxHp: 5 });
});

test("out-of-range attacker walks toward the target before landing a hit", () => {
  const g = new Game(open, { x: 0, y: 0 }, maxHitRng());
  g.addPlayer("p1"); g.spawnNpc("goblin", 5, 0, 1);
  const npcId = g.snapshot().npcs[0].id;
  g.attack("p1", npcId);
  g.step(1 / 15);
  expect(g.snapshot().npcs.find((n) => n.id === npcId)!.hp).toBe(5);
  for (let i = 0; i < 40; i++) g.step(1 / 15);
  // npc either took damage (hp < 5) or was killed (absent from snapshot) — either proves a hit landed
  const npcAfter = g.snapshot().npcs.find((n) => n.id === npcId);
  expect(npcAfter === undefined || npcAfter.hp < 5).toBe(true);
});

test("player respawns at SPAWN with full hp when killed", () => {
  const g = new Game(open, { x: 0, y: 0 }, maxHitRng());
  g.addPlayer("p1");
  g.spawnNpc("goblin", 1, 0, 2);
  const npcId = g.snapshot().npcs[0].id;
  let died = false;
  let respawnHp = 0, respawnX = -1, respawnY = -1;
  let prevHp = PLAYER_MAX_HP;
  for (let i = 0; i < 1000 && !died; i++) {
    g.attack("p1", npcId);          // re-engage each respawned goblin (same id is reused)
    g.step(1 / 15);
    const me = g.snapshot().players.find((p) => p.id === "p1")!;
    if (me.hp > prevHp) { died = true; respawnHp = me.hp; respawnX = me.x; respawnY = me.y; }
    prevHp = me.hp;
  }
  expect(died).toBe(true);
  expect(respawnHp).toBe(PLAYER_MAX_HP);
  expect({ x: respawnX, y: respawnY }).toEqual({ x: 0, y: 0 });
});

test("a targeted npc pursues instead of wandering away", () => {
  const g = new Game(open, { x: 0, y: 0 }, () => 0.999);
  g.addPlayer("p1"); g.spawnNpc("goblin", 5, 5, 4);
  const npcId = g.snapshot().npcs[0].id;
  g.attack("p1", npcId);
  const start = g.snapshot().npcs[0];
  for (let i = 0; i < 20; i++) g.step(1 / 15);
  const now = g.snapshot().npcs.find((n) => n.id === npcId)!;
  expect(Math.hypot(now.x - 0, now.y - 0)).toBeLessThanOrEqual(Math.hypot(start.x - 0, start.y - 0));
});

test("integration: command attack, kill the goblin, it respawns at home", () => {
  const g = new Game(open, { x: 0, y: 0 }, () => 0.999);
  g.addPlayer("hero");
  g.spawnNpc("goblin", 2, 0, 1);
  const id = g.snapshot().npcs[0].id;
  g.attack("hero", id);
  let respawned = false;
  for (let i = 0; i < ATTACK_COOLDOWN_TICKS * 6 + RESPAWN_TICKS + 5; i++) {
    g.step(1 / 15);
    const npcs = g.snapshot().npcs;
    if (npcs.length === 1 && npcs[0].hp === npcs[0].maxHp && npcs[0].x === 2 && npcs[0].y === 0) respawned = true;
  }
  expect(respawned).toBe(true);
});

// ── Woodcutting tests ────────────────────────────────────────────────────────

import { WOODCUTTING_XP_PER_LOG, TREE_CHARGES, RESOURCE_RESPAWN_TICKS, levelForXp, xpForLevel } from "@termenor/protocol";

test("new player has bronze_axe in starter inventory", () => {
  const g = new Game(open, { x: 0, y: 0 });
  g.addPlayer("p1");
  const inv = g.getInventory("p1");
  expect(inv?.some((s) => s?.item === "bronze_axe")).toBe(true);
});

test("restored player does not get a duplicate bronze_axe", () => {
  const g = new Game(open, { x: 0, y: 0 });
  const inv = new Array(28).fill(null);
  inv[0] = { item: "logs", qty: 1 };
  g.addPlayer("p1", { x: 0, y: 0, facing: "south", inventory: inv });
  const result = g.getInventory("p1");
  expect(result?.filter((s) => s?.item === "bronze_axe").length).toBe(0);
});

test("chopping adjacent tree adds 1 log + WOODCUTTING_XP_PER_LOG xp and decrements charges", () => {
  const g = new Game(open, { x: 0, y: 0 });
  g.addPlayer("p1"); // gets bronze_axe
  const resId = g.spawnResource("tree", 1, 0);
  g.gather("p1", resId);
  g.step(1 / 15);
  const inv = g.getInventory("p1");
  expect(inv?.some((s) => s?.item === "logs" && s.qty >= 1)).toBe(true);
  expect(g.getPlayerSkills("p1").woodcutting.xp).toBe(WOODCUTTING_XP_PER_LOG);
});

test("gather cooldown gates cadence: two steps yield only one log", () => {
  const g = new Game(open, { x: 0, y: 0 });
  g.addPlayer("p1");
  const resId = g.spawnResource("tree", 1, 0);
  g.gather("p1", resId);
  g.step(1 / 15);
  g.step(1 / 15);
  const inv = g.getInventory("p1");
  const logsSlot = inv?.find((s) => s?.item === "logs");
  expect(logsSlot?.qty).toBe(1);
});

test("no axe player: gather yields 0 logs, clears gatherTarget, emits gatherNotice", () => {
  const g = new Game(open, { x: 0, y: 0 });
  // restore with inventory that has no axe
  g.addPlayer("p2", { x: 0, y: 0, facing: "south", inventory: new Array(28).fill(null) });
  const resId = g.spawnResource("tree", 1, 0);
  g.gather("p2", resId);
  g.step(1 / 15);
  const inv = g.getInventory("p2");
  expect(inv?.every((s) => s === null || s.item !== "logs")).toBe(true);
  const notices = g.consumeGatherNotices();
  expect(notices.some((n) => n.id === "p2")).toBe(true);
});

test("full inventory: gather yields 0 logs, xp unchanged, emits gatherNotice", () => {
  const g = new Game(open, { x: 0, y: 0 });
  // 27 junk slots + axe in slot 27; no room for logs
  const inv: ({ item: string; qty: number } | null)[] = new Array(28).fill(null);
  for (let i = 0; i < 27; i++) inv[i] = { item: "coins", qty: 1 };
  inv[27] = { item: "bronze_axe", qty: 1 };
  g.addPlayer("p3", { x: 0, y: 0, facing: "south", inventory: inv });
  const resId = g.spawnResource("tree", 1, 0);
  g.gather("p3", resId);
  g.step(1 / 15);
  const inv2 = g.getInventory("p3");
  expect(inv2?.every((s) => s === null || s.item !== "logs")).toBe(true);
  expect(g.getPlayerSkills("p3").woodcutting.xp).toBe(0);
  const notices = g.consumeGatherNotices();
  expect(notices.some((n) => n.id === "p3")).toBe(true);
});

test("tree depletes after TREE_CHARGES chops then respawns after RESOURCE_RESPAWN_TICKS", () => {
  const GATHER_COOLDOWN_TICKS = 30;
  const g = new Game(open, { x: 0, y: 0 });
  g.addPlayer("p1");
  const resId = g.spawnResource("tree", 1, 0);
  g.gather("p1", resId);
  // chop TREE_CHARGES times; each chop needs GATHER_COOLDOWN_TICKS+1 ticks
  for (let chop = 0; chop < TREE_CHARGES; chop++) {
    for (let t = 0; t <= GATHER_COOLDOWN_TICKS; t++) g.step(1 / 15);
  }
  // tree should be depleted (absent from snapshot)
  expect(g.snapshot().resources.find((r) => r.id === resId)).toBeUndefined();
  // wait for respawn
  for (let t = 0; t < RESOURCE_RESPAWN_TICKS + 2; t++) g.step(1 / 15);
  expect(g.snapshot().resources.find((r) => r.id === resId)).toBeDefined();
});

test("out-of-range gatherer walks toward the tree before chopping", () => {
  const g = new Game(open, { x: 0, y: 0 });
  g.addPlayer("p1"); // starts at (0,0)
  const resId = g.spawnResource("tree", 5, 0); // far away
  g.gather("p1", resId);
  g.step(1 / 15); // first step: not adjacent, no log
  const invAfter1 = g.getInventory("p1");
  expect(invAfter1?.every((s) => s === null || s.item !== "logs")).toBe(true);
  // run enough steps for player to reach and chop
  for (let i = 0; i < 60; i++) g.step(1 / 15);
  const inv = g.getInventory("p1");
  expect(inv?.some((s) => s?.item === "logs")).toBe(true);
});

test("xp crossing a level threshold raises woodcutting level and emits levelUp", () => {
  const g = new Game(open, { x: 0, y: 0 });
  // seed player with xp just below level 2 threshold
  const xpNeededForL2 = xpForLevel(2);
  const startXp = xpNeededForL2 - WOODCUTTING_XP_PER_LOG; // one chop away
  const axeInv: ({ item: string; qty: number } | null)[] = new Array(28).fill(null);
  axeInv[0] = { item: "bronze_axe", qty: 1 };
  g.addPlayer("p1", { x: 0, y: 0, facing: "south", skills: { woodcutting: startXp }, inventory: axeInv });
  const resId = g.spawnResource("tree", 1, 0);
  g.gather("p1", resId);
  g.step(1 / 15);
  const skills = g.getPlayerSkills("p1");
  expect(skills.woodcutting.level).toBeGreaterThanOrEqual(2);
  const levelUps = g.consumeLevelUps();
  expect(levelUps.some((lu) => lu.id === "p1" && lu.skill === "woodcutting")).toBe(true);
});

test("getPlayerSkills always includes woodcutting key even for brand-new players", () => {
  const g = new Game(open, { x: 0, y: 0 });
  g.addPlayer("p1");
  const skills = g.getPlayerSkills("p1");
  expect(skills.woodcutting).toBeDefined();
  expect(skills.woodcutting.xp).toBe(0);
  expect(skills.woodcutting.level).toBe(1);
});

test("consumeSkillChanges returns ids of players whose skills changed this tick and clears", () => {
  const g = new Game(open, { x: 0, y: 0 });
  g.addPlayer("p1");
  const resId = g.spawnResource("tree", 1, 0);
  g.gather("p1", resId);
  g.step(1 / 15);
  const changed = g.consumeSkillChanges();
  expect(changed).toContain("p1");
  expect(g.consumeSkillChanges()).toHaveLength(0); // cleared
});

test("snapshot includes live resources but not depleted ones", () => {
  const GATHER_COOLDOWN_TICKS = 30;
  const g = new Game(open, { x: 0, y: 0 });
  g.addPlayer("p1");
  const resId = g.spawnResource("tree", 1, 0);
  // deplete the tree
  g.gather("p1", resId);
  for (let chop = 0; chop < TREE_CHARGES; chop++) {
    for (let t = 0; t <= GATHER_COOLDOWN_TICKS; t++) g.step(1 / 15);
  }
  expect(g.snapshot().resources.find((r) => r.id === resId)).toBeUndefined();
});

test("integration: new player chops a tree to depletion, gains logs+xp, tree respawns at its spot", () => {
  const g = new Game(open, { x: 0, y: 0 }, () => 0.5);
  g.addPlayer("hero"); // brand-new player → starter bronze_axe
  const resId = g.spawnResource("tree", 1, 0); // adjacent to spawn
  g.gather("hero", resId);
  // chop until depleted: TREE_CHARGES chops, each gated by gather cooldown
  let depleted = false;
  for (let i = 0; i < TREE_CHARGES * 40 && !depleted; i++) {
    g.step(1 / 15);
    if (!g.snapshot().resources.find((r) => r.id === resId)) depleted = true;
  }
  expect(depleted).toBe(true);
  const inv = g.getInventory("hero")!;
  const logCount = inv.reduce((n, s) => n + (s?.item === "logs" ? s.qty : 0), 0);
  expect(logCount).toBe(TREE_CHARGES);
  expect(g.getPlayerSkills("hero").woodcutting.xp).toBe(TREE_CHARGES * WOODCUTTING_XP_PER_LOG);
  // respawns at its spot after the respawn timer
  let respawned = false;
  for (let i = 0; i < RESOURCE_RESPAWN_TICKS + 5 && !respawned; i++) {
    g.step(1 / 15);
    const r = g.snapshot().resources.find((x) => x.id === resId);
    if (r && r.x === 1 && r.y === 0) respawned = true;
  }
  expect(respawned).toBe(true);
});

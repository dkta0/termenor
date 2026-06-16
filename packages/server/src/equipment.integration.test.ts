import { test, expect } from "bun:test";
import { GameWorld } from "./game";
import { openDb, getOrCreateAccount, savePlayerState } from "./db";
import { PLAYER_MAX_HIT, PLAYER_MAX_HP } from "@termenor/protocol";
import type { MapData, Facing } from "@termenor/protocol";

const MAP: MapData = { width: 5, height: 5, tiles: new Array(25).fill(0), heights: new Array(25).fill(0) };
const SPAWN = { x: 2, y: 2, facing: "south" as Facing };

test("end-to-end: equip gear from inventory, then persist it across a relogin", async () => {
  const db = openDb(":memory:");
  await getOrCreateAccount(db, "knight", "pw", SPAWN);

  const w = new GameWorld(MAP, { x: 2, y: 2 });
  w.addPlayer("knight");
  const inv = w.getInventory("knight")!;
  inv.fill(null);
  inv[0] = { item: "bronze_sword", qty: 1 };
  inv[1] = { item: "bronze_platebody", qty: 1 };

  expect(w.equip("knight", 0)).toBe(true);
  expect(w.equip("knight", 1)).toBe(true);
  expect(w.getEquipment("knight")).toEqual({ weapon: "bronze_sword", body: "bronze_platebody", shield: null });

  // persist + relogin
  const saved = w.getPlayerState("knight")!;
  savePlayerState(db, "knight", saved.x, saved.y, saved.facing, saved.inventory!, saved.skills!, saved.bank ?? [], saved.equipment!);
  const reloaded = await getOrCreateAccount(db, "knight", "pw", SPAWN);
  if (!reloaded.ok) throw new Error("reload failed");

  const w2 = new GameWorld(MAP, { x: 2, y: 2 });
  w2.addPlayer("knight", reloaded.state);
  expect(w2.getEquipment("knight")).toEqual({ weapon: "bronze_sword", body: "bronze_platebody", shield: null });
});

test("end-to-end: equipped weapon and armour change combat outcomes", () => {
  const w = new GameWorld(MAP, { x: 2, y: 2 }, () => 0.999); // pin rolls to max
  w.addPlayer("knight");
  const inv = w.getInventory("knight")!;
  inv.fill(null);
  inv[0] = { item: "bronze_sword", qty: 1 };
  inv[1] = { item: "bronze_platebody", qty: 1 };
  w.equip("knight", 0); // +2 max hit
  w.equip("knight", 1); // +2 defence
  w.spawnNpc("goblin", 3, 2, 0); // adjacent, maxHp 5, maxHit 1
  const npcId = w.snapshot().npcs[0].id;
  w.attack("knight", npcId);
  w.step(1 / 15); // one exchange

  const npc = w.snapshot().npcs.find((n) => n.id === npcId);
  expect(npc!.maxHp - npc!.hp).toBe(PLAYER_MAX_HIT + 2); // sword raised the hit above the unarmed cap
  const me = w.snapshot().players.find((p) => p.id === "knight");
  expect(me!.hp).toBe(PLAYER_MAX_HP); // platebody (def 2) fully absorbed the goblin's 1 damage
});

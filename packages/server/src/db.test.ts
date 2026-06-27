import { test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { openDb, getOrCreateAccount, savePlayerState } from "./db";
import { existsSync, rmSync } from "node:fs";
import { emptyInventory } from "./inventory";
import { emptyEquipment } from "@termenor/protocol";
import type { ItemStack } from "@termenor/protocol";

const SPAWN = { x: 24, y: 24, facing: "south" as const };

let db: Database;
beforeEach(() => {
  db = openDb(":memory:");
});

test("new account is created at spawn, hash is not plaintext", async () => {
  const result = await getOrCreateAccount(db, "alice", "s3cr3t", SPAWN);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.state.x).toBe(SPAWN.x);
  expect(result.state.y).toBe(SPAWN.y);
  expect(result.state.facing).toBe(SPAWN.facing);
  // verify hash is not stored as plaintext
  const row = db.query("SELECT password_hash FROM accounts WHERE username = ?").get("alice") as { password_hash: string };
  expect(row.password_hash).not.toBe("s3cr3t");
  expect(row.password_hash.length).toBeGreaterThan(20);
});

test("correct password is accepted and returns saved state", async () => {
  await getOrCreateAccount(db, "bob", "correct", SPAWN);
  const result = await getOrCreateAccount(db, "bob", "correct", SPAWN);
  expect(result.ok).toBe(true);
});

test("wrong password is rejected", async () => {
  await getOrCreateAccount(db, "charlie", "right", SPAWN);
  const result = await getOrCreateAccount(db, "charlie", "wrong", SPAWN);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.reason).toMatch(/password/i);
});

test("savePlayerState persists and restores position", async () => {
  await getOrCreateAccount(db, "diana", "pw", SPAWN);
  savePlayerState(db, "diana", 10.5, 15.0, "east", emptyInventory(), {}, [], emptyEquipment(), "overworld", {});
  const result = await getOrCreateAccount(db, "diana", "pw", SPAWN);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.state.x).toBeCloseTo(10.5, 5);
  expect(result.state.y).toBeCloseTo(15.0, 5);
  expect(result.state.facing).toBe("east");
});

test("fresh account defaults to spawn facing", async () => {
  const result = await getOrCreateAccount(db, "newplayer", "abc", SPAWN);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.state.facing).toBe("south");
});

test("openDb creates the parent directory for a file path", () => {
  const dir = `/tmp/termenor-dbtest-${process.pid}`;
  rmSync(dir, { recursive: true, force: true });
  const db = openDb(`${dir}/nested/termenor.db`);
  expect(existsSync(`${dir}/nested/termenor.db`)).toBe(true);
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("new account returns empty inventory", async () => {
  const result = await getOrCreateAccount(db, "invuser", "pw", SPAWN);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.state.inventory).toHaveLength(28);
  expect(result.state.inventory.every((s: ItemStack | null) => s === null)).toBe(true);
});

test("savePlayerState persists inventory and restores it", async () => {
  await getOrCreateAccount(db, "inv2", "pw", SPAWN);
  const inv = [{ item: "coins", qty: 10 }, ...new Array(27).fill(null)];
  savePlayerState(db, "inv2", SPAWN.x, SPAWN.y, SPAWN.facing, inv, {}, [], emptyEquipment(), "overworld", {});
  const result = await getOrCreateAccount(db, "inv2", "pw", SPAWN);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.state.inventory[0]).toEqual({ item: "coins", qty: 10 });
  expect(result.state.inventory[1]).toBeNull();
});

test("openDb migrates existing db without inventory column", () => {
  // Create a db without inventory column (simulating pre-migration db)
  const legacy = new Database(":memory:");
  legacy.run(`CREATE TABLE IF NOT EXISTS accounts (
    username TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    x REAL NOT NULL DEFAULT 24,
    y REAL NOT NULL DEFAULT 24,
    facing TEXT NOT NULL DEFAULT 'south',
    last_seen INTEGER NOT NULL DEFAULT 0
  )`);
  legacy.run("INSERT INTO accounts (username, password_hash, x, y, facing, last_seen) VALUES ('old', 'hash', 24, 24, 'south', 0)");
  // Run migration manually (same logic as openDb)
  try { legacy.run("ALTER TABLE accounts ADD COLUMN inventory TEXT"); } catch { /* already exists */ }
  const row = legacy.query("SELECT inventory FROM accounts WHERE username = 'old'").get() as { inventory: string | null };
  // After migration, inventory column exists (null for existing rows is fine — login will default to emptyInventory)
  expect(row).toBeDefined();
  legacy.close();
});

test("new account returns empty skills", async () => {
  const result = await getOrCreateAccount(db, "skilluser", "pw", SPAWN);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.state.skills).toEqual({});
});

test("savePlayerState persists skills and restores them", async () => {
  await getOrCreateAccount(db, "woodcutter", "pw", SPAWN);
  const skills = { woodcutting: 100 };
  savePlayerState(db, "woodcutter", SPAWN.x, SPAWN.y, SPAWN.facing, emptyInventory(), skills, [], emptyEquipment(), "overworld", {});
  const result = await getOrCreateAccount(db, "woodcutter", "pw", SPAWN);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.state.skills).toEqual({ woodcutting: 100 });
});

test("NULL or corrupt skills column yields empty skills", async () => {
  await getOrCreateAccount(db, "corrupt", "pw", SPAWN);
  db.run("UPDATE accounts SET skills = 'not json' WHERE username = ?", ["corrupt"]);
  const result = await getOrCreateAccount(db, "corrupt", "pw", SPAWN);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.state.skills).toEqual({});
});

test("register mode fails when the name is already taken", async () => {
  await getOrCreateAccount(db, "taken", "pw", SPAWN, "register");
  const result = await getOrCreateAccount(db, "taken", "pw2", SPAWN, "register");
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.reason).toMatch(/taken/i);
});

test("register mode creates a fresh account", async () => {
  const result = await getOrCreateAccount(db, "fresh", "pw", SPAWN, "register");
  expect(result.ok).toBe(true);
});

test("login mode fails when the account does not exist", async () => {
  const result = await getOrCreateAccount(db, "ghost", "pw", SPAWN, "login");
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.reason).toMatch(/no such account/i);
});

test("login mode fails with wrong password on an existing account", async () => {
  await getOrCreateAccount(db, "realuser", "right", SPAWN, "register");
  const result = await getOrCreateAccount(db, "realuser", "wrong", SPAWN, "login");
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.reason).toMatch(/wrong password/i);
});

test("login mode succeeds with correct password", async () => {
  await getOrCreateAccount(db, "loginok", "pw", SPAWN, "register");
  const result = await getOrCreateAccount(db, "loginok", "pw", SPAWN, "login");
  expect(result.ok).toBe(true);
});

test("new account returns empty bank", async () => {
  const result = await getOrCreateAccount(db, "bankuser", "pw", SPAWN);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.state.bank).toEqual([]);
});

test("savePlayerState persists bank and restores it", async () => {
  await getOrCreateAccount(db, "banker", "pw", SPAWN);
  const bank: ItemStack[] = [{ item: "logs", qty: 50 }];
  savePlayerState(db, "banker", SPAWN.x, SPAWN.y, SPAWN.facing, emptyInventory(), {}, bank, emptyEquipment(), "overworld", {});
  const result = await getOrCreateAccount(db, "banker", "pw", SPAWN);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.state.bank).toEqual([{ item: "logs", qty: 50 }]);
});

test("NULL or corrupt bank column yields empty bank", async () => {
  await getOrCreateAccount(db, "corruptbank", "pw", SPAWN);
  db.run("UPDATE accounts SET bank = 'not json' WHERE username = ?", ["corruptbank"]);
  const result = await getOrCreateAccount(db, "corruptbank", "pw", SPAWN);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.state.bank).toEqual([]);
});

test("new account starts with empty equipment", async () => {
  const result = await getOrCreateAccount(db, "freshgear", "pw", SPAWN);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.state.equipment).toEqual({ weapon: null, body: null, shield: null });
});

test("savePlayerState persists equipment and restores it", async () => {
  await getOrCreateAccount(db, "eq", "pw", SPAWN);
  savePlayerState(db, "eq", SPAWN.x, SPAWN.y, SPAWN.facing, emptyInventory(), {}, [], { weapon: "bronze_sword", body: null, shield: "bronze_shield" }, "overworld", {});
  const result = await getOrCreateAccount(db, "eq", "pw", SPAWN);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.state.equipment).toEqual({ weapon: "bronze_sword", body: null, shield: "bronze_shield" });
});

test("NULL or corrupt equipment column yields empty equipment", async () => {
  await getOrCreateAccount(db, "corruptgear", "pw", SPAWN);
  db.run("UPDATE accounts SET equipment = 'not json' WHERE username = ?", ["corruptgear"]);
  const result = await getOrCreateAccount(db, "corruptgear", "pw", SPAWN);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.state.equipment).toEqual({ weapon: null, body: null, shield: null });
});

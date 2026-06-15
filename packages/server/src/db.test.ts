import { test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { openDb, getOrCreateAccount, savePlayerState } from "./db";
import { existsSync, rmSync } from "node:fs";

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
  savePlayerState(db, "diana", 10.5, 15.0, "east");
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

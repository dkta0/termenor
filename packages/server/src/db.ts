import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Facing } from "@termenor/protocol";

export interface PlayerStateRecord {
  x: number;
  y: number;
  facing: Facing;
}

export function openDb(path: string): Database {
  // bun:sqlite creates the file but not its parent dir — ensure it exists for file paths
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.run(`
    CREATE TABLE IF NOT EXISTS accounts (
      username      TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      x             REAL NOT NULL DEFAULT 24,
      y             REAL NOT NULL DEFAULT 24,
      facing        TEXT NOT NULL DEFAULT 'south',
      last_seen     INTEGER NOT NULL DEFAULT 0
    )
  `);
  return db;
}

export async function getOrCreateAccount(
  db: Database,
  username: string,
  password: string,
  spawn: PlayerStateRecord,
): Promise<{ ok: true; state: PlayerStateRecord } | { ok: false; reason: string }> {
  const row = db
    .query<{ password_hash: string; x: number; y: number; facing: string }, string>(
      "SELECT password_hash, x, y, facing FROM accounts WHERE username = ?",
    )
    .get(username);

  if (row === null) {
    // new account — create it
    const hash = await Bun.password.hash(password);
    db.run(
      "INSERT INTO accounts (username, password_hash, x, y, facing, last_seen) VALUES (?, ?, ?, ?, ?, ?)",
      [username, hash, spawn.x, spawn.y, spawn.facing, Date.now()],
    );
    return { ok: true, state: { x: spawn.x, y: spawn.y, facing: spawn.facing } };
  }

  const valid = await Bun.password.verify(password, row.password_hash);
  if (!valid) return { ok: false, reason: "bad password" };

  return {
    ok: true,
    state: { x: row.x, y: row.y, facing: row.facing as Facing },
  };
}

export function savePlayerState(
  db: Database,
  username: string,
  x: number,
  y: number,
  facing: Facing,
): void {
  db.run(
    "UPDATE accounts SET x = ?, y = ?, facing = ?, last_seen = ? WHERE username = ?",
    [x, y, facing, Date.now(), username],
  );
}

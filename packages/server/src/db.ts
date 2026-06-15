import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Facing, ItemStack } from "@termenor/protocol";
import { emptyInventory } from "./inventory";

export interface PlayerStateRecord {
  x: number;
  y: number;
  facing: Facing;
  inventory: (ItemStack | null)[];
  skills: Record<string, number>;
  bank: ItemStack[];
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
      last_seen     INTEGER NOT NULL DEFAULT 0,
      inventory     TEXT,
      skills        TEXT,
      bank          TEXT
    )
  `);
  // Migration guard: add inventory column to existing databases that predate this column
  try {
    db.run("ALTER TABLE accounts ADD COLUMN inventory TEXT");
  } catch {
    // column already exists on an existing db — safe to ignore
  }
  // Migration guard: add skills column to existing databases that predate this column
  try {
    db.run("ALTER TABLE accounts ADD COLUMN skills TEXT");
  } catch {
    // column already exists on an existing db — safe to ignore
  }
  // Migration guard: add bank column to existing databases that predate this column
  try {
    db.run("ALTER TABLE accounts ADD COLUMN bank TEXT");
  } catch {
    // column already exists on an existing db — safe to ignore
  }
  return db;
}

export async function getOrCreateAccount(
  db: Database,
  username: string,
  password: string,
  spawn: { x: number; y: number; facing: Facing },
  mode?: "login" | "register",
): Promise<{ ok: true; state: PlayerStateRecord } | { ok: false; reason: string }> {
  const row = db
    .query<{ password_hash: string; x: number; y: number; facing: string; inventory: string | null; skills: string | null; bank: string | null }, string>(
      "SELECT password_hash, x, y, facing, inventory, skills, bank FROM accounts WHERE username = ?",
    )
    .get(username);

  if (row === null) {
    // No account exists. Reject explicit logins; create for register/legacy.
    if (mode === "login") return { ok: false, reason: "no such account" };
    const hash = await Bun.password.hash(password);
    db.run(
      "INSERT INTO accounts (username, password_hash, x, y, facing, last_seen) VALUES (?, ?, ?, ?, ?, ?)",
      [username, hash, spawn.x, spawn.y, spawn.facing, Date.now()],
    );
    return { ok: true, state: { x: spawn.x, y: spawn.y, facing: spawn.facing, inventory: emptyInventory(), skills: {}, bank: [] } };
  }

  // Account exists. Reject explicit registers; verify password otherwise.
  if (mode === "register") return { ok: false, reason: "that name is taken" };

  const valid = await Bun.password.verify(password, row.password_hash);
  if (!valid) return { ok: false, reason: mode === "login" ? "wrong password" : "bad password" };

  let skills: Record<string, number> = {};
  if (row.skills) {
    try {
      skills = JSON.parse(row.skills) as Record<string, number>;
    } catch {
      skills = {};
    }
  }

  let bank: ItemStack[] = [];
  if (row.bank) {
    try {
      bank = JSON.parse(row.bank) as ItemStack[];
    } catch {
      bank = [];
    }
  }

  return {
    ok: true,
    state: {
      x: row.x, y: row.y, facing: row.facing as Facing,
      inventory: row.inventory ? (JSON.parse(row.inventory) as (ItemStack | null)[]) : emptyInventory(),
      skills,
      bank,
    },
  };
}

export function savePlayerState(
  db: Database,
  username: string,
  x: number,
  y: number,
  facing: Facing,
  inventory: (ItemStack | null)[],
  skills: Record<string, number>,
  bank: ItemStack[],
): void {
  db.run(
    "UPDATE accounts SET x = ?, y = ?, facing = ?, inventory = ?, skills = ?, bank = ?, last_seen = ? WHERE username = ?",
    [x, y, facing, JSON.stringify(inventory), JSON.stringify(skills), JSON.stringify(bank), Date.now(), username],
  );
}

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Facing, ItemStack, Equipment } from "@termenor/protocol";
import { emptyEquipment } from "@termenor/protocol";
import { emptyInventory } from "./inventory";
import { DEFAULT_ZONE } from "./world";
import type { ScenarioProgress } from "./scenario";

export interface PlayerStateRecord {
  x: number;
  y: number;
  facing: Facing;
  inventory: (ItemStack | null)[];
  skills: Record<string, number>;
  bank: ItemStack[];
  equipment: Equipment;
  zone: string;
  quests: Record<string, number>;
  scenario: ScenarioProgress | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isScenarioProgress(value: unknown): value is ScenarioProgress {
  return isRecord(value)
    && typeof value.scenarioId === "string"
    && typeof value.version === "number"
    && Number.isInteger(value.version)
    && value.version >= 1
    && Array.isArray(value.completed)
    && value.completed.every((objectiveId) => typeof objectiveId === "string")
    && Array.isArray(value.evidence)
    && value.evidence.every(
      (entry) => isRecord(entry)
        && typeof entry.objectiveId === "string"
        && typeof entry.tick === "number"
        && Number.isInteger(entry.tick)
        && entry.tick >= 0,
    )
    && typeof value.done === "boolean";
}

export function parseScenarioProgress(
  raw: string | null | undefined,
): ScenarioProgress | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return isScenarioProgress(value) ? value : null;
  } catch {
    return null;
  }
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
      bank          TEXT,
      equipment     TEXT,
      zone          TEXT NOT NULL DEFAULT 'overworld',
      quests        TEXT,
      scenario      TEXT
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
  // Migration guard: add equipment column to existing databases that predate this column
  try {
    db.run("ALTER TABLE accounts ADD COLUMN equipment TEXT");
  } catch {
    // column already exists on an existing db — safe to ignore
  }
  // Migration guard: add zone column to existing databases that predate this column
  try {
    db.run("ALTER TABLE accounts ADD COLUMN zone TEXT NOT NULL DEFAULT 'overworld'");
  } catch {
    // column already exists on an existing db — safe to ignore
  }
  // Migration guard: add quests column to existing databases that predate this column
  try {
    db.run("ALTER TABLE accounts ADD COLUMN quests TEXT");
  } catch {
    // column already exists on an existing db — safe to ignore
  }
  const columns = db
    .query<{ name: string }, []>("PRAGMA table_info(accounts)")
    .all();
  if (!columns.some((column) => column.name === "scenario")) {
    db.run("ALTER TABLE accounts ADD COLUMN scenario TEXT");
  }
  return db;
}

export async function getOrCreateAccount(
  db: Database,
  username: string,
  password: string,
  spawn: { x: number; y: number; facing: Facing },
  mode?: "login" | "register",
): Promise<{ ok: true; created: boolean; state: PlayerStateRecord } | { ok: false; reason: string }> {
  const row = db
    .query<{ password_hash: string; x: number; y: number; facing: string; inventory: string | null; skills: string | null; bank: string | null; equipment: string | null; zone: string | null; quests: string | null; scenario: string | null }, string>(
      "SELECT password_hash, x, y, facing, inventory, skills, bank, equipment, zone, quests, scenario FROM accounts WHERE username = ?",
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
    return { ok: true, created: true, state: { x: spawn.x, y: spawn.y, facing: spawn.facing, inventory: emptyInventory(), skills: {}, bank: [], equipment: emptyEquipment(), zone: DEFAULT_ZONE, quests: {}, scenario: null } };
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

  let equipment: Equipment = emptyEquipment();
  if (row.equipment) {
    try {
      equipment = JSON.parse(row.equipment) as Equipment;
    } catch {
      equipment = emptyEquipment();
    }
  }

  let quests: Record<string, number> = {};
  if (row.quests) { try { quests = JSON.parse(row.quests) as Record<string, number>; } catch { quests = {}; } }

  return {
    created: false,
    ok: true,
    state: {
      x: row.x, y: row.y, facing: row.facing as Facing,
      inventory: row.inventory ? (JSON.parse(row.inventory) as (ItemStack | null)[]) : emptyInventory(),
      skills,
      bank,
      equipment,
      zone: row.zone ?? DEFAULT_ZONE,
      quests,
      scenario: parseScenarioProgress(row.scenario),
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
  equipment: Equipment,
  zone: string,
  quests: Record<string, number>,
  scenario: ScenarioProgress | null,
): void {
  db.run(
    "UPDATE accounts SET x = ?, y = ?, facing = ?, inventory = ?, skills = ?, bank = ?, equipment = ?, zone = ?, quests = ?, scenario = ?, last_seen = ? WHERE username = ?",
    [x, y, facing, JSON.stringify(inventory), JSON.stringify(skills), JSON.stringify(bank), JSON.stringify(equipment), zone, JSON.stringify(quests), scenario === null ? null : JSON.stringify(scenario), Date.now(), username],
  );
}

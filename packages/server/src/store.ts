import { SQL } from "bun";
import type { Database } from "bun:sqlite";
import type { Facing } from "@termenor/protocol";
import { emptyEquipment } from "@termenor/protocol";
import { emptyInventory } from "./inventory";
import { DEFAULT_ZONE } from "./world";
import { openDb, getOrCreateAccount, parseScenarioProgress, savePlayerState, type PlayerStateRecord } from "./db";

export type { PlayerStateRecord } from "./db";

export type Spawn = { x: number; y: number; facing: Facing };
export type AccountResult = { ok: true; created: boolean; state: PlayerStateRecord } | { ok: false; reason: string };

/**
 * The swappable persistence boundary. The game never touches a driver directly — it talks
 * to a `PlayerStore`. SQLite is the zero-config default (local/dev/tests); Postgres is the
 * production default, selected by `DATABASE_URL`. Adding another backend = one more class.
 */
export interface PlayerStore {
  getOrCreateAccount(username: string, password: string, spawn: Spawn, mode?: "login" | "register"): Promise<AccountResult>;
  savePlayerState(username: string, rec: PlayerStateRecord): Promise<void>;
  close(): Promise<void>;
}

/** SQLite-backed store (bun:sqlite). Synchronous driver wrapped in the async interface. */
export class SqliteStore implements PlayerStore {
  private readonly db: Database;
  constructor(path: string) { this.db = openDb(path); }

  getOrCreateAccount(username: string, password: string, spawn: Spawn, mode?: "login" | "register"): Promise<AccountResult> {
    return getOrCreateAccount(this.db, username, password, spawn, mode);
  }

  async savePlayerState(username: string, rec: PlayerStateRecord): Promise<void> {
    savePlayerState(this.db, username, rec.x, rec.y, rec.facing, rec.inventory, rec.skills, rec.bank, rec.equipment, rec.zone, rec.quests, rec.scenario);
  }

  async close(): Promise<void> { this.db.close(); }
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

/** Postgres-backed store (Bun's native SQL). Schema is the SQLite schema mapped to PG types. */
export class PostgresStore implements PlayerStore {
  private readonly sql: SQL;
  private ready: Promise<void> | null = null;
  constructor(url: string) {
    this.sql = new SQL(url);
  }

  /** Connect + create schema on first use (so constructing a store never blocks on the network). */
  private ensure(): Promise<void> {
    return (this.ready ??= this.init());
  }

  private async init(): Promise<void> {
    await this.sql`
      CREATE TABLE IF NOT EXISTS accounts (
        username      TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL,
        x             DOUBLE PRECISION NOT NULL DEFAULT 24,
        y             DOUBLE PRECISION NOT NULL DEFAULT 24,
        facing        TEXT NOT NULL DEFAULT 'south',
        last_seen     BIGINT NOT NULL DEFAULT 0,
        inventory     TEXT,
        skills        TEXT,
        bank          TEXT,
        equipment     TEXT,
        zone          TEXT NOT NULL DEFAULT 'overworld',
        quests        TEXT,
        scenario      TEXT
      )
    `;
    await this.sql`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS scenario TEXT`;
  }

  async getOrCreateAccount(username: string, password: string, spawn: Spawn, mode?: "login" | "register"): Promise<AccountResult> {
    await this.ensure();
    const rows = await this.sql`
      SELECT password_hash, x, y, facing, inventory, skills, bank, equipment, zone, quests, scenario
      FROM accounts WHERE username = ${username}
    ` as Array<{ password_hash: string; x: number; y: number; facing: string; inventory: string | null; skills: string | null; bank: string | null; equipment: string | null; zone: string | null; quests: string | null; scenario: string | null }>;

    if (rows.length === 0) {
      if (mode === "login") return { ok: false, reason: "no such account" };
      const hash = await Bun.password.hash(password);
      await this.sql`
        INSERT INTO accounts (username, password_hash, x, y, facing, last_seen)
        VALUES (${username}, ${hash}, ${spawn.x}, ${spawn.y}, ${spawn.facing}, ${Date.now()})
      `;
      return { ok: true, created: true, state: { x: spawn.x, y: spawn.y, facing: spawn.facing, inventory: emptyInventory(), skills: {}, bank: [], equipment: emptyEquipment(), zone: DEFAULT_ZONE, quests: {}, scenario: null } };
    }

    if (mode === "register") return { ok: false, reason: "that name is taken" };
    const row = rows[0];
    const valid = await Bun.password.verify(password, row.password_hash);
    if (!valid) return { ok: false, reason: mode === "login" ? "wrong password" : "bad password" };

    return {
      created: false,
      ok: true,
      state: {
        x: row.x, y: row.y, facing: row.facing as Facing,
        inventory: parseJson(row.inventory, emptyInventory()),
        skills: parseJson(row.skills, {} as Record<string, number>),
        bank: parseJson(row.bank, []),
        equipment: parseJson(row.equipment, emptyEquipment()),
        zone: row.zone ?? DEFAULT_ZONE,
        quests: parseJson(row.quests, {} as Record<string, number>),
        scenario: parseScenarioProgress(row.scenario),
      },
    };
  }

  async savePlayerState(username: string, rec: PlayerStateRecord): Promise<void> {
    await this.ensure();
    await this.sql`
      UPDATE accounts SET
        x = ${rec.x}, y = ${rec.y}, facing = ${rec.facing},
        inventory = ${JSON.stringify(rec.inventory)}, skills = ${JSON.stringify(rec.skills)},
        bank = ${JSON.stringify(rec.bank)}, equipment = ${JSON.stringify(rec.equipment)},
        zone = ${rec.zone}, quests = ${JSON.stringify(rec.quests)},
        scenario = ${rec.scenario === null ? null : JSON.stringify(rec.scenario)},
        last_seen = ${Date.now()}
      WHERE username = ${username}
    `;
  }

  async close(): Promise<void> { await this.sql.end(); }
}

/**
 * Pick a store from config/env: a `postgres://` URL (arg or `DATABASE_URL`) selects Postgres;
 * otherwise SQLite at `sqlitePath` (arg or `DB_PATH`, default in-memory).
 */
export function createStore(opts: { databaseUrl?: string; sqlitePath?: string } = {}): PlayerStore {
  const url = opts.databaseUrl ?? process.env.DATABASE_URL;
  if (url && /^postgres(ql)?:\/\//.test(url)) return new PostgresStore(url);
  return new SqliteStore(opts.sqlitePath ?? process.env.DB_PATH ?? ":memory:");
}

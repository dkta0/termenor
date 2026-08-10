#!/usr/bin/env bun
import { startServer } from "./server";
import { createStore } from "./store";
import { TUTORIAL_SCENARIO, TUTORIAL_ZONE } from "./tutorial";
import { ZONE_DEFS } from "./world";
function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}


const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST; // undefined → bind all interfaces (0.0.0.0)
const dbPath = process.env.DB_PATH ?? "./data/termenor.db";
// DATABASE_URL (postgres://…) selects Postgres; otherwise SQLite at dbPath.
const store = createStore({ sqlitePath: dbPath });
const server = startServer(port, dbPath, {
  store,
  hostname: host,
  scenario: TUTORIAL_SCENARIO,
  zoneDefs: [TUTORIAL_ZONE, ...ZONE_DEFS],
  maxConnections: positiveInteger("MAX_CONNECTIONS", 128),
  maxConnectionsPerIp: positiveInteger("MAX_CONNECTIONS_PER_IP", 4),
  attemptsPerMinute: positiveInteger("CONNECTION_ATTEMPTS_PER_MINUTE", 10),
  authenticationTimeoutMs: positiveInteger("AUTHENTICATION_TIMEOUT_MS", 15_000),
});
const backend = process.env.DATABASE_URL ? "postgres" : `sqlite (${dbPath})`;
console.log(`termenor server listening on ${host ?? "0.0.0.0"}:${server.port} — persistence: ${backend}`);

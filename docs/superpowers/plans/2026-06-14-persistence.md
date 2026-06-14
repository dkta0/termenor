# Accounts + Persistence Implementation Plan

For agentic workers: execute tasks top-to-bottom, one at a time. Run the exact test command shown after each write step. Do not proceed to the next task until tests pass and the commit is made. Do not modify files outside the listed paths for each task.

**Goal:** Players log in with username + password; their position persists in SQLite across reconnects and container restarts. A new username auto-creates an account at SPAWN; wrong password is rejected; duplicate logins rejected.

**Architecture:**
- `packages/protocol` — add `LoginMsg`, `LoginErrorMsg`; extend `WelcomeMsg` with `x,y,facing`
- `packages/server/src/db.ts` (new) — SQLite layer via `bun:sqlite`, async password hashing
- `packages/server/src/game.ts` — `addPlayer(id, state?)` restore; `getPlayerState(id)`
- `packages/server/src/server.ts` — auth gate, online Set, periodic + disconnect save
- `packages/client/src/connection.ts` + `index.ts` — send `login`, handle `loginError`, seed position
- `docker-compose.yml` + `Dockerfile` — named volume, `DB_PATH` env

**Tech Stack:** Bun (runtime + test runner), `bun:sqlite` (sync API), `Bun.password` (async bcrypt), TypeScript, Docker

---

## File Structure

| Status | Path | Purpose |
|--------|------|---------|
| modified | `packages/protocol/src/index.ts` | Add `LoginMsg`, `LoginErrorMsg`; extend `WelcomeMsg` |
| modified | `packages/protocol/src/index.test.ts` | Tests for new message types |
| created  | `packages/server/src/db.ts` | SQLite layer: openDb, getOrCreateAccount, savePlayerState |
| created  | `packages/server/src/db.test.ts` | Unit tests for db.ts using `:memory:` |
| modified | `packages/server/src/game.ts` | addPlayer optional state restore; getPlayerState |
| modified | `packages/server/src/game.test.ts` | Tests for restore and getPlayerState |
| modified | `packages/server/src/server.ts` | Auth gate, online Set, periodic + disconnect save |
| modified | `packages/server/src/index.ts` | Pass DB_PATH to startServer |
| modified | `packages/client/src/connection.ts` | Send login, handle loginError |
| modified | `packages/client/src/index.ts` | Read creds from env / stdin before renderer |
| modified | `docker-compose.yml` | Named volume + DB_PATH env |
| modified | `Dockerfile` | mkdir /app/data |

---

## Task 1 — Protocol: LoginMsg, LoginErrorMsg, WelcomeMsg position fields

**Files:** `packages/protocol/src/index.ts`, `packages/protocol/src/index.test.ts`

### Steps

**1a. Write failing tests**

Add to `packages/protocol/src/index.test.ts`:

```typescript
test("login message round-trips", () => {
  const msg: ClientMsg = { t: "login", username: "alice", password: "s3cr3t" };
  expect(decodeClient(encode(msg))).toEqual(msg);
});

test("loginError message round-trips", () => {
  const msg: ServerMsg = { t: "loginError", reason: "bad password" };
  expect(decodeServer(encode(msg))).toEqual(msg);
});

test("welcome includes restored x, y, facing", () => {
  const msg: ServerMsg = {
    t: "welcome", playerId: "alice", tickRate: 15,
    x: 12.5, y: 7.0, facing: "east",
    map: { width: 2, height: 1, tiles: [0, 0], heights: [0, 0] },
  };
  expect(decodeServer(encode(msg))).toEqual(msg);
});

test("decodeClient rejects hello (removed from ClientMsg)", () => {
  // hello is no longer a valid client message after auth refactor
  // login replaces hello as the first message sent by a client
  expect(() => decodeClient(JSON.stringify({ t: "hello" }))).toThrow();
});
```

**Run (expect FAIL):**
```
bun test packages/protocol/src/index.test.ts
```
Expected failures: `login message round-trips`, `loginError message round-trips`, `welcome includes restored x, y, facing`, `decodeClient rejects hello`.

**1b. Implement**

Replace `packages/protocol/src/index.ts` with:

```typescript
export type Facing = "north" | "south" | "east" | "west";

/** Row-major grid. 0 = walkable, 1 = blocked. `heights` is per-tile ground elevation. */
export interface MapData {
  width: number;
  height: number;
  tiles: number[];
  heights: number[];
}

/** Max walkable height delta between two adjacent tiles. */
export const MAX_CLIMB = 1;

/** x/y are continuous tile coords (floats) so clients can interpolate. */
export interface PlayerState {
  id: string;
  x: number;
  y: number;
  facing: Facing;
}

export interface LoginMsg { t: "login"; username: string; password: string; }
export interface MoveToMsg { t: "moveTo"; x: number; y: number; }
export type ClientMsg = LoginMsg | MoveToMsg;

export interface WelcomeMsg {
  t: "welcome";
  playerId: string;
  map: MapData;
  tickRate: number;
  x: number;
  y: number;
  facing: Facing;
}
export interface SnapshotMsg { t: "snapshot"; tick: number; players: PlayerState[]; }
export interface LoginErrorMsg { t: "loginError"; reason: string; }
export type ServerMsg = WelcomeMsg | SnapshotMsg | LoginErrorMsg;

export function encode(msg: ClientMsg | ServerMsg): string {
  return JSON.stringify(msg);
}

const CLIENT_TYPES = new Set(["login", "moveTo"]);
const SERVER_TYPES = new Set(["welcome", "snapshot", "loginError"]);

export function decodeClient(data: string): ClientMsg {
  const obj = JSON.parse(data);
  if (!obj || !CLIENT_TYPES.has(obj.t)) throw new Error(`bad client message: ${data}`);
  return obj as ClientMsg;
}

export function decodeServer(data: string): ServerMsg {
  const obj = JSON.parse(data);
  if (!obj || !SERVER_TYPES.has(obj.t)) throw new Error(`bad server message: ${data}`);
  return obj as ServerMsg;
}
```

Note: `HelloMsg` and `"hello"` are removed from the protocol — `login` replaces it as the first client message. This is a breaking change intentionally gated behind this slice.

**Run (expect PASS):**
```
bun test packages/protocol/src/index.test.ts
```

**1c. Commit:**
```
git add packages/protocol/src/index.ts packages/protocol/src/index.test.ts
git commit -m "feat(protocol): add LoginMsg, LoginErrorMsg; extend WelcomeMsg with x/y/facing"
```

---

## Task 2 — DB layer: openDb, getOrCreateAccount, savePlayerState

**Files:** `packages/server/src/db.ts` (new), `packages/server/src/db.test.ts` (new)

### Steps

**2a. Write failing tests**

Create `packages/server/src/db.test.ts`:

```typescript
import { test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { openDb, getOrCreateAccount, savePlayerState } from "./db";

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
```

**Run (expect FAIL — db.ts does not exist):**
```
bun test packages/server/src/db.test.ts
```

**2b. Implement**

Create `packages/server/src/db.ts`:

```typescript
import { Database } from "bun:sqlite";
import type { Facing } from "@termenor/protocol";

export interface PlayerStateRecord {
  x: number;
  y: number;
  facing: Facing;
}

export function openDb(path: string): Database {
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
```

**Run (expect PASS):**
```
bun test packages/server/src/db.test.ts
```

**2c. Commit:**
```
git add packages/server/src/db.ts packages/server/src/db.test.ts
git commit -m "feat(server): db.ts — SQLite account + position persistence with bun:sqlite"
```

---

## Task 3 — Game: addPlayer restore + getPlayerState

**Files:** `packages/server/src/game.ts`, `packages/server/src/game.test.ts`

### Steps

**3a. Write failing tests**

Add to `packages/server/src/game.test.ts`:

```typescript
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
```

**Run (expect FAIL):**
```
bun test packages/server/src/game.test.ts
```

**3b. Implement**

Update `packages/server/src/game.ts`. Change `addPlayer` signature and add `getPlayerState`:

```typescript
import type { Facing, MapData, PlayerState, SnapshotMsg } from "@termenor/protocol";
import { findPath, type Point } from "./pathfinding";

const SPEED = 5; // tiles per second  → ~200ms per tile

interface Player {
  id: string;
  x: number;
  y: number;
  facing: Facing;
  path: Point[]; // remaining waypoints (tile centers)
}

function facingTo(dx: number, dy: number, fallback: Facing): Facing {
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "east" : "west";
  if (dy !== 0) return dy > 0 ? "south" : "north";
  return fallback;
}

export interface RestoredState {
  x: number;
  y: number;
  facing: Facing;
}

export class Game {
  readonly map: MapData;
  private spawn: Point;
  private players = new Map<string, Player>();
  private tick = 0;

  constructor(map: MapData, spawn: Point) {
    this.map = map;
    this.spawn = spawn;
  }

  addPlayer(id: string, state?: RestoredState): void {
    const x = state?.x ?? this.spawn.x;
    const y = state?.y ?? this.spawn.y;
    const facing = state?.facing ?? "south";
    this.players.set(id, { id, x, y, facing, path: [] });
  }

  removePlayer(id: string): void {
    this.players.delete(id);
  }

  getPlayerState(id: string): RestoredState | null {
    const p = this.players.get(id);
    if (!p) return null;
    return { x: p.x, y: p.y, facing: p.facing };
  }

  queueMove(id: string, x: number, y: number): void {
    const p = this.players.get(id);
    if (!p) return;
    // tiles are integer-addressed; floor any fractional client input
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    const path = findPath(this.map, { x: Math.round(p.x), y: Math.round(p.y) }, { x: tx, y: ty });
    if (path === null) return; // unwalkable / unreachable — ignore
    p.path = path;
  }

  /** Advance the world by dt seconds. */
  step(dt: number): void {
    this.tick++;
    for (const p of this.players.values()) {
      let budget = SPEED * dt;
      while (budget > 0 && p.path.length > 0) {
        const target = p.path[0];
        const dx = target.x - p.x;
        const dy = target.y - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= budget) {
          p.x = target.x;
          p.y = target.y;
          p.facing = facingTo(dx, dy, p.facing);
          p.path.shift();
          budget -= dist;
        } else {
          p.x += (dx / dist) * budget;
          p.y += (dy / dist) * budget;
          p.facing = facingTo(dx, dy, p.facing);
          budget = 0;
        }
      }
    }
  }

  snapshot(): SnapshotMsg {
    const players: PlayerState[] = [...this.players.values()].map((p) => ({
      id: p.id, x: p.x, y: p.y, facing: p.facing,
    }));
    return { t: "snapshot", tick: this.tick, players };
  }
}
```

**Run (expect PASS):**
```
bun test packages/server/src/game.test.ts
```

**3c. Commit:**
```
git add packages/server/src/game.ts packages/server/src/game.test.ts
git commit -m "feat(game): addPlayer accepts optional restore state; add getPlayerState"
```

---

## Task 4 — Server: auth gate, online Set, periodic + disconnect save

**Files:** `packages/server/src/server.ts`, `packages/server/src/index.ts`

This task modifies behavior (WebSocket lifecycle, auth gating) rather than pure functions. Tests for this layer live in the integration test (Task 7). This task provides a manual verification command instead.

### Steps

**4a. Implement `packages/server/src/server.ts`**

Replace the entire file:

```typescript
import { decodeClient, encode } from "@termenor/protocol";
import { Game } from "./game";
import { createDefaultMap, SPAWN } from "./world";
import { openDb, getOrCreateAccount, savePlayerState } from "./db";
import type { Database } from "bun:sqlite";

const TICK_RATE = 15;
const SAVE_INTERVAL_TICKS = TICK_RATE * 5; // save all online players every ~5 seconds

interface Conn { id: string; username: string | null; }

export interface RunningServer {
  port: number;
  stop(): void;
}

export function startServer(port: number, dbPath = "./data/termenor.db"): RunningServer {
  const map = createDefaultMap();
  const game = new Game(map, SPAWN);
  const db: Database = openDb(dbPath);
  const online = new Set<string>(); // usernames currently connected
  let nextId = 1;
  let saveTick = 0;

  const server = Bun.serve<Conn>({
    port,
    fetch(req, srv) {
      if (srv.upgrade(req, { data: { id: `p${nextId++}`, username: null } })) return;
      return new Response("termenor server", { status: 200 });
    },
    websocket: {
      open(_ws) {
        // do nothing — wait for login message
      },
      async message(ws, raw) {
        let msg;
        try { msg = decodeClient(String(raw)); } catch { return; }

        if (ws.data.username === null) {
          // unauthenticated — only accept login
          if (msg.t !== "login") return;

          const { username, password } = msg;

          if (online.has(username)) {
            ws.send(encode({ t: "loginError", reason: "already online" }));
            ws.close();
            return;
          }

          const spawn = { x: SPAWN.x, y: SPAWN.y, facing: "south" as const };
          const result = await getOrCreateAccount(db, username, password, spawn);

          if (!result.ok) {
            ws.send(encode({ t: "loginError", reason: result.reason }));
            ws.close();
            return;
          }

          ws.data.username = username;
          online.add(username);
          game.addPlayer(username, result.state);
          ws.subscribe("world");
          ws.send(encode({
            t: "welcome",
            playerId: username,
            map,
            tickRate: TICK_RATE,
            x: result.state.x,
            y: result.state.y,
            facing: result.state.facing,
          }));
          return;
        }

        // authenticated — handle game messages
        if (msg.t === "moveTo") game.queueMove(ws.data.username, msg.x, msg.y);
      },
      close(ws) {
        const { username } = ws.data;
        if (username === null) return;
        const state = game.getPlayerState(username);
        if (state) savePlayerState(db, username, state.x, state.y, state.facing);
        game.removePlayer(username);
        online.delete(username);
      },
    },
  });

  const dt = 1 / TICK_RATE;
  const interval = setInterval(() => {
    game.step(dt);
    server.publish("world", encode(game.snapshot()));

    saveTick++;
    if (saveTick >= SAVE_INTERVAL_TICKS) {
      saveTick = 0;
      // persist all currently online players
      for (const username of online) {
        const state = game.getPlayerState(username);
        if (state) savePlayerState(db, username, state.x, state.y, state.facing);
      }
    }
  }, 1000 / TICK_RATE);

  return {
    port: server.port ?? port,
    stop() { clearInterval(interval); server.stop(true); },
  };
}
```

**4b. Update `packages/server/src/index.ts`**

```typescript
import { startServer } from "./server";

const port = Number(process.env.PORT ?? 3000);
const dbPath = process.env.DB_PATH ?? "./data/termenor.db";
const server = startServer(port, dbPath);
console.log(`termenor server listening on ws://localhost:${server.port}`);
```

**4c. Typecheck verification (no runnable unit test possible for server wiring):**
```
bun run typecheck
```
Expected: zero errors.

**4d. Commit:**
```
git add packages/server/src/server.ts packages/server/src/index.ts
git commit -m "feat(server): auth gate, online set, login handshake, periodic + disconnect save"
```

---

## Task 5 — Client: send login, handle loginError, seed position from welcome

**Files:** `packages/client/src/connection.ts`, `packages/client/src/index.ts`

### Steps

**5a. Write failing tests**

Add to `packages/client/src/connection.test.ts` (the existing connection test file). First check the existing test structure to append correctly:

```typescript
test("connection sends login message on open", () => {
  const sent: string[] = [];
  const mockSock: SocketLike = {
    send: (d) => sent.push(d),
    close: () => {},
  };
  const state = new GameState();
  const conn = new Connection("ws://x", state, {
    socketFactory: () => mockSock,
    username: "alice",
    password: "s3cr3t",
  });
  conn.connect();
  mockSock.onopen?.();
  expect(sent).toHaveLength(1);
  const msg = JSON.parse(sent[0]);
  expect(msg.t).toBe("login");
  expect(msg.username).toBe("alice");
  expect(msg.password).toBe("s3cr3t");
});

test("loginError triggers onLoginError callback", () => {
  let errorReason: string | null = null;
  const mockSock: SocketLike = {
    send: () => {},
    close: () => {},
  };
  const state = new GameState();
  const conn = new Connection("ws://x", state, {
    socketFactory: () => mockSock,
    username: "alice",
    password: "wrong",
    onLoginError: (reason) => { errorReason = reason; },
  });
  conn.connect();
  mockSock.onopen?.();
  mockSock.onmessage?.(JSON.stringify({ t: "loginError", reason: "bad password" }));
  expect(errorReason).toBe("bad password");
});

test("welcome message seeds local position in GameState", () => {
  const mockSock: SocketLike = {
    send: () => {},
    close: () => {},
  };
  const state = new GameState();
  const conn = new Connection("ws://x", state, {
    socketFactory: () => mockSock,
    username: "alice",
    password: "pw",
  });
  conn.connect();
  mockSock.onopen?.();
  mockSock.onmessage?.(JSON.stringify({
    t: "welcome",
    playerId: "alice",
    tickRate: 15,
    x: 10,
    y: 5,
    facing: "east",
    map: { width: 2, height: 1, tiles: [0, 0], heights: [0, 0] },
  }));
  expect(state.localId).toBe("alice");
});
```

**Run (expect FAIL):**
```
bun test packages/client/src/connection.test.ts
```

**5b. Implement `packages/client/src/connection.ts`**

```typescript
import { decodeServer, encode, type MoveToMsg } from "@termenor/protocol";
import type { GameState } from "./game-state";

/** Minimal socket surface so tests can inject a mock. */
export interface SocketLike {
  onopen?: () => void;
  onmessage?: (data: string) => void;
  onclose?: () => void;
  send(data: string): void;
  close(): void;
}
export type SocketFactory = (url: string) => SocketLike;

export interface ConnectionOpts {
  socketFactory?: SocketFactory;
  now?: () => number;
  reconnectDelayMs?: number;
  username: string;
  password: string;
  onLoginError?: (reason: string) => void;
}

/** Adapts the browser/Bun WebSocket to SocketLike. */
function defaultFactory(url: string): SocketLike {
  const ws = new WebSocket(url);
  const adapter: SocketLike = {
    send: (d) => ws.send(d),
    close: () => ws.close(),
  };
  ws.addEventListener("open", () => adapter.onopen?.());
  ws.addEventListener("message", (e) => adapter.onmessage?.(String(e.data)));
  ws.addEventListener("close", () => adapter.onclose?.());
  return adapter;
}

export class Connection {
  private sock: SocketLike | null = null;
  private readonly factory: SocketFactory;
  private readonly now: () => number;
  private readonly reconnectDelayMs: number;
  private readonly username: string;
  private readonly password: string;
  private readonly onLoginError: (reason: string) => void;
  private closedByUser = false;

  constructor(
    private readonly url: string,
    private readonly state: GameState,
    opts: ConnectionOpts,
  ) {
    this.factory = opts.socketFactory ?? defaultFactory;
    this.now = opts.now ?? (() => performance.now());
    this.reconnectDelayMs = opts.reconnectDelayMs ?? 500;
    this.username = opts.username;
    this.password = opts.password;
    this.onLoginError = opts.onLoginError ?? ((reason) => {
      console.error(`Login failed: ${reason}`);
      process.exit(1);
    });
  }

  connect(): void {
    const sock = this.factory(this.url);
    this.sock = sock;
    sock.onopen = () => sock.send(encode({ t: "login", username: this.username, password: this.password }));
    sock.onmessage = (data) => this.handle(data);
    sock.onclose = () => {
      if (this.closedByUser) return;
      if (this.reconnectDelayMs <= 0) this.connect();
      else setTimeout(() => this.connect(), this.reconnectDelayMs);
    };
  }

  sendMoveTo(x: number, y: number): void {
    const msg: MoveToMsg = { t: "moveTo", x, y };
    this.sock?.send(encode(msg));
  }

  disconnect(): void {
    this.closedByUser = true;
    this.sock?.close();
  }

  private handle(data: string): void {
    let msg;
    try { msg = decodeServer(data); } catch { return; }
    if (msg.t === "loginError") {
      this.onLoginError(msg.reason);
    } else if (msg.t === "welcome") {
      this.state.setLocalId(msg.playerId);
      this.state.setMap(msg.map);
      // seed position: inject an initial snapshot so the renderer has a starting frame
      this.state.applySnapshot(
        { t: "snapshot", tick: 0, players: [{ id: msg.playerId, x: msg.x, y: msg.y, facing: msg.facing }] },
        this.now(),
      );
    } else if (msg.t === "snapshot") {
      this.state.applySnapshot(msg, this.now());
    }
  }
}
```

**5c. Update `packages/client/src/index.ts`**

```typescript
import { GameState } from "./game-state";
import { Connection } from "./connection";
import { startRenderer } from "./render/renderer";

const url = process.env.SERVER_URL ?? process.argv[2] ?? "ws://localhost:3000";

// Read credentials before starting TUI (stdin is available in line mode at this point)
async function readCredentials(): Promise<{ username: string; password: string }> {
  const username = process.env.TERMENOR_USER;
  const password = process.env.TERMENOR_PASS;
  if (username && password) return { username, password };

  // minimal stdin prompt — must run BEFORE createCliRenderer puts stdin in raw mode
  process.stdout.write("Username: ");
  const u = await new Promise<string>((resolve) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.resume();
    process.stdin.once("data", (chunk: string) => {
      buf = chunk.trim();
      resolve(buf);
    });
  });

  process.stdout.write("Password: ");
  const p = await new Promise<string>((resolve) => {
    let buf = "";
    process.stdin.once("data", (chunk: string) => {
      buf = chunk.trim();
      resolve(buf);
    });
  });
  process.stdin.pause();

  return { username: u, password: p };
}

const { username, password } = await readCredentials();

const state = new GameState();
const conn = new Connection(url, state, {
  username,
  password,
  onLoginError: (reason) => {
    console.error(`Login failed: ${reason}`);
    process.exit(1);
  },
});
conn.connect();

const handle = await startRenderer(state, {
  onMoveTo: (x, y) => conn.sendMoveTo(x, y),
});

const shutdown = () => { handle.stop(); conn.disconnect(); process.exit(0); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
```

**Run (expect PASS):**
```
bun test packages/client/src/connection.test.ts
```

**5d. Full typecheck:**
```
bun run typecheck
```

**5e. Commit:**
```
git add packages/client/src/connection.ts packages/client/src/index.ts
git commit -m "feat(client): send login on connect, handle loginError, seed position from welcome"
```

---

## Task 6 — Docker: named volume + DB_PATH env

**Files:** `docker-compose.yml`, `Dockerfile`

No unit test is possible. Manual verification command provided.

### Steps

**6a. Update `docker-compose.yml`:**

```yaml
services:
  server:
    build: .
    ports:
      - "3000:3000"
    environment:
      - PORT=3000
      - DB_PATH=/app/data/termenor.db
    volumes:
      - termenor-data:/app/data
    restart: unless-stopped

volumes:
  termenor-data:
```

**6b. Update `Dockerfile`** — add `RUN mkdir -p /app/data` after `WORKDIR`:

```dockerfile
FROM oven/bun:1.3.10-alpine
WORKDIR /app

# ensure data directory exists (volume will be mounted here at runtime)
RUN mkdir -p /app/data

# install workspace deps
COPY package.json bun.lock ./
COPY packages/protocol/package.json packages/protocol/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN bun install --frozen-lockfile --production

# source (server + protocol only; client runs in the player's terminal)
COPY packages/protocol ./packages/protocol
COPY packages/server ./packages/server

ENV PORT=3000
ENV DB_PATH=/app/data/termenor.db
EXPOSE 3000
CMD ["bun", "run", "packages/server/src/index.ts"]
```

**6c. Verification (build only — do not start the container):**
```
docker compose build
```
Expected: build completes with exit code 0, `/app/data` directory present in image layer.

**6d. Commit:**
```
git add docker-compose.yml Dockerfile
git commit -m "feat(docker): named volume termenor-data for SQLite db, DB_PATH env"
```

---

## Task 7 — Integration test: reconnect restore, bad password, duplicate login

**Files:** `packages/server/src/server.test.ts` (new)

### Steps

**7a. Write the failing test**

Create `packages/server/src/server.test.ts`:

```typescript
import { test, expect, afterEach } from "bun:test";
import type { RunningServer } from "./server";
import { startServer } from "./server";

// helper: open a WebSocket and return a simple promise-based wrapper
function wsClient(port: number): {
  send(data: string): void;
  messages: string[];
  waitForMessage(t: string, timeoutMs?: number): Promise<Record<string, unknown>>;
  close(): void;
} {
  const messages: string[] = [];
  const ws = new WebSocket(`ws://localhost:${port}`);
  const listeners = new Map<string, (msg: Record<string, unknown>) => void>();

  ws.addEventListener("message", (e) => {
    const raw = String(e.data);
    messages.push(raw);
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const t = String(obj.t);
    listeners.get(t)?.(obj);
  });

  return {
    send: (d) => ws.send(d),
    messages,
    waitForMessage(t: string, timeoutMs = 2000): Promise<Record<string, unknown>> {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timeout waiting for ${t}`)), timeoutMs);
        listeners.set(t, (msg) => { clearTimeout(timer); resolve(msg); });
      });
    },
    close: () => ws.close(),
  };
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

let srv: RunningServer;
afterEach(() => { srv?.stop(); });

test("login with new username creates account and returns spawn", async () => {
  srv = startServer(0, ":memory:");
  await sleep(50); // let server bind

  const client = wsClient(srv.port);
  const welcomeP = client.waitForMessage("welcome");
  await sleep(20); // let socket open
  client.send(JSON.stringify({ t: "login", username: "alice", password: "pw" }));
  const welcome = await welcomeP;
  expect(welcome.playerId).toBe("alice");
  expect(typeof welcome.x).toBe("number");
  expect(typeof welcome.y).toBe("number");
  client.close();
});

test("wrong password returns loginError", async () => {
  srv = startServer(0, ":memory:");
  await sleep(50);

  // first: create account
  const c1 = wsClient(srv.port);
  await sleep(20);
  c1.send(JSON.stringify({ t: "login", username: "bob", password: "right" }));
  await c1.waitForMessage("welcome");
  c1.close();
  await sleep(100); // let close propagate

  // second: wrong password
  const c2 = wsClient(srv.port);
  const errP = c2.waitForMessage("loginError");
  await sleep(20);
  c2.send(JSON.stringify({ t: "login", username: "bob", password: "wrong" }));
  const err = await errP;
  expect(typeof err.reason).toBe("string");
  c2.close();
});

test("duplicate login (account already online) returns loginError", async () => {
  srv = startServer(0, ":memory:");
  await sleep(50);

  const c1 = wsClient(srv.port);
  await sleep(20);
  c1.send(JSON.stringify({ t: "login", username: "carol", password: "pw" }));
  await c1.waitForMessage("welcome");
  // c1 stays connected — carol is online

  const c2 = wsClient(srv.port);
  const errP = c2.waitForMessage("loginError");
  await sleep(20);
  c2.send(JSON.stringify({ t: "login", username: "carol", password: "pw" }));
  const err = await errP;
  expect(String(err.reason)).toMatch(/already online/i);
  c1.close();
  c2.close();
});

test("position is restored after disconnect and reconnect", async () => {
  srv = startServer(0, ":memory:");
  await sleep(50);

  // connect, move, disconnect
  const c1 = wsClient(srv.port);
  await sleep(20);
  c1.send(JSON.stringify({ t: "login", username: "diana", password: "pw" }));
  await c1.waitForMessage("welcome");

  // send moveTo (5, 5) and wait for snapshots to reflect movement
  c1.send(JSON.stringify({ t: "moveTo", x: 5, y: 5 }));
  await sleep(2000); // 2 seconds — enough for 5 tiles at SPEED=5

  c1.close();
  await sleep(200); // let close handler run + save state

  // reconnect
  const c2 = wsClient(srv.port);
  const welcomeP = c2.waitForMessage("welcome");
  await sleep(20);
  c2.send(JSON.stringify({ t: "login", username: "diana", password: "pw" }));
  const welcome = await welcomeP;
  // restored position should be near (5, 5), not spawn (24, 24)
  expect(Number(welcome.x)).toBeCloseTo(5, 0);
  expect(Number(welcome.y)).toBeCloseTo(5, 0);
  c2.close();
}, 10000);

test("moveTo before login is ignored", async () => {
  srv = startServer(0, ":memory:");
  await sleep(50);

  const client = wsClient(srv.port);
  await sleep(20);
  // send moveTo without logging in first
  client.send(JSON.stringify({ t: "moveTo", x: 10, y: 10 }));
  await sleep(200);
  // no welcome or loginError should have been sent
  expect(client.messages).toHaveLength(0);
  client.close();
});
```

**Run (expect FAIL — server.test.ts is new and server.ts async message handler needs testing):**
```
bun test packages/server/src/server.test.ts
```

**7b. Fix any integration failures**

Run the full test suite to confirm all tests pass:
```
bun test
```

**7c. Typecheck gate:**
```
bun run typecheck
```

Expected: zero errors.

**7d. Commit:**
```
git add packages/server/src/server.test.ts
git commit -m "test(server): integration tests — login, bad password, duplicate, reconnect restore"
```

---

## Self-Review

| Spec criterion | Covered | Evidence |
|---|---|---|
| 1. DB layer tested against `:memory:` | Yes | Task 2: `db.test.ts` — create/verify/reject/save/restore all tested with `new Database(":memory:")` via `openDb(":memory:")` |
| 2. Auth: new account created + hashed, correct accepted, wrong rejected | Yes | Task 2: `db.test.ts` — hash ≠ plaintext verified, correct/wrong password cases explicit |
| 3. Restore: `savePlayerState` → `getOrCreateAccount` returns those values; fresh → SPAWN | Yes | Task 2: `savePlayerState persists and restores position` + `fresh account defaults to spawn facing` |
| 4. Protocol login handshake: client sends `login`, server replies `welcome` (with x/y/facing) or `loginError`; `moveTo` gated | Yes | Task 1 (types), Task 4 (gate in server.ts), Task 7 integration (`moveTo before login` test) |
| 5. Duplicate login rejected | Yes | Task 4 (`online.has(username)` check), Task 7 `duplicate login` integration test |
| 6. Persistence across reconnect | Yes | Task 7 `position is restored after disconnect and reconnect` test; save on close + periodic save every 5 s in tick loop |
| 7. Docker volume + DB_PATH | Yes | Task 6: named volume `termenor-data:/app/data`, `DB_PATH=/app/data/termenor.db` in both docker-compose and Dockerfile |
| 8. No regressions | Yes | Task 7 step 7b runs full `bun test`; step 7c runs `bun run typecheck`; existing game.test.ts tests unchanged in Task 3 |

### Deviations from spec assumptions (for the controller's awareness)

1. **`HelloMsg` removed entirely.** The spec says to add `LoginMsg` but is silent on whether to keep `HelloMsg`. Since `login` now serves as the first client message, keeping `hello` creates a dead code path (server ignores it pre-auth). The plan removes it and updates `CLIENT_TYPES` accordingly. One existing test (`hello round-trips`) will fail and must be deleted or replaced with the new `login` round-trip test.

2. **`connection.test.ts` already exists.** The plan appends to it rather than creating from scratch. The existing tests import `Connection` with the old 3-arg constructor (no `username`/`password`). Those tests will need updating to pass `username` and `password` in opts. The plan's Task 5 test snippet shows the new opts shape; the implementer must update or remove the old `sock.send(encode({ t: "hello" }))` assertion from the existing test.

3. **`GameState.localId` field.** The plan's welcome test checks `state.localId` — this field must exist as a readable property on `GameState` (it is set via `setLocalId`). If `localId` is a private field, the test must use a public accessor. Verify against `packages/client/src/game-state.ts` before implementing Task 5.

4. **`startServer` in server.test.ts uses `:memory:` as `dbPath`.** The `:memory:` string is passed through to `openDb()` in db.ts. `openDb` must not try to create the parent directory for `:memory:` paths. The implementation in Task 2 uses `new Database(path, { create: true })` which handles `:memory:` correctly.

5. **Periodic save tick count.** The spec says "every ~5 s". The plan uses `SAVE_INTERVAL_TICKS = TICK_RATE * 5 = 75`. This means a tick counter in the closure — not a separate `setInterval` — keeping the tick loop simple.

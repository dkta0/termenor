# Termenor — Vertical Slice 3: Accounts + Persistence

Status: **spec** · Branch: `feat/persistence` · Date: 2026-06-14

## 1. Goal

Players log in with a username + password and their position survives reconnects. State
persists in **SQLite** (Bun's built-in `bun:sqlite` — no extra service/dependency) stored on
a Docker volume so it survives container restarts. Server stays authoritative.

"Done" = a player logs in, walks somewhere, disconnects, reconnects with the same
credentials, and resumes at their saved location; a brand-new username auto-creates an
account spawning at `SPAWN`; wrong password is rejected.

### Non-goals
- No email, password reset, sessions/tokens, or rate-limiting (hobby scope).
- No Postgres (SQLite via a volume is sufficient for a single server; revisit at world-scale).
- No account management UI beyond the login prompt; no inventory/skills yet (later slices).

## 2. Success criteria (concrete & checkable)
1. **DB layer pure-ish + tested.** `db.ts` opens a SQLite db (`:memory:` in tests), with
   `getAccount`, `createAccount`, `savePlayerState`; unit-tested against `:memory:`.
2. **Auth tested.** New username creates an account (password hashed via `Bun.password`).
   Correct password → success; wrong password → rejected. Hash is never the plaintext.
3. **Restore tested.** After `savePlayerState(user, x, y, facing)`, loading returns those
   values; a fresh account returns `SPAWN`/default facing.
4. **Protocol login handshake.** Client sends `{t:"login",username,password}`; server replies
   `welcome` (with restored x/y/facing) on success or `{t:"loginError",reason}` on failure.
   No `moveTo` is processed before a successful login.
5. **Duplicate-login rejected.** Logging in with an account already online → `loginError`.
6. **Persistence across reconnect (integration).** Move → disconnect → reconnect → position
   restored. Saved on disconnect (and periodically while online).
7. **Docker volume.** `docker-compose.yml` mounts a named volume for the db file; `DB_PATH`
   env configurable; default path under a persisted dir.
8. **No regressions.** Full `bun test` green, `bun run typecheck` clean.

## 3. Architecture

### 3.1 Protocol (`packages/protocol/src/index.ts`)
- Add `LoginMsg { t:"login"; username: string; password: string }` to `ClientMsg`.
- Add `LoginErrorMsg { t:"loginError"; reason: string }` to `ServerMsg`.
- `WelcomeMsg` gains `x`, `y`, `facing` (the restored spawn position). `playerId` becomes the
  username.
- Update `CLIENT_TYPES`/`SERVER_TYPES` sets and the decode guards.

### 3.2 Server persistence (`packages/server/src/db.ts` — new)
- `openDb(path: string): Database` (from `bun:sqlite`); creates the `accounts` table if absent:
  `username TEXT PRIMARY KEY, password_hash TEXT, x REAL, y REAL, facing TEXT, last_seen INTEGER`.
- `async getOrCreateAccount(db, username, password, spawn): { ok: true, state } | { ok:false, reason }`
  — if account exists, verify password via `Bun.password.verify`; if absent, create with
  hashed password (`Bun.password.hash`) at `spawn`. Returns restored `{x,y,facing}`.
- `savePlayerState(db, username, x, y, facing)` — UPSERT position + `last_seen`.
- Keep DB calls synchronous (bun:sqlite is sync) except password hashing (async).

### 3.3 Server wiring (`packages/server/src/server.ts`, `game.ts`, `index.ts`)
- `Conn` gains `username: string | null` (null until authed). `open` no longer adds a player.
- `message`: if not authed, only accept `login` → run `getOrCreateAccount`; reject if that
  username is already online (track a `Set<string>` of online usernames) → `loginError`. On
  success: set `ws.data.username`, `game.addPlayer(username, state)`, send `welcome` with
  restored pos, subscribe to "world". If authed, handle `moveTo` as today.
- `close`: if authed, `savePlayerState(...)` from the live `Game` position, remove from online
  set, `game.removePlayer`.
- Periodic save: in the tick loop (throttled, e.g. every ~5 s) persist all online players.
- `Game.addPlayer(id, state?)` accepts an optional `{x,y,facing}` to restore (defaults to
  spawn). Add `Game.getPlayerState(id)` so the server can read live pos for saving.
- `startServer(port, dbPath?)`; `index.ts` passes `DB_PATH` env (default e.g. `./data/termenor.db`).

### 3.4 Client (`packages/client/src/connection.ts`, `index.ts`)
- On connect, prompt for username/password (env `TERMENOR_USER`/`TERMENOR_PASS` for the
  demo/tests, else a minimal stdin prompt before the TUI starts) and send `login`.
- Handle `loginError` (print + exit). On `welcome`, seed local position from restored x/y.

### 3.5 Docker
- `docker-compose.yml`: add `volumes: [ termenor-data:/app/data ]` and a top-level
  `volumes: { termenor-data: }`; set `DB_PATH=/app/data/termenor.db`.
- `Dockerfile`: ensure `/app/data` exists (the volume mount covers it at runtime).

## 4. Error handling
- Malformed/oversized login → `loginError` (no crash); never echo password back.
- DB open failure → fail fast on server start (loud), not per-connection.
- moveTo before login → ignored.
- Reconnect while still "online" (stale socket) → reject duplicate; player must wait for the
  old socket's `close` (acceptable for this slice).

## 5. Testing
- **Unit:** `db.ts` against `:memory:` — create/verify/reject password, save+restore position,
  new account defaults to spawn, hash ≠ plaintext.
- **Integration:** spin up `startServer(0, ":memory:")`, drive a ws client through
  login→move→close→reconnect, assert restored position and `loginError` on bad password +
  duplicate login.
- **Gate:** full `bun test` + `bun run typecheck` clean.

## 6. Sequencing (for `/plan`)
1. Protocol login/welcome/loginError messages.  2. `db.ts` + unit tests.  3. `Game.addPlayer`
restore + `getPlayerState`.  4. Server login handshake + online-set + periodic/disconnect save.
5. Client login (env creds + prompt) + welcome restore.  6. Docker volume + DB_PATH.
7. Integration test (reconnect restore, bad password, duplicate login).  8. Review.

**Risk:** the client stdin login prompt interacting with the OpenTUI raw-mode terminal —
prefer env-var creds for automated tests/demo and keep the interactive prompt minimal
(read before `createCliRenderer`).

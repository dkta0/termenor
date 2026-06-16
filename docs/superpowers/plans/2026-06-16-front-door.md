# Front Door Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A newcomer clones the repo, runs one script, registers/logs in via an in-TUI screen, and spawns into the public shared world — without reading any code.

**Architecture:** `mode: "login" | "register"` is added as an **optional** field on the existing `LoginMsg` (absent = legacy get-or-create, so every current test and the env-var PTY path stay green). The server splits into explicit register/login paths with distinct errors. The client gains a `Connection.authenticate()` that resolves success/failure per attempt and only auto-reconnects after a successful welcome. A self-contained login renderable runs *before* the existing game renderer (which is left untouched) and drives `authenticate()`, showing inline errors and allowing retry. A `./play` script + honest README + VPS deploy complete the front door.

**Tech Stack:** Bun, TypeScript, `bun:sqlite`, `Bun.password`, `@opentui/core` 0.4, `bun:test`, Python PTY smoke tests, Docker compose.

**Branch:** `feat/front-door` (already created; spec committed).

---

## File Structure

- `packages/protocol/src/index.ts` — *modify*: add optional `mode` to `LoginMsg`.
- `packages/protocol/src/index.test.ts` — *modify*: assert `mode` round-trips.
- `packages/server/src/db.ts` — *modify*: `getOrCreateAccount` gains optional `mode`.
- `packages/server/src/db.test.ts` — *modify*: register/login branch coverage.
- `packages/server/src/server.ts` — *modify*: read + validate + forward `msg.mode`.
- `packages/server/src/server.test.ts` — *modify*: wire-level register/login errors.
- `packages/client/src/connection.ts` — *modify*: `authenticate()`, reconnect gating, conditional `mode` in login frame.
- `packages/client/src/connection.test.ts` — *modify*: authenticate + reconnect-gating tests.
- `packages/client/src/render/login-form.ts` — *create*: pure form state machine.
- `packages/client/src/render/login-form.test.ts` — *create*: form state machine tests.
- `packages/client/src/render/login.ts` — *create*: OpenTUI login screen wrapper.
- `packages/client/src/index.ts` — *modify*: flow inversion (env fast-path → else login screen → game renderer).
- `scripts/pty-login-check.py` — *create*: PTY smoke for login → world.
- `scripts/play.sh` + `play` symlink — *create*: one-command launcher.
- `package.json`, `justfile` — *modify*: add `verify:login` / `login` and fold into `check`.
- `README.md` — *modify*: honest rewrite, "just play" first.
- Deploy: `docker-compose.yml` (verify), VPS (operational).

---

## Task 1: Protocol — optional `mode` on LoginMsg

**Files:**
- Modify: `packages/protocol/src/index.ts:35`
- Test: `packages/protocol/src/index.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/protocol/src/index.test.ts`:

```ts
test("decodeClient accepts a login message carrying an explicit mode", () => {
  const wire = encode({ t: "login", mode: "register", username: "alice", password: "pw" });
  const msg = decodeClient(wire);
  expect(msg.t).toBe("login");
  if (msg.t !== "login") return;
  expect(msg.mode).toBe("register");
  expect(msg.username).toBe("alice");
});

test("decodeClient still accepts a login message with no mode (legacy)", () => {
  const msg = decodeClient(encode({ t: "login", username: "bob", password: "pw" }));
  expect(msg.t).toBe("login");
  if (msg.t !== "login") return;
  expect(msg.mode).toBeUndefined();
});
```

(Use the existing import line at the top of the test file; it already imports `encode` and `decodeClient`. If `decodeClient` is not yet imported there, add it.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/protocol/src/index.test.ts`
Expected: FAIL — TypeScript error "Object literal may only specify known properties" on `mode` (the field doesn't exist yet).

- [ ] **Step 3: Add the field**

In `packages/protocol/src/index.ts`, change line 35 from:

```ts
export interface LoginMsg { t: "login"; username: string; password: string; }
```

to:

```ts
export interface LoginMsg { t: "login"; mode?: "login" | "register"; username: string; password: string; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/protocol/src/index.test.ts`
Expected: PASS (all tests, including the two new ones).

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/index.ts packages/protocol/src/index.test.ts
git commit -m "feat(protocol): add optional mode to LoginMsg for register/login"
```

---

## Task 2: db.ts — explicit register/login paths

**Files:**
- Modify: `packages/server/src/db.ts:46` (the `getOrCreateAccount` signature + body)
- Test: `packages/server/src/db.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/server/src/db.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/server/src/db.test.ts`
Expected: FAIL — `getOrCreateAccount` takes 4 args, not 5 (TS arity error), and the new reasons don't exist.

- [ ] **Step 3: Implement the mode branch**

In `packages/server/src/db.ts`, change the `getOrCreateAccount` signature to accept an optional `mode`, and branch on it. Replace the existing function header and the two early sections (the `row === null` block and the `verify` block) so the full function reads:

```ts
export async function getOrCreateAccount(
  db: Database,
  username: string,
  password: string,
  spawn: { x: number; y: number; facing: Facing },
  mode?: "login" | "register",
): Promise<{ ok: true; state: PlayerStateRecord } | { ok: false; reason: string }> {
  const row = db
    .query<{ password_hash: string; x: number; y: number; facing: string; inventory: string | null; skills: string | null }, string>(
      "SELECT password_hash, x, y, facing, inventory, skills FROM accounts WHERE username = ?",
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
    return { ok: true, state: { x: spawn.x, y: spawn.y, facing: spawn.facing, inventory: emptyInventory(), skills: {} } };
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

  return {
    ok: true,
    state: {
      x: row.x, y: row.y, facing: row.facing as Facing,
      inventory: row.inventory ? (JSON.parse(row.inventory) as (ItemStack | null)[]) : emptyInventory(),
      skills,
    },
  };
}
```

Note: the legacy (no-mode) path is unchanged — missing account is created, wrong password returns `"bad password"` — so existing tests stay green.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/server/src/db.test.ts`
Expected: PASS (new + all existing db tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/db.ts packages/server/src/db.test.ts
git commit -m "feat(server/db): explicit register/login modes with distinct errors"
```

---

## Task 3: server.ts — forward and validate `mode`

**Files:**
- Modify: `packages/server/src/server.ts:54-77`
- Test: `packages/server/src/server.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/server/src/server.test.ts` (follow the existing harness pattern — copy the `connect`/`waitForMessage` setup used by the test at line 93, "wrong password returns loginError"):

```ts
test("register mode on a taken name returns loginError 'that name is taken'", async () => {
  const srv = startServer(0);
  const port = srv.port;
  const c1 = await connectClient(port);
  c1.send(JSON.stringify({ t: "login", mode: "register", username: "dup", password: "pw" }));
  await c1.waitForMessage("welcome");
  const c2 = await connectClient(port);
  const errP = c2.waitForMessage("loginError");
  c2.send(JSON.stringify({ t: "login", mode: "register", username: "dup", password: "pw" }));
  const err = await errP;
  expect(String(err.reason)).toMatch(/taken/i);
  srv.stop();
});

test("login mode on a missing account returns loginError 'no such account'", async () => {
  const srv = startServer(0);
  const c = await connectClient(srv.port);
  const errP = c.waitForMessage("loginError");
  c.send(JSON.stringify({ t: "login", mode: "login", username: "nobody", password: "pw" }));
  const err = await errP;
  expect(String(err.reason)).toMatch(/no such account/i);
  srv.stop();
});

test("login mode with wrong password returns loginError 'wrong password'", async () => {
  const srv = startServer(0);
  const c1 = await connectClient(srv.port);
  c1.send(JSON.stringify({ t: "login", mode: "register", username: "pwuser", password: "right" }));
  await c1.waitForMessage("welcome");
  c1.close();
  const c2 = await connectClient(srv.port);
  const errP = c2.waitForMessage("loginError");
  c2.send(JSON.stringify({ t: "login", mode: "login", username: "pwuser", password: "wrong" }));
  const err = await errP;
  expect(String(err.reason)).toMatch(/wrong password/i);
  srv.stop();
});
```

> Implementer note: reuse whatever helper the existing tests use to open a client and await a typed message. Inspect lines 78–135 of `server.test.ts` and mirror that exact helper (named `connectClient`/`waitForMessage` above as placeholders for the real helpers). Use `startServer(0)` if the existing tests do (ephemeral port); otherwise match their port convention.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/server/src/server.test.ts`
Expected: FAIL — server ignores `mode`, so register-on-taken currently succeeds (get-or-create verifies the password and sends `welcome`) and login-on-missing creates the account instead of erroring.

- [ ] **Step 3: Forward `mode` in the auth handler**

In `packages/server/src/server.ts`, in the unauthenticated branch (around lines 54–77):

Change the destructure (line 54) from:

```ts
          const { username, password } = msg;
```

to:

```ts
          const { username, password, mode } = msg;
```

Then change the `getOrCreateAccount` call (line 76) from:

```ts
          const result = await getOrCreateAccount(db, username, password, spawn);
```

to:

```ts
          const result = await getOrCreateAccount(db, username, password, spawn, mode);
```

No other changes — the existing reservation, `online` checks, and `welcome` emission are untouched. (No new validation needed: `mode` is an optional union the protocol type already constrains; an unexpected string simply falls through to legacy behavior, which is safe.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/server/src/server.test.ts`
Expected: PASS (new + all existing server tests, including the legacy no-mode login tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/server.ts packages/server/src/server.test.ts
git commit -m "feat(server): forward login mode to account resolution"
```

---

## Task 4: Connection — `authenticate()` + reconnect gating

**Files:**
- Modify: `packages/client/src/connection.ts`
- Test: `packages/client/src/connection.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/client/src/connection.test.ts`:

```ts
test("authenticate resolves ok when welcome arrives, and sends mode", async () => {
  const sock = new MockSocket();
  const conn = new Connection("ws://x", new GameState(), { socketFactory: () => sock, now: () => 0 });
  const p = conn.authenticate("register", "newbie", "pw");
  sock.fireOpen();
  expect(sock.lastDecoded()).toEqual({ t: "login", mode: "register", username: "newbie", password: "pw" });
  sock.fireMessage(encode({
    t: "welcome", playerId: "newbie", tickRate: 15, x: 0, y: 0, facing: "south",
    map: { width: 2, height: 1, tiles: [0, 0], heights: [0, 0] },
  }));
  await expect(p).resolves.toEqual({ ok: true });
});

test("authenticate resolves with the error reason on loginError and does NOT reconnect", async () => {
  const sockets: MockSocket[] = [];
  const conn = new Connection("ws://x", new GameState(), {
    socketFactory: () => { const s = new MockSocket(); sockets.push(s); return s; },
    now: () => 0, reconnectDelayMs: 0,
  });
  const p = conn.authenticate("login", "ghost", "pw");
  sockets[0].fireOpen();
  sockets[0].fireMessage(encode({ t: "loginError", reason: "no such account" }));
  await expect(p).resolves.toEqual({ ok: false, reason: "no such account" });
  sockets[0].close(); // server-side close after the error
  expect(sockets).toHaveLength(1); // suppressed: no auto-reconnect on auth failure
});

test("legacy connect() still sends a login frame without a mode key", () => {
  const { sock } = setup({ username: "alice", password: "s3cr3t" });
  sock.fireOpen();
  expect(sock.lastDecoded()).toEqual({ t: "login", username: "alice", password: "s3cr3t" });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/client/src/connection.test.ts`
Expected: FAIL — `conn.authenticate` is not a function; `Connection` currently requires `username`/`password` in opts.

- [ ] **Step 3: Implement authenticate + gating**

In `packages/client/src/connection.ts`:

(a) Make `username`/`password` optional in `ConnectionOpts`:

```ts
export interface ConnectionOpts {
  socketFactory?: SocketFactory;
  now?: () => number;
  reconnectDelayMs?: number;
  username?: string;
  password?: string;
  onLoginError?: (reason: string) => void;
  onChatMsg?: (from: string, text: string) => void;
  onInventory?: (slots: (ItemStack | null)[]) => void;
  onSkills?: () => void;
}

export type AuthResult = { ok: true } | { ok: false; reason: string };
```

(b) Change the credential fields from `readonly` to mutable and add auth state. Replace the field declarations:

```ts
  private username: string;
  private password: string;
  private mode: "login" | "register" | undefined;
  private authenticated = false;
  private suppressReconnect = false;
  private pendingAuth: ((r: AuthResult) => void) | null = null;
```

(c) In the constructor, default the optional creds:

```ts
    this.username = opts.username ?? "";
    this.password = opts.password ?? "";
```

(d) Update `connect()` to include `mode` only when set:

```ts
  connect(): void {
    const sock = this.factory(this.url);
    this.sock = sock;
    sock.onopen = () => {
      const frame: LoginMsg = this.mode
        ? { t: "login", mode: this.mode, username: this.username, password: this.password }
        : { t: "login", username: this.username, password: this.password };
      sock.send(encode(frame));
    };
    sock.onmessage = (data) => this.handle(data);
    sock.onclose = () => {
      if (this.closedByUser || this.suppressReconnect) return;
      if (this.reconnectDelayMs <= 0) this.connect();
      else setTimeout(() => this.connect(), this.reconnectDelayMs);
    };
  }
```

Add `LoginMsg` to the protocol import at the top of the file (the `import { ... } from "@termenor/protocol"` line):

```ts
import { decodeServer, encode, PLAYER_MAX_HP, type LoginMsg, type MoveToMsg, type ChatMsg, type PickupMsg, type DropMsg, type AttackMsg, type GatherMsg, type UseMsg, type SkillsMsg } from "@termenor/protocol";
```

(e) Add the `authenticate()` method (place it just before `sendMoveTo`):

```ts
  /** Connect and attempt auth with the given mode. Resolves once the server
   *  replies with welcome (ok) or loginError (failure). On failure, the socket
   *  is not auto-reconnected, so the caller can retry with new credentials. */
  authenticate(mode: "login" | "register" | undefined, username: string, password: string): Promise<AuthResult> {
    this.mode = mode;
    this.username = username;
    this.password = password;
    this.suppressReconnect = false;
    return new Promise<AuthResult>((resolve) => {
      this.pendingAuth = resolve;
      this.connect();
    });
  }
```

(f) Update `handle()` for the `welcome` and `loginError` branches. Replace the `loginError` branch:

```ts
    if (msg.t === "loginError") {
      const pending = this.pendingAuth;
      if (pending) {
        this.suppressReconnect = true;
        this.pendingAuth = null;
        pending({ ok: false, reason: msg.reason });
      } else {
        this.onLoginError(msg.reason);
      }
    } else if (msg.t === "welcome") {
      this.authenticated = true;
      this.mode = "login"; // any later reconnect logs into the now-existing account
      const pending = this.pendingAuth;
      this.pendingAuth = null;
      pending?.({ ok: true });
      this.state.setLocalId(msg.playerId);
      this.state.setMap(msg.map);
      this.state.applySnapshot(
        { t: "snapshot", tick: 0,
          players: [{ id: msg.playerId, x: msg.x, y: msg.y, facing: msg.facing, hp: PLAYER_MAX_HP, maxHp: PLAYER_MAX_HP }],
          ground: [], npcs: [], hits: [], resources: [] },
        this.now(),
      );
    } else if (msg.t === "snapshot") {
```

(Leave the remaining `else if` branches — snapshot/chatMsg/inventory/skills — exactly as they are.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/client/src/connection.test.ts`
Expected: PASS — new tests pass, and all existing tests (including "sends login on open", "loginError triggers onLoginError callback", and "reconnects after close") stay green because the legacy `connect()` path with no `mode` and no `pendingAuth` is unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/connection.ts packages/client/src/connection.test.ts
git commit -m "feat(client/net): Connection.authenticate() with retry-safe reconnect gating"
```

---

## Task 5: LoginForm — pure form state machine

**Files:**
- Create: `packages/client/src/render/login-form.ts`
- Test: `packages/client/src/render/login-form.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/client/src/render/login-form.test.ts`:

```ts
import { test, expect } from "bun:test";
import { LoginForm } from "./login-form";

test("defaults to register mode, username focused, empty fields", () => {
  const f = new LoginForm();
  const v = f.view();
  expect(v.mode).toBe("register");
  expect(v.focus).toBe("username");
  expect(v.username).toBe("");
  expect(v.password).toBe("");
  expect(v.error).toBeNull();
});

test("toggleMode switches register <-> login", () => {
  const f = new LoginForm();
  f.toggleMode();
  expect(f.view().mode).toBe("login");
  f.toggleMode();
  expect(f.view().mode).toBe("register");
});

test("type appends to the focused field; focusNext moves to password", () => {
  const f = new LoginForm();
  f.type("a"); f.type("b");
  expect(f.view().username).toBe("ab");
  f.focusNext();
  expect(f.view().focus).toBe("password");
  f.type("x");
  expect(f.view().password).toBe("x");
  expect(f.view().username).toBe("ab");
});

test("password is masked in the view but kept raw in the payload", () => {
  const f = new LoginForm();
  f.focusNext();
  f.type("s"); f.type("e"); f.type("c");
  expect(f.view().password).toBe("•••");
  expect(f.payload().password).toBe("sec");
});

test("backspace removes the last char of the focused field", () => {
  const f = new LoginForm();
  f.type("a"); f.type("b"); f.backspace();
  expect(f.view().username).toBe("a");
  f.backspace(); f.backspace(); // underflow is safe
  expect(f.view().username).toBe("");
});

test("payload reflects current mode and raw credentials", () => {
  const f = new LoginForm();
  f.type("a"); f.type("l"); f.type("i");
  f.focusNext(); f.type("p"); f.type("w");
  f.toggleMode();
  expect(f.payload()).toEqual({ mode: "login", username: "ali", password: "pw" });
});

test("setError / clearError control the error line", () => {
  const f = new LoginForm();
  f.setError("that name is taken");
  expect(f.view().error).toBe("that name is taken");
  f.clearError();
  expect(f.view().error).toBeNull();
});

test("canSubmit requires both fields non-empty", () => {
  const f = new LoginForm();
  expect(f.canSubmit()).toBe(false);
  f.type("u");
  expect(f.canSubmit()).toBe(false);
  f.focusNext(); f.type("p");
  expect(f.canSubmit()).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/client/src/render/login-form.test.ts`
Expected: FAIL — module `./login-form` does not exist.

- [ ] **Step 3: Implement LoginForm**

Create `packages/client/src/render/login-form.ts`:

```ts
export type AuthMode = "login" | "register";
type Field = "username" | "password";

export interface LoginView {
  mode: AuthMode;
  focus: Field;
  username: string;
  password: string; // masked
  error: string | null;
}

/** Pure, render-agnostic state for the login/register screen.
 *  All terminal/OpenTUI wiring lives in login.ts; this is unit-tested in isolation. */
export class LoginForm {
  private mode: AuthMode = "register";
  private focus: Field = "username";
  private username = "";
  private password = "";
  private error: string | null = null;

  toggleMode(): void {
    this.mode = this.mode === "register" ? "login" : "register";
  }

  focusNext(): void {
    this.focus = this.focus === "username" ? "password" : "username";
  }

  type(ch: string): void {
    if (this.focus === "username") this.username += ch;
    else this.password += ch;
    this.error = null;
  }

  backspace(): void {
    if (this.focus === "username") this.username = this.username.slice(0, -1);
    else this.password = this.password.slice(0, -1);
    this.error = null;
  }

  setError(reason: string): void { this.error = reason; }
  clearError(): void { this.error = null; }

  canSubmit(): boolean {
    return this.username.length > 0 && this.password.length > 0;
  }

  payload(): { mode: AuthMode; username: string; password: string } {
    return { mode: this.mode, username: this.username, password: this.password };
  }

  view(): LoginView {
    return {
      mode: this.mode,
      focus: this.focus,
      username: this.username,
      password: "•".repeat(this.password.length),
      error: this.error,
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/client/src/render/login-form.test.ts`
Expected: PASS (all 8 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/render/login-form.ts packages/client/src/render/login-form.test.ts
git commit -m "feat(client/login): pure LoginForm state machine with masking"
```

---

## Task 6: Login screen — OpenTUI wrapper

**Files:**
- Create: `packages/client/src/render/login.ts`

> Risk: this is the OpenTUI 0.4 raw-mode input piece flagged in the spec. Prototype the keystroke capture against a real terminal (`just client` with no creds) before trusting it. The form logic is already tested (Task 5); this wrapper is exercised by the PTY smoke (Task 8), not a unit test.

- [ ] **Step 1: Implement the wrapper**

Create `packages/client/src/render/login.ts`:

```ts
import { createCliRenderer, BoxRenderable, RGBA, type CliRenderer, type KeyEvent } from "@opentui/core";
import { LoginForm } from "./login-form";
import type { AuthResult } from "../connection";

export interface LoginResult { mode: "login" | "register"; username: string; password: string; }

const WHITE = RGBA.fromInts(235, 235, 235, 255);
const DIM = RGBA.fromInts(120, 120, 120, 255);
const RED = RGBA.fromInts(230, 90, 90, 255);
const ACCENT = RGBA.fromInts(255, 210, 60, 255);

/**
 * Boots a minimal OpenTUI screen for login/register. Drives `attempt` on submit;
 * on failure it shows the reason and stays up for retry. Resolves with the
 * credentials that succeeded, after tearing the screen down. Requires a real terminal.
 */
export async function runLogin(attempt: (p: LoginResult) => Promise<AuthResult>): Promise<LoginResult> {
  const renderer: CliRenderer = await createCliRenderer({ targetFps: 30, useMouse: false });
  const form = new LoginForm();
  let busy = false;

  return new Promise<LoginResult>((resolve) => {
    const paint = () => {
      const buf = renderer.nextRenderBuffer;
      if (!buf) return;
      const v = form.view();
      buf.clear?.(RGBA.fromInts(0, 0, 0, 255));
      const cx = Math.floor(renderer.terminalWidth / 2);
      const top = Math.max(1, Math.floor(renderer.terminalHeight / 2) - 5);
      const line = (row: number, text: string, color = WHITE) =>
        buf.drawText?.(text, Math.max(0, cx - Math.floor(text.length / 2)), row, color);

      line(top, "T E R M E N O R", ACCENT);
      line(top + 1, "RuneScape in your terminal", DIM);
      const modeLabel = v.mode === "register"
        ? "( ) Log in    (•) Register   [Tab: switch field · ←/→: toggle]"
        : "(•) Log in    ( ) Register   [Tab: switch field · ←/→: toggle]";
      line(top + 3, modeLabel, DIM);
      line(top + 5, `${v.focus === "username" ? "›" : " "} Username  ${v.username || "_"}`,
        v.focus === "username" ? WHITE : DIM);
      line(top + 6, `${v.focus === "password" ? "›" : " "} Password  ${v.password || "_"}`,
        v.focus === "password" ? WHITE : DIM);
      if (v.error) line(top + 8, `⚠ ${v.error}`, RED);
      line(top + 10, busy ? "…connecting" : "Enter to play", busy ? DIM : ACCENT);
    };

    renderer.setFrameCallback(async () => { paint(); });

    renderer.keyInput.on("keypress", async (key: KeyEvent) => {
      if (busy) return;
      const name = key.name ?? "";
      if (name === "tab") { form.focusNext(); return; }
      if (name === "left" || name === "right") { form.toggleMode(); return; }
      if (name === "backspace") { form.backspace(); return; }
      if (name === "return" || name === "enter") {
        if (!form.canSubmit()) { form.setError("enter a username and password"); return; }
        busy = true;
        const p = form.payload();
        const result = await attempt(p);
        if (result.ok) { renderer.stop?.(); resolve(p); return; }
        form.setError(result.reason);
        busy = false;
        return;
      }
      // printable glyphs arrive via `sequence` (carries space, uppercase, etc.)
      const ch = key.sequence ?? "";
      if (ch.length === 1 && ch >= " ") form.type(ch);
    });
  });
}
```

> Implementer note: OpenTUI 0.4's exact draw API may differ from `buf.drawText` / `buf.clear` (see the `opentui-0.4-gotchas` memory and how `renderer.ts` writes cells via `setCell`/`textCells`). If `drawText` is not available on the buffer, render the lines using the same primitive `renderer.ts` uses (`textCells` from `./overlay` + per-cell writes), keeping the layout above. `renderer.stop?.()` — confirm the teardown method name against `RendererHandle.stop` usage; if the renderer exposes a different disposal call, use that. The contract that matters: keystrokes mutate `form`, Enter calls `attempt`, success resolves after teardown.

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS (no type errors in `login.ts`).

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/render/login.ts
git commit -m "feat(client/login): in-TUI login/register screen wrapper"
```

---

## Task 7: index.ts — flow inversion

**Files:**
- Modify: `packages/client/src/index.ts`

- [ ] **Step 1: Rewrite the entrypoint**

Replace the entire contents of `packages/client/src/index.ts` with:

```ts
import { GameState } from "./game-state";
import { ChatState } from "./chat";
import { Connection } from "./connection";
import { startRenderer } from "./render/renderer";
import { runLogin } from "./render/login";

const url = process.env.SERVER_URL ?? process.argv[2] ?? "ws://localhost:3000";

const state = new GameState();
const chatState = new ChatState();
const conn = new Connection(url, state, {
  onChatMsg: (from, text) => chatState.receive(from, text),
});

// Fast path for non-interactive use (PTY smoke tests, dev `just client`):
// env credentials skip the login screen and use legacy get-or-create (mode undefined).
const envUser = process.env.TERMENOR_USER;
const envPass = process.env.TERMENOR_PASS;
if (envUser && envPass) {
  const result = await conn.authenticate(undefined, envUser, envPass);
  if (!result.ok) {
    console.error(`Login failed: ${result.reason}`);
    process.exit(1);
  }
} else {
  // Interactive: show the in-TUI login/register screen, retrying until success.
  await runLogin((p) => conn.authenticate(p.mode, p.username, p.password));
}

const handle = await startRenderer(state, chatState, {
  onMoveTo: (x, y) => conn.sendMoveTo(x, y),
  onChat: (text) => conn.sendChat(text),
  onPickup: () => conn.sendPickup(),
  onDrop: (slot) => conn.sendDrop(slot),
  onAttack: (id) => conn.sendAttack(id),
  onGather: (id) => conn.sendGather(id),
  onUse: (action, slot) => conn.sendUse(action, slot),
});

const shutdown = () => { handle.stop(); conn.disconnect(); process.exit(0); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Verify the env-var fast path still renders**

Run: `bun run verify:render`
Expected: `PTY RENDER OK` (the existing smoke uses `TERMENOR_USER`/`TERMENOR_PASS`, so it takes the fast path and must still pass unchanged).

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/index.ts
git commit -m "feat(client): invert startup — login screen before game renderer"
```

---

## Task 8: PTY login smoke + gate

**Files:**
- Create: `scripts/pty-login-check.py`
- Modify: `package.json`, `justfile`

- [ ] **Step 1: Write the PTY login smoke**

Create `scripts/pty-login-check.py` (models the structure of `scripts/pty-render-check.py`, but spawns ONE client with NO env credentials and types a registration):

```python
#!/usr/bin/env python3
"""End-to-end login verification through a real PTY.

Spawns the server and ONE OpenTUI client with NO TERMENOR_USER/PASS, so the
client shows the in-TUI login screen. Types a username, Tab to password, a
password, then Enter to register — and verifies the world renders afterward
(half-block glyph + local player color), proving login -> play works.
"""
import os, pty, sys, time, fcntl, termios, struct, subprocess, select, signal, tempfile

PORT = 3139
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HALF_BLOCK = "▀".encode("utf-8")
LOCAL_COLOR = b"255;210;60"

def set_winsize(fd, rows, cols):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))

def spawn_client(rows, cols):
    pid, fd = pty.fork()
    if pid == 0:
        env = dict(os.environ)
        env["SERVER_URL"] = f"ws://localhost:{PORT}"
        env["TERM"] = "xterm-256color"
        env["COLORTERM"] = "truecolor"
        env.pop("TERMENOR_USER", None)   # force the interactive login screen
        env.pop("TERMENOR_PASS", None)
        os.chdir(ROOT)
        os.execvpe("bun", ["bun", "run", "packages/client/src/index.ts"], env)
        os._exit(127)
    set_winsize(fd, rows, cols)
    return pid, fd

def drain(fds, duration):
    out = {fd: bytearray() for fd in fds}
    end = time.monotonic() + duration
    while time.monotonic() < end:
        r, _, _ = select.select(fds, [], [], 0.1)
        for fd in r:
            try:
                data = os.read(fd, 65536)
                if data: out[fd].extend(data)
            except OSError:
                pass
    return out

def main():
    db_dir = tempfile.mkdtemp(prefix="termenor-login-")
    db_path = os.path.join(db_dir, "login-check.db")
    server = subprocess.Popen(
        ["bun", "run", "packages/server/src/index.ts"],
        cwd=ROOT, env={**os.environ, "PORT": str(PORT), "DB_PATH": db_path},
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    time.sleep(1.5)
    pid, fd = spawn_client(40, 100)
    time.sleep(1.0)  # login screen renders

    # Type credentials: username "ptylogin", Tab, password "secret", Enter.
    for ch in b"ptylogin":
        os.write(fd, bytes([ch])); time.sleep(0.03)
    os.write(fd, b"\t"); time.sleep(0.1)            # focus password
    for ch in b"secret":
        os.write(fd, bytes([ch])); time.sleep(0.03)
    os.write(fd, b"\r"); time.sleep(0.1)            # submit (register)

    world = drain([fd], 3.0)  # collect frames after entering the world

    try: os.kill(pid, signal.SIGTERM)
    except OSError: pass
    server.send_signal(signal.SIGTERM)
    time.sleep(0.3)
    try: server.kill()
    except Exception: pass

    out = bytes(world[fd])
    checks = {
        "client emitted output": len(out) > 0,
        "world half-block ▀ glyph present (entered game)": HALF_BLOCK in out,
        "local player color rendered": LOCAL_COLOR in out,
    }
    ok = True
    for name, passed in checks.items():
        print(f"  [{'PASS' if passed else 'FAIL'}] {name}")
        ok = ok and passed
    print("PTY LOGIN OK" if ok else "PTY LOGIN FAILED")
    sys.exit(0 if ok else 1)

if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Add the npm script and just recipe**

In `package.json`, add to `"scripts"`:

```json
    "verify:login": "python3 scripts/pty-login-check.py",
```

In `justfile`, add a recipe and fold it into `check`:

```
# real-terminal login → world smoke test (hermetic, own temp DB)
login:
    bun run verify:login

# full pre-commit gate: tests + typecheck + render + click + login
check: test typecheck render click login
```

(Replace the existing `check:` line.)

- [ ] **Step 3: Run the login smoke**

Run: `bun run verify:login`
Expected: `PTY LOGIN OK` with all three checks PASS.

> If it fails on the input step, the OpenTUI key handling in `login.ts` (Task 6) needs adjustment — the `sequence`/`name` mapping is the likely culprit. Debug against `just client` (no creds) interactively first.

- [ ] **Step 4: Run the full gate**

Run: `just check`
Expected: all tests pass, `PTY RENDER OK`, `CLICK MOVE OK`, `PTY LOGIN OK`.

- [ ] **Step 5: Commit**

```bash
git add scripts/pty-login-check.py package.json justfile
git commit -m "test(gate): add PTY login→world smoke to the pre-commit gate"
```

---

## Task 9: One-command launch script

**Files:**
- Create: `scripts/play.sh`
- Create: `play` (symlink or thin wrapper at repo root)

- [ ] **Step 1: Write the launcher**

Create `scripts/play.sh`:

```bash
#!/usr/bin/env bash
# Termenor — one-command launcher. Connects you to the public server and plays.
#   ./play                  connect to the default public server
#   ./play ws://host:3000   connect to a specific server
set -euo pipefail

# Default public server. Updated to the live host when deployed (see Task 11).
DEFAULT_SERVER_URL="ws://localhost:3000"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v bun >/dev/null 2>&1; then
  echo "Termenor needs Bun. Install it: https://bun.sh  (curl -fsSL https://bun.sh/install | bash)" >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies (first run only)…"
  bun install
fi

export SERVER_URL="${1:-${SERVER_URL:-$DEFAULT_SERVER_URL}}"
echo "Connecting to $SERVER_URL …  (use ghostty or kitty for best fidelity)"
exec bun run packages/client/src/index.ts
```

- [ ] **Step 2: Create the root entry + make executable**

Run:

```bash
chmod +x scripts/play.sh
ln -sf scripts/play.sh play
git add --chmod=+x scripts/play.sh
```

- [ ] **Step 3: Verify it launches the login screen against a local server**

In one terminal: `just server`
In another: `./play`
Expected: dependency check passes (or installs), the in-TUI login screen appears, registering a new user drops you into the world. Press Ctrl-C to exit.

- [ ] **Step 4: Commit**

```bash
git add scripts/play.sh play
git commit -m "feat: ./play one-command launcher (deps check + connect + login)"
```

---

## Task 10: README rewrite

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace the README**

Replace the contents of `README.md` with content that (a) describes the current game honestly, (b) leads with `./play`, and (c) keeps contributor/dev instructions in a clearly separate lower section. Use this structure (fill the feature list from the shipped slices in `docs/ROADMAP.md` — movement, isometric world, accounts, chat, inventory + ground items, NPCs, melee combat, and gathering skills: woodcutting/mining/fishing/cooking/firemaking):

```markdown
# Termenor

A RuneScape-inspired MMO that runs entirely in your terminal — isometric world,
real-time multiplayer movement, combat, gathering skills, inventory, NPCs, and a
shared persistent world. Built to dip into on a break.

## Play

```bash
git clone https://github.com/dkta0/termenor
cd termenor
./play
```

That's it — `./play` checks for [Bun](https://bun.sh), installs dependencies on
first run, connects you to the public server, and shows a login screen. Register a
name and you're in. Use **ghostty** or **kitty** for the best rendering.

Connect to a different server: `./play ws://host:3000`.

### Controls

- **Click a tile** to walk there (the server pathfinds around walls).
- **Arrow keys** step one tile.
- Gather, fight, and manage inventory with the on-screen hotkeys.

## What's in the world

- Smooth, server-authoritative multiplayer movement on an isometric tile map.
- Accounts with persistent state (position, inventory, skills).
- Public chat and nearby-player name labels.
- 28-slot inventory with ground items (pick up / drop).
- NPCs with wander AI, melee combat (HP, death/respawn, damage splats).
- Gathering skills with XP and levels: woodcutting, mining, fishing, cooking, firemaking.

See [`docs/ROADMAP.md`](docs/ROADMAP.md) for what's shipped and what's next.

## Develop

Requires [Bun](https://bun.sh).

```bash
bun install
just server     # run the server locally (ws://localhost:3000)
just client     # run a client against it (dev account via env)
just check      # full gate: tests + typecheck + render/click/login smoke
```

Architecture and contributor notes: see [`CONTEXT.md`](CONTEXT.md) and
[`docs/`](docs/).

## Rendering tiers

Fidelity scales with the terminal, detected at startup from OpenTUI's
capabilities: **halfblock** (truecolor/256-color) renders at sub-cell resolution
for smooth movement; **ascii** is the always-playable glyph fallback.
```

> Implementer note: keep the rendering-tiers detail only if it stays accurate; trim anything that no longer matches the code. Do not re-add the stale "no combat/skilling/inventory yet" line.

- [ ] **Step 2: Sanity check links**

Run: `grep -n "no combat\|movement first\|Movement first" README.md`
Expected: no matches (the stale framing is gone).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(readme): honest rewrite — lead with ./play, list shipped features"
```

---

## Task 11: Public deployment (operational)

**Files:**
- Verify: `Dockerfile`, `docker-compose.yml`
- Modify (after host is known): `scripts/play.sh`, `README.md`

> This task is operational, not TDD. It requires the maintainer's VPS host/SSH access — gather that before starting. Plain `ws://` per the spec; TLS/`wss://` is a deliberate follow-up if wanted. If DNS/TLS scope appears, stop and split it into its own cycle (the spec authorizes this).

- [ ] **Step 1: Confirm the compose setup persists the DB**

Read `docker-compose.yml` and `Dockerfile`. Verify: the server runs with `PORT` set, `DB_PATH` points at a path on a named/mounted volume, and the volume is declared so the SQLite file survives `docker compose down`. If `DB_PATH` is not on a persistent volume, fix the compose file so it is, and commit that fix.

- [ ] **Step 2: Build and run locally via compose (smoke)**

Run:

```bash
docker compose up --build -d
sleep 3
docker compose logs --no-color | tail -20
./play ws://localhost:3000   # register, confirm you spawn, Ctrl-C
docker compose down
```

Expected: server logs show it listening; the client connects and you can play.

- [ ] **Step 3: Deploy to the VPS**

On the VPS (host provided by maintainer), from a checkout of `feat/front-door` (or after merge, `main`):

```bash
docker compose up --build -d
docker compose ps   # confirm the server container is healthy/running
```

Confirm the port is reachable from outside (open the firewall / security group for the chosen port).

- [ ] **Step 4: Verify persistence across restart**

From a local machine:

```bash
./play ws://<vps-host>:3000   # register account "persisttest", move, Ctrl-C
```

On the VPS: `docker compose restart`. Then locally:

```bash
./play ws://<vps-host>:3000   # log in as "persisttest" — position should be restored
```

Expected: the account logs in (not "no such account") and spawns at the saved position.

- [ ] **Step 5: Flip the default URL**

Update `DEFAULT_SERVER_URL` in `scripts/play.sh` to `ws://<vps-host>:3000`, and update the README clone-and-play section if it names a host. Verify a clean `./play` (no argument) connects to the live server.

- [ ] **Step 6: Commit**

```bash
git add scripts/play.sh README.md docker-compose.yml
git commit -m "feat(deploy): point ./play at the public server; persist DB volume"
```

---

## Self-Review

**Spec coverage:**
- Goal 1 (one-command launch) → Task 9, Task 11 Step 5. ✓
- Goal 2 (in-TUI login screen, masked, retry) → Tasks 5, 6, 7. ✓
- Goal 3 (register/login distinction on the wire) → Tasks 1, 2, 3. ✓
- Goal 4 (honest README) → Task 10. ✓
- Goal 5 (public deployment) → Task 11. ✓
- Non-goal "no game renderer change" → honored: login is a separate renderable (Task 6); `renderer.ts` is never edited. ✓
- Non-goal "no anti-abuse / no TLS" → Task 11 stays `ws://`, no rate-limiting added. ✓
- Spec's "build 1–4 against local, deploy last" → task order matches (Tasks 1–10 local-testable, Task 11 deploys). ✓

**Placeholder scan:** No "TBD"/"implement later". The one parameterized value — the VPS host — is explicitly an operational input in Task 11, and `DEFAULT_SERVER_URL` ships as `ws://localhost:3000` until flipped (concrete, not a placeholder). The two "implementer notes" (OpenTUI draw API in Task 6, server.test helper names in Task 3) point at real code to mirror rather than leaving blanks.

**Type consistency:** `authenticate(mode, username, password)` and `AuthResult` defined in Task 4 are consumed identically in Tasks 6 (`login.ts`) and 7 (`index.ts`). `LoginForm.payload()` returns `{mode, username, password}` matching `runLogin`'s `LoginResult` and the `authenticate` arg order. `getOrCreateAccount`'s new 5th param `mode` (Task 2) matches the call site in Task 3. `LoginMsg.mode` (Task 1) is the same union used everywhere.

# Chat + Nearby-Player Presence Implementation Plan

For agentic workers: execute tasks top-to-bottom, one at a time. Run the exact test command shown after each write step. Do not proceed to the next task until tests pass and the commit is made. Do not modify files outside the listed paths for each task.

**Goal:** Players see each other's usernames floating above their billboards and can send public chat messages. Server sanitizes and broadcasts chat to all connected players. Movement is disabled while the chat input box is active.

**Architecture:**
- `packages/protocol` — add `ChatMsg` (client→server) and `ChatBroadcastMsg` (server→client); export `MAX_CHAT_LEN=200`
- `packages/server/src/server.ts` — pure `sanitizeChat` helper; handle `chat` in the authed branch; publish `chatMsg`
- `packages/client/src/chat.ts` (new) — pure `ChatState` class: ring buffer + input state, no I/O
- `packages/client/src/render/overlay.ts` (new) — pure helper: place a text string into cell-grid bounds, return clipped `{col,row,char}[]`
- `packages/client/src/connection.ts` — add `sendChat`; dispatch incoming `chatMsg` via callback
- `packages/client/src/render/renderer.ts` — chat input mode in keypress handler; name labels + chat log overlays after `blit`; add `onChat` to `RendererHooks`
- `packages/client/src/index.ts` — construct `ChatState`, wire `onChat` + `onChatMsg`

**Tech Stack:** Bun (runtime + test runner), TypeScript, OpenTUI (`@opentui/core` — `buffer.setCell`, `RGBA.fromInts`, `KeyEvent`)

---

## File Structure

| Status   | Path                                              | Purpose                                              |
|----------|---------------------------------------------------|------------------------------------------------------|
| modified | `packages/protocol/src/index.ts`                  | Add `ChatMsg`, `ChatBroadcastMsg`, `MAX_CHAT_LEN`    |
| modified | `packages/protocol/src/index.test.ts`             | Round-trip tests for new message types               |
| modified | `packages/server/src/server.ts`                   | `sanitizeChat` helper + `chat` message handler       |
| created  | `packages/server/src/sanitize.test.ts`            | Unit tests for `sanitizeChat`                        |
| modified | `packages/server/src/server.test.ts`              | Integration tests for chat broadcast                 |
| created  | `packages/client/src/chat.ts`                     | Pure `ChatState` class                               |
| created  | `packages/client/src/chat.test.ts`                | Unit tests for `ChatState`                           |
| created  | `packages/client/src/render/overlay.ts`           | Pure text-placement helper                           |
| created  | `packages/client/src/render/overlay.test.ts`      | Unit tests for `overlay`                             |
| modified | `packages/client/src/connection.ts`               | `sendChat`; `onChatMsg` callback in `ConnectionOpts` |
| modified | `packages/client/src/connection.test.ts`          | Tests for `sendChat` and `chatMsg` dispatch          |
| modified | `packages/client/src/render/renderer.ts`          | Chat input mode; name/chat/input overlays            |
| modified | `packages/client/src/index.ts`                    | Construct `ChatState`; wire hooks                    |

---

## Task 1 — Protocol: ChatMsg, ChatBroadcastMsg, MAX_CHAT_LEN

**Files:** `packages/protocol/src/index.ts`, `packages/protocol/src/index.test.ts`

### Steps

**1a. Write failing tests.**

Add to `packages/protocol/src/index.test.ts`:

```typescript
import { MAX_CHAT_LEN } from "./index";

test("chat client message round-trips", () => {
  const msg: ClientMsg = { t: "chat", text: "hello world" };
  expect(decodeClient(encode(msg))).toEqual(msg);
});

test("chatMsg server message round-trips", () => {
  const msg: ServerMsg = { t: "chatMsg", from: "alice", text: "hi" };
  expect(decodeServer(encode(msg))).toEqual(msg);
});

test("MAX_CHAT_LEN is 200", () => {
  expect(MAX_CHAT_LEN).toBe(200);
});

test("decodeClient rejects unknown type 'shout'", () => {
  expect(() => decodeClient(JSON.stringify({ t: "shout" }))).toThrow();
});
```

**Run (expect FAIL):**
```
bun test packages/protocol/src/index.test.ts
```

**1b. Implement.**

In `packages/protocol/src/index.ts`, make the following changes (exact text shown; keep all existing code):

1. Add after the `MoveToMsg` line:
```typescript
export interface ChatMsg { t: "chat"; text: string; }
```

2. Update the `ClientMsg` union:
```typescript
export type ClientMsg = LoginMsg | MoveToMsg | ChatMsg;
```

3. Add after `LoginErrorMsg`:
```typescript
export interface ChatBroadcastMsg { t: "chatMsg"; from: string; text: string; }
```

4. Update the `ServerMsg` union:
```typescript
export type ServerMsg = WelcomeMsg | SnapshotMsg | LoginErrorMsg | ChatBroadcastMsg;
```

5. Add after the `CLIENT_TYPES` Set declaration:
```typescript
export const MAX_CHAT_LEN = 200;
```

6. Update `CLIENT_TYPES` to include `"chat"`:
```typescript
const CLIENT_TYPES = new Set(["login", "moveTo", "chat"]);
```

7. Update `SERVER_TYPES` to include `"chatMsg"`:
```typescript
const SERVER_TYPES = new Set(["welcome", "snapshot", "loginError", "chatMsg"]);
```

**Run (expect PASS):**
```
bun test packages/protocol/src/index.test.ts
```

**1c. Commit:**
```
git add packages/protocol/src/index.ts packages/protocol/src/index.test.ts
git commit -m "feat(protocol): add ChatMsg, ChatBroadcastMsg, MAX_CHAT_LEN"
```

---

## Task 2 — Server: sanitizeChat helper + chat broadcast

**Files:** `packages/server/src/server.ts`, `packages/server/src/sanitize.test.ts`, `packages/server/src/server.test.ts`

### Steps

**2a. Write failing unit tests for `sanitizeChat`.**

Create `packages/server/src/sanitize.test.ts`:

```typescript
import { test, expect } from "bun:test";
import { sanitizeChat } from "./server";

test("sanitizeChat trims surrounding whitespace", () => {
  expect(sanitizeChat("  hello  ")).toBe("hello");
});

test("sanitizeChat truncates to MAX_CHAT_LEN characters", () => {
  const long = "a".repeat(300);
  expect(sanitizeChat(long).length).toBe(200);
});

test("sanitizeChat returns empty string for whitespace-only input", () => {
  expect(sanitizeChat("   ")).toBe("");
  expect(sanitizeChat("")).toBe("");
});

test("sanitizeChat leaves short clean text unchanged", () => {
  expect(sanitizeChat("hi there")).toBe("hi there");
});

test("sanitizeChat truncates after trimming (trim first, then slice)", () => {
  // 198 a's + 2 spaces on each side → trim → 198 chars → under limit
  const padded = "  " + "a".repeat(198) + "  ";
  expect(sanitizeChat(padded)).toBe("a".repeat(198));
});
```

**Run (expect FAIL — `sanitizeChat` not yet exported):**
```
bun test packages/server/src/sanitize.test.ts
```

**2b. Write failing integration tests for chat broadcast.**

Add to `packages/server/src/server.test.ts` (after the last existing test):

```typescript
test("authenticated player's chat is broadcast as chatMsg to all subscribers", async () => {
  srv = startServer(0, ":memory:");

  const alice = wsClient(srv.port);
  const bob = wsClient(srv.port);
  await alice.waitForOpen();
  await bob.waitForOpen();

  alice.send(JSON.stringify({ t: "login", username: "alice", password: "pw" }));
  await alice.waitForMessage("welcome");

  bob.send(JSON.stringify({ t: "login", username: "bob", password: "pw" }));
  await bob.waitForMessage("welcome");

  const aliceChatP = alice.waitForMessage("chatMsg");
  const bobChatP = bob.waitForMessage("chatMsg");

  alice.send(JSON.stringify({ t: "chat", text: "hello bob" }));

  const aliceMsg = await aliceChatP;
  const bobMsg = await bobChatP;

  expect(aliceMsg).toMatchObject({ t: "chatMsg", from: "alice", text: "hello bob" });
  expect(bobMsg).toMatchObject({ t: "chatMsg", from: "alice", text: "hello bob" });

  alice.close();
  bob.close();
});

test("empty chat (whitespace-only) is dropped — no chatMsg broadcast", async () => {
  srv = startServer(0, ":memory:");
  const alice = wsClient(srv.port);
  await alice.waitForOpen();
  alice.send(JSON.stringify({ t: "login", username: "alice", password: "pw" }));
  await alice.waitForMessage("welcome");

  alice.send(JSON.stringify({ t: "chat", text: "   " }));
  await sleep(200);

  const chatMsgs = alice.messages.filter((m) => m.includes('"chatMsg"'));
  expect(chatMsgs).toHaveLength(0);
  alice.close();
});

test("over-long chat text is truncated to MAX_CHAT_LEN", async () => {
  srv = startServer(0, ":memory:");
  const alice = wsClient(srv.port);
  await alice.waitForOpen();
  alice.send(JSON.stringify({ t: "login", username: "alice", password: "pw" }));
  await alice.waitForMessage("welcome");

  const chatP = alice.waitForMessage("chatMsg");
  alice.send(JSON.stringify({ t: "chat", text: "x".repeat(500) }));
  const msg = await chatP;
  expect(String(msg.text).length).toBe(200);
  alice.close();
});

test("unauthenticated chat is silently ignored", async () => {
  srv = startServer(0, ":memory:");
  const client = wsClient(srv.port);
  await client.waitForOpen();

  client.send(JSON.stringify({ t: "chat", text: "sneaky" }));
  await sleep(150);

  expect(client.messages).toHaveLength(0);
  client.close();
});
```

**Run (expect FAIL):**
```
bun test packages/server/src/server.test.ts
```

**2c. Implement.**

In `packages/server/src/server.ts`:

1. Update the import to include `MAX_CHAT_LEN`:
```typescript
import { decodeClient, encode, MAX_CHAT_LEN } from "@termenor/protocol";
```

2. Add the exported `sanitizeChat` helper immediately after the imports (before `const TICK_RATE`):
```typescript
/** Trim whitespace then truncate to MAX_CHAT_LEN. Returns "" for blank input. */
export function sanitizeChat(text: string): string {
  return text.trim().slice(0, MAX_CHAT_LEN);
}
```

3. In the `// authenticated — handle game messages` section (currently line 90), replace:
```typescript
        // authenticated — handle game messages
        if (msg.t === "moveTo") game.queueMove(ws.data.username, msg.x, msg.y);
```
with:
```typescript
        // authenticated — handle game messages
        if (msg.t === "moveTo") {
          game.queueMove(ws.data.username, msg.x, msg.y);
        } else if (msg.t === "chat") {
          const text = sanitizeChat(msg.text);
          if (text) server.publish("world", encode({ t: "chatMsg", from: ws.data.username, text }));
        }
```

**Run (expect PASS):**
```
bun test packages/server/src/sanitize.test.ts packages/server/src/server.test.ts
```

**2d. Commit:**
```
git add packages/server/src/server.ts packages/server/src/sanitize.test.ts packages/server/src/server.test.ts
git commit -m "feat(server): sanitizeChat helper + chat broadcast"
```

---

## Task 3 — Client: pure ChatState class

**Files:** `packages/client/src/chat.ts`, `packages/client/src/chat.test.ts`

### Steps

**3a. Write failing tests.**

Create `packages/client/src/chat.test.ts`:

```typescript
import { test, expect } from "bun:test";
import { ChatState } from "./chat";

test("initially inactive with empty input and no messages", () => {
  const c = new ChatState();
  expect(c.active).toBe(false);
  expect(c.input).toBe("");
  expect(c.recent(10)).toEqual([]);
});

test("open() sets active=true and clears input", () => {
  const c = new ChatState();
  c.open();
  expect(c.active).toBe(true);
  expect(c.input).toBe("");
});

test("cancel() sets active=false and clears input", () => {
  const c = new ChatState();
  c.open();
  c.type("h");
  c.cancel();
  expect(c.active).toBe(false);
  expect(c.input).toBe("");
});

test("type() appends a printable char while active", () => {
  const c = new ChatState();
  c.open();
  c.type("h");
  c.type("i");
  expect(c.input).toBe("hi");
});

test("type() ignores multi-char strings", () => {
  const c = new ChatState();
  c.open();
  c.type("hello"); // multi-char — ignored
  expect(c.input).toBe("");
});

test("type() ignores control characters (char code < 32)", () => {
  const c = new ChatState();
  c.open();
  c.type("\x00");
  c.type("\t");
  c.type("\n");
  expect(c.input).toBe("");
});

test("type() ignores DEL (char code 127)", () => {
  const c = new ChatState();
  c.open();
  c.type("\x7f");
  expect(c.input).toBe("");
});

test("backspace() removes last char while active", () => {
  const c = new ChatState();
  c.open();
  c.type("h");
  c.type("i");
  c.backspace();
  expect(c.input).toBe("h");
});

test("backspace() on empty input is a no-op", () => {
  const c = new ChatState();
  c.open();
  c.backspace();
  expect(c.input).toBe("");
});

test("submit() returns trimmed text, clears input, sets active=false", () => {
  const c = new ChatState();
  c.open();
  "hello".split("").forEach((ch) => c.type(ch));
  const result = c.submit();
  expect(result).toBe("hello");
  expect(c.active).toBe(false);
  expect(c.input).toBe("");
});

test("submit() returns null for empty/whitespace-only input", () => {
  const c = new ChatState();
  c.open();
  expect(c.submit()).toBeNull();
});

test("receive() stores messages accessible via recent()", () => {
  const c = new ChatState();
  c.receive("alice", "hi");
  c.receive("bob", "hey");
  expect(c.recent(10)).toEqual([
    { from: "alice", text: "hi" },
    { from: "bob", text: "hey" },
  ]);
});

test("recent(n) returns last n messages", () => {
  const c = new ChatState();
  for (let i = 0; i < 10; i++) c.receive("x", String(i));
  const last3 = c.recent(3);
  expect(last3).toEqual([{ from: "x", text: "7" }, { from: "x", text: "8" }, { from: "x", text: "9" }]);
});

test("receive() caps buffer at 50 messages", () => {
  const c = new ChatState();
  for (let i = 0; i < 60; i++) c.receive("x", String(i));
  expect(c.recent(100).length).toBe(50);
  // oldest retained is message index 10 ("10")
  expect(c.recent(100)[0].text).toBe("10");
});

test("type/backspace/submit are no-ops when not active", () => {
  const c = new ChatState();
  c.type("x"); // not active — ignored
  expect(c.input).toBe("");
  c.backspace(); // no-op
  expect(c.submit()).toBeNull(); // inactive submit returns null
});
```

**Run (expect FAIL — `chat.ts` not yet created):**
```
bun test packages/client/src/chat.test.ts
```

**3b. Implement.**

Create `packages/client/src/chat.ts`:

```typescript
export interface ChatMessage { from: string; text: string; }

const CAP = 50;

export class ChatState {
  private messages: ChatMessage[] = [];
  input = "";
  active = false;

  open(): void {
    this.active = true;
    this.input = "";
  }

  cancel(): void {
    this.active = false;
    this.input = "";
  }

  /** Append a single printable character. Ignores multi-char strings and control codes. */
  type(ch: string): void {
    if (!this.active) return;
    if (ch.length !== 1) return;
    const code = ch.charCodeAt(0);
    if (code < 32 || code === 127) return;
    this.input += ch;
  }

  backspace(): void {
    if (!this.active) return;
    this.input = this.input.slice(0, -1);
  }

  /** Returns trimmed input text to send, or null if blank. Clears and deactivates. */
  submit(): string | null {
    if (!this.active) return null;
    const text = this.input.trim();
    this.active = false;
    this.input = "";
    return text.length > 0 ? text : null;
  }

  receive(from: string, text: string): void {
    this.messages.push({ from, text });
    if (this.messages.length > CAP) this.messages.shift();
  }

  /** Last n messages, oldest-first. */
  recent(n: number): ChatMessage[] {
    return this.messages.slice(-n);
  }
}
```

**Run (expect PASS):**
```
bun test packages/client/src/chat.test.ts
```

**3c. Commit:**
```
git add packages/client/src/chat.ts packages/client/src/chat.test.ts
git commit -m "feat(client): pure ChatState class (ring buffer + input state)"
```

---

## Task 4 — Client: overlay.ts text placement helper

**Files:** `packages/client/src/render/overlay.ts`, `packages/client/src/render/overlay.test.ts`

### Steps

**4a. Write failing tests.**

Create `packages/client/src/render/overlay.test.ts`:

```typescript
import { test, expect } from "bun:test";
import { textCells } from "./overlay";

test("places a string starting at (col, row) within bounds", () => {
  const cells = textCells("hi", 2, 1, 10, 5);
  expect(cells).toEqual([
    { col: 2, row: 1, char: "h" },
    { col: 3, row: 1, char: "i" },
  ]);
});

test("clips characters that fall outside grid width", () => {
  const cells = textCells("hello", 8, 0, 10, 5);
  // cols 8 and 9 are in-bounds; col 10+ are clipped
  expect(cells).toHaveLength(2);
  expect(cells[0]).toEqual({ col: 8, row: 0, char: "h" });
  expect(cells[1]).toEqual({ col: 9, row: 0, char: "e" });
});

test("clips entirely when col is >= cols", () => {
  const cells = textCells("hello", 10, 0, 10, 5);
  expect(cells).toHaveLength(0);
});

test("clips entirely when row is out of bounds", () => {
  const cells = textCells("hi", 0, 5, 10, 5);
  expect(cells).toHaveLength(0);
});

test("clips entirely when col is negative", () => {
  const cells = textCells("hi", -5, 0, 10, 5);
  // col -5 and col -4 both < 0 — neither placed
  expect(cells).toHaveLength(0);
});

test("partial clip when string starts before col 0", () => {
  // start at col -1; "ab" → 'a' at -1 (clipped), 'b' at 0 (in-bounds)
  const cells = textCells("ab", -1, 0, 10, 5);
  expect(cells).toEqual([{ col: 0, row: 0, char: "b" }]);
});

test("empty string produces no cells", () => {
  expect(textCells("", 0, 0, 10, 5)).toEqual([]);
});
```

**Run (expect FAIL — `overlay.ts` not yet created):**
```
bun test packages/client/src/render/overlay.test.ts
```

**4b. Implement.**

Create `packages/client/src/render/overlay.ts`:

```typescript
export interface OverlayCell { col: number; row: number; char: string; }

/**
 * Convert a text string into a list of cells to write, clipped to the grid bounds.
 * `col` and `row` are the top-left origin of the text in cell coordinates.
 * `cols` and `rows` are the grid dimensions.
 */
export function textCells(
  text: string,
  col: number,
  row: number,
  cols: number,
  rows: number,
): OverlayCell[] {
  if (row < 0 || row >= rows) return [];
  const out: OverlayCell[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = col + i;
    if (c < 0) continue;
    if (c >= cols) break;
    out.push({ col: c, row, char: text[i] });
  }
  return out;
}
```

**Run (expect PASS):**
```
bun test packages/client/src/render/overlay.test.ts
```

**4c. Commit:**
```
git add packages/client/src/render/overlay.ts packages/client/src/render/overlay.test.ts
git commit -m "feat(client): overlay.ts pure text-cell placement helper"
```

---

## Task 5 — Connection: sendChat + chatMsg dispatch

**Files:** `packages/client/src/connection.ts`, `packages/client/src/connection.test.ts`

### Steps

**5a. Write failing tests.**

Add to `packages/client/src/connection.test.ts`:

```typescript
test("sendChat serializes a chat message", () => {
  const { sock, conn } = setup();
  sock.fireOpen();
  conn.sendChat("hello world");
  expect(sock.lastDecoded()).toEqual({ t: "chat", text: "hello world" });
});

test("incoming chatMsg invokes onChatMsg callback", () => {
  const received: Array<{ from: string; text: string }> = [];
  const sock = new MockSocket();
  const factory: SocketFactory = () => sock;
  const gs = new GameState();
  const conn = new Connection("ws://x", gs, {
    socketFactory: factory,
    now: () => 1000,
    username: "alice",
    password: "pw",
    onChatMsg: (from, text) => received.push({ from, text }),
  });
  conn.connect();
  sock.fireOpen();
  sock.fireMessage(encode({ t: "chatMsg", from: "bob", text: "hi alice" }));
  expect(received).toEqual([{ from: "bob", text: "hi alice" }]);
});
```

**Run (expect FAIL):**
```
bun test packages/client/src/connection.test.ts
```

**5b. Implement.**

In `packages/client/src/connection.ts`:

1. Update the import to include `ChatMsg` and `ChatBroadcastMsg`:
```typescript
import { decodeServer, encode, type MoveToMsg, type ChatMsg } from "@termenor/protocol";
```

2. Add `onChatMsg` to `ConnectionOpts`:
```typescript
export interface ConnectionOpts {
  socketFactory?: SocketFactory;
  now?: () => number;
  reconnectDelayMs?: number;
  username: string;
  password: string;
  onLoginError?: (reason: string) => void;
  onChatMsg?: (from: string, text: string) => void;
}
```

3. Add `onChatMsg` private field and constructor wiring. In the `Connection` class, add the field after `onLoginError`:
```typescript
  private readonly onChatMsg: (from: string, text: string) => void;
```

4. In the `constructor`, add after the `onLoginError` assignment:
```typescript
    this.onChatMsg = opts.onChatMsg ?? (() => {});
```

5. Add `sendChat` method after `sendMoveTo`:
```typescript
  sendChat(text: string): void {
    const msg: ChatMsg = { t: "chat", text };
    this.sock?.send(encode(msg));
  }
```

6. In the `handle` method, add a `chatMsg` branch after the `snapshot` branch:
```typescript
    } else if (msg.t === "chatMsg") {
      this.onChatMsg(msg.from, msg.text);
    }
```

**Run (expect PASS):**
```
bun test packages/client/src/connection.test.ts
```

**5c. Commit:**
```
git add packages/client/src/connection.ts packages/client/src/connection.test.ts
git commit -m "feat(client/connection): sendChat + chatMsg dispatch callback"
```

---

## Task 6 — Renderer: chat input mode + name/chat overlays

**Files:** `packages/client/src/render/renderer.ts`

### Steps

**6a. No automated unit test for renderer** (requires real terminal). Proceed directly to implementation.

In `packages/client/src/render/renderer.ts`:

**6b. Update imports** — add `ChatState` and `textCells`:

```typescript
import type { ChatState } from "../chat";
import { textCells } from "./overlay";
```

**6c. Add `onChat` to `RendererHooks`:**

Replace:
```typescript
export interface RendererHooks {
  /** Called with a destination tile when the player clicks / presses an arrow. */
  onMoveTo(x: number, y: number): void;
}
```
with:
```typescript
export interface RendererHooks {
  /** Called with a destination tile when the player clicks / presses an arrow. */
  onMoveTo(x: number, y: number): void;
  /** Called with trimmed chat text when the user submits a chat message. */
  onChat(text: string): void;
}
```

**6d. Add `chat: ChatState` parameter to `startRenderer`:**

Replace the function signature:
```typescript
export async function startRenderer(state: GameState, hooks: RendererHooks): Promise<RendererHandle> {
```
with:
```typescript
export async function startRenderer(state: GameState, chat: ChatState, hooks: RendererHooks): Promise<RendererHandle> {
```

**6e. Update the frame callback** to draw overlays after `blit`. Replace the `renderer.setFrameCallback` block:

```typescript
  renderer.setFrameCallback(async () => {
    const buffer = renderer.nextRenderBuffer;
    const map = state.map;
    if (!buffer || !map) return;

    const cols = renderer.terminalWidth;
    const rows = renderer.terminalHeight;
    const pxW = cols;
    const pxH = tier === "halfblock" ? rows * 2 : rows;

    const players = state.samplePositions(performance.now());
    const me = players.find((p) => p.id === state.localId);
    const center = me ? tileToScreen(me.x, me.y, me.h) : tileToScreen(map.width / 2, map.height / 2, 0);
    const cam = isoCamera(center.sx, center.sy, pxW, pxH);

    const frame = rasterizeIso(map, players, cam.ox, cam.oy, pxW, pxH, state.localId);
    lastFrame = frame;
    const grid = cellGridFor(tier, frame.buf);
    blit(buffer, grid);

    // --- Overlays (drawn directly via setCell after blit) ---

    const WHITE = RGBA.fromInts(255, 255, 255, 255);
    const YELLOW = RGBA.fromInts(255, 255, 0, 255);
    const CYAN = RGBA.fromInts(0, 220, 220, 255);
    const DIM = RGBA.fromInts(180, 180, 180, 255);

    // Name labels: one cell-row above each player's billboard
    for (const p of players) {
      const { sx, sy } = tileToScreen(p.x, p.y, p.h);
      // Billboard top is ~2 px above tile center; name label one cell higher.
      // halfblock: 1 cell = 2 px. Add 4 extra px so label clears the billboard.
      const labelSy = sy - cam.oy - 6;
      const labelRow = tier === "halfblock" ? Math.round(labelSy / 2) - 1 : Math.round(labelSy) - 1;
      const labelSx = sx - cam.ox;
      const labelCol = Math.round(labelSx - p.id.length / 2);
      const color = p.id === state.localId ? YELLOW : WHITE;
      for (const cell of textCells(p.id, labelCol, labelRow, cols, rows)) {
        buffer.setCell(cell.col, cell.row, cell.char, color, BLACK);
      }
    }

    // Chat log: bottom-left, last 6 messages
    const LOG_LINES = 6;
    const recentMsgs = chat.recent(LOG_LINES);
    const logStartRow = rows - LOG_LINES - (chat.active ? 2 : 1);
    for (let i = 0; i < recentMsgs.length; i++) {
      const { from, text } = recentMsgs[i];
      const line = `${from}: ${text}`;
      const row = logStartRow + i;
      for (const cell of textCells(line, 1, row, cols, rows)) {
        buffer.setCell(cell.col, cell.row, cell.char, DIM, BLACK);
      }
    }

    // Input line: shown when chat is active
    if (chat.active) {
      const inputLine = `> ${chat.input}_`;
      for (const cell of textCells(inputLine, 1, rows - 1, cols, rows)) {
        buffer.setCell(cell.col, cell.row, cell.char, CYAN, BLACK);
      }
    }
  });
```

**6f. Update the keypress handler** to add chat input mode. Replace the current handler:

```typescript
  // arrow keys → step one tile from current rounded position
  renderer.keyInput.on("keypress", (key: KeyEvent) => {
    const d = arrowDelta(key.name);
    if (!d) return;
    const players = state.samplePositions(performance.now());
    const me = players.find((p) => p.id === state.localId);
    if (!me) return;
    hooks.onMoveTo(Math.round(me.x) + d.dx, Math.round(me.y) + d.dy);
  });
```
with:
```typescript
  renderer.keyInput.on("keypress", (key: KeyEvent) => {
    if (chat.active) {
      // Chat input mode — consume all keys; movement is gated
      if (key.name === "return" || key.name === "enter") {
        const text = chat.submit();
        if (text) hooks.onChat(text);
      } else if (key.name === "escape") {
        chat.cancel();
      } else if (key.name === "backspace") {
        chat.backspace();
      } else {
        chat.type(key.name ?? "");
      }
      return; // always return early — block arrows/mouse movement while typing
    }

    // Not in chat mode
    if (key.name === "return" || key.name === "enter") {
      chat.open();
      return;
    }

    // Arrow key movement
    const d = arrowDelta(key.name);
    if (!d) return;
    const players = state.samplePositions(performance.now());
    const me = players.find((p) => p.id === state.localId);
    if (!me) return;
    hooks.onMoveTo(Math.round(me.x) + d.dx, Math.round(me.y) + d.dy);
  });
```

**6g. Run the full test suite to check for type errors and regressions:**
```
bun test
bun run typecheck
```

All existing tests must pass. Fix any TypeScript errors (the signature change to `startRenderer` will cause a compile error in `index.ts` until Task 7).

**6h. Commit** (after Task 7 fixes the compile error — do NOT commit this task alone if typecheck fails; proceed immediately to Task 7):

*(Commit happens at end of Task 7 once typecheck is clean.)*

---

## Task 7 — index.ts wiring

**Files:** `packages/client/src/index.ts`

### Steps

**7a. Implement wiring.**

In `packages/client/src/index.ts`, make the following changes:

1. Add import for `ChatState`:
```typescript
import { ChatState } from "./chat";
```

2. Construct a `ChatState` instance after `const state = new GameState();`:
```typescript
const chatState = new ChatState();
```

3. Pass `onChatMsg` callback to `Connection` opts (add after `onLoginError` in the opts object):
```typescript
  onChatMsg: (from, text) => chatState.receive(from, text),
```

4. Pass `chatState` as the second argument to `startRenderer` and add `onChat` to hooks. Replace:
```typescript
const handle = await startRenderer(state, {
  onMoveTo: (x, y) => conn.sendMoveTo(x, y),
});
```
with:
```typescript
const handle = await startRenderer(state, chatState, {
  onMoveTo: (x, y) => conn.sendMoveTo(x, y),
  onChat: (text) => conn.sendChat(text),
});
```

**7b. Run full typecheck and test suite:**
```
bun run typecheck
bun test
```

Both must pass with zero errors.

**7c. Commit tasks 6 and 7 together:**
```
git add packages/client/src/render/renderer.ts packages/client/src/index.ts
git commit -m "feat(client): chat input mode + name/chat overlays + index wiring"
```

---

## Task 8 — Integration test: two players, chat round-trip

**Files:** `packages/server/src/server.test.ts` (tests already added in Task 2 cover this)

### Steps

**8a. Verify all tests pass end-to-end:**
```
bun test
```

All tests in all packages must be green.

**8b. Run typecheck across the whole monorepo:**
```
bun run typecheck
```

**8c. Visual smoke check** (manual, with two terminal tabs):

```
# Tab 1
TERMENOR_USER=alice TERMENOR_PASS=pw bun run packages/client/src/index.ts ws://localhost:3000

# Tab 2
TERMENOR_USER=bob TERMENOR_PASS=pw bun run packages/client/src/index.ts ws://localhost:3000
```

Verify:
- Each player sees the other's name floating above their billboard.
- Pressing Enter opens the `> _` input line; typing appears; pressing Enter sends it; both players see the message in the chat log.
- While input is active, arrow keys do not move the player.
- Pressing Esc cancels without sending.

**8d. Commit (if any test fixes were needed):**
```
git add -p
git commit -m "test(server): integration tests for chat broadcast edge cases"
```

---

## Self-Review — Spec Success Criteria

| # | Criterion | Addressed by |
|---|-----------|--------------|
| 1 | Chat protocol round-trips (`ChatMsg`, `ChatBroadcastMsg`, type sets, `MAX_CHAT_LEN`) | Task 1 |
| 2 | Server broadcast + validation (trim/drop empty/truncate over-long/ignore unauth) tested | Tasks 2, 8 |
| 3 | Pure `ChatState` module tested (open/cancel/type/backspace/submit/receive-cap/recent) | Task 3 |
| 4 | Presence: names render above each visible player's billboard (local + remote) | Task 6 |
| 5 | Chat UI: log bottom-left; `> …` input line; Enter opens/sends, Esc cancels, Backspace edits | Tasks 6, 7 |
| 6 | Movement gated while typing (keypress handler returns early when `chat.active`) | Task 6 |
| 7 | No regressions: full `bun test` green, `bun run typecheck` clean | Tasks 6–8 |

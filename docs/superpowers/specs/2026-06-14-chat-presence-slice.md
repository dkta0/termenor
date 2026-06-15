# Termenor — Vertical Slice 4: Chat + Nearby-Player Presence

Status: **spec** · Branch: `feat/chat-presence` · Date: 2026-06-14

## 1. Goal

Players see each other's **names** above their characters and can talk via **public chat**.
Server stays authoritative and broadcasts chat to all connected players. Names come for free
from slice 3 (the account username is the player id).

"Done" = two logged-in players see each other's name floating above the billboard; one types
a message and both see it appear in a chat log; movement is disabled while typing.

### Non-goals
- No private/whisper, channels, clans, or chat history persistence.
- No profanity filter, slash-commands, or emotes (later polish).
- No proximity/range limit on chat (it's global "public chat" for this slice).

## 2. Success criteria (concrete & checkable)
1. **Chat protocol round-trips.** `ChatMsg {t:"chat",text}` (client) and
   `ChatBroadcastMsg {t:"chatMsg",from,text}` (server) encode/decode; type sets updated.
2. **Server broadcast + validation (tested).** An authed player's `chat` is broadcast to all
   "world" subscribers as `chatMsg` with `from=username`. Text is trimmed; empty → dropped;
   over-long (>200 chars) → truncated. `chat` from an unauthenticated socket is ignored.
3. **Pure client chat-state module (tested).** `ChatState`: a ring buffer of recent messages
   (cap ~50, render last N), an input buffer with `open/cancel/type/backspace/submit/receive`.
   `submit` returns the trimmed text (or null if empty) and clears+closes input. Unit-tested
   with no TUI.
4. **Presence: names render** above each visible player's billboard (the local player too).
5. **Chat UI:** recent messages render bottom-left; while typing, an input line (`> …`) shows;
   Enter opens chat / sends, Esc cancels, Backspace edits.
6. **Movement gated while typing.** Arrow keys/clicks do not move the player while chat input
   is active.
7. **No regressions.** Full `bun test` green, `bun run typecheck` clean, `verify:render` passes.

## 3. Architecture

### 3.1 Protocol (`packages/protocol/src/index.ts`)
- `ChatMsg { t:"chat"; text: string }` → add to `ClientMsg`, `CLIENT_TYPES`.
- `ChatBroadcastMsg { t:"chatMsg"; from: string; text: string }` → add to `ServerMsg`,
  `SERVER_TYPES`.
- Export `MAX_CHAT_LEN = 200`.

### 3.2 Server (`packages/server/src/server.ts`)
- In the authed branch of `message`, handle `msg.t === "chat"`:
  `const text = msg.text.trim().slice(0, MAX_CHAT_LEN); if (!text) return;`
  then `server.publish("world", encode({t:"chatMsg", from: ws.data.username, text}))`.
- Unauthenticated `chat` is already ignored (only `login` accepted pre-auth).
- Pure helper `sanitizeChat(text): string` (trim + truncate) so it can be unit-tested without
  a running server.

### 3.3 Client chat state (`packages/client/src/chat.ts` — new, pure)
- `class ChatState { messages: {from,text}[]; input: string; active: boolean; }`
  - `open()` → active=true, input="".
  - `cancel()` → active=false, input="".
  - `type(ch: string)` → append a printable char (ignore control chars) while active.
  - `backspace()` → drop last char while active.
  - `submit(): string | null` → trimmed input or null if empty; clears input + sets
    active=false; returns the text for the caller to send.
  - `receive(from, text)` → push `{from,text}`; cap the buffer at 50.
  - `recent(n): {from,text}[]` → last n messages.
- Pure; no I/O. Fully unit-tested.

### 3.4 Client wiring (`connection.ts`, `render/renderer.ts`)
- `Connection.sendChat(text)`; handle incoming `chatMsg` → `chatState.receive(from,text)`.
  `GameState` (or a passed-in `ChatState`) holds the chat; keep `ChatState` separate from
  `GameState` and owned by the renderer/index wiring.
- `renderer.ts` keypress handler:
  - If `chat.active`: Enter → `const t = chat.submit(); if (t) hooks.onChat(t)`; Esc →
    `chat.cancel()`; Backspace → `chat.backspace()`; a printable single char → `chat.type(ch)`.
    **Return early so arrows don't move.**
  - If not active: Enter → `chat.open()`; else arrow/move handling as today.
- After `blit(buffer, grid)`, draw overlays directly via `buffer.setCell`:
  - **Names:** for each visible player, project `tileToScreen(x,y,h)`, convert to a cell
    (col = sx-camOx; row = (sy-camOy)/2 for halfblock) a row or two above the billboard, and
    write the name string centered-ish. Clip to viewport.
  - **Chat log:** bottom-left, last ~6 messages as `from: text`.
  - **Input line:** if active, the line `> input` at the very bottom.
- A small `overlay.ts` pure helper for clipping/placing a text string into the cell grid
  bounds (returns the cells to write) is unit-testable; keep the raw `setCell` calls in
  renderer.ts.

### 3.5 index.ts
- Construct a `ChatState`, pass it to the renderer; wire `onChat: (t) => conn.sendChat(t)`.

## 4. Error handling
- Oversized/whitespace-only chat → sanitized server-side (truncate/drop); never crashes.
- Non-printable/control keys while typing → ignored by `type()`.
- Name/chat overlay that would draw outside the grid → clipped, never throws.

## 5. Testing
- **Unit:** protocol round-trip; `sanitizeChat` (trim, truncate, empty); `ChatState`
  (open/type/backspace/submit-empty-null/submit-text/receive-cap/recent); `overlay` clipping.
- **Integration:** `startServer(0,":memory:")`, two ws clients log in, one sends `chat`, both
  receive `chatMsg` with correct `from`; empty/over-long handled; unauth `chat` ignored.
- **Visual/PTY:** extend nothing required, but manually confirm names + chat render; keep
  `verify:render` green (chat overlay must not break the half-block frame).

## 6. Sequencing (for `/plan`)
1. Protocol chat messages + MAX_CHAT_LEN.  2. Server `sanitizeChat` + chat broadcast + tests.
3. `chat.ts` ChatState (pure) + tests.  4. `overlay.ts` text placement + tests.  5. Connection
sendChat + chatMsg handling.  6. Renderer: chat input mode (gate movement) + name/chat
overlays.  7. index wiring.  8. Integration test.  9. Review.

**Risk:** keypress handling for text input under OpenTUI raw mode (printable-char detection,
Backspace/Enter/Esc names). Keep `type()` tolerant (only accept length-1 printable strings)
and verify key names against the existing `input.ts` conventions.

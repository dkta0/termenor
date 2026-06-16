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

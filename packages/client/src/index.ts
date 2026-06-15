import { GameState } from "./game-state";
import { ChatState } from "./chat";
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
    process.stdin.setEncoding("utf8");
    process.stdin.resume();
    process.stdin.once("data", (chunk: string) => {
      resolve(chunk.trim());
    });
  });

  process.stdout.write("Password: ");
  const p = await new Promise<string>((resolve) => {
    process.stdin.once("data", (chunk: string) => {
      resolve(chunk.trim());
    });
  });
  process.stdin.pause();

  return { username: u, password: p };
}

const { username, password } = await readCredentials();

const state = new GameState();
const chatState = new ChatState();
const conn = new Connection(url, state, {
  username,
  password,
  onLoginError: (reason) => {
    console.error(`Login failed: ${reason}`);
    process.exit(1);
  },
  onChatMsg: (from, text) => chatState.receive(from, text),
});
conn.connect();

const handle = await startRenderer(state, chatState, {
  onMoveTo: (x, y) => conn.sendMoveTo(x, y),
  onChat: (text) => conn.sendChat(text),
  onPickup: () => conn.sendPickup(),
  onDrop: (slot) => conn.sendDrop(slot),
  onAttack: (id) => conn.sendAttack(id),
});

const shutdown = () => { handle.stop(); conn.disconnect(); process.exit(0); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

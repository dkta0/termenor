import { GameState } from "./game-state";
import { Connection } from "./connection";
import { startRenderer } from "./render/renderer";

const url = process.env.SERVER_URL ?? process.argv[2] ?? "ws://localhost:3000";

const state = new GameState();
const conn = new Connection(url, state);
conn.connect();

const handle = await startRenderer(state, {
  onMoveTo: (x, y) => conn.sendMoveTo(x, y),
});

const shutdown = () => { handle.stop(); conn.disconnect(); process.exit(0); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

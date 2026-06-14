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

export function startServer(port: number, dbPath = process.env.DB_PATH ?? ":memory:"): RunningServer {
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

          // validate non-empty, length-bounded credentials before touching the DB
          if (
            typeof username !== "string" || username.length < 1 || username.length > 32 ||
            typeof password !== "string" || password.length < 1
          ) {
            ws.send(encode({ t: "loginError", reason: "invalid credentials" }));
            ws.close();
            return;
          }

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
    stop() { clearInterval(interval); server.stop(true); db.close(); },
  };
}

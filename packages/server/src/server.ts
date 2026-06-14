import { decodeClient, encode } from "@termenor/protocol";
import { Game } from "./game";
import { createDefaultMap, SPAWN } from "./world";

const TICK_RATE = 15;

interface Conn { id: string; }

export interface RunningServer {
  port: number;
  stop(): void;
}

export function startServer(port: number): RunningServer {
  const map = createDefaultMap();
  const game = new Game(map, SPAWN);
  let nextId = 1;

  const server = Bun.serve<Conn>({
    port,
    fetch(req, srv) {
      if (srv.upgrade(req, { data: { id: `p${nextId++}` } })) return;
      return new Response("termenor server", { status: 200 });
    },
    websocket: {
      open(ws) {
        game.addPlayer(ws.data.id);
        ws.subscribe("world");
        ws.send(encode({ t: "welcome", playerId: ws.data.id, map, tickRate: TICK_RATE }));
      },
      message(ws, raw) {
        let msg;
        try { msg = decodeClient(String(raw)); } catch { return; }
        if (msg.t === "moveTo") game.queueMove(ws.data.id, msg.x, msg.y);
      },
      close(ws) {
        game.removePlayer(ws.data.id);
      },
    },
  });

  const dt = 1 / TICK_RATE;
  const interval = setInterval(() => {
    game.step(dt);
    server.publish("world", encode(game.snapshot()));
  }, 1000 / TICK_RATE);

  return {
    port: server.port ?? port,
    stop() { clearInterval(interval); server.stop(true); },
  };
}

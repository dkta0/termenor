import { test, expect } from "bun:test";
import { decodeServer, encode, type ServerMsg } from "@termenor/protocol";
import { startServer } from "./server";

function nextMessage(ws: WebSocket): Promise<ServerMsg> {
  return new Promise((resolve) => {
    ws.addEventListener("message", (e) => resolve(decodeServer(String(e.data))), { once: true });
  });
}

test("client receives welcome then snapshots and can move", async () => {
  const server = startServer(0); // port 0 → ephemeral
  const url = `ws://localhost:${server.port}`;
  const ws = new WebSocket(url);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));

  ws.send(encode({ t: "hello" }));
  const welcome = await nextMessage(ws);
  expect(welcome.t).toBe("welcome");
  if (welcome.t !== "welcome") throw new Error("expected welcome");
  expect(welcome.map.width).toBeGreaterThan(0);
  const myId = welcome.playerId;

  // move and confirm a later snapshot shows movement away from spawn
  ws.send(encode({ t: "moveTo", x: welcome.map.width - 2, y: 24 }));
  let moved = false;
  for (let i = 0; i < 30 && !moved; i++) {
    const snap = await nextMessage(ws);
    if (snap.t !== "snapshot") continue;
    const me = snap.players.find((p) => p.id === myId);
    if (me && me.x !== 24) moved = true;
  }
  expect(moved).toBe(true);

  ws.close();
  server.stop();
});

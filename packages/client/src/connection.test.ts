import { test, expect } from "bun:test";
import { encode, type ClientMsg } from "@termenor/protocol";
import { GameState } from "./game-state";
import { Connection, type SocketLike, type SocketFactory } from "./connection";

class MockSocket implements SocketLike {
  sent: string[] = [];
  onopen?: () => void;
  onmessage?: (data: string) => void;
  onclose?: () => void;
  close() { this.onclose?.(); }
  send(data: string) { this.sent.push(data); }
  // test helpers
  fireOpen() { this.onopen?.(); }
  fireMessage(s: string) { this.onmessage?.(s); }
  lastDecoded(): ClientMsg { return JSON.parse(this.sent.at(-1)!); }
}

function setup() {
  const sock = new MockSocket();
  const factory: SocketFactory = () => sock;
  const gs = new GameState();
  let t = 1000;
  const conn = new Connection("ws://x", gs, { socketFactory: factory, now: () => t });
  conn.connect();
  return { sock, gs, conn, advance: (ms: number) => { t += ms; } };
}

test("sends hello on open", () => {
  const { sock } = setup();
  sock.fireOpen();
  expect(sock.lastDecoded()).toEqual({ t: "hello" });
});

test("sendMoveTo serializes a moveTo message", () => {
  const { sock, conn } = setup();
  sock.fireOpen();
  conn.sendMoveTo(5, 6);
  expect(sock.lastDecoded()).toEqual({ t: "moveTo", x: 5, y: 6 });
});

test("welcome populates map and local id", () => {
  const { sock, gs } = setup();
  sock.fireOpen();
  sock.fireMessage(encode({ t: "welcome", playerId: "me", tickRate: 15,
    map: { width: 3, height: 1, tiles: [0,0,0], heights: [0,0,0] } }));
  expect(gs.localId).toBe("me");
  expect(gs.map?.width).toBe(3);
});

test("snapshot is applied to game-state", () => {
  const { sock, gs, advance } = setup();
  sock.fireOpen();
  sock.fireMessage(encode({ t: "snapshot", tick: 1, players: [{ id: "me", x: 1, y: 0, facing: "east" }] }));
  advance(200);
  const players = gs.samplePositions(1200);
  expect(players[0].id).toBe("me");
});

test("reconnects after close", () => {
  const sockets: MockSocket[] = [];
  const factory: SocketFactory = () => { const s = new MockSocket(); sockets.push(s); return s; };
  const gs = new GameState();
  const conn = new Connection("ws://x", gs, { socketFactory: factory, now: () => 0, reconnectDelayMs: 0 });
  conn.connect();
  expect(sockets).toHaveLength(1);
  sockets[0].close();
  expect(sockets).toHaveLength(2); // reconnected immediately (delay 0)
});

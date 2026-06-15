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

function setup(overrides: { username?: string; password?: string } = {}) {
  const sock = new MockSocket();
  const factory: SocketFactory = () => sock;
  const gs = new GameState();
  let t = 1000;
  const conn = new Connection("ws://x", gs, {
    socketFactory: factory,
    now: () => t,
    username: overrides.username ?? "testuser",
    password: overrides.password ?? "testpass",
  });
  conn.connect();
  return { sock, gs, conn, advance: (ms: number) => { t += ms; } };
}

test("sends login on open", () => {
  const { sock } = setup({ username: "alice", password: "s3cr3t" });
  sock.fireOpen();
  expect(sock.lastDecoded()).toEqual({ t: "login", username: "alice", password: "s3cr3t" });
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
  sock.fireMessage(encode({
    t: "welcome", playerId: "me", tickRate: 15,
    x: 3, y: 1, facing: "south",
    map: { width: 3, height: 1, tiles: [0, 0, 0], heights: [0, 0, 0] },
  }));
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
  const conn = new Connection("ws://x", gs, {
    socketFactory: factory,
    now: () => 0,
    reconnectDelayMs: 0,
    username: "testuser",
    password: "testpass",
  });
  conn.connect();
  expect(sockets).toHaveLength(1);
  sockets[0].close();
  expect(sockets).toHaveLength(2); // reconnected immediately (delay 0)
});

test("connection sends login message on open", () => {
  const sent: string[] = [];
  const mockSock: SocketLike = {
    send: (d) => sent.push(d),
    close: () => {},
  };
  const state = new GameState();
  const conn = new Connection("ws://x", state, {
    socketFactory: () => mockSock,
    username: "alice",
    password: "s3cr3t",
  });
  conn.connect();
  mockSock.onopen?.();
  expect(sent).toHaveLength(1);
  const msg = JSON.parse(sent[0]);
  expect(msg.t).toBe("login");
  expect(msg.username).toBe("alice");
  expect(msg.password).toBe("s3cr3t");
});

test("loginError triggers onLoginError callback", () => {
  let errorReason: string | undefined;
  const mockSock: SocketLike = {
    send: () => {},
    close: () => {},
  };
  const state = new GameState();
  const conn = new Connection("ws://x", state, {
    socketFactory: () => mockSock,
    username: "alice",
    password: "wrong",
    onLoginError: (reason: string) => { errorReason = reason; },
  });
  conn.connect();
  mockSock.onopen?.();
  mockSock.onmessage?.(JSON.stringify({ t: "loginError", reason: "bad password" }));
  expect(errorReason).toBe("bad password");
});

test("welcome message seeds local position in GameState", () => {
  const mockSock: SocketLike = {
    send: () => {},
    close: () => {},
  };
  const state = new GameState();
  const conn = new Connection("ws://x", state, {
    socketFactory: () => mockSock,
    username: "alice",
    password: "pw",
  });
  conn.connect();
  mockSock.onopen?.();
  mockSock.onmessage?.(JSON.stringify({
    t: "welcome",
    playerId: "alice",
    tickRate: 15,
    x: 10,
    y: 5,
    facing: "east",
    map: { width: 2, height: 1, tiles: [0, 0], heights: [0, 0] },
  }));
  expect(state.localId).toBe("alice");
});

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

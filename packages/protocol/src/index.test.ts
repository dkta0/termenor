import { test, expect } from "bun:test";
import { encode, decodeClient, decodeServer, type ClientMsg, type ServerMsg } from "./index";

test("client message round-trips", () => {
  const msg: ClientMsg = { t: "moveTo", x: 3, y: 7 };
  expect(decodeClient(encode(msg))).toEqual(msg);
});

test("hello round-trips", () => {
  const msg: ClientMsg = { t: "hello" };
  expect(decodeClient(encode(msg))).toEqual(msg);
});

test("server snapshot round-trips", () => {
  const msg: ServerMsg = {
    t: "snapshot", tick: 5,
    players: [{ id: "a", x: 1.5, y: 2, facing: "east" }],
  };
  expect(decodeServer(encode(msg))).toEqual(msg);
});

test("welcome round-trips", () => {
  const msg: ServerMsg = {
    t: "welcome", playerId: "a", tickRate: 15,
    map: { width: 2, height: 1, tiles: [0, 1], heights: [0, 0] },
  };
  expect(decodeServer(encode(msg))).toEqual(msg);
});

test("decodeClient rejects unknown type", () => {
  expect(() => decodeClient(JSON.stringify({ t: "nope" }))).toThrow();
});

import { MAX_CLIMB } from "./index";
import type { MapData } from "./index";

test("MapData carries a per-tile heights array", () => {
  const m: MapData = { width: 2, height: 1, tiles: [0, 0], heights: [0, 1] };
  expect(m.heights.length).toBe(m.tiles.length);
});

test("MAX_CLIMB is 1 (one height unit per step)", () => {
  expect(MAX_CLIMB).toBe(1);
});

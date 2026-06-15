import { test, expect } from "bun:test";
import { encode, decodeClient, decodeServer, type ClientMsg, type ServerMsg } from "./index";

test("client message round-trips", () => {
  const msg: ClientMsg = { t: "moveTo", x: 3, y: 7 };
  expect(decodeClient(encode(msg))).toEqual(msg);
});

test("server snapshot round-trips", () => {
  const msg: ServerMsg = {
    t: "snapshot", tick: 5,
    players: [{ id: "a", x: 1.5, y: 2, facing: "east" }],
    ground: [],
    npcs: [],
  };
  expect(decodeServer(encode(msg))).toEqual(msg);
});

test("decodeClient rejects unknown type", () => {
  expect(() => decodeClient(JSON.stringify({ t: "nope" }))).toThrow();
});

import { MAX_CLIMB, MAX_CHAT_LEN } from "./index";
import type { MapData } from "./index";

test("MapData carries a per-tile heights array", () => {
  const m: MapData = { width: 2, height: 1, tiles: [0, 0], heights: [0, 1] };
  expect(m.heights.length).toBe(m.tiles.length);
});

test("MAX_CLIMB is 1 (one height unit per step)", () => {
  expect(MAX_CLIMB).toBe(1);
});

test("login message round-trips", () => {
  const msg: ClientMsg = { t: "login", username: "alice", password: "s3cr3t" };
  expect(decodeClient(encode(msg))).toEqual(msg);
});

test("loginError message round-trips", () => {
  const msg: ServerMsg = { t: "loginError", reason: "bad password" };
  expect(decodeServer(encode(msg))).toEqual(msg);
});

test("welcome includes restored x, y, facing", () => {
  const msg: ServerMsg = {
    t: "welcome", playerId: "alice", tickRate: 15,
    x: 12.5, y: 7.0, facing: "east",
    map: { width: 2, height: 1, tiles: [0, 0], heights: [0, 0] },
  };
  expect(decodeServer(encode(msg))).toEqual(msg);
});

test("decodeClient rejects hello (removed from ClientMsg)", () => {
  // hello is no longer a valid client message after auth refactor
  // login replaces hello as the first message sent by a client
  expect(() => decodeClient(JSON.stringify({ t: "hello" }))).toThrow();
});

test("chat message round-trips", () => {
  const msg = { t: "chat", text: "hello world" } as const;
  expect(decodeClient(encode(msg))).toEqual(msg);
});

test("chatMsg broadcast round-trips", () => {
  const msg = { t: "chatMsg", from: "alice", text: "hi" } as const;
  expect(decodeServer(encode(msg))).toEqual(msg);
});

test("MAX_CHAT_LEN is 200", () => {
  expect(MAX_CHAT_LEN).toBe(200);
});

import { ITEMS, INV_SIZE } from "./items";
import type { GroundItem, ItemStack } from "./items";

test("PickupMsg round-trips", () => {
  const msg: ClientMsg = { t: "pickup" };
  expect(decodeClient(encode(msg))).toEqual(msg);
});

test("DropMsg round-trips", () => {
  const msg: ClientMsg = { t: "drop", slot: 3 };
  expect(decodeClient(encode(msg))).toEqual(msg);
});

test("InventoryMsg round-trips", () => {
  const slots: (ItemStack | null)[] = [{ item: "coins", qty: 5 }, null];
  const msg: ServerMsg = { t: "inventory", slots };
  expect(decodeServer(encode(msg))).toEqual(msg);
});

test("SnapshotMsg includes ground array", () => {
  const ground: GroundItem[] = [{ id: 1, item: "coins", qty: 10, x: 3, y: 4 }];
  const msg: ServerMsg = { t: "snapshot", tick: 1, players: [], ground, npcs: [] };
  expect(decodeServer(encode(msg))).toEqual(msg);
});

import { NPC_TYPES, type NpcState } from "./index";

test("SnapshotMsg with npcs round-trips through encode/decodeServer", () => {
  const npcs: NpcState[] = [{ id: "npc-1", type: "goblin", x: 3.5, y: 7, facing: "south" }];
  const msg: ServerMsg = { t: "snapshot", tick: 42, players: [], ground: [], npcs };
  expect(decodeServer(encode(msg))).toEqual(msg);
});

test("NPC_TYPES has goblin and rat entries", () => {
  expect(NPC_TYPES.goblin).toBeDefined();
  expect(NPC_TYPES.rat).toBeDefined();
  expect(NPC_TYPES.goblin.name).toBe("Goblin");
  expect(NPC_TYPES.rat.name).toBe("Rat");
});

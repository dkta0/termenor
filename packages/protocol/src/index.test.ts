import { test, expect } from "bun:test";
import { encode, decodeClient, decodeServer, type ClientMsg, type ServerMsg } from "./index";

test("client message round-trips", () => {
  const msg: ClientMsg = { t: "moveTo", x: 3, y: 7 };
  expect(decodeClient(encode(msg))).toEqual(msg);
});

test("server snapshot round-trips", () => {
  const msg: ServerMsg = {
    t: "snapshot", tick: 5,
    players: [{ id: "a", x: 1.5, y: 2, facing: "east", hp: 10, maxHp: 10 }],
    ground: [],
    npcs: [],
    hits: [],
    resources: [],
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

import { ITEM_KINDS, INV_SIZE } from "./items";
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
  const msg: ServerMsg = { t: "snapshot", tick: 1, players: [], ground, npcs: [], hits: [], resources: [] };
  expect(decodeServer(encode(msg))).toEqual(msg);
});

import { NPC_KINDS, type NpcState } from "./index";

test("SnapshotMsg with npcs round-trips through encode/decodeServer", () => {
  const npcs: NpcState[] = [{ id: "npc-1", type: "goblin", x: 3.5, y: 7, facing: "south", hp: 5, maxHp: 5 }];
  const msg: ServerMsg = { t: "snapshot", tick: 42, players: [], ground: [], npcs, hits: [], resources: [] };
  expect(decodeServer(encode(msg))).toEqual(msg);
});

test("NPC_KINDS has goblin and rat entries", () => {
  expect(NPC_KINDS.goblin).toBeDefined();
  expect(NPC_KINDS.rat).toBeDefined();
  expect(NPC_KINDS.goblin.name).toBe("Goblin");
  expect(NPC_KINDS.rat.name).toBe("Rat");
});

import { PLAYER_MAX_HP } from "./combat";

test("attack message round-trips", () => {
  const msg: ClientMsg = { t: "attack", targetId: "npc-3" };
  expect(decodeClient(encode(msg))).toEqual(msg);
});

test("snapshot with hp + hits round-trips", () => {
  const msg: ServerMsg = {
    t: "snapshot", tick: 9,
    players: [{ id: "a", x: 1, y: 2, facing: "east", hp: 7, maxHp: PLAYER_MAX_HP }],
    ground: [],
    npcs: [{ id: "n1", type: "goblin", x: 5, y: 5, facing: "south", hp: 3, maxHp: 5 }],
    hits: [{ targetId: "n1", amount: 2, tick: 9 }],
    resources: [],
  };
  expect(decodeServer(encode(msg))).toEqual(msg);
});

import { type ResourceState } from "./index";

test("gather ClientMsg round-trips", () => {
  const msg: ClientMsg = { t: "gather", targetId: "res-1" };
  expect(decodeClient(encode(msg))).toEqual(msg);
});

test("skills ServerMsg round-trips", () => {
  const msg: ServerMsg = {
    t: "skills",
    skills: { woodcutting: { xp: 25, level: 1 } },
  };
  expect(decodeServer(encode(msg))).toEqual(msg);
});

test("snapshot with resources round-trips", () => {
  const resources: ResourceState[] = [{ id: "r1", type: "tree", x: 3, y: 4 }];
  const msg: ServerMsg = {
    t: "snapshot", tick: 10,
    players: [],
    ground: [],
    npcs: [],
    hits: [],
    resources,
  };
  expect(decodeServer(encode(msg))).toEqual(msg);
});

import { type UseMsg } from "./index";

test("UseMsg round-trips through encode/decodeClient", () => {
  const msg: ClientMsg = { t: "use", action: "firemaking", slot: 2 };
  expect(decodeClient(encode(msg))).toEqual(msg);
});

import { SHOPS, SELL_RATE, BANK_CAP, type ShopEntry } from "./index";
import { type OpenMsg, type BankActionMsg, type ShopActionMsg, type BankMsg, type ShopMsg } from "./index";

test("SHOPS.general_store has entries and SELL_RATE is 0.5", () => {
  expect(SHOPS.general_store).toBeDefined();
  expect(SHOPS.general_store.entries.length).toBeGreaterThan(0);
  expect(SELL_RATE).toBe(0.5);
  expect(BANK_CAP).toBe(200);
});

test("OpenMsg (bank) round-trips through encode/decodeClient", () => {
  const msg: ClientMsg = { t: "open", what: "bank", targetId: "booth-1" };
  expect(decodeClient(encode(msg))).toEqual(msg);
});

test("OpenMsg (shop) round-trips through encode/decodeClient", () => {
  const msg: ClientMsg = { t: "open", what: "shop", targetId: "store-1" };
  expect(decodeClient(encode(msg))).toEqual(msg);
});

test("BankActionMsg round-trips through encode/decodeClient", () => {
  const msg: ClientMsg = { t: "bankAction", action: "deposit", slot: 2, qty: 5 };
  expect(decodeClient(encode(msg))).toEqual(msg);
});

test("ShopActionMsg round-trips through encode/decodeClient", () => {
  const msg: ClientMsg = { t: "shopAction", action: "buy", item: "logs", qty: 1 };
  expect(decodeClient(encode(msg))).toEqual(msg);
});

test("BankMsg round-trips through encode/decodeServer", () => {
  const msg: ServerMsg = { t: "bank", items: [{ item: "coins", qty: 50 }], open: true };
  expect(decodeServer(encode(msg))).toEqual(msg);
});

test("ShopMsg round-trips through encode/decodeServer", () => {
  const entries: ShopEntry[] = [{ item: "logs", price: 4, stock: 100 }];
  const msg: ServerMsg = { t: "shop", shopId: "general_store", name: "General Store", entries, open: true };
  expect(decodeServer(encode(msg))).toEqual(msg);
});

test("snapshot with rock and fire resources round-trips", () => {
  const resources: ResourceState[] = [
    { id: "r1", type: "rock", x: 2, y: 2 },
    { id: "f1", type: "fire", x: 3, y: 3 },
  ];
  const msg: ServerMsg = {
    t: "snapshot", tick: 20,
    players: [],
    ground: [],
    npcs: [],
    hits: [],
    resources,
  };
  expect(decodeServer(encode(msg))).toEqual(msg);
});

test("decodeClient accepts a login message carrying an explicit mode", () => {
  const wire = encode({ t: "login", mode: "register", username: "alice", password: "pw" });
  const msg = decodeClient(wire);
  expect(msg.t).toBe("login");
  if (msg.t !== "login") return;
  expect(msg.mode).toBe("register");
  expect(msg.username).toBe("alice");
});

test("decodeClient still accepts a login message with no mode (legacy)", () => {
  const msg = decodeClient(encode({ t: "login", username: "bob", password: "pw" }));
  expect(msg.t).toBe("login");
  if (msg.t !== "login") return;
  expect(msg.mode).toBeUndefined();
});

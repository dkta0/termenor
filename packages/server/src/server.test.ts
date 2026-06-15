import { test, expect, afterEach } from "bun:test";
import type { RunningServer } from "./server";
import { startServer } from "./server";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Open a WebSocket and return a simple promise-based wrapper. */
function wsClient(port: number): {
  send(data: string): void;
  messages: string[];
  waitForOpen(timeoutMs?: number): Promise<void>;
  waitForMessage(t: string, timeoutMs?: number): Promise<Record<string, unknown>>;
  close(): void;
} {
  const messages: string[] = [];
  const ws = new WebSocket(`ws://localhost:${port}`);
  const listeners = new Map<string, Array<(msg: Record<string, unknown>) => void>>();
  let openResolve: (() => void) | null = null;
  let openReject: ((e: Error) => void) | null = null;

  ws.addEventListener("open", () => { openResolve?.(); });
  ws.addEventListener("error", () => { openReject?.(new Error("ws error")); });

  ws.addEventListener("message", (e) => {
    const raw = String(e.data);
    messages.push(raw);
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const t = String(obj.t);
    const cbs = listeners.get(t);
    if (cbs && cbs.length > 0) {
      const cb = cbs.shift()!;
      if (cbs.length === 0) listeners.delete(t);
      cb(obj);
    }
  });

  return {
    send: (d) => ws.send(d),
    messages,
    waitForOpen(timeoutMs = 3000): Promise<void> {
      return new Promise((resolve, reject) => {
        if (ws.readyState === WebSocket.OPEN) { resolve(); return; }
        const timer = setTimeout(() => reject(new Error("timeout waiting for ws open")), timeoutMs);
        openResolve = () => { clearTimeout(timer); resolve(); };
        openReject = (e) => { clearTimeout(timer); reject(e); };
      });
    },
    waitForMessage(t: string, timeoutMs = 3000): Promise<Record<string, unknown>> {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timeout waiting for "${t}"`)), timeoutMs);
        const existing = listeners.get(t) ?? [];
        existing.push((msg) => { clearTimeout(timer); resolve(msg); });
        listeners.set(t, existing);
      });
    },
    close: () => ws.close(),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Test state
// ---------------------------------------------------------------------------

let srv: RunningServer;

afterEach(() => { srv?.stop(); });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("new login returns welcome at spawn (24, 24)", async () => {
  srv = startServer(0, ":memory:");

  const client = wsClient(srv.port);
  await client.waitForOpen();
  const welcomeP = client.waitForMessage("welcome");
  client.send(JSON.stringify({ t: "login", username: "alice", password: "pw" }));
  const welcome = await welcomeP;

  expect(welcome.playerId).toBe("alice");
  expect(Number(welcome.x)).toBeCloseTo(24, 5);
  expect(Number(welcome.y)).toBeCloseTo(24, 5);
  client.close();
});

test("wrong password returns loginError with no welcome", async () => {
  srv = startServer(0, ":memory:");

  // First: create account for "bob"
  const c1 = wsClient(srv.port);
  await c1.waitForOpen();
  c1.send(JSON.stringify({ t: "login", username: "bob", password: "right" }));
  await c1.waitForMessage("welcome");
  c1.close();
  await sleep(100); // let close propagate so bob is offline

  // Second: wrong password
  const c2 = wsClient(srv.port);
  await c2.waitForOpen();
  const errP = c2.waitForMessage("loginError");
  c2.send(JSON.stringify({ t: "login", username: "bob", password: "wrong" }));
  const err = await errP;

  expect(typeof err.reason).toBe("string");
  // must not have received a welcome
  expect(c2.messages.every((m) => !m.includes('"welcome"'))).toBe(true);
  c2.close();
});

test("duplicate login (account already online) returns loginError", async () => {
  srv = startServer(0, ":memory:");

  // c1 logs in and stays connected
  const c1 = wsClient(srv.port);
  await c1.waitForOpen();
  c1.send(JSON.stringify({ t: "login", username: "carol", password: "pw" }));
  await c1.waitForMessage("welcome");

  // c2 tries to log in as the same user
  const c2 = wsClient(srv.port);
  await c2.waitForOpen();
  const errP = c2.waitForMessage("loginError");
  c2.send(JSON.stringify({ t: "login", username: "carol", password: "pw" }));
  const err = await errP;

  expect(String(err.reason)).toMatch(/already online/i);
  c1.close();
  c2.close();
});

test("position is restored after disconnect and reconnect", async () => {
  srv = startServer(0, ":memory:");

  // --- Session 1: login + move a short distance ---
  const c1 = wsClient(srv.port);
  await c1.waitForOpen();
  c1.send(JSON.stringify({ t: "login", username: "dave", password: "pw" }));
  await c1.waitForMessage("welcome"); // spawn at 24, 24

  // Move to (21, 21) — ~4.2 tiles from spawn.
  // At SPEED=5 tiles/s and TICK_RATE=15 Hz, 1000ms covers 5 tiles, plenty to arrive.
  c1.send(JSON.stringify({ t: "moveTo", x: 21, y: 21 }));
  await sleep(1200); // wait >1s to ensure arrival at (21, 21)

  c1.close();
  await sleep(150); // let the close handler run + save state

  // --- Session 2: reconnect and check restored position ---
  const c2 = wsClient(srv.port);
  await c2.waitForOpen();
  const welcomeP = c2.waitForMessage("welcome");
  c2.send(JSON.stringify({ t: "login", username: "dave", password: "pw" }));
  const welcome = await welcomeP;

  // Should be near (21, 21), NOT spawn (24, 24)
  expect(Number(welcome.x)).toBeCloseTo(21, 0);
  expect(Number(welcome.y)).toBeCloseTo(21, 0);
  c2.close();
}, 10_000);

test("moveTo before login is ignored — server does not crash; welcome shows spawn", async () => {
  srv = startServer(0, ":memory:");

  const client = wsClient(srv.port);
  await client.waitForOpen();

  // Send moveTo WITHOUT logging in first
  client.send(JSON.stringify({ t: "moveTo", x: 10, y: 10 }));
  await sleep(150); // give server time to process (or ignore) the message

  // No welcome or loginError should have arrived
  expect(client.messages).toHaveLength(0);

  // Now log in — should still get spawn position, not the unauthenticated moveTo
  const welcomeP = client.waitForMessage("welcome");
  client.send(JSON.stringify({ t: "login", username: "eve", password: "pw" }));
  const welcome = await welcomeP;

  expect(welcome.playerId).toBe("eve");
  expect(Number(welcome.x)).toBeCloseTo(24, 5);
  expect(Number(welcome.y)).toBeCloseTo(24, 5);
  client.close();
});

test("authenticated player's chat is broadcast as chatMsg to all subscribers", async () => {
  srv = startServer(0, ":memory:");

  const alice = wsClient(srv.port);
  const bob = wsClient(srv.port);
  await alice.waitForOpen();
  await bob.waitForOpen();

  alice.send(JSON.stringify({ t: "login", username: "alice", password: "pw" }));
  await alice.waitForMessage("welcome");

  bob.send(JSON.stringify({ t: "login", username: "bob", password: "pw" }));
  await bob.waitForMessage("welcome");

  const aliceChatP = alice.waitForMessage("chatMsg");
  const bobChatP = bob.waitForMessage("chatMsg");

  alice.send(JSON.stringify({ t: "chat", text: "hello bob" }));

  const aliceMsg = await aliceChatP;
  const bobMsg = await bobChatP;

  expect(aliceMsg).toMatchObject({ t: "chatMsg", from: "alice", text: "hello bob" });
  expect(bobMsg).toMatchObject({ t: "chatMsg", from: "alice", text: "hello bob" });

  alice.close();
  bob.close();
});

test("empty chat (whitespace-only) is dropped — no chatMsg broadcast", async () => {
  srv = startServer(0, ":memory:");
  const alice = wsClient(srv.port);
  await alice.waitForOpen();
  alice.send(JSON.stringify({ t: "login", username: "alice", password: "pw" }));
  await alice.waitForMessage("welcome");

  alice.send(JSON.stringify({ t: "chat", text: "   " }));
  await sleep(200);

  const chatMsgs = alice.messages.filter((m) => m.includes('"chatMsg"'));
  expect(chatMsgs).toHaveLength(0);
  alice.close();
});

test("over-long chat text is truncated to MAX_CHAT_LEN", async () => {
  srv = startServer(0, ":memory:");
  const alice = wsClient(srv.port);
  await alice.waitForOpen();
  alice.send(JSON.stringify({ t: "login", username: "alice", password: "pw" }));
  await alice.waitForMessage("welcome");

  const chatP = alice.waitForMessage("chatMsg");
  alice.send(JSON.stringify({ t: "chat", text: "x".repeat(500) }));
  const msg = await chatP;
  expect(String(msg.text).length).toBe(200);
  alice.close();
});

test("unauthenticated chat is silently ignored", async () => {
  srv = startServer(0, ":memory:");
  const client = wsClient(srv.port);
  await client.waitForOpen();

  client.send(JSON.stringify({ t: "chat", text: "sneaky" }));
  await sleep(150);

  expect(client.messages).toHaveLength(0);
  client.close();
});

// ---------------------------------------------------------------------------
// Inventory integration tests
// Each test uses its own startServer(0, ":memory:") for isolation.
// SEED_ITEMS: coins(25,24), logs(23,24), shrimp(24,25) — all 1 tile from spawn(24,24)
// SPEED = 5 tiles/s → 1 tile ≈ 200ms; wait 800ms to be safe
// INV_SIZE = 28
// ---------------------------------------------------------------------------

test("inventory on login: server sends inventory of length 28, all null", async () => {
  srv = startServer(0, ":memory:");

  const client = wsClient(srv.port);
  await client.waitForOpen();
  client.send(JSON.stringify({ t: "login", username: "inv_login_user", password: "pw" }));
  await client.waitForMessage("welcome");

  const inv = await client.waitForMessage("inventory");
  const slots = inv.slots as Array<unknown>;
  expect(Array.isArray(slots)).toBe(true);
  expect(slots).toHaveLength(28);
  expect(slots.every((s) => s === null)).toBe(true);
  client.close();
});

test("snapshot carries ground: snapshot includes seeded items", async () => {
  srv = startServer(0, ":memory:");

  const client = wsClient(srv.port);
  await client.waitForOpen();
  client.send(JSON.stringify({ t: "login", username: "snap_ground_user", password: "pw" }));
  await client.waitForMessage("welcome");

  const snap = await client.waitForMessage("snapshot");
  const ground = snap.ground as Array<{ item: string; x: number; y: number; qty: number }>;
  expect(Array.isArray(ground)).toBe(true);
  // At least one seeded item must be present
  expect(ground.length).toBeGreaterThanOrEqual(1);
  // coins at (25,24) should be there
  const coins = ground.find((g) => g.item === "coins" && g.x === 25 && g.y === 24);
  expect(coins).toBeDefined();
  expect(coins!.qty).toBe(25);
  client.close();
});

test("pickup: moving onto a seeded item and picking it up fills inventory", async () => {
  srv = startServer(0, ":memory:");

  const client = wsClient(srv.port);
  await client.waitForOpen();
  client.send(JSON.stringify({ t: "login", username: "pickup_user", password: "pw" }));
  await client.waitForMessage("welcome");
  // Discard the initial inventory message
  await client.waitForMessage("inventory");

  // Move to coins at (25, 24) — 1 tile east of spawn
  client.send(JSON.stringify({ t: "moveTo", x: 25, y: 24 }));
  await sleep(800); // wait for arrival (1 tile at 5 tiles/s ≈ 200ms; 800ms is safe)

  client.send(JSON.stringify({ t: "pickup" }));

  // Wait for a non-empty inventory message
  const inv = await client.waitForMessage("inventory", 3000);
  const slots = inv.slots as Array<{ item: string; qty: number } | null>;
  const coinSlot = slots.find((s) => s?.item === "coins");
  expect(coinSlot).toBeDefined();
  expect(coinSlot!.qty).toBeGreaterThan(0);

  // Verify coins are gone from ground in the next snapshot
  const snap = await client.waitForMessage("snapshot", 3000);
  const ground = snap.ground as Array<{ item: string; x: number; y: number }>;
  const coinsOnGround = ground.find((g) => g.item === "coins" && g.x === 25 && g.y === 24);
  expect(coinsOnGround).toBeUndefined();

  client.close();
}, 10_000);

test("drop: dropping an item puts it back on ground at player's tile", async () => {
  srv = startServer(0, ":memory:");

  const client = wsClient(srv.port);
  await client.waitForOpen();
  client.send(JSON.stringify({ t: "login", username: "drop_user", password: "pw" }));
  await client.waitForMessage("welcome");
  // Discard initial inventory (all null)
  await client.waitForMessage("inventory");

  // Move to logs at (23, 24) and pick them up
  client.send(JSON.stringify({ t: "moveTo", x: 23, y: 24 }));
  await sleep(800);
  client.send(JSON.stringify({ t: "pickup" }));

  // Wait for filled inventory after pickup
  const invAfterPickup = await client.waitForMessage("inventory", 3000);
  const slotsAfterPickup = invAfterPickup.slots as Array<{ item: string; qty: number } | null>;
  const logSlotIdx = slotsAfterPickup.findIndex((s) => s?.item === "logs");
  expect(logSlotIdx).toBeGreaterThanOrEqual(0);

  // Drop that slot
  client.send(JSON.stringify({ t: "drop", slot: logSlotIdx }));

  // After drop, inventory should show that slot as null
  const invAfterDrop = await client.waitForMessage("inventory", 3000);
  const slotsAfterDrop = invAfterDrop.slots as Array<{ item: string; qty: number } | null>;
  expect(slotsAfterDrop[logSlotIdx]).toBeNull();

  // Dropped item appears in ground in the next snapshot
  const snap = await client.waitForMessage("snapshot", 3000);
  const ground = snap.ground as Array<{ item: string; x: number; y: number }>;
  const logsOnGround = ground.find((g) => g.item === "logs" && g.x === 23 && g.y === 24);
  expect(logsOnGround).toBeDefined();

  client.close();
}, 10_000);

test("persist across reconnect: inventory survives disconnect and reconnect", async () => {
  srv = startServer(0, ":memory:");

  // --- Session 1: pick up shrimp at (24, 25) ---
  const c1 = wsClient(srv.port);
  await c1.waitForOpen();
  c1.send(JSON.stringify({ t: "login", username: "persist_user", password: "pw" }));
  await c1.waitForMessage("welcome");
  await c1.waitForMessage("inventory"); // discard initial empty inventory

  c1.send(JSON.stringify({ t: "moveTo", x: 24, y: 25 }));
  await sleep(800); // wait for arrival at shrimp tile
  c1.send(JSON.stringify({ t: "pickup" }));

  const invAfterPickup = await c1.waitForMessage("inventory", 3000);
  const slotsAfterPickup = invAfterPickup.slots as Array<{ item: string; qty: number } | null>;
  expect(slotsAfterPickup.some((s) => s !== null)).toBe(true);

  c1.close();
  await sleep(200); // let disconnect handler save state to DB

  // --- Session 2: reconnect and verify inventory restored ---
  const c2 = wsClient(srv.port);
  await c2.waitForOpen();
  c2.send(JSON.stringify({ t: "login", username: "persist_user", password: "pw" }));
  await c2.waitForMessage("welcome");

  const restoredInv = await c2.waitForMessage("inventory", 3000);
  const restoredSlots = restoredInv.slots as Array<{ item: string; qty: number } | null>;
  expect(restoredSlots.some((s) => s !== null)).toBe(true);

  const shrimpSlot = restoredSlots.find((s) => s?.item === "shrimp");
  expect(shrimpSlot).toBeDefined();
  expect(shrimpSlot!.qty).toBeGreaterThan(0);

  c2.close();
}, 15_000);

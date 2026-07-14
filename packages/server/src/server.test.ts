import { test, expect, afterEach } from "bun:test";
import type { RunningServer } from "./server";
import { startServer } from "./server";
import { emptyEquipment } from "@termenor/protocol";
import { emptyInventory } from "./inventory";
import type { AccountResult, PlayerStateRecord, PlayerStore } from "./store";
import type { ScenarioDef } from "./scenario";
import { TUTORIAL_SCENARIO, TUTORIAL_ZONE } from "./tutorial";
import { ZONE_DEFS, type ZoneDef } from "./world";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Ground = { id: number; item: string; x: number; y: number; qty: number };
type Player = { id: string; x: number; y: number; facing: string; hp: number; maxHp: number };

/** Open a WebSocket and return a simple promise-based wrapper. */
function wsClient(port: number): {
  send(data: string): void;
  messages: string[];
  waitForOpen(timeoutMs?: number): Promise<void>;
  waitForMessage(t: string, timeoutMs?: number): Promise<Record<string, unknown>>;
  groundItems(): Ground[];
  waitForGround(pred: (g: Ground[]) => boolean, timeoutMs?: number): Promise<Ground[]>;
  waitForPlayers(pred: (p: Player[]) => boolean, timeoutMs?: number): Promise<Player[]>;
  close(): void;
} {
  const messages: string[] = [];
  // Reconstruct ground state from the delta stream, exactly as the real client does.
  const ground = new Map<number, Ground>();
  const groundWaiters: Array<{ pred: (g: Ground[]) => boolean; resolve: (g: Ground[]) => void; timer: ReturnType<typeof setTimeout> }> = [];
  const players = new Map<string, Player>();
  const playerWaiters: Array<{ pred: (p: Player[]) => boolean; resolve: (p: Player[]) => void; timer: ReturnType<typeof setTimeout> }> = [];
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
    if (t === "delta") {
      const g = obj.ground as { spawns?: Ground[]; updates?: Ground[]; despawns?: number[] };
      for (const id of g.despawns ?? []) ground.delete(id);
      for (const e of g.spawns ?? []) ground.set(e.id, e);
      for (const e of g.updates ?? []) ground.set(e.id, e);
      const arr = [...ground.values()];
      for (let i = groundWaiters.length - 1; i >= 0; i--) {
        if (groundWaiters[i].pred(arr)) {
          clearTimeout(groundWaiters[i].timer);
          groundWaiters[i].resolve(arr);
          groundWaiters.splice(i, 1);
        }
      }
      const pd = obj.players as { spawns?: Player[]; updates?: Player[]; despawns?: string[] };
      for (const id of pd.despawns ?? []) players.delete(id);
      for (const e of pd.spawns ?? []) players.set(e.id, e);
      for (const e of pd.updates ?? []) players.set(e.id, e);
      const parr = [...players.values()];
      for (let i = playerWaiters.length - 1; i >= 0; i--) {
        if (playerWaiters[i].pred(parr)) {
          clearTimeout(playerWaiters[i].timer);
          playerWaiters[i].resolve(parr);
          playerWaiters.splice(i, 1);
        }
      }
    }
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
    groundItems: (): Ground[] => [...ground.values()],
    waitForGround(pred: (g: Ground[]) => boolean, timeoutMs = 3000): Promise<Ground[]> {
      return new Promise((resolve, reject) => {
        const current = [...ground.values()];
        if (pred(current)) { resolve(current); return; }
        const timer = setTimeout(() => reject(new Error("timeout waiting for ground condition")), timeoutMs);
        groundWaiters.push({ pred, resolve, timer });
      });
    },
    waitForPlayers(pred: (p: Player[]) => boolean, timeoutMs = 3000): Promise<Player[]> {
      return new Promise((resolve, reject) => {
        const current = [...players.values()];
        if (pred(current)) { resolve(current); return; }
        const timer = setTimeout(() => reject(new Error("timeout waiting for players condition")), timeoutMs);
        playerWaiters.push({ pred, resolve, timer });
      });
    },
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

test("a joining player sees an existing player and their movement via deltas", async () => {
  srv = startServer(0, ":memory:");

  const alice = wsClient(srv.port);
  await alice.waitForOpen();
  alice.send(JSON.stringify({ t: "login", username: "alice", password: "pw" }));
  await alice.waitForMessage("welcome");

  // Bob joins after alice — his full baseline delta must already include alice.
  const bob = wsClient(srv.port);
  await bob.waitForOpen();
  bob.send(JSON.stringify({ t: "login", username: "bob", password: "pw" }));
  await bob.waitForMessage("welcome");

  const seen = await bob.waitForPlayers((p) => p.some((q) => q.id === "alice"));
  expect(seen.find((q) => q.id === "alice")!.x).toBeCloseTo(24, 5);

  // Alice walks east; a later delta update must move her in bob's reconstructed world.
  alice.send(JSON.stringify({ t: "moveTo", x: 27, y: 24 }));
  const moved = await bob.waitForPlayers((p) => {
    const a = p.find((q) => q.id === "alice");
    return a !== undefined && a.x > 24;
  }, 5000);
  expect(moved.find((q) => q.id === "alice")!.x).toBeGreaterThan(24);

  alice.close();
  bob.close();
}, 10_000);

test("a player leaving the AOI radius despawns, and respawns on return", async () => {
  srv = startServer(0, ":memory:", { aoiRadius: 5 });

  const alice = wsClient(srv.port);
  await alice.waitForOpen();
  alice.send(JSON.stringify({ t: "login", username: "alice", password: "pw" }));
  await alice.waitForMessage("welcome");

  const bob = wsClient(srv.port);
  await bob.waitForOpen();
  bob.send(JSON.stringify({ t: "login", username: "bob", password: "pw" }));
  await bob.waitForMessage("welcome");

  // Both spawn together at (24,24) → within bob's radius, so bob sees alice.
  await bob.waitForPlayers((p) => p.some((q) => q.id === "alice"));

  // Alice walks north up the clear x=24 column to (24,14) — Chebyshev 10 from bob,
  // well past the radius-5 AOI → she is despawned from bob's view.
  alice.send(JSON.stringify({ t: "moveTo", x: 24, y: 14 }));
  await bob.waitForPlayers((p) => !p.some((q) => q.id === "alice"), 8000);

  // Alice walks back to spawn → she re-enters bob's AOI and respawns.
  alice.send(JSON.stringify({ t: "moveTo", x: 24, y: 24 }));
  await bob.waitForPlayers((p) => p.some((q) => q.id === "alice"), 8000);

  alice.close();
  bob.close();
}, 20_000);

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

  // The first delta is a full baseline (every entity as a spawn) — seeded ground included.
  const ground = await client.waitForGround((g) => g.some((it) => it.item === "coins" && it.x === 25 && it.y === 24));
  expect(ground.length).toBeGreaterThanOrEqual(1);
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

  // Picked-up coins are despawned in a subsequent delta.
  const ground = await client.waitForGround((g) => !g.some((it) => it.item === "coins" && it.x === 25 && it.y === 24));
  expect(ground.find((g) => g.item === "coins" && g.x === 25 && g.y === 24)).toBeUndefined();

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

  // Dropped logs appear as a spawn in a subsequent delta.
  const ground = await client.waitForGround((g) => g.some((it) => it.item === "logs" && it.x === 23 && it.y === 24));
  expect(ground.find((g) => g.item === "logs" && g.x === 23 && g.y === 24)).toBeDefined();

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

test("register mode on a taken name returns loginError 'that name is taken'", async () => {
  srv = startServer(0, ":memory:");

  const c1 = wsClient(srv.port);
  await c1.waitForOpen();
  c1.send(JSON.stringify({ t: "login", mode: "register", username: "dup", password: "pw" }));
  await c1.waitForMessage("welcome");
  c1.close();
  await sleep(100); // let close propagate so "dup" is offline

  const c2 = wsClient(srv.port);
  await c2.waitForOpen();
  const errP = c2.waitForMessage("loginError");
  c2.send(JSON.stringify({ t: "login", mode: "register", username: "dup", password: "pw" }));
  const err = await errP;
  expect(String(err.reason)).toMatch(/taken/i);
  c2.close();
});

test("login mode on a missing account returns loginError 'no such account'", async () => {
  srv = startServer(0, ":memory:");

  const c = wsClient(srv.port);
  await c.waitForOpen();
  const errP = c.waitForMessage("loginError");
  c.send(JSON.stringify({ t: "login", mode: "login", username: "nobody", password: "pw" }));
  const err = await errP;
  expect(String(err.reason)).toMatch(/no such account/i);
  c.close();
});

test("login mode with wrong password returns loginError 'wrong password'", async () => {
  srv = startServer(0, ":memory:");

  const c1 = wsClient(srv.port);
  await c1.waitForOpen();
  c1.send(JSON.stringify({ t: "login", mode: "register", username: "pwuser", password: "right" }));
  await c1.waitForMessage("welcome");
  c1.close();
  await sleep(100); // let close propagate so "pwuser" is offline

  const c2 = wsClient(srv.port);
  await c2.waitForOpen();
  const errP = c2.waitForMessage("loginError");
  c2.send(JSON.stringify({ t: "login", mode: "login", username: "pwuser", password: "wrong" }));
  const err = await errP;
  expect(String(err.reason)).toMatch(/wrong password/i);
  c2.close();
});

test("walking onto a portal sends a zone message carrying the new map", async () => {
  srv = startServer(0, ":memory:");
  const c = wsClient(srv.port);
  await c.waitForOpen();
  c.send(JSON.stringify({ t: "login", username: "traveler", password: "pw" }));
  await c.waitForMessage("welcome");
  // Walk onto the overworld portal at (30,30) → cave.
  c.send(JSON.stringify({ t: "moveTo", x: 30, y: 30 }));
  const zone = await c.waitForMessage("zone", 8000);
  expect(zone.zone).toBe("cave");
  expect((zone.map as { width: number }).width).toBe(24); // cave map is 24 wide
  c.close();
}, 12_000);

const scenarioZones: ZoneDef[] = [
  {
    id: "tutorial",
    map: {
      width: 8,
      height: 5,
      tiles: Array(40).fill(0),
      heights: Array(40).fill(0),
      scenery: [],
    },
    spawn: { x: 1, y: 2 },
    seedItems: [],
    npcs: [],
    resources: [],
    portals: [{ x: 3, y: 2, toZone: "overworld", toX: 6, toY: 2 }],
  },
  {
    id: "overworld",
    map: {
      width: 8,
      height: 5,
      tiles: Array(40).fill(0),
      heights: Array(40).fill(0),
      scenery: [],
    },
    spawn: { x: 6, y: 2 },
    seedItems: [],
    npcs: [],
    resources: [],
    portals: [],
  },
];

const serverScenario: ScenarioDef = {
  id: "first_steps",
  version: 1,
  startZone: "tutorial",
  initialItems: [],
  objectives: [
    {
      id: "enter_world",
      text: "Cross into Termenor.",
      when: { kind: "enteredZone", zone: "overworld" },
    },
  ],
  exit: { fromZone: "tutorial", toZone: "overworld" },
};

function scenarioPlayerState(
  overrides: Partial<PlayerStateRecord> = {},
): PlayerStateRecord {
  return {
    x: 1,
    y: 2,
    facing: "east",
    inventory: emptyInventory(),
    skills: {},
    bank: [],
    equipment: emptyEquipment(),
    zone: "tutorial",
    quests: {},
    scenario: {
      scenarioId: serverScenario.id,
      version: serverScenario.version,
      completed: [],
      evidence: [],
      done: false,
    },
    ...overrides,
  };
}

class TestPlayerStore implements PlayerStore {
  readonly saves: PlayerStateRecord[] = [];

  constructor(
    private loaded: PlayerStateRecord,
    private readonly saveEffect: (
      username: string,
      state: PlayerStateRecord,
    ) => Promise<void> = async () => {},
  ) {}

  async getOrCreateAccount(): Promise<AccountResult> {
    return { ok: true, created: false, state: structuredClone(this.loaded) };
  }

  async savePlayerState(username: string, state: PlayerStateRecord): Promise<void> {
    this.saves.push(structuredClone(state));
    await this.saveEffect(username, state);
    this.loaded = structuredClone(state);
  }

  async close(): Promise<void> {}
}

interface PersistenceErrorEvent {
  error: unknown;
  context: {
    operation: "transition" | "disconnect" | "periodic";
    playerId: string;
    fromZone?: string;
    toZone?: string;
  };
}

function deferredSignal(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function decodedMessages(messages: readonly string[]): Record<string, unknown>[] {
  return messages.map((raw) => {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) throw new Error("expected an object message");
    return value;
  });
}

function isDestinationDelta(message: Record<string, unknown>): boolean {
  if (message.t !== "delta" || !isRecord(message.players)) return false;
  for (const field of ["spawns", "updates"]) {
    const entries = message.players[field];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (isRecord(entry) && entry.x === 6 && entry.y === 2) return true;
    }
  }
  return false;
}

test("welcome is immediately followed by authoritative Scenario progress", async () => {
  const store = new TestPlayerStore(scenarioPlayerState());
  srv = startServer(0, ":memory:", {
    store,
    scenario: serverScenario,
    zoneDefs: scenarioZones,
  });
  const client = wsClient(srv.port);
  await client.waitForOpen();
  const welcomeP = client.waitForMessage("welcome");
  const scenarioP = client.waitForMessage("scenario");
  client.send(JSON.stringify({ t: "login", username: "learner", password: "pw" }));

  const welcome = await welcomeP;
  const scenario = await scenarioP;
  expect(welcome.x).toBe(1);
  expect(scenario).toMatchObject({
    scenarioId: "first_steps",
    version: 1,
    objectiveId: "enter_world",
    objectiveText: "Cross into Termenor.",
    completed: [],
    done: false,
  });
  const messages = decodedMessages(client.messages);
  const welcomeIndex = messages.findIndex((message) => message.t === "welcome");
  const scenarioIndex = messages.findIndex((message) => message.t === "scenario");
  expect(scenarioIndex).toBe(welcomeIndex + 1);
  client.close();
});

test("Scenario option replacement after startup does not alter emitted definition", async () => {
  const store = new TestPlayerStore(scenarioPlayerState());
  const options = {
    store,
    scenario: serverScenario,
    zoneDefs: scenarioZones,
  };
  srv = startServer(0, ":memory:", options);
  options.scenario = {
    ...serverScenario,
    id: "replacement",
    version: 99,
    objectives: [{
      id: "replacement_goal",
      text: "Replacement objective.",
      when: { kind: "enteredZone", zone: "overworld" },
    }],
  };
  const client = wsClient(srv.port);
  await client.waitForOpen();
  const scenarioP = client.waitForMessage("scenario");
  client.send(JSON.stringify({ t: "login", username: "alias", password: "pw" }));
  const message = await scenarioP;
  expect(message).toMatchObject({
    scenarioId: "first_steps",
    version: 1,
    objectiveId: "enter_world",
    objectiveText: "Cross into Termenor.",
  });
  client.close();
});
test("committed Scenario completion survives disconnect and reconnect", async () => {
  const disconnectSaved = deferredSignal();
  let saves = 0;
  const store = new TestPlayerStore(
    scenarioPlayerState({ x: 2, y: 2 }),
    async () => {
      saves++;
      if (saves === 2) disconnectSaved.resolve();
    },
  );
  srv = startServer(0, ":memory:", {
    store,
    scenario: serverScenario,
    zoneDefs: scenarioZones,
  });
  const client = wsClient(srv.port);
  await client.waitForOpen();
  const welcomeP = client.waitForMessage("welcome");
  const initialScenarioP = client.waitForMessage("scenario");
  client.send(JSON.stringify({ t: "login", username: "persist-complete", password: "pw" }));
  await welcomeP;
  await initialScenarioP;
  const zoneP = client.waitForMessage("zone");
  const completedP = client.waitForMessage("scenario");
  client.send(JSON.stringify({ t: "moveTo", x: 3, y: 2 }));
  const [zone, completed] = await Promise.all([zoneP, completedP]);
  expect(zone).toMatchObject({ zone: "overworld", x: 6, y: 2 });
  expect(completed).toMatchObject({ completed: ["enter_world"], done: true });

  client.close();
  await disconnectSaved.promise;

  const restored = wsClient(srv.port);
  await restored.waitForOpen();
  const restoredWelcomeP = restored.waitForMessage("welcome");
  const restoredScenarioP = restored.waitForMessage("scenario");
  restored.send(JSON.stringify({ t: "login", username: "persist-complete", password: "pw" }));
  const [restoredWelcome, restoredScenario] = await Promise.all([restoredWelcomeP, restoredScenarioP]);
  expect(restoredWelcome).toMatchObject({ x: 6, y: 2 });
  expect(restoredScenario).toMatchObject({ completed: ["enter_world"], done: true });
  restored.close();
}, 8_000);


test("incompatible persisted Scenario resets progress without discarding Player state", async () => {
  const inventory = emptyInventory();
  inventory[0] = { item: "logs", qty: 3 };
  const store = new TestPlayerStore(scenarioPlayerState({
    x: 1.5,
    y: 3,
    inventory,
    skills: { woodcutting: 42 },
    quests: { cooks_assistant: 2 },
    scenario: {
      scenarioId: "first_steps",
      version: 99,
      completed: ["stale"],
      evidence: [{ objectiveId: "stale", tick: 2 }],
      done: true,
    },
  }));
  srv = startServer(0, ":memory:", {
    store,
    scenario: serverScenario,
    zoneDefs: scenarioZones,
  });
  const client = wsClient(srv.port);
  await client.waitForOpen();
  const welcomeP = client.waitForMessage("welcome");
  const scenarioP = client.waitForMessage("scenario");
  const inventoryP = client.waitForMessage("inventory");
  client.send(JSON.stringify({ t: "login", username: "returner", password: "pw" }));

  const welcome = await welcomeP;
  const scenario = await scenarioP;
  const inventoryMessage = await inventoryP;
  expect(welcome).toMatchObject({ x: 1.5, y: 3 });
  expect(inventoryMessage.slots).toEqual(inventory);
  expect(scenario).toMatchObject({
    scenarioId: "first_steps",
    version: 1,
    objectiveId: "enter_world",
    completed: [],
    done: false,
  });
  client.close();
});

test("disconnect during a rejected final transition save persists the tutorial rollback snapshot", async () => {
  const transitionSaveStarted = deferredSignal();
  const releaseTransitionSave = deferredSignal();
  const disconnectSaveStarted = deferredSignal();
  let rejectTransitionSave = false;
  let saveCount = 0;
  const store = new TestPlayerStore(
    scenarioPlayerState({ x: 3, y: 2 }),
    async () => {
      saveCount++;
      if (saveCount === 1) {
        transitionSaveStarted.resolve();
        await releaseTransitionSave.promise;
        if (rejectTransitionSave) throw new Error("destination save rejected");
      } else if (saveCount === 2) {
        disconnectSaveStarted.resolve();
      }
    },
  );
  srv = startServer(0, ":memory:", {
    store,
    scenario: serverScenario,
    zoneDefs: scenarioZones,
    onPersistenceError: () => {},
  });
  const first = wsClient(srv.port);
  await first.waitForOpen();
  const welcomeP = first.waitForMessage("welcome");
  const initialScenarioP = first.waitForMessage("scenario");
  first.send(JSON.stringify({ t: "login", username: "reject-close", password: "pw" }));
  await welcomeP;
  await initialScenarioP;
  await transitionSaveStarted.promise;

  first.close();
  await sleep(50);
  rejectTransitionSave = true;
  releaseTransitionSave.resolve();
  await disconnectSaveStarted.promise;
  await sleep(50);

  const restored = wsClient(srv.port);
  await restored.waitForOpen();
  const restoredWelcomeP = restored.waitForMessage("welcome");
  const restoredScenarioP = restored.waitForMessage("scenario");
  restored.send(JSON.stringify({ t: "login", username: "reject-close", password: "pw" }));
  const restoredWelcome = await restoredWelcomeP;
  const restoredScenario = await restoredScenarioP;

  expect(restoredWelcome).toMatchObject({ x: 2, y: 2 });
  expect(restoredScenario).toMatchObject({
    scenarioId: "first_steps",
    completed: [],
    done: false,
  });
  expect(store.saves).toHaveLength(2);
  expect(store.saves[0]).toMatchObject({
    zone: "overworld",
    scenario: { completed: ["enter_world"], done: true },
  });
  expect(store.saves[1]).toMatchObject({
    zone: "tutorial",
    x: 2,
    y: 2,
    scenario: { completed: [], done: false },
  });
  restored.close();
}, 8_000);

test("disconnect during a successful final transition save persists the tutorial rollback snapshot", async () => {
  const transitionSaveStarted = deferredSignal();
  const releaseTransitionSave = deferredSignal();
  const disconnectSaveStarted = deferredSignal();
  let saveCount = 0;
  const store = new TestPlayerStore(
    scenarioPlayerState({ x: 3, y: 2 }),
    async () => {
      saveCount++;
      if (saveCount === 1) {
        transitionSaveStarted.resolve();
        await releaseTransitionSave.promise;
      } else if (saveCount === 2) {
        disconnectSaveStarted.resolve();
      }
    },
  );
  srv = startServer(0, ":memory:", {
    store,
    scenario: serverScenario,
    zoneDefs: scenarioZones,
  });
  const first = wsClient(srv.port);
  await first.waitForOpen();
  const welcomeP = first.waitForMessage("welcome");
  const initialScenarioP = first.waitForMessage("scenario");
  first.send(JSON.stringify({ t: "login", username: "success-close", password: "pw" }));
  await welcomeP;
  await initialScenarioP;
  await transitionSaveStarted.promise;

  first.close();
  await sleep(50);
  releaseTransitionSave.resolve();
  await disconnectSaveStarted.promise;
  await sleep(50);

  const restored = wsClient(srv.port);
  await restored.waitForOpen();
  const restoredWelcomeP = restored.waitForMessage("welcome");
  const restoredScenarioP = restored.waitForMessage("scenario");
  restored.send(JSON.stringify({ t: "login", username: "success-close", password: "pw" }));
  const restoredWelcome = await restoredWelcomeP;
  const restoredScenario = await restoredScenarioP;

  expect(restoredWelcome).toMatchObject({ x: 2, y: 2 });
  expect(restoredScenario).toMatchObject({
    scenarioId: "first_steps",
    completed: [],
    done: false,
  });
  expect(store.saves).toHaveLength(2);
  expect(store.saves[0]).toMatchObject({
    zone: "overworld",
    scenario: { completed: ["enter_world"], done: true },
  });
  expect(store.saves[1]).toMatchObject({
    zone: "tutorial",
    x: 2,
    y: 2,
    scenario: { completed: [], done: false },
  });
  restored.close();
}, 8_000);

test("successful final transition is persisted before destination visibility", async () => {
  const saveStarted = deferredSignal();
  const releaseSave = deferredSignal();
  const store = new TestPlayerStore(
    scenarioPlayerState({ x: 3, y: 2 }),
    async () => {
      saveStarted.resolve();
      await releaseSave.promise;
    },
  );
  srv = startServer(0, ":memory:", {
    store,
    scenario: serverScenario,
    zoneDefs: scenarioZones,
  });
  const client = wsClient(srv.port);
  await client.waitForOpen();
  const welcomeP = client.waitForMessage("welcome");
  const initialScenarioP = client.waitForMessage("scenario");
  client.send(JSON.stringify({ t: "login", username: "finisher", password: "pw" }));
  await welcomeP;
  await initialScenarioP;
  await saveStarted.promise;
  await sleep(150);

  const messagesBeforeSave = decodedMessages(client.messages);
  expect(messagesBeforeSave.some((message) => message.t === "zone")).toBe(false);
  expect(messagesBeforeSave.some(
    (message) => message.t === "scenario" && message.done === true,
  )).toBe(false);
  expect(messagesBeforeSave.some(isDestinationDelta)).toBe(false);

  const zoneP = client.waitForMessage("zone");
  const completedP = client.waitForMessage("scenario");
  releaseSave.resolve();
  const zone = await zoneP;
  const completed = await completedP;

  expect(zone).toMatchObject({ zone: "overworld", x: 6, y: 2 });
  expect(completed).toMatchObject({
    scenarioId: "first_steps",
    completed: ["enter_world"],
    done: true,
  });
  expect(store.saves).toHaveLength(1);
  expect(store.saves[0]).toMatchObject({
    zone: "overworld",
    x: 6,
    y: 2,
    scenario: {
      completed: ["enter_world"],
      evidence: [{
        objectiveId: "enter_world",
        tick: expect.any(Number),
      }],
      done: true,
    },
  });
  const messages = decodedMessages(client.messages);
  const zoneIndex = messages.findIndex((message) => message.t === "zone");
  const completedIndex = messages.findIndex(
    (message) => message.t === "scenario" && message.done === true,
  );
  const firstDestinationDelta = messages.findIndex(isDestinationDelta);
  expect(zoneIndex).toBeGreaterThan(-1);
  expect(completedIndex).toBeGreaterThan(zoneIndex);
  expect(firstDestinationDelta === -1 || firstDestinationDelta > completedIndex).toBe(true);
  client.close();
});

test("rejected final save rolls back once beside the portal and remains playable", async () => {
  const store = new TestPlayerStore(
    scenarioPlayerState({ x: 3, y: 2 }),
    async () => { throw new Error("database unavailable"); },
  );
  const persistenceErrors: PersistenceErrorEvent[] = [];
  srv = startServer(0, ":memory:", {
    store,
    scenario: serverScenario,
    zoneDefs: scenarioZones,
    onPersistenceError: (error, context) => {
      persistenceErrors.push({ error, context });
    },
  });
  const client = wsClient(srv.port);
  await client.waitForOpen();
  const welcomeP = client.waitForMessage("welcome");
  const initialScenarioP = client.waitForMessage("scenario");
  const feedbackP = client.waitForMessage("chatMsg");
  client.send(JSON.stringify({ t: "login", username: "blocked", password: "pw" }));
  await welcomeP;
  await initialScenarioP;
  const feedback = await feedbackP;

  expect(feedback.text).toMatch(/could not save.*remain in the tutorial/i);
  await client.waitForPlayers(
    (players) => players.some((player) => player.id === "blocked" && player.x === 2 && player.y === 2),
  );
  await sleep(350);
  expect(store.saves).toHaveLength(1);
  const messagesAfterRollback = decodedMessages(client.messages);
  expect(messagesAfterRollback.some((message) => message.t === "zone")).toBe(false);
  expect(messagesAfterRollback.some(
    (message) => message.t === "scenario" && message.done === true,
  )).toBe(false);
  expect(messagesAfterRollback.some(isDestinationDelta)).toBe(false);
  expect(persistenceErrors).toHaveLength(1);
  expect(persistenceErrors[0]).toMatchObject({
    error: expect.any(Error),
    context: {
      operation: "transition",
      playerId: "blocked",
      fromZone: "tutorial",
      toZone: "overworld",
    },
  });

  client.send(JSON.stringify({ t: "moveTo", x: 1, y: 2 }));
  await client.waitForPlayers(
    (players) => players.some((player) => player.id === "blocked" && player.x < 1.2),
  );
  expect(store.saves).toHaveLength(1);
  client.close();
}, 8_000);

test("an earlier periodic save must finish before the final transition save starts", async () => {
  const firstSaveStarted = deferredSignal();
  const releaseFirstSave = deferredSignal();
  const secondSaveStarted = deferredSignal();
  const releaseSecondSave = deferredSignal();
  const completedWrites: PlayerStateRecord[] = [];
  let invocation = 0;
  const store = new TestPlayerStore(
    scenarioPlayerState(),
    async (_username, state) => {
      invocation++;
      if (invocation === 1) {
        firstSaveStarted.resolve();
        await releaseFirstSave.promise;
      } else if (invocation === 2) {
        secondSaveStarted.resolve();
        await releaseSecondSave.promise;
      }
      completedWrites.push(structuredClone(state));
    },
  );
  srv = startServer(0, ":memory:", {
    store,
    scenario: serverScenario,
    zoneDefs: scenarioZones,
  });
  const client = wsClient(srv.port);
  await client.waitForOpen();
  const welcomeP = client.waitForMessage("welcome");
  const initialScenarioP = client.waitForMessage("scenario");
  client.send(JSON.stringify({ t: "login", username: "ordered", password: "pw" }));
  await welcomeP;
  await initialScenarioP;
  await firstSaveStarted.promise;

  client.send(JSON.stringify({ t: "moveTo", x: 3, y: 2 }));
  await sleep(700);
  expect(store.saves).toHaveLength(1);
  expect(decodedMessages(client.messages).some((message) => message.t === "zone")).toBe(false);

  releaseFirstSave.resolve();
  await secondSaveStarted.promise;
  expect(store.saves).toHaveLength(2);
  expect(decodedMessages(client.messages).some((message) => message.t === "zone")).toBe(false);

  const zoneP = client.waitForMessage("zone");
  const completedP = client.waitForMessage("scenario");
  releaseSecondSave.resolve();
  await zoneP;
  await completedP;

  expect(completedWrites.map((state) => state.zone)).toEqual([
    "tutorial",
    "overworld",
  ]);
  expect(completedWrites[1].scenario?.done).toBe(true);
  client.close();
}, 15_000);

test("a reconnect stays blocked until disconnect persistence settles", async () => {
  const saveStarted = deferredSignal();
  const releaseSave = deferredSignal();
  const store = new TestPlayerStore(
    scenarioPlayerState(),
    async () => {
      saveStarted.resolve();
      await releaseSave.promise;
    },
  );
  srv = startServer(0, ":memory:", {
    store,
    scenario: serverScenario,
    zoneDefs: scenarioZones,
  });
  const first = wsClient(srv.port);
  await first.waitForOpen();
  const firstWelcomeP = first.waitForMessage("welcome");
  first.send(JSON.stringify({ t: "login", username: "reconnecting", password: "pw" }));
  await firstWelcomeP;
  first.close();
  await saveStarted.promise;

  const blocked = wsClient(srv.port);
  await blocked.waitForOpen();
  blocked.send(JSON.stringify({ t: "login", username: "reconnecting", password: "pw" }));
  await sleep(150);
  const blockedMessages = decodedMessages(blocked.messages);
  releaseSave.resolve();
  expect(blockedMessages).toContainEqual({
    t: "loginError",
    reason: "already online",
  });

  await sleep(100);
  const restored = wsClient(srv.port);
  await restored.waitForOpen();
  const restoredWelcomeP = restored.waitForMessage("welcome");
  restored.send(JSON.stringify({ t: "login", username: "reconnecting", password: "pw" }));
  await restoredWelcomeP;
  restored.close();
});

test("one pending transition save does not prevent another Player save from starting", async () => {
  const releaseFirst = deferredSignal();
  const firstStarted = deferredSignal();
  const secondStarted = deferredSignal();
  const store = new TestPlayerStore(
    scenarioPlayerState(),
    async (username) => {
      if (username === "first") {
        firstStarted.resolve();
        await releaseFirst.promise;
      } else if (username === "second") {
        secondStarted.resolve();
      }
    },
  );
  srv = startServer(0, ":memory:", {
    store,
    scenario: serverScenario,
    zoneDefs: scenarioZones,
  });
  const first = wsClient(srv.port);
  const second = wsClient(srv.port);
  await Promise.all([first.waitForOpen(), second.waitForOpen()]);
  const firstWelcomeP = first.waitForMessage("welcome");
  const secondWelcomeP = second.waitForMessage("welcome");
  first.send(JSON.stringify({ t: "login", username: "first", password: "pw" }));
  second.send(JSON.stringify({ t: "login", username: "second", password: "pw" }));
  await Promise.all([firstWelcomeP, secondWelcomeP]);

  first.send(JSON.stringify({ t: "moveTo", x: 3, y: 2 }));
  second.send(JSON.stringify({ t: "moveTo", x: 3, y: 2 }));
  await firstStarted.promise;
  await secondStarted.promise;

  expect(store.saves).toHaveLength(2);
  releaseFirst.resolve();
  await Promise.all([
    first.waitForMessage("zone"),
    second.waitForMessage("zone"),
  ]);
  first.close();
  second.close();
}, 8_000);

test("rollback remains safe when the persistence reporter throws", async () => {
  const store = new TestPlayerStore(
    scenarioPlayerState({ x: 3, y: 2 }),
    async () => { throw new Error("database unavailable"); },
  );
  srv = startServer(0, ":memory:", {
    store,
    scenario: serverScenario,
    zoneDefs: scenarioZones,
    onPersistenceError: () => { throw new Error("reporter failed"); },
  });
  const client = wsClient(srv.port);
  await client.waitForOpen();
  const welcomeP = client.waitForMessage("welcome");
  const feedbackP = client.waitForMessage("chatMsg");
  client.send(JSON.stringify({ t: "login", username: "safe-report", password: "pw" }));
  await welcomeP;
  const feedback = await feedbackP;

  expect(feedback.text).toMatch(/remain in the tutorial/i);
  await client.waitForPlayers(
    (players) => players.some(
      (player) => player.id === "safe-report" && player.x === 2 && player.y === 2,
    ),
  );
  expect(decodedMessages(client.messages).some((message) => message.t === "zone")).toBe(false);

  client.send(JSON.stringify({ t: "moveTo", x: 1, y: 2 }));
  await client.waitForPlayers(
    (players) => players.some((player) => player.id === "safe-report" && player.x < 1.2),
  );
  client.close();
}, 8_000);

test("a rejected disconnect save retains state and blocks reconnect until retry succeeds", async () => {
  const firstSaveFailed = deferredSignal();
  const retryStarted = deferredSignal();
  const releaseRetry = deferredSignal();
  const persistenceErrors: PersistenceErrorEvent[] = [];
  let attempts = 0;
  const store = new TestPlayerStore(
    scenarioPlayerState(),
    async () => {
      attempts++;
      if (attempts === 1) {
        firstSaveFailed.resolve();
        throw new Error("temporary disconnect failure");
      }
      retryStarted.resolve();
      await releaseRetry.promise;
    },
  );
  srv = startServer(0, ":memory:", {
    store,
    scenario: serverScenario,
    zoneDefs: scenarioZones,
    onPersistenceError: (error, context) => {
      persistenceErrors.push({ error, context });
    },
  });
  const first = wsClient(srv.port);
  await first.waitForOpen();
  const welcomeP = first.waitForMessage("welcome");
  first.send(JSON.stringify({ t: "login", username: "retrying-close", password: "pw" }));
  await welcomeP;
  first.send(JSON.stringify({ t: "moveTo", x: 2, y: 2 }));
  await first.waitForPlayers(
    (players) => players.some((player) => player.id === "retrying-close" && player.x === 2),
  );
  first.close();
  await firstSaveFailed.promise;
  await sleep(50);

  const blocked = wsClient(srv.port);
  await blocked.waitForOpen();
  blocked.send(JSON.stringify({ t: "login", username: "retrying-close", password: "pw" }));
  await sleep(100);
  expect(decodedMessages(blocked.messages)).toContainEqual({
    t: "loginError",
    reason: "already online",
  });

  await retryStarted.promise;
  releaseRetry.resolve();
  await sleep(100);
  const restored = wsClient(srv.port);
  await restored.waitForOpen();
  const restoredWelcomeP = restored.waitForMessage("welcome");
  restored.send(JSON.stringify({ t: "login", username: "retrying-close", password: "pw" }));
  const restoredWelcome = await restoredWelcomeP;
  expect(restoredWelcome.x).toBe(2);
  expect(persistenceErrors).toContainEqual({
    error: expect.any(Error),
    context: {
      operation: "disconnect",
      playerId: "retrying-close",
    },
  });
  restored.close();
}, 8_000);

test("periodic save rejection stays safe when its reporter rejects asynchronously", async () => {
  const persistenceErrors: PersistenceErrorEvent[] = [];
  const periodicReported = deferredSignal();
  let attempts = 0;
  const store = new TestPlayerStore(
    scenarioPlayerState(),
    async () => {
      attempts++;
      if (attempts === 1) throw new Error("temporary periodic failure");
    },
  );
  srv = startServer(0, ":memory:", {
    store,
    scenario: serverScenario,
    zoneDefs: scenarioZones,
    onPersistenceError: async (error, context) => {
      persistenceErrors.push({ error, context });
      if (context.operation === "periodic") periodicReported.resolve();
      throw new Error("async periodic reporter failed");
    },
  });
  const client = wsClient(srv.port);
  await client.waitForOpen();
  const welcomeP = client.waitForMessage("welcome");
  client.send(JSON.stringify({ t: "login", username: "periodic", password: "pw" }));
  await welcomeP;
  await periodicReported.promise;

  expect(persistenceErrors).toContainEqual({
    error: expect.any(Error),
    context: {
      operation: "periodic",
      playerId: "periodic",
    },
  });
  client.send(JSON.stringify({ t: "moveTo", x: 2, y: 2 }));
  await client.waitForPlayers(
    (players) => players.some((player) => player.id === "periodic" && player.x === 2),
  );
  client.close();
}, 8_000);

test("rollback contains an asynchronously rejecting persistence reporter", async () => {
  const store = new TestPlayerStore(
    scenarioPlayerState({ x: 3, y: 2 }),
    async () => { throw new Error("database unavailable"); },
  );
  srv = startServer(0, ":memory:", {
    store,
    scenario: serverScenario,
    zoneDefs: scenarioZones,
    onPersistenceError: async () => {
      throw new Error("async reporter failed");
    },
  });
  const client = wsClient(srv.port);
  await client.waitForOpen();
  const welcomeP = client.waitForMessage("welcome");
  const feedbackP = client.waitForMessage("chatMsg");
  client.send(JSON.stringify({ t: "login", username: "safe-async-report", password: "pw" }));
  await welcomeP;
  const feedback = await feedbackP;

  expect(feedback.text).toMatch(/remain in the tutorial/i);
  await client.waitForPlayers(
    (players) => players.some(
      (player) => player.id === "safe-async-report" && player.x === 2 && player.y === 2,
    ),
  );
  await sleep(0);
  expect(decodedMessages(client.messages).some((message) => message.t === "zone")).toBe(false);
  client.close();
}, 8_000);

test("a genuinely new registered account starts in the tutorial with its own Scenario loadout", async () => {
  srv = startServer(0, ":memory:", {
    scenario: TUTORIAL_SCENARIO,
    zoneDefs: [TUTORIAL_ZONE, ...ZONE_DEFS],
  });
  const client = wsClient(srv.port);
  await client.waitForOpen();
  const welcomeP = client.waitForMessage("welcome");
  const scenarioP = client.waitForMessage("scenario");
  const inventoryP = client.waitForMessage("inventory");
  client.send(JSON.stringify({
    t: "login",
    mode: "register",
    username: "fresh-learner",
    password: "pw",
  }));

  const [welcome, scenario, inventory] = await Promise.all([welcomeP, scenarioP, inventoryP]);
  expect(welcome).toMatchObject({
    x: TUTORIAL_ZONE.spawn.x,
    y: TUTORIAL_ZONE.spawn.y,
  });
  expect(isRecord(welcome.map) && welcome.map.width).toBe(TUTORIAL_ZONE.map.width);
  expect(scenario).toMatchObject({
    scenarioId: "first_steps",
    objectiveId: "meet_guide",
    done: false,
  });
  expect(Array.isArray(inventory.slots)).toBe(true);
  if (!Array.isArray(inventory.slots)) throw new Error("inventory slots missing");
  expect(inventory.slots).toContainEqual({ item: "bronze_axe", qty: 1 });
  client.close();
});

test("a successful tutorial Gather pushes the changed Inventory to the client", async () => {
  srv = startServer(0, ":memory:", {
    scenario: TUTORIAL_SCENARIO,
    zoneDefs: [TUTORIAL_ZONE, ...ZONE_DEFS],
  });
  const client = wsClient(srv.port);
  await client.waitForOpen();
  const welcomeP = client.waitForMessage("welcome");
  const initialInventoryP = client.waitForMessage("inventory");
  client.send(JSON.stringify({
    t: "login",
    mode: "register",
    username: "gathering-learner",
    password: "pw",
  }));
  await Promise.all([welcomeP, initialInventoryP]);

  const changedInventoryP = client.waitForMessage("inventory");
  client.send(JSON.stringify({ t: "gather", targetId: "res-1" }));
  const changedInventory = await changedInventoryP;
  expect(Array.isArray(changedInventory.slots)).toBe(true);
  if (!Array.isArray(changedInventory.slots)) throw new Error("inventory slots missing");
  expect(changedInventory.slots).toContainEqual({ item: "logs", qty: 1 });
  client.close();
});

test("an existing account retains its saved Zone and Inventory when a Scenario is active", async () => {
  const inventory = emptyInventory();
  inventory[4] = { item: "logs", qty: 3 };
  const store = new TestPlayerStore(scenarioPlayerState({
    x: 25,
    y: 24,
    zone: "overworld",
    inventory,
    scenario: null,
  }));
  srv = startServer(0, ":memory:", {
    store,
    scenario: TUTORIAL_SCENARIO,
    zoneDefs: [TUTORIAL_ZONE, ...ZONE_DEFS],
  });
  const client = wsClient(srv.port);
  await client.waitForOpen();
  const welcomeP = client.waitForMessage("welcome");
  const inventoryP = client.waitForMessage("inventory");
  client.send(JSON.stringify({ t: "login", mode: "login", username: "returner", password: "pw" }));

  const [welcome, inventoryMessage] = await Promise.all([welcomeP, inventoryP]);
  expect(welcome).toMatchObject({ x: 25, y: 24 });
  expect(isRecord(welcome.map) && welcome.map.width).toBe(ZONE_DEFS[0].map.width);
  expect(Array.isArray(inventoryMessage.slots)).toBe(true);
  if (!Array.isArray(inventoryMessage.slots)) throw new Error("inventory slots missing");
  expect(inventoryMessage.slots[4]).toEqual({ item: "logs", qty: 3 });
  expect(inventoryMessage.slots).not.toContainEqual({ item: "bronze_axe", qty: 1 });
  expect(decodedMessages(client.messages).some((message) => message.t === "scenario")).toBe(false);
  client.close();
});

test("authenticated Inventory Examine advances from the server-observed slot Item", async () => {
  const inventory = emptyInventory();
  inventory[2] = { item: "arrow_shafts", qty: 1 };
  const completed = TUTORIAL_SCENARIO.objectives.slice(0, 3).map((objective) => objective.id);
  const evidence = completed.map((objectiveId, index) => ({ objectiveId, tick: index + 1 }));
  evidence.push({ objectiveId: "gain_fletching_xp", tick: 3 });
  const store = new TestPlayerStore(scenarioPlayerState({
    x: TUTORIAL_ZONE.spawn.x,
    y: TUTORIAL_ZONE.spawn.y,
    zone: "tutorial",
    inventory,
    scenario: {
      scenarioId: TUTORIAL_SCENARIO.id,
      version: TUTORIAL_SCENARIO.version,
      completed,
      evidence,
      done: false,
    },
  }));
  srv = startServer(0, ":memory:", {
    store,
    scenario: TUTORIAL_SCENARIO,
    zoneDefs: [TUTORIAL_ZONE, ...ZONE_DEFS],
  });
  const client = wsClient(srv.port);
  await client.waitForOpen();
  const welcomeP = client.waitForMessage("welcome");
  const initialScenarioP = client.waitForMessage("scenario");
  client.send(JSON.stringify({ t: "login", username: "examiner", password: "pw" }));
  await welcomeP;
  const initialScenario = await initialScenarioP;
  expect(initialScenario.objectiveId).toBe("use_inventory");

  const staleFeedbackP = client.waitForMessage("chatMsg");
  client.send(JSON.stringify({ t: "inventoryAction", action: "examine", slot: 3 }));
  expect(await staleFeedbackP).toMatchObject({
    from: "",
    text: "That Inventory slot changed. Select the item and try Examine again.",
  });

  const advancedScenarioP = client.waitForMessage("scenario");
  client.send(JSON.stringify({ t: "inventoryAction", action: "examine", slot: 2 }));
  const advancedScenario = await advancedScenarioP;
  expect(advancedScenario).toMatchObject({
    objectiveId: "enter_world",
    completed: [
      "meet_guide",
      "gather_logs",
      "fletch_logs",
      "use_inventory",
      "gain_fletching_xp",
    ],
    done: false,
  });
  client.close();
});

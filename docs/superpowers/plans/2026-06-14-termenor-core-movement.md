# Termenor Core Movement Implementation Plan (Plan A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the server-authoritative, networked tile-movement core — protocol, A* pathfinding, 15 Hz game loop, WebSocket transport, and the client-side game-state model + netcode — all headless-testable with no terminal-rendering dependency.

**Architecture:** Bun-workspaces monorepo. A shared `protocol` package is the single source of truth for wire types. The `server` runs an authoritative fixed-tick loop that pathfinds (A*) and advances continuous player positions, broadcasting snapshots over WebSocket. The `client` package here contains only the netcode (`Connection`) and the interpolating game-state model (`GameState`) — the renderer is Plan B. One-way data flow: net → model.

**Tech Stack:** TypeScript, Bun (runtime + `bun test` + `Bun.serve` WebSocket). No build step — Bun runs `.ts` directly.

---

### Task 0: Monorepo scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `packages/protocol/package.json`
- Create: `packages/server/package.json`
- Create: `packages/client/package.json`

- [ ] **Step 1: Root `package.json`**

```json
{
  "name": "termenor",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "test": "bun test",
    "server": "bun run packages/server/src/index.ts"
  }
}
```

- [ ] **Step 2: Root `tsconfig.json`**

```json
{
  "compilerOptions": {
    "strict": true,
    "module": "esnext",
    "target": "esnext",
    "moduleResolution": "bundler",
    "types": ["bun-types"],
    "skipLibCheck": true,
    "noEmit": true,
    "paths": {
      "@termenor/protocol": ["./packages/protocol/src/index.ts"]
    },
    "baseUrl": "."
  }
}
```

- [ ] **Step 3: Package manifests**

`packages/protocol/package.json`:
```json
{ "name": "@termenor/protocol", "version": "0.0.0", "type": "module", "main": "src/index.ts" }
```
`packages/server/package.json`:
```json
{ "name": "@termenor/server", "version": "0.0.0", "type": "module", "main": "src/index.ts",
  "dependencies": { "@termenor/protocol": "workspace:*" } }
```
`packages/client/package.json`:
```json
{ "name": "@termenor/client", "version": "0.0.0", "type": "module", "main": "src/index.ts",
  "dependencies": { "@termenor/protocol": "workspace:*" } }
```

- [ ] **Step 4: Install + verify workspace resolution**

Run: `bun install`
Expected: completes, creates `node_modules` with `@termenor/*` symlinks.

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json packages bun.lock
git commit -m "chore: scaffold bun-workspaces monorepo"
```

---

### Task 1: Protocol — types and codec

**Files:**
- Create: `packages/protocol/src/index.ts`
- Test: `packages/protocol/src/index.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/protocol/src/index.test.ts
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
    map: { width: 2, height: 1, tiles: [0, 1] },
  };
  expect(decodeServer(encode(msg))).toEqual(msg);
});

test("decodeClient rejects unknown type", () => {
  expect(() => decodeClient(JSON.stringify({ t: "nope" }))).toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/protocol`
Expected: FAIL — cannot find module `./index`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/protocol/src/index.ts
export type Facing = "north" | "south" | "east" | "west";

/** Row-major grid. 0 = walkable, 1 = blocked. */
export interface MapData {
  width: number;
  height: number;
  tiles: number[];
}

/** x/y are continuous tile coords (floats) so clients can interpolate. */
export interface PlayerState {
  id: string;
  x: number;
  y: number;
  facing: Facing;
}

export interface HelloMsg { t: "hello"; }
export interface MoveToMsg { t: "moveTo"; x: number; y: number; }
export type ClientMsg = HelloMsg | MoveToMsg;

export interface WelcomeMsg { t: "welcome"; playerId: string; map: MapData; tickRate: number; }
export interface SnapshotMsg { t: "snapshot"; tick: number; players: PlayerState[]; }
export type ServerMsg = WelcomeMsg | SnapshotMsg;

export function encode(msg: ClientMsg | ServerMsg): string {
  return JSON.stringify(msg);
}

const CLIENT_TYPES = new Set(["hello", "moveTo"]);
const SERVER_TYPES = new Set(["welcome", "snapshot"]);

export function decodeClient(data: string): ClientMsg {
  const obj = JSON.parse(data);
  if (!obj || !CLIENT_TYPES.has(obj.t)) throw new Error(`bad client message: ${data}`);
  return obj as ClientMsg;
}

export function decodeServer(data: string): ServerMsg {
  const obj = JSON.parse(data);
  if (!obj || !SERVER_TYPES.has(obj.t)) throw new Error(`bad server message: ${data}`);
  return obj as ServerMsg;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/protocol`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/protocol
git commit -m "feat(protocol): wire types and JSON codec"
```

---

### Task 2: Server — A* pathfinding

**Files:**
- Create: `packages/server/src/pathfinding.ts`
- Test: `packages/server/src/pathfinding.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/src/pathfinding.test.ts
import { test, expect } from "bun:test";
import type { MapData } from "@termenor/protocol";
import { findPath, isWalkable } from "./pathfinding";

// 3x3 open grid
const open: MapData = { width: 3, height: 3, tiles: [0,0,0, 0,0,0, 0,0,0] };

test("straight path returns steps excluding origin, including target", () => {
  const path = findPath(open, { x: 0, y: 0 }, { x: 2, y: 0 });
  expect(path).toEqual([{ x: 1, y: 0 }, { x: 2, y: 0 }]);
});

test("path routes around a wall", () => {
  // wall down the middle column except bottom row
  const map: MapData = { width: 3, height: 3, tiles: [0,1,0, 0,1,0, 0,0,0] };
  const path = findPath(map, { x: 0, y: 0 }, { x: 2, y: 0 })!;
  expect(path.at(-1)).toEqual({ x: 2, y: 0 });
  // every step must be walkable
  for (const p of path) expect(isWalkable(map, p.x, p.y)).toBe(true);
});

test("unreachable target returns null", () => {
  // target fully walled off
  const map: MapData = { width: 3, height: 3, tiles: [0,1,0, 1,1,0, 0,1,0] };
  expect(findPath(map, { x: 0, y: 0 }, { x: 2, y: 0 })).toBeNull();
});

test("blocked target returns null", () => {
  const map: MapData = { width: 3, height: 3, tiles: [0,0,0, 0,1,0, 0,0,0] };
  expect(findPath(map, { x: 0, y: 0 }, { x: 1, y: 1 })).toBeNull();
});

test("same-tile target returns empty path", () => {
  expect(findPath(open, { x: 1, y: 1 }, { x: 1, y: 1 })).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/server/src/pathfinding.test.ts`
Expected: FAIL — cannot find module `./pathfinding`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/server/src/pathfinding.ts
import type { MapData } from "@termenor/protocol";

export interface Point { x: number; y: number; }

export function isWalkable(map: MapData, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
  return map.tiles[y * map.width + x] === 0;
}

const key = (x: number, y: number) => `${x},${y}`;
const NEIGHBORS = [ [1,0], [-1,0], [0,1], [0,-1] ];

/**
 * 4-connected A*. Returns the list of steps AFTER `from` up to and including
 * `to`. Empty array if from === to. null if `to` is blocked or unreachable.
 */
export function findPath(map: MapData, from: Point, to: Point): Point[] | null {
  if (!isWalkable(map, to.x, to.y)) return null;
  if (from.x === to.x && from.y === to.y) return [];

  const h = (x: number, y: number) => Math.abs(x - to.x) + Math.abs(y - to.y);
  const open: Array<{ x: number; y: number; g: number; f: number }> = [
    { x: from.x, y: from.y, g: 0, f: h(from.x, from.y) },
  ];
  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>([[key(from.x, from.y), 0]]);
  const closed = new Set<string>();

  while (open.length > 0) {
    // pick lowest f (small grids — linear scan is fine)
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0];
    const ck = key(cur.x, cur.y);
    if (cur.x === to.x && cur.y === to.y) {
      // reconstruct
      const path: Point[] = [];
      let k: string | undefined = ck;
      while (k && k !== key(from.x, from.y)) {
        const [px, py] = k.split(",").map(Number);
        path.push({ x: px, y: py });
        k = cameFrom.get(k);
      }
      return path.reverse();
    }
    if (closed.has(ck)) continue;
    closed.add(ck);

    for (const [dx, dy] of NEIGHBORS) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (!isWalkable(map, nx, ny)) continue;
      const nk = key(nx, ny);
      if (closed.has(nk)) continue;
      const tentative = cur.g + 1;
      if (tentative < (gScore.get(nk) ?? Infinity)) {
        cameFrom.set(nk, ck);
        gScore.set(nk, tentative);
        open.push({ x: nx, y: ny, g: tentative, f: tentative + h(nx, ny) });
      }
    }
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/server/src/pathfinding.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/pathfinding.ts packages/server/src/pathfinding.test.ts
git commit -m "feat(server): A* pathfinding over walkable grid"
```

---

### Task 3: Server — world map generator

**Files:**
- Create: `packages/server/src/world.ts`
- Test: `packages/server/src/world.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/src/world.test.ts
import { test, expect } from "bun:test";
import { createDefaultMap } from "./world";
import { isWalkable } from "./pathfinding";

test("default map has expected dimensions", () => {
  const map = createDefaultMap();
  expect(map.width).toBe(48);
  expect(map.height).toBe(48);
  expect(map.tiles.length).toBe(48 * 48);
});

test("borders are blocked", () => {
  const map = createDefaultMap();
  expect(isWalkable(map, 0, 0)).toBe(false);
  expect(isWalkable(map, 47, 47)).toBe(false);
});

test("center is walkable", () => {
  const map = createDefaultMap();
  expect(isWalkable(map, 24, 24)).toBe(true);
});

test("tiles are only 0 or 1", () => {
  const map = createDefaultMap();
  for (const t of map.tiles) expect(t === 0 || t === 1).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/server/src/world.test.ts`
Expected: FAIL — cannot find module `./world`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/server/src/world.ts
import type { MapData } from "@termenor/protocol";

const W = 48;
const H = 48;

/** Static map for the slice: walled border plus a few rectangular obstacles. */
export function createDefaultMap(): MapData {
  const tiles = new Array(W * H).fill(0);
  const set = (x: number, y: number) => { tiles[y * W + x] = 1; };

  // border walls
  for (let x = 0; x < W; x++) { set(x, 0); set(x, H - 1); }
  for (let y = 0; y < H; y++) { set(0, y); set(W - 1, y); }

  // a few interior obstacle blocks (kept away from spawn at 24,24)
  const blocks = [
    { x: 8, y: 8, w: 4, h: 4 },
    { x: 34, y: 10, w: 5, h: 3 },
    { x: 12, y: 30, w: 3, h: 6 },
    { x: 32, y: 32, w: 6, h: 4 },
  ];
  for (const b of blocks)
    for (let yy = b.y; yy < b.y + b.h; yy++)
      for (let xx = b.x; xx < b.x + b.w; xx++) set(xx, yy);

  return { width: W, height: H, tiles };
}

/** Default spawn — guaranteed walkable in the map above. */
export const SPAWN = { x: 24, y: 24 };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/server/src/world.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/world.ts packages/server/src/world.test.ts
git commit -m "feat(server): static default world map"
```

---

### Task 4: Server — game loop and player movement

**Files:**
- Create: `packages/server/src/game.ts`
- Test: `packages/server/src/game.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/src/game.test.ts
import { test, expect } from "bun:test";
import type { MapData } from "@termenor/protocol";
import { Game } from "./game";

// open 10x1 corridor
const corridor: MapData = { width: 10, height: 1, tiles: new Array(10).fill(0) };

test("addPlayer spawns at given tile and appears in snapshot", () => {
  const g = new Game(corridor, { x: 0, y: 0 });
  g.addPlayer("p1");
  const snap = g.snapshot();
  expect(snap.players).toHaveLength(1);
  expect(snap.players[0]).toMatchObject({ id: "p1", x: 0, y: 0 });
});

test("player walks to target over time and stops there", () => {
  const g = new Game(corridor, { x: 0, y: 0 });
  g.addPlayer("p1");
  g.queueMove("p1", 4, 0); // 4 tiles at 5 tiles/s = 0.8s
  // advance 1 second in 66ms steps
  for (let i = 0; i < 16; i++) g.step(1 / 15);
  const p = g.snapshot().players[0];
  expect(p.x).toBeCloseTo(4, 5);
  expect(p.y).toBeCloseTo(0, 5);
});

test("facing updates toward movement direction", () => {
  const g = new Game(corridor, { x: 0, y: 0 });
  g.addPlayer("p1");
  g.queueMove("p1", 3, 0);
  g.step(1 / 15);
  expect(g.snapshot().players[0].facing).toBe("east");
});

test("queueMove to unwalkable tile is ignored", () => {
  const map: MapData = { width: 3, height: 1, tiles: [0, 1, 0] };
  const g = new Game(map, { x: 0, y: 0 });
  g.addPlayer("p1");
  g.queueMove("p1", 1, 0); // blocked
  for (let i = 0; i < 10; i++) g.step(1 / 15);
  expect(g.snapshot().players[0]).toMatchObject({ x: 0, y: 0 });
});

test("two players tracked independently", () => {
  const g = new Game(corridor, { x: 0, y: 0 });
  g.addPlayer("a");
  g.addPlayer("b");
  g.queueMove("a", 2, 0);
  for (let i = 0; i < 10; i++) g.step(1 / 15);
  const byId = Object.fromEntries(g.snapshot().players.map((p) => [p.id, p]));
  expect(byId.a.x).toBeCloseTo(2, 5);
  expect(byId.b.x).toBeCloseTo(0, 5);
});

test("removePlayer drops it from snapshot", () => {
  const g = new Game(corridor, { x: 0, y: 0 });
  g.addPlayer("a");
  g.removePlayer("a");
  expect(g.snapshot().players).toHaveLength(0);
});

test("tick counter increments each step", () => {
  const g = new Game(corridor, { x: 0, y: 0 });
  g.step(1 / 15);
  g.step(1 / 15);
  expect(g.snapshot().tick).toBe(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/server/src/game.test.ts`
Expected: FAIL — cannot find module `./game`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/server/src/game.ts
import type { Facing, MapData, PlayerState, SnapshotMsg } from "@termenor/protocol";
import { findPath, type Point } from "./pathfinding";

const SPEED = 5; // tiles per second  → ~200ms per tile

interface Player {
  id: string;
  x: number;
  y: number;
  facing: Facing;
  path: Point[]; // remaining waypoints (tile centers)
}

function facingTo(dx: number, dy: number, fallback: Facing): Facing {
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "east" : "west";
  if (dy !== 0) return dy > 0 ? "south" : "north";
  return fallback;
}

export class Game {
  readonly map: MapData;
  private spawn: Point;
  private players = new Map<string, Player>();
  private tick = 0;

  constructor(map: MapData, spawn: Point) {
    this.map = map;
    this.spawn = spawn;
  }

  addPlayer(id: string): void {
    this.players.set(id, {
      id, x: this.spawn.x, y: this.spawn.y, facing: "south", path: [],
    });
  }

  removePlayer(id: string): void {
    this.players.delete(id);
  }

  queueMove(id: string, x: number, y: number): void {
    const p = this.players.get(id);
    if (!p) return;
    const path = findPath(this.map, { x: Math.round(p.x), y: Math.round(p.y) }, { x, y });
    if (path === null) return; // unwalkable / unreachable — ignore
    p.path = path;
  }

  /** Advance the world by dt seconds. */
  step(dt: number): void {
    this.tick++;
    for (const p of this.players.values()) {
      let budget = SPEED * dt;
      while (budget > 0 && p.path.length > 0) {
        const target = p.path[0];
        const dx = target.x - p.x;
        const dy = target.y - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= budget) {
          p.x = target.x;
          p.y = target.y;
          p.facing = facingTo(dx, dy, p.facing);
          p.path.shift();
          budget -= dist;
        } else {
          p.x += (dx / dist) * budget;
          p.y += (dy / dist) * budget;
          p.facing = facingTo(dx, dy, p.facing);
          budget = 0;
        }
      }
    }
  }

  snapshot(): SnapshotMsg {
    const players: PlayerState[] = [...this.players.values()].map((p) => ({
      id: p.id, x: p.x, y: p.y, facing: p.facing,
    }));
    return { t: "snapshot", tick: this.tick, players };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/server/src/game.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/game.ts packages/server/src/game.test.ts
git commit -m "feat(server): authoritative game loop with path-following movement"
```

---

### Task 5: Server — WebSocket transport and entry point

**Files:**
- Create: `packages/server/src/server.ts`
- Create: `packages/server/src/index.ts`
- Test: `packages/server/src/server.test.ts`

- [ ] **Step 1: Write the failing test (integration over a real local socket)**

```ts
// packages/server/src/server.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/server/src/server.test.ts`
Expected: FAIL — cannot find module `./server`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/server/src/server.ts
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

  const server = Bun.serve<Conn, undefined>({
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
    port: server.port,
    stop() { clearInterval(interval); server.stop(true); },
  };
}
```

```ts
// packages/server/src/index.ts
import { startServer } from "./server";

const port = Number(process.env.PORT ?? 3000);
const server = startServer(port);
console.log(`termenor server listening on ws://localhost:${server.port}`);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/server/src/server.test.ts`
Expected: PASS (1 test). Note: `server.publish` broadcasts to subscribers of the `"world"` topic.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/server.ts packages/server/src/index.ts packages/server/src/server.test.ts
git commit -m "feat(server): websocket transport and 15Hz broadcast loop"
```

---

### Task 6: Client — interpolating game-state model

**Files:**
- Create: `packages/client/src/game-state.ts`
- Test: `packages/client/src/game-state.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/client/src/game-state.test.ts
import { test, expect } from "bun:test";
import type { SnapshotMsg } from "@termenor/protocol";
import { GameState, INTERP_DELAY_MS } from "./game-state";

const snap = (tick: number, x: number): SnapshotMsg => ({
  t: "snapshot", tick, players: [{ id: "a", x, y: 0, facing: "east" }],
});

test("samplePositions returns empty before any snapshot", () => {
  const gs = new GameState();
  expect(gs.samplePositions(1000)).toEqual([]);
});

test("interpolates linearly between two snapshots", () => {
  const gs = new GameState();
  gs.applySnapshot(snap(1, 0), 1000);
  gs.applySnapshot(snap(2, 10), 1100); // 100ms apart, moved 0→10
  // render time held INTERP_DELAY_MS behind the latest snapshot.
  // ask for the midpoint between the two snapshot timestamps.
  const renderTime = 1050 + INTERP_DELAY_MS;
  const players = gs.samplePositions(renderTime);
  expect(players[0].x).toBeCloseTo(5, 5);
});

test("clamps to latest when render time is past newest snapshot", () => {
  const gs = new GameState();
  gs.applySnapshot(snap(1, 0), 1000);
  gs.applySnapshot(snap(2, 10), 1100);
  const players = gs.samplePositions(5000);
  expect(players[0].x).toBeCloseTo(10, 5);
});

test("setMap / setLocalId expose state", () => {
  const gs = new GameState();
  gs.setMap({ width: 2, height: 1, tiles: [0, 0] });
  gs.setLocalId("a");
  expect(gs.map?.width).toBe(2);
  expect(gs.localId).toBe("a");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/client/src/game-state.test.ts`
Expected: FAIL — cannot find module `./game-state`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/client/src/game-state.ts
import type { Facing, MapData, PlayerState, SnapshotMsg } from "@termenor/protocol";

/** How far behind real time we render, to always have two snapshots to lerp. */
export const INTERP_DELAY_MS = 100;

export interface RenderPlayer { id: string; x: number; y: number; facing: Facing; }

interface Frame { time: number; players: Map<string, PlayerState>; }

export class GameState {
  map: MapData | null = null;
  localId: string | null = null;
  private frames: Frame[] = []; // chronological; keep last 2

  setMap(map: MapData): void { this.map = map; }
  setLocalId(id: string): void { this.localId = id; }

  applySnapshot(snap: SnapshotMsg, now: number): void {
    const players = new Map(snap.players.map((p) => [p.id, p]));
    this.frames.push({ time: now, players });
    if (this.frames.length > 2) this.frames.shift();
  }

  /** Interpolated positions at the given render time (ms). */
  samplePositions(renderTime: number): RenderPlayer[] {
    if (this.frames.length === 0) return [];
    if (this.frames.length === 1) return frameToPlayers(this.frames[0]);

    const [a, b] = this.frames;
    const target = renderTime - INTERP_DELAY_MS;
    if (target <= a.time) return frameToPlayers(a);
    if (target >= b.time) return frameToPlayers(b);

    const t = (target - a.time) / (b.time - a.time);
    const out: RenderPlayer[] = [];
    for (const [id, pb] of b.players) {
      const pa = a.players.get(id);
      if (!pa) { out.push({ ...pb }); continue; }
      out.push({
        id,
        x: pa.x + (pb.x - pa.x) * t,
        y: pa.y + (pb.y - pa.y) * t,
        facing: pb.facing,
      });
    }
    return out;
  }
}

function frameToPlayers(f: Frame): RenderPlayer[] {
  return [...f.players.values()].map((p) => ({ id: p.id, x: p.x, y: p.y, facing: p.facing }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/client/src/game-state.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/game-state.ts packages/client/src/game-state.test.ts
git commit -m "feat(client): interpolating game-state model"
```

---

### Task 7: Client — netcode connection

**Files:**
- Create: `packages/client/src/connection.ts`
- Test: `packages/client/src/connection.test.ts`

- [ ] **Step 1: Write the failing test (with a mock socket)**

```ts
// packages/client/src/connection.test.ts
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
    map: { width: 3, height: 1, tiles: [0,0,0] } }));
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/client/src/connection.test.ts`
Expected: FAIL — cannot find module `./connection`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/client/src/connection.ts
import { decodeServer, encode, type MoveToMsg } from "@termenor/protocol";
import type { GameState } from "./game-state";

/** Minimal socket surface so tests can inject a mock. */
export interface SocketLike {
  onopen?: () => void;
  onmessage?: (data: string) => void;
  onclose?: () => void;
  send(data: string): void;
  close(): void;
}
export type SocketFactory = (url: string) => SocketLike;

export interface ConnectionOpts {
  socketFactory?: SocketFactory;
  now?: () => number;
  reconnectDelayMs?: number;
}

/** Adapts the browser/Bun WebSocket to SocketLike. */
function defaultFactory(url: string): SocketLike {
  const ws = new WebSocket(url);
  const adapter: SocketLike = {
    send: (d) => ws.send(d),
    close: () => ws.close(),
  };
  ws.addEventListener("open", () => adapter.onopen?.());
  ws.addEventListener("message", (e) => adapter.onmessage?.(String(e.data)));
  ws.addEventListener("close", () => adapter.onclose?.());
  return adapter;
}

export class Connection {
  private sock: SocketLike | null = null;
  private readonly factory: SocketFactory;
  private readonly now: () => number;
  private readonly reconnectDelayMs: number;
  private closedByUser = false;

  constructor(
    private readonly url: string,
    private readonly state: GameState,
    opts: ConnectionOpts = {},
  ) {
    this.factory = opts.socketFactory ?? defaultFactory;
    this.now = opts.now ?? (() => performance.now());
    this.reconnectDelayMs = opts.reconnectDelayMs ?? 500;
  }

  connect(): void {
    const sock = this.factory(this.url);
    this.sock = sock;
    sock.onopen = () => sock.send(encode({ t: "hello" }));
    sock.onmessage = (data) => this.handle(data);
    sock.onclose = () => {
      if (this.closedByUser) return;
      if (this.reconnectDelayMs <= 0) this.connect();
      else setTimeout(() => this.connect(), this.reconnectDelayMs);
    };
  }

  sendMoveTo(x: number, y: number): void {
    const msg: MoveToMsg = { t: "moveTo", x, y };
    this.sock?.send(encode(msg));
  }

  disconnect(): void {
    this.closedByUser = true;
    this.sock?.close();
  }

  private handle(data: string): void {
    let msg;
    try { msg = decodeServer(data); } catch { return; }
    if (msg.t === "welcome") {
      this.state.setLocalId(msg.playerId);
      this.state.setMap(msg.map);
    } else if (msg.t === "snapshot") {
      this.state.applySnapshot(msg, this.now());
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/client/src/connection.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/connection.ts packages/client/src/connection.test.ts
git commit -m "feat(client): websocket netcode feeding game-state"
```

---

### Task 8: Full-suite green + headless smoke check

**Files:**
- Create: `scripts/smoke.ts`

- [ ] **Step 1: Run the whole test suite**

Run: `bun test`
Expected: all tests across protocol/server/client PASS.

- [ ] **Step 2: Write a headless smoke script (two clients see each other move)**

```ts
// scripts/smoke.ts
// Verifies two real clients connect, move, and observe each other — no renderer.
import { startServer } from "../packages/server/src/server";
import { GameState } from "../packages/client/src/game-state";
import { Connection } from "../packages/client/src/connection";

const server = startServer(0);
const url = `ws://localhost:${server.port}`;

const gsA = new GameState();
const gsB = new GameState();
const a = new Connection(url, gsA);
const b = new Connection(url, gsB);
a.connect();
b.connect();

await Bun.sleep(300); // let both join + receive welcome
a.sendMoveTo(40, 24);
b.sendMoveTo(8, 24);

await Bun.sleep(1500); // let them walk
const aPlayers = gsA.samplePositions(performance.now());
console.log("client A sees players:", aPlayers.map((p) => `${p.id}@(${p.x.toFixed(1)},${p.y.toFixed(1)})`));
const seesTwo = aPlayers.length === 2;
const someoneMoved = aPlayers.some((p) => Math.round(p.x) !== 24);
console.log(seesTwo && someoneMoved ? "SMOKE OK" : "SMOKE FAILED");

a.disconnect();
b.disconnect();
server.stop();
process.exit(seesTwo && someoneMoved ? 0 : 1);
```

- [ ] **Step 3: Run the smoke script**

Run: `bun run scripts/smoke.ts`
Expected: prints two players, at least one off the spawn column, and `SMOKE OK`; exit 0.

- [ ] **Step 4: Commit**

```bash
git add scripts/smoke.ts
git commit -m "test: headless two-client movement smoke script"
```

---

## Self-Review

**Spec coverage:**
- Protocol single source of truth → Task 1. ✅
- A* pathfinding (click-to-move server side) → Task 2. ✅
- Static map sent once → Task 3 + Welcome message. ✅
- Fixed 15 Hz authoritative loop, continuous positions, move speed ≈200 ms/tile → Task 4. ✅
- WebSocket transport, join/move/disconnect, broadcast snapshots → Task 5. ✅
- Client game-state model decoupled from net, interpolation buffer → Task 6. ✅
- Netcode with reconnect, mock-socket tested → Task 7. ✅
- Two-clients-see-each-other acceptance (headless) → Task 8. ✅
- Renderer tiers, input, OpenTUI, Docker → **deferred to Plan B** (out of scope here, by design).

**Placeholder scan:** none — every code step is complete.

**Type consistency:** `MapData`, `PlayerState`, `Facing`, `SnapshotMsg`, `WelcomeMsg` all sourced from `@termenor/protocol`. `findPath`/`isWalkable`/`Point` consistent between Tasks 2/4. `GameState` methods (`applySnapshot`, `samplePositions`, `setMap`, `setLocalId`, `INTERP_DELAY_MS`) consistent between Tasks 6/7/8. `Connection` API (`connect`, `sendMoveTo`, `disconnect`, `SocketLike`, `SocketFactory`) consistent between Tasks 7/8.

**Note for executor:** `Bun.serve` generic signature and `server.publish`/`ws.subscribe` topic API should be confirmed against the installed Bun version (1.3.10) during Task 5; adjust the typing if the API differs, keeping behavior identical.

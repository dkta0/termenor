import { test, expect } from "bun:test";
import type { MapData } from "@termenor/protocol";
import type { RenderPlayer } from "../game-state";
import { rasterizeIso, plot, newIsoFrame } from "./rasterize";
import { isoCamera } from "./camera";
import { tileToScreen } from "./iso";
import { Kind } from "./types";

const flatMap: MapData = {
  width: 3, height: 3,
  tiles: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  heights: [0, 0, 0, 0, 0, 0, 0, 0, 0],
};

test("plot is depth-tested: nearer (higher depth) wins regardless of order", () => {
  const f = newIsoFrame(4, 4);
  plot(f, 1, 1, /*depth*/ 5, Kind.WALL, [10, 20, 30], 7);
  plot(f, 1, 1, /*depth*/ 2, Kind.FLOOR, [99, 99, 99], 3); // farther — must NOT overwrite
  const i = 1 * 4 + 1;
  expect(f.buf.kinds[i]).toBe(Kind.WALL);
  expect([f.buf.rgb[i * 3], f.buf.rgb[i * 3 + 1], f.buf.rgb[i * 3 + 2]]).toEqual([10, 20, 30]);
  expect(f.pick[i]).toBe(7);

  plot(f, 1, 1, /*depth*/ 9, Kind.LOCAL, [1, 2, 3], 8); // nearer — overwrites
  expect(f.buf.kinds[i]).toBe(Kind.LOCAL);
  expect(f.pick[i]).toBe(8);
});

test("rasterizeIso fills a frame without throwing and marks some floor + pick", () => {
  const players: RenderPlayer[] = [{ id: "me", x: 1, y: 1, facing: "south", h: 0, hp: 10, maxHp: 10 }];
  const f = rasterizeIso(flatMap, players, 0, 0, 64, 48, "me");
  expect(f.buf.width).toBe(64);
  expect(f.buf.height).toBe(48);
  expect(f.buf.rgb.length).toBe(64 * 48 * 3);
  expect(f.buf.kinds.some((k) => k === Kind.FLOOR)).toBe(true);
  expect(f.pick.some((p) => p >= 0)).toBe(true);
  expect(f.buf.kinds.some((k) => k === Kind.LOCAL)).toBe(true);
});

test("walk-behind: a wall in front (greater x+y) occludes the player behind it", () => {
  const players: RenderPlayer[] = [{ id: "me", x: 0, y: 0, facing: "south", h: 0, hp: 10, maxHp: 10 }];
  const flat: MapData = { width: 2, height: 2, tiles: [0, 0, 0, 0], heights: [0, 0, 0, 0] };
  const walled: MapData = { width: 2, height: 2, tiles: [0, 0, 0, 1], heights: [0, 0, 0, 0] };
  const localPixels = (f: ReturnType<typeof rasterizeIso>) =>
    f.buf.kinds.reduce((n, k) => n + (k === Kind.LOCAL ? 1 : 0), 0);
  const open = rasterizeIso(flat, players, -40, -8, 80, 48, "me");
  const behind = rasterizeIso(walled, players, -40, -8, 80, 48, "me");
  // On open ground the player is visible; a tall wall on the (1,1) tile in front of
  // the (0,0) player hides part or all of the billboard — fewer LOCAL pixels survive.
  expect(localPixels(open)).toBeGreaterThan(0);
  expect(localPixels(behind)).toBeLessThan(localPixels(open));
});

import type { GroundItem } from "@termenor/protocol";

test("rasterizeIso with ground item produces ITEM pixels at item tile", () => {
  const map: import("@termenor/protocol").MapData = {
    width: 5, height: 5,
    tiles: new Array(25).fill(0),
    heights: new Array(25).fill(0),
  };
  const ground: GroundItem[] = [{ id: 1, item: "coins", qty: 5, x: 2, y: 2 }];
  const frame = rasterizeIso(map, [], 0, 0, 200, 200, null, ground);
  const hasItem = frame.buf.kinds.some((k) => k === Kind.ITEM);
  expect(hasItem).toBe(true);
});

test("rasterizeIso with no ground items produces no ITEM pixels", () => {
  const map: import("@termenor/protocol").MapData = {
    width: 5, height: 5,
    tiles: new Array(25).fill(0),
    heights: new Array(25).fill(0),
  };
  const frame = rasterizeIso(map, [], 0, 0, 200, 200, null, []);
  const hasItem = frame.buf.kinds.some((k) => k === Kind.ITEM);
  expect(hasItem).toBe(false);
});

import { NPC_KINDS } from "@termenor/protocol";
import type { NpcRender } from "../game-state";

test("rasterizeIso with npcs produces NPC pixels", () => {
  const map: MapData = {
    width: 5, height: 5,
    tiles: new Array(25).fill(0),
    heights: new Array(25).fill(0),
  };
  const npc: NpcRender = { id: "npc-1", type: "goblin", x: 2, y: 2, facing: "south", h: 0, hp: 5, maxHp: 10 };
  const frame = rasterizeIso(map, [], 0, 0, 200, 200, null, [], [npc]);
  expect(frame.buf.kinds.some((k) => k === Kind.NPC)).toBe(true);
});

test("rasterizeIso with no npcs produces no NPC pixels", () => {
  const map: MapData = {
    width: 5, height: 5,
    tiles: new Array(25).fill(0),
    heights: new Array(25).fill(0),
  };
  const frame = rasterizeIso(map, [], 0, 0, 200, 200, null, [], []);
  expect(frame.buf.kinds.some((k) => k === Kind.NPC)).toBe(false);
});

const localPixels = (f: ReturnType<typeof rasterizeIso>) =>
  f.buf.kinds.reduce((n, k) => n + (k === Kind.LOCAL ? 1 : 0), 0);

// drawBillboard plots W=2 × H=4 = 8 pixels; on flat ground none should be clipped.
const FULL_BILLBOARD = 8;
const big = (n: number): MapData => ({ width: n, height: n, tiles: new Array(n * n).fill(0), heights: new Array(n * n).fill(0) });
// center a 32×32 viewport on tile (px,py) at h=0 — tileToScreen: sx=(x-y)*4, sy=(x+y)*2
const centeredOn = (map: MapData, players: RenderPlayer[], px: number, py: number) =>
  rasterizeIso(map, players, (px - py) * 4 - 16, (px + py) * 2 - 16, 32, 32, "me");

test("a moving entity (fractional position) is NOT clipped by the floor around it", () => {
  // Regression: floor tiles used depth=x+y, out-ranking an entity also at x+y when
  // mid-move, so the front-adjacent ground clipped the sprite. Entity depth bias fixes it.
  const players: RenderPlayer[] = [{ id: "me", x: 2.5, y: 2.5, facing: "south", h: 0, hp: 10, maxHp: 10 }];
  expect(localPixels(centeredOn(big(6), players, 2.5, 2.5))).toBe(FULL_BILLBOARD);
});

test("entity stays intact at every fractional step across a tile (no movement flicker)", () => {
  for (const frac of [0, 0.25, 0.5, 0.75]) {
    const players: RenderPlayer[] = [{ id: "me", x: 2 + frac, y: 2 + frac, facing: "south", h: 0, hp: 10, maxHp: 10 }];
    expect(localPixels(centeredOn(big(6), players, 2 + frac, 2 + frac))).toBe(FULL_BILLBOARD);
  }
});

test("entity is NOT clipped by a one-step-higher hill one tile ahead", () => {
  // Over rolling terrain (adjacent height deltas <= 1) the raised front tile reached
  // up into the sprite and ate its feet; the depth bias must clear a 1-height step.
  const n = 8;
  const heights = new Array(n * n).fill(0);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (x + y >= 5) heights[y * n + x] = 1; // hill ahead
  const map: MapData = { width: n, height: n, tiles: new Array(n * n).fill(0), heights };
  const players: RenderPlayer[] = [{ id: "me", x: 2, y: 2, facing: "south", h: 0, hp: 10, maxHp: 10 }];
  expect(localPixels(rasterizeIso(map, players, (2 - 2) * 4 - 16, (2 + 2) * 2 - 16, 32, 32, "me"))).toBe(FULL_BILLBOARD);
});

test("sprite fills whole half-block cells — no terrain bleeds through its edges (anti-shimmer)", () => {
  // Each terminal cell is 2px (fg=top px, bg=bottom px). If the billboard half-filled
  // an edge cell, the scrolling terrain in the other half strobed the sprite. Snapping
  // the sprite to cell boundaries must leave zero half-filled (terrain-bleeding) cells.
  const LOCALC = [255, 210, 60];
  const isLocal = (rgb: Uint8Array, i: number) => rgb[i * 3] === LOCALC[0] && rgb[i * 3 + 1] === LOCALC[1] && rgb[i * 3 + 2] === LOCALC[2];
  const isGreen = (rgb: Uint8Array, i: number) => { const r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2]; return g > r && g > b && r < 120; };
  for (const frac of [0, 0.5]) {
    const players: RenderPlayer[] = [{ id: "me", x: 2 + frac, y: 2 + frac, facing: "south", h: 0, hp: 8, maxHp: 10 }];
    const f = centeredOn(big(6), players, 2 + frac, 2 + frac);
    const W = 32, H = 32;
    const cells = new Map<string, { loc: boolean; terr: boolean }>();
    for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
      const i = py * W + px, key = `${px},${py >> 1}`;
      const e = cells.get(key) ?? { loc: false, terr: false };
      if (isLocal(f.buf.rgb, i)) e.loc = true; else if (isGreen(f.buf.rgb, i)) e.terr = true;
      cells.set(key, e);
    }
    const bleed = [...cells.values()].filter((e) => e.loc && e.terr).length;
    expect(bleed).toBe(0);
  }
});

test("the player's shadow is stable across sub-pixel movement over rolling terrain (no ground flicker)", () => {
  // Regression: the shadow sits at the ground depth (x+y), so a plain depth test made it
  // win/lose against the scrolling tiles pixel-by-pixel as the camera-followed player moved
  // — the shadow flickered. Drawing it over-ground (plotEntity) makes it a stable diamond.
  const n = 20;
  const heights = new Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) heights[y * n + x] = Math.round(1.6 + 1.4 * Math.sin(x / 3) + 0.9 * Math.cos(y / 4));
  const map: MapData = { width: n, height: n, tiles: new Array(n * n).fill(0), heights };
  const shadowPx = (f: ReturnType<typeof rasterizeIso>) => f.buf.kinds.reduce((s, k) => s + (k === Kind.SHADOW ? 1 : 0), 0);
  const counts = new Set<number>();
  for (let i = 0; i < 16; i++) {
    const x = 8 + i * 0.13, y = 8 + i * 0.13, h = heights[Math.round(y) * n + Math.round(x)];
    const c = tileToScreen(x, y, h);
    const cam = isoCamera(c.sx, c.sy, 64, 48); // camera-follow, no other entities
    counts.add(shadowPx(rasterizeIso(map, [{ id: "me", x, y, facing: "south", h, hp: 10, maxHp: 10 }], cam.ox, cam.oy, 64, 48, "me")));
  }
  expect(counts.size).toBe(1); // identical shadow every frame
});

test("HP bar pixels are written at depth=Infinity so nothing overwrites them (no flicker)", () => {
  // The bar flickered because it was drawn without depth protection — later-rendered
  // entities (NPCs/resources) could overwrite it. drawHpBar now pins depth=Infinity.
  const players: RenderPlayer[] = [{ id: "me", x: 2, y: 2, facing: "south", h: 0, hp: 10, maxHp: 10 }];
  const HP_GREEN = [40, 200, 40];
  const f = centeredOn(big(6), players, 2, 2);
  const barPixels: number[] = [];
  for (let i = 0, p = 0; i < f.buf.rgb.length; i += 3, p++)
    if (f.buf.rgb[i] === HP_GREEN[0] && f.buf.rgb[i + 1] === HP_GREEN[1] && f.buf.rgb[i + 2] === HP_GREEN[2]) barPixels.push(p);
  expect(barPixels.length).toBeGreaterThan(0);
  expect(barPixels.every((p) => f.depth[p] === Infinity)).toBe(true);
});

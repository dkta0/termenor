// Render client A's live view to PNG frames as another player walks, so the
// rendering + interpolation can be inspected as an image (faithful to the
// half-block tier, which paints exactly this pixel buffer). Requires ImageMagick.
import { startServer } from "../packages/server/src/server";
import { GameState } from "../packages/client/src/game-state";
import { Connection } from "../packages/client/src/connection";
import { computeCameraPx } from "../packages/client/src/render/camera";
import { rasterize } from "../packages/client/src/render/rasterize";
import { Kind, PIXELS_PER_TILE as PPT, type KindValue } from "../packages/client/src/render/types";

const PALETTE: Record<KindValue, [number, number, number]> = {
  [Kind.EMPTY]: [0, 0, 0],
  [Kind.FLOOR]: [34, 68, 34],
  [Kind.WALL]: [90, 90, 100],
  [Kind.PLAYER]: [80, 140, 255],
  [Kind.LOCAL]: [255, 210, 60],
};

const PXW = 80, PXH = 60; // viewport in pixels (20x15 tiles)

function writePPM(path: string, w: number, h: number, kinds: Uint8Array) {
  const header = new TextEncoder().encode(`P6\n${w} ${h}\n255\n`);
  const body = new Uint8Array(w * h * 3);
  for (let i = 0; i < kinds.length; i++) {
    const [r, g, b] = PALETTE[(kinds[i] as KindValue)] ?? PALETTE[Kind.EMPTY];
    body[i * 3] = r; body[i * 3 + 1] = g; body[i * 3 + 2] = b;
  }
  const out = new Uint8Array(header.length + body.length);
  out.set(header, 0); out.set(body, header.length);
  return Bun.write(path, out);
}

const server = startServer(0);
const url = `ws://localhost:${server.port}`;
const state = new GameState();           // client A (observer)
const a = new Connection(url, state);
const moverState = new GameState();      // client B (mover)
const b = new Connection(url, moverState);
a.connect(); b.connect();

await Bun.sleep(300);
// B walks a diagonal path across the view so A sees smooth motion + both sprites
b.sendMoveTo(30, 30);

const frames: string[] = [];
const N = 12;
for (let i = 0; i < N; i++) {
  await Bun.sleep(90);
  const players = state.samplePositions(performance.now());
  const map = state.map!;
  const me = players.find((p) => p.id === state.localId);
  const cx = me ? me.x * PPT + PPT / 2 : (map.width * PPT) / 2;
  const cy = me ? me.y * PPT + PPT / 2 : (map.height * PPT) / 2;
  const cam = computeCameraPx(cx, cy, PXW, PXH, map.width * PPT, map.height * PPT);
  const buf = rasterize(map, players, cam, PXW, PXH, state.localId);
  const ppm = `/tmp/termenor-f${String(i).padStart(2, "0")}.ppm`;
  await writePPM(ppm, PXW, PXH, buf.kinds);
  frames.push(ppm);
  console.log(`frame ${i}: ${players.map((p) => `${p.id}@(${p.x.toFixed(2)},${p.y.toFixed(2)})`).join(" ")}`);
}

a.disconnect(); b.disconnect(); server.stop();

// upscale each frame (nearest-neighbor) and montage into a contact sheet
const up = frames.map((f, i) => {
  const png = `/tmp/termenor-f${String(i).padStart(2, "0")}.png`;
  Bun.spawnSync(["magick", f, "-scale", "320x240", png]);
  return png;
});
Bun.spawnSync(["magick", "montage", ...up, "-tile", "4x3", "-geometry", "+4+4", "-background", "#222", "/tmp/termenor-strip.png"]);
// also a single hero frame (the last one) at higher res
Bun.spawnSync(["magick", frames[frames.length - 1], "-scale", "640x480", "/tmp/termenor-hero.png"]);
console.log("wrote /tmp/termenor-strip.png and /tmp/termenor-hero.png");

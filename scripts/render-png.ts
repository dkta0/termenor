// Render client A's live view to PNG frames as another player walks, so the
// rendering + interpolation can be inspected as an image (faithful to the
// half-block tier, which paints exactly this pixel buffer). Requires ImageMagick.
import { startServer } from "../packages/server/src/server";
import { GameState } from "../packages/client/src/game-state";
import { Connection } from "../packages/client/src/connection";
import { isoCamera } from "../packages/client/src/render/camera";
import { rasterizeIso } from "../packages/client/src/render/rasterize";
import { tileToScreen } from "../packages/client/src/render/iso";

const PXW = 80, PXH = 60; // viewport in pixels (20x15 tiles)

function writePPM(path: string, w: number, h: number, rgb: Uint8Array) {
  const header = new TextEncoder().encode(`P6\n${w} ${h}\n255\n`);
  const body = new Uint8Array(w * h * 3);
  body.set(rgb);
  const out = new Uint8Array(header.length + body.length);
  out.set(header, 0); out.set(body, header.length);
  return Bun.write(path, out);
}

const server = startServer(0);
const url = `ws://localhost:${server.port}`;
const state = new GameState();           // client A (observer)
const a = new Connection(url, state, { username: "observer", password: "smoke" });
const moverState = new GameState();      // client B (mover)
const b = new Connection(url, moverState, { username: "mover", password: "smoke" });
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
  const center = me ? tileToScreen(me.x, me.y, me.h) : tileToScreen(map.width / 2, map.height / 2, 0);
  const cam = isoCamera(center.sx, center.sy, PXW, PXH);
  const frame = rasterizeIso(map, players, cam.ox, cam.oy, PXW, PXH, state.localId, state.ground, state.sampleNpcs(performance.now()));
  const ppm = `/tmp/termenor-f${String(i).padStart(2, "0")}.ppm`;
  await writePPM(ppm, PXW, PXH, frame.buf.rgb);
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

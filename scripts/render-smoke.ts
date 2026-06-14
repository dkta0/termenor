// Headless validation of the full render pipeline against a live server:
// connect → receive snapshots → sample interpolated positions → rasterize →
// ASCII cells → print. Proves everything except the OpenTUI blit (needs a TTY).
import { startServer } from "../packages/server/src/server";
import { GameState } from "../packages/client/src/game-state";
import { Connection } from "../packages/client/src/connection";
import { isoCamera } from "../packages/client/src/render/camera";
import { rasterizeIso } from "../packages/client/src/render/rasterize";
import { toAsciiCells } from "../packages/client/src/render/tiers";
import { tileToScreen } from "../packages/client/src/render/iso";

const COLS = 64; // 16 tiles wide at 4px/tile
const ROWS = 32; // 8 tiles tall

const server = startServer(0);
const url = `ws://localhost:${server.port}`;

const state = new GameState();
const conn = new Connection(url, state);
conn.connect();

// a second player so we can see both
const other = new Connection(url, new GameState());
other.connect();

await Bun.sleep(300);
conn.sendMoveTo(28, 24);   // local walks 4 tiles east
other.sendMoveTo(22, 24);  // other walks 2 tiles west — stays in local's view
await Bun.sleep(1200);

const map = state.map!;
const players = state.samplePositions(performance.now());
const me = players.find((p) => p.id === state.localId);
const center = me ? tileToScreen(me.x, me.y, me.h) : tileToScreen(map.width / 2, map.height / 2, 0);
const cam = isoCamera(center.sx, center.sy, COLS, ROWS);
const frame = rasterizeIso(map, players, cam.ox, cam.oy, COLS, ROWS, state.localId);
const grid = toAsciiCells(frame.buf);

let frameStr = "";
for (let r = 0; r < grid.rows; r++) {
  let line = "";
  for (let c = 0; c < grid.cols; c++) line += grid.cells[r * grid.cols + c].char;
  frameStr += line + "\n";
}
console.log(frameStr);

const text = grid.cells.map((c) => c.char).join("");
const hasLocal = text.includes("@");
const hasOther = text.includes("o");
const hasWorld = text.includes("·") || text.includes("#");
console.log(`local '@': ${hasLocal}  other 'o': ${hasOther}  world: ${hasWorld}`);
console.log(hasLocal && hasOther && hasWorld ? "RENDER OK" : "RENDER FAILED");

conn.disconnect();
other.disconnect();
server.stop();
process.exit(hasLocal && hasOther && hasWorld ? 0 : 1);

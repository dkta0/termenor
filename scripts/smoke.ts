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

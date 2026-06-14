import { startServer } from "./server";

const port = Number(process.env.PORT ?? 3000);
const server = startServer(port);
console.log(`termenor server listening on ws://localhost:${server.port}`);

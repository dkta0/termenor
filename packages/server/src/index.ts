import { startServer } from "./server";

const port = Number(process.env.PORT ?? 3000);
const dbPath = process.env.DB_PATH ?? "./data/termenor.db";
const server = startServer(port, dbPath);
console.log(`termenor server listening on ws://localhost:${server.port}`);

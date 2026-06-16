import { encode, decodeClient, MAX_CHAT_LEN, INV_SIZE, emptyEquipment, type InventoryMsg, type SkillsMsg, type BankMsg, type ShopMsg } from "@termenor/protocol";
import { GameWorld } from "./game";
import { createDefaultMap, SPAWN, SEED_ITEMS, NPC_SPAWNS, RESOURCE_SPAWNS, STARTER_AXE } from "./world";
import { openDb, getOrCreateAccount, savePlayerState } from "./db";
import { emptyInventory } from "./inventory";
import type { Database } from "bun:sqlite";

/** Trim whitespace then truncate to MAX_CHAT_LEN. Returns "" for blank input. */
export function sanitizeChat(text: string): string {
  return text.trim().slice(0, MAX_CHAT_LEN);
}

const TICK_RATE = 15;
const SAVE_INTERVAL_TICKS = TICK_RATE * 5; // save all online players every ~5 seconds

interface Conn { id: string; username: string | null; shopId: string | null; }

export interface RunningServer {
  port: number;
  stop(): void;
}

export function startServer(port: number, dbPath = process.env.DB_PATH ?? ":memory:"): RunningServer {
  const map = createDefaultMap();
  const game = new GameWorld(map, SPAWN);
  for (const s of SEED_ITEMS) game.addGroundItem(s.item, s.qty, s.x, s.y);
  game.addGroundItem(STARTER_AXE.item, STARTER_AXE.qty, STARTER_AXE.x, STARTER_AXE.y);
  for (const n of NPC_SPAWNS) game.spawnNpc(n.type, n.x, n.y, n.radius);
  for (const r of RESOURCE_SPAWNS) game.spawnResource(r.type, r.x, r.y);
  const db: Database = openDb(dbPath);
  const online = new Set<string>(); // usernames currently connected
  const sockets = new Map<string, Bun.ServerWebSocket<Conn>>(); // username → active socket
  let nextId = 1;
  let saveTick = 0;

  const server = Bun.serve<Conn>({
    port,
    fetch(req, srv) {
      if (srv.upgrade(req, { data: { id: `p${nextId++}`, username: null, shopId: null } })) return;
      return new Response("termenor server", { status: 200 });
    },
    websocket: {
      open(_ws) {
        // do nothing — wait for login message
      },
      async message(ws, raw) {
        let msg;
        try { msg = decodeClient(String(raw)); } catch { return; }

        if (ws.data.username === null) {
          // unauthenticated — only accept login
          if (msg.t !== "login") return;

          const { username, password, mode } = msg;

          // validate non-empty, length-bounded credentials before touching the DB
          if (
            typeof username !== "string" || username.length < 1 || username.length > 32 ||
            typeof password !== "string" || password.length < 1
          ) {
            ws.send(encode({ t: "loginError", reason: "invalid credentials" }));
            ws.close();
            return;
          }

          if (online.has(username)) {
            ws.send(encode({ t: "loginError", reason: "already online" }));
            ws.close();
            return;
          }
          // reserve the username synchronously (before the await) so a concurrent
          // login for the same account can't slip past the check above (TOCTOU race)
          online.add(username);

          const spawn = { x: SPAWN.x, y: SPAWN.y, facing: "south" as const };
          const result = await getOrCreateAccount(db, username, password, spawn, mode);

          if (!result.ok) {
            online.delete(username); // release the reservation on auth failure
            ws.send(encode({ t: "loginError", reason: result.reason }));
            ws.close();
            return;
          }

          ws.data.username = username;
          sockets.set(username, ws);
          game.addPlayer(username, result.state);
          ws.subscribe("world");
          ws.send(encode({
            t: "welcome",
            playerId: username,
            map,
            tickRate: TICK_RATE,
            x: result.state.x,
            y: result.state.y,
            facing: result.state.facing,
          }));
          const invMsg: InventoryMsg = { t: "inventory", slots: result.state.inventory };
          ws.send(encode(invMsg));
          const skillsMsg: SkillsMsg = { t: "skills", skills: game.getPlayerSkills(username) };
          ws.send(encode(skillsMsg));
          return;
        }

        // authenticated — handle game messages
        if (msg.t === "moveTo") {
          game.queueMove(ws.data.username, msg.x, msg.y);
        } else if (msg.t === "chat") {
          const text = sanitizeChat(msg.text);
          if (text) server.publish("world", encode({ t: "chatMsg", from: ws.data.username, text }));
        } else if (msg.t === "pickup") {
          const changed = game.pickup(ws.data.username);
          if (changed) {
            const inv = game.getInventory(ws.data.username);
            if (inv) ws.send(encode({ t: "inventory", slots: inv } satisfies InventoryMsg));
          }
        } else if (msg.t === "drop") {
          if (typeof msg.slot === "number" && msg.slot >= 0 && msg.slot < INV_SIZE) {
            const changed = game.drop(ws.data.username, msg.slot);
            if (changed) {
              const inv = game.getInventory(ws.data.username);
              if (inv) ws.send(encode({ t: "inventory", slots: inv } satisfies InventoryMsg));
            }
          }
        } else if (msg.t === "attack") {
          game.attack(ws.data.username, msg.targetId);
        } else if (msg.t === "gather") {
          game.gather(ws.data.username, msg.targetId);
        } else if (msg.t === "use") {
          game.use(ws.data.username, msg.action, msg.slot);
        } else if (msg.t === "open") {
          const u = ws.data.username;
          if (msg.what === "bank") {
            if (game.openBank(u, msg.targetId)) {
              ws.send(encode({ t: "bank", items: game.getBank(u), open: true } satisfies BankMsg));
            }
          } else {
            const sid = game.openShop(u, msg.targetId);
            if (sid) {
              const shop = game.getShop(sid);
              if (shop) {
                ws.data.shopId = sid;
                ws.send(encode({ t: "shop", shopId: sid, name: shop.name, entries: shop.entries, open: true } satisfies ShopMsg));
              }
            }
          }
        } else if (msg.t === "bankAction") {
          const u = ws.data.username;
          if (msg.action === "deposit") game.deposit(u, msg.slot, msg.qty);
          else game.withdraw(u, msg.slot, msg.qty);
          ws.send(encode({ t: "bank", items: game.getBank(u), open: true } satisfies BankMsg));
          const inv = game.getInventory(u);
          if (inv) ws.send(encode({ t: "inventory", slots: inv } satisfies InventoryMsg));
        } else if (msg.t === "shopAction") {
          const u = ws.data.username;
          const sid = ws.data.shopId;
          if (sid) {
            if (msg.action === "buy") game.buy(u, sid, msg.item, msg.qty);
            else game.sell(u, sid, msg.item, msg.qty);
            const shop = game.getShop(sid);
            if (shop) ws.send(encode({ t: "shop", shopId: sid, name: shop.name, entries: shop.entries, open: true } satisfies ShopMsg));
            const inv = game.getInventory(u);
            if (inv) ws.send(encode({ t: "inventory", slots: inv } satisfies InventoryMsg));
          }
        }
      },
      close(ws) {
        const { username } = ws.data;
        if (username === null) return;
        const state = game.getPlayerState(username);
        if (state) savePlayerState(db, username, state.x, state.y, state.facing, state.inventory ?? emptyInventory(), state.skills ?? {}, state.bank ?? [], emptyEquipment());
        game.removePlayer(username);
        online.delete(username);
        sockets.delete(username);
      },
    },
  });

  const dt = 1 / TICK_RATE;
  const interval = setInterval(() => {
    game.step(dt);
    server.publish("world", encode(game.snapshot()));

    // deliver per-player skill updates
    for (const id of game.consumeSkillChanges()) {
      const sock = sockets.get(id);
      if (sock) sock.send(encode({ t: "skills", skills: game.getPlayerSkills(id) } satisfies SkillsMsg));
    }
    // deliver level-up announcements as private chat messages
    for (const { id, skill, level } of game.consumeLevelUps()) {
      const sock = sockets.get(id);
      if (sock) sock.send(encode({ t: "chatMsg", from: "", text: `${skill[0].toUpperCase() + skill.slice(1)} level ${level}!` }));
    }
    // deliver gather feedback notices (no-axe, full-inv, etc.)
    for (const { id, text } of game.consumeGatherNotices()) {
      const sock = sockets.get(id);
      if (sock) sock.send(encode({ t: "chatMsg", from: "", text }));
    }

    saveTick++;
    if (saveTick >= SAVE_INTERVAL_TICKS) {
      saveTick = 0;
      // persist all currently online players
      for (const username of online) {
        const state = game.getPlayerState(username);
        if (state) savePlayerState(db, username, state.x, state.y, state.facing, state.inventory ?? emptyInventory(), state.skills ?? {}, state.bank ?? [], emptyEquipment());
      }
    }
  }, 1000 / TICK_RATE);

  return {
    port: server.port ?? port,
    stop() { clearInterval(interval); server.stop(true); db.close(); },
  };
}

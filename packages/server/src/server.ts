import { encode, decodeClient, MAX_CHAT_LEN, INV_SIZE, emptyEquipment, validateAllModels, type InventoryMsg, type SkillsMsg, type BankMsg, type ShopMsg, type EquipmentMsg, type SnapshotMsg, type ZoneMsg, type PlayerState, type ScenarioMsg } from "@termenor/protocol";
import { diffSnapshot } from "./delta";
import { WorldIndex } from "./aoi";
import { Zones, type PersistablePlayerState, type ZoneTransition } from "./zones";
import { SPAWN, type ZoneDef } from "./world";
import { SqliteStore, type PlayerStateRecord, type PlayerStore } from "./store";
import { emptyInventory } from "./inventory";
import { executeIntent } from "./intent-executor";
import { currentObjective, type ScenarioDef, type ScenarioProgress } from "./scenario";

// fail fast at startup if the model catalog is invalid
const modelErrors = validateAllModels();
if (modelErrors.length > 0) {
  console.error("Invalid models in catalog:\n" + modelErrors.join("\n"));
  throw new Error(`Model catalog validation failed (${modelErrors.length} error(s))`);
}

/** Trim whitespace then truncate to MAX_CHAT_LEN. Returns "" for blank input. */
export function sanitizeChat(text: string): string {
  return text.trim().slice(0, MAX_CHAT_LEN);
}

const TICK_RATE = 15;
const SAVE_INTERVAL_TICKS = TICK_RATE * 5; // save all online players every ~5 seconds

const DISCONNECT_RETRY_MS = 100;
interface Conn { id: string; username: string | null; shopId: string | null; lastView: SnapshotMsg | null; }

export interface RunningServer {
  port: number;
  stop(): void;
}
type PersistenceOperation = "transition" | "disconnect" | "periodic";
interface PersistenceErrorContext {
  operation: PersistenceOperation;
  playerId: string;
  fromZone?: string;
  toZone?: string;
}

interface StartServerOptions {
  aoiRadius?: number;
  store?: PlayerStore;
  hostname?: string;
  scenario?: ScenarioDef;
  zoneDefs?: ZoneDef[];
  onPersistenceError?: (
    error: unknown,
    context: PersistenceErrorContext,
  ) => void | Promise<void>;
}

function playerStateRecord(
  state: PersistablePlayerState,
): PlayerStateRecord {
  return {
    x: state.x,
    y: state.y,
    facing: state.facing,
    inventory: state.inventory ?? emptyInventory(),
    skills: state.skills ?? {},
    bank: state.bank ?? [],
    equipment: state.equipment ?? emptyEquipment(),
    zone: state.zone,
    quests: state.quests ?? {},
    scenario: state.scenario,
  };
}

function scenarioMessage(
  definition: ScenarioDef,
  progress: ScenarioProgress,
): ScenarioMsg {
  const objective = currentObjective(definition, progress);
  return {
    t: "scenario",
    scenarioId: progress.scenarioId,
    version: progress.version,
    objectiveId: objective?.id ?? null,
    objectiveText: objective?.text ?? null,
    completed: progress.completed,
    done: progress.done,
  };
}

/**
 * `aoiRadius` (Chebyshev tiles) bounds each player's Area of Interest — only entities
 * within it are sent to that player. The default comfortably exceeds the current map and
 * the largest practical viewport, so it filters nothing today; lower it once a large
 * streamed world makes culling pay off.
 */
export function startServer(
  port: number,
  dbPath = process.env.DB_PATH ?? ":memory:",
  opts: StartServerOptions = {},
): RunningServer {
  const AOI_RADIUS = opts.aoiRadius ?? 48;
  const zones = new Zones(opts.zoneDefs, {
    scenario: opts.scenario,
    deferTransitions: opts.scenario !== undefined,
  });
  const store: PlayerStore = opts.store ?? new SqliteStore(dbPath);
  const saveChains = new Map<string, Promise<void>>();
  const latestSaveSnapshots = new Map<string, PlayerStateRecord>();
  const disconnectedSnapshots = new Map<string, PlayerStateRecord>();
  const cancelDisconnectRetries = new Map<string, () => void>();
  const reportPersistenceError = opts.onPersistenceError
    ?? ((error: unknown, context: PersistenceErrorContext) => {
      console.error(
        `Failed ${context.operation} persistence for ${context.playerId}`,
        error,
      );
    });
  const safelyReportPersistenceError = (
    error: unknown,
    context: PersistenceErrorContext,
  ) => {
    try {
      void reportPersistenceError(error, context)?.catch(() => {});
    } catch {
      // Observability hooks must never interfere with authoritative recovery.
    }
  };
  const enqueuePlayerSave = (
    username: string,
    state: PlayerStateRecord,
  ): Promise<void> => {
    const snapshot = structuredClone(state);
    latestSaveSnapshots.set(username, snapshot);
    const previous = saveChains.get(username);
    const ready = previous ? previous.catch(() => {}) : Promise.resolve();
    const save = ready.then(() => store.savePlayerState(username, snapshot));
    saveChains.set(username, save);
    void save.then(
      () => {
        if (saveChains.get(username) === save) saveChains.delete(username);
        if (latestSaveSnapshots.get(username) === snapshot) {
          latestSaveSnapshots.delete(username);
        }
      },
      () => {
        if (saveChains.get(username) === save) saveChains.delete(username);
      },
    );
    return save;
  };
  const online = new Set<string>(); // usernames currently connected
  const sockets = new Map<string, Bun.ServerWebSocket<Conn>>(); // username → active socket
  let stopping = false;
  const persistDisconnected = (username: string) => {
    const snapshot = disconnectedSnapshots.get(username);
    if (!snapshot || stopping) return;
    void enqueuePlayerSave(username, snapshot).then(
      () => {
        if (disconnectedSnapshots.get(username) !== snapshot) return;
        disconnectedSnapshots.delete(username);
        online.delete(username);
      },
      (error) => {
        safelyReportPersistenceError(error, {
          operation: "disconnect",
          playerId: username,
        });
        if (disconnectedSnapshots.get(username) !== snapshot || stopping) return;
        const timer = setTimeout(() => {
          cancelDisconnectRetries.delete(username);
          persistDisconnected(username);
        }, DISCONNECT_RETRY_MS);
        cancelDisconnectRetries.set(username, () => { clearTimeout(timer); });
      },
    );
  };
  let nextId = 1;
  let saveTick = 0;
  // Per-connection AOI baseline lives on each socket's data (`lastView`); no shared state.

  const sendScenario = (socket: Bun.ServerWebSocket<Conn>, id: string) => {
    const definition = opts.scenario;
    const progress = zones.progressOf(id);
    if (definition && progress) socket.send(encode(scenarioMessage(definition, progress)));
  };

  const server = Bun.serve<Conn>({
    port,
    hostname: opts.hostname, // undefined → Bun binds 0.0.0.0 (all interfaces) for internet play
    fetch(req, srv) {
      if (srv.upgrade(req, { data: { id: `p${nextId++}`, username: null, shopId: null, lastView: null } })) return;
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
          const result = await store.getOrCreateAccount(username, password, spawn, mode);

          if (!result.ok) {
            online.delete(username); // release the reservation on auth failure
            ws.send(encode({ t: "loginError", reason: result.reason }));
            ws.close();
            return;
          }

          ws.data.username = username;
          sockets.set(username, ws);
          zones.addPlayer(username, result.state);
          ws.subscribe("world");
          ws.send(encode({
            t: "welcome",
            playerId: username,
            map: zones.mapOf(zones.zoneOf(username)),
            tickRate: TICK_RATE,
            x: result.state.x,
            y: result.state.y,
            facing: result.state.facing,
          }));
          sendScenario(ws, username);
          const invMsg: InventoryMsg = { t: "inventory", slots: result.state.inventory };
          ws.send(encode(invMsg));
          const skillsMsg: SkillsMsg = { t: "skills", skills: zones.worldOf(username).getPlayerSkills(username) };
          ws.send(encode(skillsMsg));
          const eq = zones.worldOf(username).getEquipment(username);
          ws.send(encode({ t: "equipment", weapon: eq.weapon, body: eq.body, shield: eq.shield } satisfies EquipmentMsg));
          return;
        }

        // authenticated — handle game messages, routed to the player's current zone world
        const u = ws.data.username;
        const w = zones.worldOf(u);
        if (msg.t === "intent") {
          const session = { shopId: ws.data.shopId ?? undefined };
          const result = executeIntent(w, u, msg.intent, session);
          ws.data.shopId = session.shopId ?? null;
          for (const m of result.self) ws.send(encode(m));
          for (const m of result.world) server.publish("world", encode(m));
        } else if (msg.t === "moveTo") {
          w.queueMove(u, msg.x, msg.y);
        } else if (msg.t === "chat") {
          const text = sanitizeChat(msg.text);
          if (text) server.publish("world", encode({ t: "chatMsg", from: u, text }));
        } else if (msg.t === "pickup") {
          const changed = w.pickup(u);
          if (changed) {
            const inv = w.getInventory(u);
            if (inv) ws.send(encode({ t: "inventory", slots: inv } satisfies InventoryMsg));
          }
        } else if (msg.t === "drop") {
          if (typeof msg.slot === "number" && msg.slot >= 0 && msg.slot < INV_SIZE) {
            const changed = w.drop(u, msg.slot);
            if (changed) {
              const inv = w.getInventory(u);
              if (inv) ws.send(encode({ t: "inventory", slots: inv } satisfies InventoryMsg));
            }
          }
        } else if (msg.t === "attack") {
          w.attack(u, msg.targetId);
        } else if (msg.t === "gather") {
          w.gather(u, msg.targetId);
        } else if (msg.t === "use") {
          w.use(u, msg.action, msg.slot);
        } else if (msg.t === "open") {
          if (msg.what === "bank") {
            if (w.openBank(u, msg.targetId)) {
              ws.send(encode({ t: "bank", items: w.getBank(u), open: true } satisfies BankMsg));
            }
          } else {
            const sid = w.openShop(u, msg.targetId);
            if (sid) {
              const shop = w.getShop(sid);
              if (shop) {
                ws.data.shopId = sid;
                ws.send(encode({ t: "shop", shopId: sid, name: shop.name, entries: shop.entries, open: true } satisfies ShopMsg));
              }
            }
          }
        } else if (msg.t === "bankAction") {
          if (msg.action === "deposit") w.deposit(u, msg.slot, msg.qty);
          else w.withdraw(u, msg.slot, msg.qty);
          ws.send(encode({ t: "bank", items: w.getBank(u), open: true } satisfies BankMsg));
          const inv = w.getInventory(u);
          if (inv) ws.send(encode({ t: "inventory", slots: inv } satisfies InventoryMsg));
        } else if (msg.t === "shopAction") {
          const sid = ws.data.shopId;
          if (sid) {
            if (msg.action === "buy") w.buy(u, sid, msg.item, msg.qty);
            else w.sell(u, sid, msg.item, msg.qty);
            const shop = w.getShop(sid);
            if (shop) ws.send(encode({ t: "shop", shopId: sid, name: shop.name, entries: shop.entries, open: true } satisfies ShopMsg));
            const inv = w.getInventory(u);
            if (inv) ws.send(encode({ t: "inventory", slots: inv } satisfies InventoryMsg));
          }
        } else if (msg.t === "equipAction") {
          if (msg.action === "equip") w.equip(u, msg.slot);
          else w.unequip(u, msg.slot);
          const eq = w.getEquipment(u);
          ws.send(encode({ t: "equipment", weapon: eq.weapon, body: eq.body, shield: eq.shield } satisfies EquipmentMsg));
          const inv = w.getInventory(u);
          if (inv) ws.send(encode({ t: "inventory", slots: inv } satisfies InventoryMsg));
        }
      },
      close(ws) {
        const { username } = ws.data;
        if (username === null) return;
        const state = zones.stateOf(username);
        const snapshot = state
          ? playerStateRecord(state)
          : latestSaveSnapshots.get(username);
        zones.removePlayer(username);
        sockets.delete(username);
        if (snapshot) {
          disconnectedSnapshots.set(username, snapshot);
          persistDisconnected(username);
        } else {
          online.delete(username);
        }
      },
    },
  });

  const dt = 1 / TICK_RATE;
  const sendZone = (
    socket: Bun.ServerWebSocket<Conn>,
    transition: ZoneTransition,
  ) => {
    socket.send(encode({
      t: "zone",
      zone: transition.zone,
      map: zones.mapOf(transition.zone),
      x: transition.x,
      y: transition.y,
      facing: transition.facing,
    } satisfies ZoneMsg));
    socket.data.lastView = null;
  };

  const flushScenarioChanges = () => {
    for (const id of zones.consumeScenarioChanges()) {
      const socket = sockets.get(id);
      if (socket) sendScenario(socket, id);
    }
  };

  const processTransition = async (transition: ZoneTransition) => {
    const socket = sockets.get(transition.id);
    if (transition.pending !== true) {
      if (socket) sendZone(socket, transition);
      return;
    }
    if (!socket) {
      zones.rollbackTransition(transition);
      return;
    }
    const pendingState = zones.pendingStateOf(transition);
    if (!pendingState) return;
    try {
      await enqueuePlayerSave(
        transition.id,
        playerStateRecord(pendingState),
      );
    } catch (error) {
      const rolledBack = zones.rollbackTransition(transition);
      safelyReportPersistenceError(error, {
        operation: "transition",
        playerId: transition.id,
        fromZone: transition.fromZone,
        toZone: transition.zone,
      });
      if (rolledBack && sockets.get(transition.id) === socket) {
        socket.data.lastView = null;
        socket.send(encode({
          t: "chatMsg",
          from: "",
          text: "Could not save your progress, so you remain in the tutorial. Please try crossing the exit again.",
        }));
        flushScenarioChanges();
      }
      return;
    }
    if (sockets.get(transition.id) !== socket) {
      zones.rollbackTransition(transition);
      return;
    }
    if (!zones.commitTransition(transition)) return;
    sendZone(socket, transition);
    flushScenarioChanges();
  };

  const interval = setInterval(() => {
    zones.step(dt);

    for (const transition of zones.consumeTransitions()) {
      void processTransition(transition);
    }
    flushScenarioChanges();

    // Per-zone AOI delta: snapshot each occupied zone once, then send each player only the
    // change within their Area of Interest since their last view.
    const views = new Map<string, { index: WorldIndex; byId: Map<string, PlayerState> }>();
    const viewFor = (zone: string) => {
      let v = views.get(zone);
      if (!v) {
        const world = zones.world(zone);
        const snap = world.snapshot();
        v = { index: new WorldIndex(snap, world.map.width), byId: new Map(snap.players.map((p) => [p.id, p])) };
        views.set(zone, v);
      }
      return v;
    };
    for (const sock of sockets.values()) {
      const id = sock.data.username;
      if (!id) continue;
      const v = viewFor(zones.zoneOf(id));
      const me = v.byId.get(id);
      if (!me) continue;
      const view = v.index.view(me.x, me.y, AOI_RADIUS);
      sock.send(encode(diffSnapshot(sock.data.lastView, view)));
      sock.data.lastView = view;
    }

    // deliver per-player skill / level-up / gather / order feedback from every zone
    for (const zoneId of zones.zoneIds()) {
      const world = zones.world(zoneId);
      for (const sid of world.consumeSkillChanges()) {
        const sock = sockets.get(sid);
        if (sock) sock.send(encode({ t: "skills", skills: world.getPlayerSkills(sid) } satisfies SkillsMsg));
      }
      for (const { id, skill, level } of world.consumeLevelUps()) {
        const sock = sockets.get(id);
        if (sock) sock.send(encode({ t: "chatMsg", from: "", text: `${skill[0].toUpperCase() + skill.slice(1)} level ${level}!` }));
      }
      for (const { id, text } of world.consumeGatherNotices()) {
        const sock = sockets.get(id);
        if (sock) sock.send(encode({ t: "chatMsg", from: "", text }));
      }
      for (const { id, text } of world.consumeOrderNotices()) {
        const sock = sockets.get(id);
        if (sock) sock.send(encode({ t: "chatMsg", from: "", text }));
      }
    }

    saveTick++;
    if (saveTick >= SAVE_INTERVAL_TICKS) {
      saveTick = 0;
      for (const username of online) {
        const state = zones.stateOf(username);
        if (state) {
          void enqueuePlayerSave(username, playerStateRecord(state)).catch((error) => {
            safelyReportPersistenceError(error, {
              operation: "periodic",
              playerId: username,
            });
          });
        }
      }
    }
  }, 1000 / TICK_RATE);

  return {
    port: server.port ?? port,
    stop() {
      stopping = true;
      clearInterval(interval);
      for (const cancel of cancelDisconnectRetries.values()) cancel();
      cancelDisconnectRetries.clear();
      server.stop(true);
      void store.close();
    },
  };
}

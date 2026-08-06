import { decodeServer, encode, PLAYER_MAX_HP, type LoginMsg, type MoveToMsg, type ChatMsg, type PickupMsg, type DropMsg, type AttackMsg, type GatherMsg, type UseMsg, type OpenMsg, type BankActionMsg, type ShopActionMsg, type EquipActionMsg, type InventoryActionMsg, type PanelActionMsg, type Intent, type IntentMsg } from "@termenor/protocol";
import type { ItemStack } from "@termenor/protocol";
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
  username?: string;
  password?: string;
  onLoginError?: (reason: string) => void;
  onChatMsg?: (from: string, text: string) => void;
  onInventory?: (slots: (ItemStack | null)[]) => void;
  onSkills?: () => void;
  onBank?: () => void;
  onShop?: () => void;
  onEquipment?: () => void;
}

export type AuthResult = { ok: true } | { ok: false; reason: string };

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
  private username: string;
  private password: string;
  private mode: "login" | "register" | undefined;
  private suppressReconnect = false;
  private pendingAuth: ((r: AuthResult) => void) | null = null;
  private readonly onLoginError: (reason: string) => void;
  private readonly onChatMsg: (from: string, text: string) => void;
  private readonly onInventory: ((slots: (ItemStack | null)[]) => void) | undefined;
  private readonly onSkills: (() => void) | undefined;
  private readonly onBank: (() => void) | undefined;
  private readonly onShop: (() => void) | undefined;
  private readonly onEquipment: (() => void) | undefined;
  private closedByUser = false;

  constructor(
    private readonly url: string,
    private readonly state: GameState,
    opts: ConnectionOpts,
  ) {
    this.factory = opts.socketFactory ?? defaultFactory;
    this.now = opts.now ?? (() => performance.now());
    this.reconnectDelayMs = opts.reconnectDelayMs ?? 500;
    this.username = opts.username ?? "";
    this.password = opts.password ?? "";
    this.onLoginError = opts.onLoginError ?? ((reason) => {
      console.error(`Login failed: ${reason}`);
      process.exit(1);
    });
    this.onChatMsg = opts.onChatMsg ?? (() => {});
    this.onInventory = opts.onInventory;
    this.onSkills = opts.onSkills;
    this.onBank = opts.onBank;
    this.onShop = opts.onShop;
    this.onEquipment = opts.onEquipment;
  }

  connect(): void {
    const sock = this.factory(this.url);
    this.sock = sock;
    sock.onopen = () => {
      const frame: LoginMsg = this.mode
        ? { t: "login", mode: this.mode, username: this.username, password: this.password }
        : { t: "login", username: this.username, password: this.password };
      sock.send(encode(frame));
    };
    sock.onmessage = (data) => this.handle(data);
    sock.onclose = () => {
      // Ignore the close of a socket we've already replaced (e.g. a failed-auth
      // socket whose late close arrives after the user retried). Only the live
      // socket may drive reconnection — otherwise a retry's reset of
      // suppressReconnect would let the abandoned socket spawn a stray connection.
      if (sock !== this.sock) return;
      if (this.closedByUser || this.suppressReconnect) return;
      if (this.reconnectDelayMs <= 0) this.connect();
      else setTimeout(() => this.connect(), this.reconnectDelayMs);
    };
  }

  /** Connect and attempt auth with the given mode. Resolves once the server
   *  replies with welcome (ok) or loginError (failure). On failure, the socket
   *  is not auto-reconnected, so the caller can retry with new credentials. */
  authenticate(mode: "login" | "register" | undefined, username: string, password: string): Promise<AuthResult> {
    this.mode = mode;
    this.username = username;
    this.password = password;
    this.suppressReconnect = false;
    return new Promise<AuthResult>((resolve) => {
      this.pendingAuth = resolve;
      this.connect();
    });
  }

  sendMoveTo(x: number, y: number): void {
    const msg: MoveToMsg = { t: "moveTo", x, y };
    this.sock?.send(encode(msg));
  }

  sendChat(text: string): void {
    const msg: ChatMsg = { t: "chat", text };
    this.sock?.send(encode(msg));
  }

  sendPickup(): void {
    const msg: PickupMsg = { t: "pickup" };
    this.sock?.send(encode(msg));
  }

  sendDrop(slot: number): void {
    const msg: DropMsg = { t: "drop", slot };
    this.sock?.send(encode(msg));
  }

  sendAttack(targetId: string): void {
    const msg: AttackMsg = { t: "attack", targetId };
    this.sock?.send(encode(msg));
  }

  sendGather(targetId: string): void {
    const msg: GatherMsg = { t: "gather", targetId };
    this.sock?.send(encode(msg));
  }

  sendUse(action: string, slot: number): void {
    const msg: UseMsg = { t: "use", action, slot };
    this.sock?.send(encode(msg));
  }

  sendOpen(what: "bank" | "shop", targetId: string): void {
    const msg: OpenMsg = { t: "open", what, targetId };
    this.sock?.send(encode(msg));
  }

  sendBankAction(action: "deposit" | "withdraw", slot: number, qty: number): void {
    const msg: BankActionMsg = { t: "bankAction", action, slot, qty };
    this.sock?.send(encode(msg));
  }

  sendShopAction(action: "buy" | "sell", item: string, qty: number): void {
    const msg: ShopActionMsg = { t: "shopAction", action, item, qty };
    this.sock?.send(encode(msg));
  }

  sendEquipAction(action: "equip" | "unequip", slot: number): void {
    const msg: EquipActionMsg = { t: "equipAction", action, slot };
    this.sock?.send(encode(msg));
  }

  sendInventoryAction(action: "examine", slot: number): void {
    const msg: InventoryActionMsg = { t: "inventoryAction", action, slot };
    this.sock?.send(encode(msg));
  }

  sendPanelAction(panel: "skills"): void {
    const msg: PanelActionMsg = { t: "panelAction", panel };
    this.sock?.send(encode(msg));
  }

  sendIntent(intent: Intent): void {
    const msg: IntentMsg = { t: "intent", intent };
    this.sock?.send(encode(msg));
  }

  disconnect(): void {
    this.closedByUser = true;
    this.sock?.close();
  }

  private handle(data: string): void {
    let msg;
    try { msg = decodeServer(data); } catch { return; }
    if (msg.t === "loginError") {
      const pending = this.pendingAuth;
      if (pending) {
        this.suppressReconnect = true;
        this.pendingAuth = null;
        pending({ ok: false, reason: msg.reason });
      } else {
        this.onLoginError(msg.reason);
      }
    } else if (msg.t === "welcome") {
      this.mode = "login"; // any later reconnect logs into the now-existing account
      const pending = this.pendingAuth;
      this.pendingAuth = null;
      pending?.({ ok: true });
      this.state.setLocalId(msg.playerId);
      this.state.setMap(msg.map);
      // Seed the local player so the renderer has a frame before the first delta.
      this.state.applyDelta(
        { t: "delta", tick: 0,
          players: { spawns: [{ id: msg.playerId, x: msg.x, y: msg.y, facing: msg.facing, hp: PLAYER_MAX_HP, maxHp: PLAYER_MAX_HP }], updates: [], despawns: [] },
          npcs: { spawns: [], updates: [], despawns: [] },
          ground: { spawns: [], updates: [], despawns: [] },
          resources: { spawns: [], updates: [], despawns: [] },
          hits: [] },
        this.now(),
      );
    } else if (msg.t === "zone") {
      this.state.enterZone(msg.map);
      // Re-seed the local player so the renderer has a frame before the first delta in the new zone.
      const id = this.state.localId;
      if (id) {
        this.state.applyDelta(
          { t: "delta", tick: 0,
            players: { spawns: [{ id, x: msg.x, y: msg.y, facing: msg.facing, hp: PLAYER_MAX_HP, maxHp: PLAYER_MAX_HP }], updates: [], despawns: [] },
            npcs: { spawns: [], updates: [], despawns: [] },
            ground: { spawns: [], updates: [], despawns: [] },
            resources: { spawns: [], updates: [], despawns: [] },
            hits: [] },
          this.now(),
        );
      }
    } else if (msg.t === "scenario") {
      const { t: _type, ...state } = msg;
      this.state.setScenario(state);
    } else if (msg.t === "delta") {
      this.state.applyDelta(msg, this.now());
    } else if (msg.t === "chatMsg") {
      this.onChatMsg(msg.from, msg.text);
    } else if (msg.t === "inventory") {
      this.state.setInventory(msg.slots);
      this.onInventory?.(msg.slots);
    } else if (msg.t === "skills") {
      this.state.setSkills(msg.skills);
      this.onSkills?.();
    } else if (msg.t === "bank") {
      this.state.setBank(msg.items, msg.open);
      this.onBank?.();
    } else if (msg.t === "shop") {
      this.state.setShop(msg.shopId, msg.name, msg.entries, msg.open);
      this.onShop?.();
    } else if (msg.t === "equipment") {
      this.state.setEquipment({ weapon: msg.weapon, body: msg.body, shield: msg.shield });
      this.onEquipment?.();
    }
  }
}

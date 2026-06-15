import { decodeServer, encode, PLAYER_MAX_HP, type MoveToMsg, type ChatMsg, type PickupMsg, type DropMsg, type AttackMsg } from "@termenor/protocol";
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
  username: string;
  password: string;
  onLoginError?: (reason: string) => void;
  onChatMsg?: (from: string, text: string) => void;
  onInventory?: (slots: (ItemStack | null)[]) => void;
}

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
  private readonly username: string;
  private readonly password: string;
  private readonly onLoginError: (reason: string) => void;
  private readonly onChatMsg: (from: string, text: string) => void;
  private readonly onInventory: ((slots: (ItemStack | null)[]) => void) | undefined;
  private closedByUser = false;

  constructor(
    private readonly url: string,
    private readonly state: GameState,
    opts: ConnectionOpts,
  ) {
    this.factory = opts.socketFactory ?? defaultFactory;
    this.now = opts.now ?? (() => performance.now());
    this.reconnectDelayMs = opts.reconnectDelayMs ?? 500;
    this.username = opts.username;
    this.password = opts.password;
    this.onLoginError = opts.onLoginError ?? ((reason) => {
      console.error(`Login failed: ${reason}`);
      process.exit(1);
    });
    this.onChatMsg = opts.onChatMsg ?? (() => {});
    this.onInventory = opts.onInventory;
  }

  connect(): void {
    const sock = this.factory(this.url);
    this.sock = sock;
    sock.onopen = () => sock.send(encode({ t: "login", username: this.username, password: this.password }));
    sock.onmessage = (data) => this.handle(data);
    sock.onclose = () => {
      if (this.closedByUser) return;
      if (this.reconnectDelayMs <= 0) this.connect();
      else setTimeout(() => this.connect(), this.reconnectDelayMs);
    };
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

  disconnect(): void {
    this.closedByUser = true;
    this.sock?.close();
  }

  private handle(data: string): void {
    let msg;
    try { msg = decodeServer(data); } catch { return; }
    if (msg.t === "loginError") {
      this.onLoginError(msg.reason);
    } else if (msg.t === "welcome") {
      this.state.setLocalId(msg.playerId);
      this.state.setMap(msg.map);
      // seed initial position so renderer has a starting frame before first snapshot
      this.state.applySnapshot(
        { t: "snapshot", tick: 0,
          players: [{ id: msg.playerId, x: msg.x, y: msg.y, facing: msg.facing, hp: PLAYER_MAX_HP, maxHp: PLAYER_MAX_HP }],
          ground: [], npcs: [], hits: [] },
        this.now(),
      );
    } else if (msg.t === "snapshot") {
      this.state.applySnapshot(msg, this.now());
    } else if (msg.t === "chatMsg") {
      this.onChatMsg(msg.from, msg.text);
    } else if (msg.t === "inventory") {
      this.state.setInventory(msg.slots);
      this.onInventory?.(msg.slots);
    }
  }
}

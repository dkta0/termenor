import type { ItemStack, GroundItem } from "./items";
export type { ItemStack, GroundItem } from "./items";
export { ITEMS, isItem, INV_SIZE } from "./items";

import type { NpcState } from "./npcs";
export type { NpcState } from "./npcs";
export { NPC_TYPES } from "./npcs";

export type Facing = "north" | "south" | "east" | "west";

/** Row-major grid. 0 = walkable, 1 = blocked. `heights` is per-tile ground elevation. */
export interface MapData {
  width: number;
  height: number;
  tiles: number[];
  heights: number[];
}

/** Max walkable height delta between two adjacent tiles. */
export const MAX_CLIMB = 1;

/** x/y are continuous tile coords (floats) so clients can interpolate. */
export interface PlayerState {
  id: string;
  x: number;
  y: number;
  facing: Facing;
  hp: number;
  maxHp: number;
}

export interface LoginMsg { t: "login"; username: string; password: string; }
export interface MoveToMsg { t: "moveTo"; x: number; y: number; }
export interface ChatMsg { t: "chat"; text: string; }
export interface PickupMsg { t: "pickup"; }
export interface DropMsg { t: "drop"; slot: number; }
export interface AttackMsg { t: "attack"; targetId: string; }
export type ClientMsg = LoginMsg | MoveToMsg | ChatMsg | PickupMsg | DropMsg | AttackMsg;

export interface WelcomeMsg {
  t: "welcome";
  playerId: string;
  map: MapData;
  tickRate: number;
  x: number;
  y: number;
  facing: Facing;
}
export interface HitEvent { targetId: string; amount: number; tick: number; }
export interface SnapshotMsg { t: "snapshot"; tick: number; players: PlayerState[]; ground: GroundItem[]; npcs: NpcState[]; hits: HitEvent[]; }
export interface LoginErrorMsg { t: "loginError"; reason: string; }
export interface ChatBroadcastMsg { t: "chatMsg"; from: string; text: string; }
export interface InventoryMsg { t: "inventory"; slots: (ItemStack | null)[]; }
export type ServerMsg = WelcomeMsg | SnapshotMsg | LoginErrorMsg | ChatBroadcastMsg | InventoryMsg;

export function encode(msg: ClientMsg | ServerMsg): string {
  return JSON.stringify(msg);
}

export const MAX_CHAT_LEN = 200;

const CLIENT_TYPES = new Set(["login", "moveTo", "chat", "pickup", "drop", "attack"]);
const SERVER_TYPES = new Set(["welcome", "snapshot", "loginError", "chatMsg", "inventory"]);

export function decodeClient(data: string): ClientMsg {
  const obj = JSON.parse(data);
  if (!obj || !CLIENT_TYPES.has(obj.t)) throw new Error(`bad client message: ${data}`);
  return obj as ClientMsg;
}

export function decodeServer(data: string): ServerMsg {
  const obj = JSON.parse(data);
  if (!obj || !SERVER_TYPES.has(obj.t)) throw new Error(`bad server message: ${data}`);
  return obj as ServerMsg;
}

export * from "./combat";

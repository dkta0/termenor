import type { ItemStack, GroundItem } from "./items";
import type { Scenery } from "./models";
import type { Intent } from "./intents";
import type { ScenarioMsg } from "./scenarios";
export type { ItemStack, GroundItem } from "./items";
export { ITEM_KINDS, isItem, INV_SIZE } from "./items";
export type { ItemKind } from "./items";

import type { NpcState } from "./npcs";
export type { NpcState } from "./npcs";
export { NPC_KINDS, type NpcKind } from "./npcs";

import type { ResourceState } from "./resources";
import type { ShopEntry } from "./shops";

export type Facing = "north" | "south" | "east" | "west";

/** Row-major grid. 0 = walkable, 1 = blocked. `heights` is per-tile ground elevation. */
export interface MapData {
  width: number;
  height: number;
  tiles: number[];
  heights: number[];
  scenery?: Scenery[];
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

export interface LoginMsg { t: "login"; mode?: "login" | "register"; username: string; password: string; }
export interface MoveToMsg { t: "moveTo"; x: number; y: number; }
export interface ChatMsg { t: "chat"; text: string; }
export interface PickupMsg { t: "pickup"; }
export interface DropMsg { t: "drop"; slot: number; }
export interface AttackMsg { t: "attack"; targetId: string; }
export interface GatherMsg { t: "gather"; targetId: string; }
export interface UseMsg { t: "use"; action: string; slot: number; }
export interface OpenMsg { t: "open"; what: "bank" | "shop"; targetId: string; }
export interface BankActionMsg { t: "bankAction"; action: "deposit" | "withdraw"; slot: number; qty: number; }
export interface ShopActionMsg { t: "shopAction"; action: "buy" | "sell"; item: string; qty: number; }
export interface EquipActionMsg { t: "equipAction"; action: "equip" | "unequip"; slot: number; }
export interface InventoryActionMsg { t: "inventoryAction"; action: "examine"; slot: number; }
export interface PanelActionMsg { t: "panelAction"; panel: "skills"; }
export interface IntentMsg { t: "intent"; intent: Intent; }
export type ClientMsg = LoginMsg | MoveToMsg | ChatMsg | PickupMsg | DropMsg | AttackMsg | GatherMsg | UseMsg | OpenMsg | BankActionMsg | ShopActionMsg | EquipActionMsg | InventoryActionMsg | PanelActionMsg | IntentMsg;

export interface WelcomeMsg {
  t: "welcome";
  playerId: string;
  map: MapData;
  tickRate: number;
  x: number;
  y: number;
  facing: Facing;
}
/** Sent when a player crosses into a new zone: swap the rendered map and reposition. */
export interface ZoneMsg {
  t: "zone";
  zone: string;
  map: MapData;
  x: number;
  y: number;
  facing: Facing;
}
export interface HitEvent { targetId: string; amount: number; tick: number; }
export interface SnapshotMsg { t: "snapshot"; tick: number; players: PlayerState[]; ground: GroundItem[]; npcs: NpcState[]; hits: HitEvent[]; resources: ResourceState[]; }
/**
 * An incremental change set for one entity category, diffed against what the client
 * was last sent. `spawns` are newly present, `updates` are present-but-changed (full
 * record), `despawns` are ids no longer present. Absent from all three = unchanged.
 */
export interface EntityDelta<S extends { id: string | number }> {
  spawns: S[];
  updates: S[];
  despawns: S["id"][];
}

/**
 * The per-tick world update sent in place of a full Snapshot. The wire carries only
 * what changed since the client's last delta; the client reconstructs a full frame
 * from its running world model. `hits` are transient per-tick events, always sent.
 */
export interface DeltaMsg {
  t: "delta";
  tick: number;
  players: EntityDelta<PlayerState>;
  npcs: EntityDelta<NpcState>;
  ground: EntityDelta<GroundItem>;
  resources: EntityDelta<ResourceState>;
  hits: HitEvent[];
}
export interface LoginErrorMsg { t: "loginError"; reason: string; }
export interface ChatBroadcastMsg { t: "chatMsg"; from: string; text: string; }
export interface InventoryMsg { t: "inventory"; slots: (ItemStack | null)[]; }
export interface SkillsMsg { t: "skills"; skills: Record<string, { xp: number; level: number }>; }
export interface BankMsg { t: "bank"; items: ItemStack[]; open: boolean; }
export interface ShopMsg { t: "shop"; shopId: string; name: string; entries: ShopEntry[]; open: boolean; }
export interface EquipmentMsg { t: "equipment"; weapon: string | null; body: string | null; shield: string | null; }
export type ServerMsg = WelcomeMsg | ZoneMsg | ScenarioMsg | DeltaMsg | LoginErrorMsg | ChatBroadcastMsg | InventoryMsg | SkillsMsg | BankMsg | ShopMsg | EquipmentMsg;

export function encode(msg: ClientMsg | ServerMsg): string {
  return JSON.stringify(msg);
}

export const MAX_CHAT_LEN = 200;

const CLIENT_TYPES: Record<ClientMsg["t"], true> = {
  login: true,
  moveTo: true,
  chat: true,
  pickup: true,
  drop: true,
  attack: true,
  gather: true,
  use: true,
  open: true,
  bankAction: true,
  shopAction: true,
  equipAction: true,
  inventoryAction: true,
  panelAction: true,
  intent: true,
};
const SERVER_TYPES: Record<ServerMsg["t"], true> = {
  welcome: true,
  zone: true,
  scenario: true,
  delta: true,
  loginError: true,
  chatMsg: true,
  inventory: true,
  skills: true,
  bank: true,
  shop: true,
  equipment: true,
};

function hasKnownType<T extends string>(
  value: unknown,
  types: Record<T, true>,
): value is { t: T } {
  return value !== null
    && typeof value === "object"
    && "t" in value
    && typeof value.t === "string"
    && Object.hasOwn(types, value.t);
}

export function decodeClient(data: string): ClientMsg {
  const value: unknown = JSON.parse(data);
  if (!hasKnownType(value, CLIENT_TYPES)) {
    throw new Error(`bad client message: ${data}`);
  }
  return value as ClientMsg;
}

export function decodeServer(data: string): ServerMsg {
  const value: unknown = JSON.parse(data);
  if (!hasKnownType(value, SERVER_TYPES)) {
    throw new Error(`bad server message: ${data}`);
  }
  return value as ServerMsg;
}
export * from "./quests";

export * from "./combat";
export * from "./skills";
export * from "./resources";
export * from "./shops";
export * from "./equipment";
export * from "./intents";
export * from "./models";
export * from "./recipes";
export * from "./scenarios";

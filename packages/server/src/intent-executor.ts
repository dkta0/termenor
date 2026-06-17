import type { Intent } from "@termenor/protocol";
import type { ServerMsg, InventoryMsg, BankMsg, ShopMsg, EquipmentMsg } from "@termenor/protocol";
import type { GameWorld } from "./game";

/** Per-connection session state the executor reads/writes (backed by ws.data). */
export interface IntentSession { shopId?: string; }

/** Messages produced by executing an intent. */
export interface IntentResult { self: ServerMsg[]; world: ServerMsg[]; }

const NOTHING: IntentResult = { self: [], world: [] };

// Nullable because getInventory returns null for an unknown/absent player; callers must guard before including this message.
function inventoryMsg(game: GameWorld, playerId: string): InventoryMsg | null {
  const inv = game.getInventory(playerId);
  return inv ? { t: "inventory", slots: inv } : null;
}

function equipmentMsg(game: GameWorld, playerId: string): EquipmentMsg {
  const eq = game.getEquipment(playerId);
  return { t: "equipment", weapon: eq.weapon, body: eq.body, shield: eq.shield };
}

function bankMsg(game: GameWorld, playerId: string): BankMsg {
  return { t: "bank", items: game.getBank(playerId), open: true };
}

// One handler per Intent kind. The mapped type forces every kind to have a
// handler — adding an Intent variant without a handler is a compile error.
type Handlers = {
  [K in Intent["kind"]]: (
    game: GameWorld,
    playerId: string,
    intent: Extract<Intent, { kind: K }>,
    session: IntentSession,
  ) => IntentResult;
};

const handlers: Handlers = {
  move: (game, playerId, intent) => {
    game.queueMove(playerId, intent.x, intent.y);
    return NOTHING;
  },
  attack: (game, playerId, intent) => {
    game.attack(playerId, intent.targetId);
    return NOTHING;
  },
  gather: (game, playerId, intent) => {
    game.gather(playerId, intent.targetId);
    return NOTHING;
  },
  pickup: (game, playerId) => {
    const changed = game.pickup(playerId);
    const inv = changed ? inventoryMsg(game, playerId) : null;
    return { self: inv ? [inv] : [], world: [] };
  },
  drop: (game, playerId, intent) => {
    const changed = game.drop(playerId, intent.slot);
    const inv = changed ? inventoryMsg(game, playerId) : null;
    return { self: inv ? [inv] : [], world: [] };
  },
  use: (game, playerId, intent) => {
    game.use(playerId, intent.action, intent.slot);
    return NOTHING;
  },
  openBank: (game, playerId, intent) => {
    if (!game.openBank(playerId, intent.targetId)) return NOTHING;
    return { self: [bankMsg(game, playerId)], world: [] };
  },
  openShop: (game, playerId, intent, session) => {
    const sid = game.openShop(playerId, intent.targetId);
    if (!sid) return NOTHING;
    const shop = game.getShop(sid);
    if (!shop) return NOTHING;
    session.shopId = sid;
    const msg: ShopMsg = { t: "shop", shopId: sid, name: shop.name, entries: shop.entries, open: true };
    return { self: [msg], world: [] };
  },
  deposit: (game, playerId, intent) => {
    game.deposit(playerId, intent.slot, intent.qty);
    const inv = inventoryMsg(game, playerId);
    return { self: inv ? [bankMsg(game, playerId), inv] : [bankMsg(game, playerId)], world: [] };
  },
  withdraw: (game, playerId, intent) => {
    game.withdraw(playerId, intent.index, intent.qty);
    const inv = inventoryMsg(game, playerId);
    return { self: inv ? [bankMsg(game, playerId), inv] : [bankMsg(game, playerId)], world: [] };
  },
  buy: (game, playerId, intent, session) => {
    const sid = session.shopId;
    if (!sid) return NOTHING;
    game.buy(playerId, sid, intent.item, intent.qty);
    const shop = game.getShop(sid);
    const self: ServerMsg[] = [];
    if (shop) self.push({ t: "shop", shopId: sid, name: shop.name, entries: shop.entries, open: true });
    const inv = inventoryMsg(game, playerId);
    if (inv) self.push(inv);
    return { self, world: [] };
  },
  sell: (game, playerId, intent, session) => {
    const sid = session.shopId;
    if (!sid) return NOTHING;
    game.sell(playerId, sid, intent.item, intent.qty);
    const shop = game.getShop(sid);
    const self: ServerMsg[] = [];
    if (shop) self.push({ t: "shop", shopId: sid, name: shop.name, entries: shop.entries, open: true });
    const inv = inventoryMsg(game, playerId);
    if (inv) self.push(inv);
    return { self, world: [] };
  },
  equip: (game, playerId, intent) => {
    game.equip(playerId, intent.slot);
    const inv = inventoryMsg(game, playerId);
    return { self: inv ? [equipmentMsg(game, playerId), inv] : [equipmentMsg(game, playerId)], world: [] };
  },
  unequip: (game, playerId, intent) => {
    game.unequip(playerId, intent.index);
    const inv = inventoryMsg(game, playerId);
    return { self: inv ? [equipmentMsg(game, playerId), inv] : [equipmentMsg(game, playerId)], world: [] };
  },
  order: (game, playerId, intent) => {
    const text = game.setOrder(playerId, intent.activity, intent.targetType, intent.stop);
    return { self: text ? [{ t: "chatMsg", from: "", text }] : [], world: [] };
  },
  stopOrder: (game, playerId) => {
    const text = game.clearOrder(playerId);
    return { self: text ? [{ t: "chatMsg", from: "", text }] : [], world: [] };
  },
};

/** Execute any intent against the world, returning the messages to send. */
export function executeIntent(
  game: GameWorld,
  playerId: string,
  intent: Intent,
  session: IntentSession,
): IntentResult {
  const handler = handlers[intent.kind] as (
    game: GameWorld,
    playerId: string,
    intent: Intent,
    session: IntentSession,
  ) => IntentResult;
  return handler(game, playerId, intent, session);
}

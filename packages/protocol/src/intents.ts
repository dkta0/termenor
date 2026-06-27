// The normalized, structured player command — the shared vocabulary between
// the client resolver (text/NL -> Intent) and the server executor (Intent -> effect).
// Adding a new intent is: add a variant here, register a verb in the client
// resolver, and add a handler in the server executor (the handler map is
// exhaustiveness-checked, so the compiler will flag the missing handler).

// Stop-conditions for standing orders (Slice B). A small, extensible grammar:
// add a variant here and a case in the server's stop-condition evaluator.
// untilFull / untilLevel apply to gather activities only.
export type StopCondition =
  | { kind: "forever" }
  | { kind: "count"; n: number }
  | { kind: "untilFull" }
  | { kind: "untilLevel"; level: number };

export type Intent =
  | { kind: "move"; x: number; y: number } // move: no command-line verb yet (movement is via map-click/arrows); a "go" verb may be added later
  | { kind: "attack"; targetId: string }
  | { kind: "gather"; targetId: string }
  | { kind: "pickup" }
  | { kind: "drop"; slot: number }
  | { kind: "use"; action: string; slot: number }
  | { kind: "train"; recipe: string }
  | { kind: "talk"; targetId: string }
  | { kind: "openBank"; targetId: string }
  | { kind: "openShop"; targetId: string }
  | { kind: "deposit"; slot: number; qty: number }
  | { kind: "withdraw"; index: number; qty: number }
  | { kind: "buy"; item: string; qty: number }
  | { kind: "sell"; item: string; qty: number }
  | { kind: "equip"; slot: number }
  | { kind: "unequip"; index: number }
  // Standing orders (Slice B): an autonomous activity + a stop-condition the
  // server runs across ticks. targetType is an entity .type key (e.g. "tree",
  // "rock", "goblin"), re-resolved server-side to the nearest live entity.
  | { kind: "order"; activity: "gather" | "combat"; targetType: string; stop: StopCondition }
  | { kind: "stopOrder" };

export type IntentKind = Intent["kind"];

// The normalized, structured player command — the shared vocabulary between
// the client resolver (text/NL -> Intent) and the server executor (Intent -> effect).
// Adding a new intent is: add a variant here, register a verb in the client
// resolver, and add a handler in the server executor (the handler map is
// exhaustiveness-checked, so the compiler will flag the missing handler).
export type Intent =
  | { kind: "move"; x: number; y: number } // move: no command-line verb yet (movement is via map-click/arrows); a "go" verb may be added later
  | { kind: "attack"; targetId: string }
  | { kind: "gather"; targetId: string }
  | { kind: "pickup" }
  | { kind: "drop"; slot: number }
  | { kind: "use"; action: string; slot: number }
  | { kind: "openBank"; targetId: string }
  | { kind: "openShop"; targetId: string }
  | { kind: "deposit"; slot: number; qty: number }
  | { kind: "withdraw"; index: number; qty: number }
  | { kind: "buy"; item: string; qty: number }
  | { kind: "sell"; item: string; qty: number }
  | { kind: "equip"; slot: number }
  | { kind: "unequip"; index: number };

export type IntentKind = Intent["kind"];

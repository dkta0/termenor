import type { Intent } from "@termenor/protocol";
import type { ItemStack, Equipment } from "@termenor/protocol";

export interface EntityRef { id: string; type: string; name: string; x: number; y: number; }

/** Everything the resolver needs from the live world, injected so it stays pure. */
export interface ResolveContext {
  player: { x: number; y: number };
  npcs: EntityRef[];
  resources: EntityRef[];
  inventory: (ItemStack | null)[];
  equipment: Equipment;
  itemName: (id: string) => string;
  nearestOfType: (type: string) => string | null;
  equipSlotName: (index: number) => string | null;
}

export type ResolveResult = { ok: true; intent: Intent } | { ok: false; message: string };

export interface CommandSpec {
  verbs: string[]; // first is canonical; rest are aliases
  help: string;
  parse: (args: string[], ctx: ResolveContext) => ResolveResult;
}

const err = (message: string): ResolveResult => ({ ok: false, message });
const ok = (intent: Intent): ResolveResult => ({ ok: true, intent });

/** Case-insensitive substring match; nearest to the player wins ties. */
function matchEntity(query: string, list: EntityRef[], player: { x: number; y: number }): EntityRef | null {
  const q = query.toLowerCase();
  const hits = list.filter((e) => e.name.toLowerCase().includes(q) || e.type.toLowerCase().includes(q));
  if (hits.length === 0) return null;
  return hits.reduce((best, e) =>
    Math.hypot(e.x - player.x, e.y - player.y) < Math.hypot(best.x - player.x, best.y - player.y) ? e : best,
  );
}

/** Match an item name (id or display name) to its first inventory slot, or -1. */
function matchInventorySlot(query: string, inv: (ItemStack | null)[], itemName: (id: string) => string): number {
  const q = query.toLowerCase();
  return inv.findIndex(
    (s) => s != null && (s.item.toLowerCase().includes(q) || itemName(s.item).toLowerCase().includes(q)),
  );
}

function parseQty(token: string | undefined): number {
  if (token === undefined) return 1;
  if (token === "all") return -1;
  const n = parseInt(token, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export const COMMANDS: CommandSpec[] = [
  {
    verbs: ["attack", "fight", "kill"],
    help: "attack <enemy> — fight the named enemy",
    parse: (args, ctx) => {
      if (args.length === 0) return err("attack what? e.g. `attack goblin`");
      const target = matchEntity(args.join(" "), ctx.npcs, ctx.player);
      return target ? ok({ kind: "attack", targetId: target.id }) : err(`no enemy matching "${args.join(" ")}" nearby`);
    },
  },
  {
    verbs: ["gather", "mine", "chop", "fish"],
    help: "gather <resource> — harvest the named resource",
    parse: (args, ctx) => {
      if (args.length === 0) return err("gather what? e.g. `mine copper`");
      const target = matchEntity(args.join(" "), ctx.resources, ctx.player);
      return target ? ok({ kind: "gather", targetId: target.id }) : err(`no resource matching "${args.join(" ")}" nearby`);
    },
  },
  {
    verbs: ["take", "pickup", "pick", "grab"],
    help: "take — pick up the item under you",
    parse: () => ok({ kind: "pickup" }),
  },
  {
    verbs: ["drop"],
    help: "drop <item> — drop the named item",
    parse: (args, ctx) => {
      if (args.length === 0) return err("drop what? e.g. `drop logs`");
      const slot = matchInventorySlot(args.join(" "), ctx.inventory, ctx.itemName);
      return slot >= 0 ? ok({ kind: "drop", slot }) : err(`no "${args.join(" ")}" in your inventory`);
    },
  },
  {
    verbs: ["use"],
    help: "use <action> <item> — e.g. `use firemaking logs`",
    parse: (args, ctx) => {
      if (args.length < 2) return err("use what? e.g. `use firemaking logs`");
      const action = args[0];
      const slot = matchInventorySlot(args.slice(1).join(" "), ctx.inventory, ctx.itemName);
      return slot >= 0 ? ok({ kind: "use", action, slot }) : err(`no "${args.slice(1).join(" ")}" in your inventory`);
    },
  },
  {
    verbs: ["bank"],
    help: "bank — open the nearest bank booth",
    parse: (_args, ctx) => {
      const id = ctx.nearestOfType("bank_booth");
      return id ? ok({ kind: "openBank", targetId: id }) : err("no bank booth nearby");
    },
  },
  {
    verbs: ["shop", "store"],
    help: "shop — open the nearest store",
    parse: (_args, ctx) => {
      const id = ctx.nearestOfType("general_store");
      return id ? ok({ kind: "openShop", targetId: id }) : err("no store nearby");
    },
  },
  {
    verbs: ["deposit"],
    help: "deposit <item> [qty|all] — deposit from inventory",
    parse: (args, ctx) => {
      if (args.length === 0) return err("deposit what? e.g. `deposit logs all`");
      const slot = matchInventorySlot(args[0], ctx.inventory, ctx.itemName);
      if (slot < 0) return err(`no "${args[0]}" in your inventory`);
      return ok({ kind: "deposit", slot, qty: parseQty(args[1]) });
    },
  },
  {
    verbs: ["withdraw"],
    help: "withdraw <bank-index> [qty|all] — withdraw by bank slot number",
    parse: (args) => {
      const index = parseInt(args[0] ?? "", 10);
      if (!Number.isFinite(index) || index < 1) return err("withdraw which slot? e.g. `withdraw 1 all`");
      return ok({ kind: "withdraw", index: index - 1, qty: parseQty(args[1]) });
    },
  },
  {
    verbs: ["buy"],
    help: "buy <item> [qty] — buy from the open shop",
    parse: (args) => {
      if (args.length === 0) return err("buy what? e.g. `buy logs 5`");
      return ok({ kind: "buy", item: args[0], qty: parseQty(args[1]) });
    },
  },
  {
    verbs: ["sell"],
    help: "sell <item> [qty] — sell to the open shop",
    parse: (args) => {
      if (args.length === 0) return err("sell what? e.g. `sell logs 5`");
      return ok({ kind: "sell", item: args[0], qty: parseQty(args[1]) });
    },
  },
  {
    verbs: ["equip", "wield", "wear"],
    help: "equip <item> — equip the named item",
    parse: (args, ctx) => {
      if (args.length === 0) return err("equip what? e.g. `equip bronze sword`");
      const slot = matchInventorySlot(args.join(" "), ctx.inventory, ctx.itemName);
      return slot >= 0 ? ok({ kind: "equip", slot }) : err(`no "${args.join(" ")}" in your inventory`);
    },
  },
  {
    verbs: ["unequip", "remove"],
    help: "unequip <weapon|body|shield> — remove equipped gear",
    parse: (args, ctx) => {
      if (args.length === 0) return err("unequip what? e.g. `unequip weapon`");
      const q = args[0].toLowerCase();
      const index = ["weapon", "body", "shield"].findIndex((s) => s === q);
      if (index < 0) return err("unequip weapon, body, or shield");
      const slotName = ctx.equipSlotName(index);
      if (!slotName) return err("nothing equipped there");
      return ok({ kind: "unequip", index });
    },
  },
];

// Verb -> spec lookup, built once.
const VERB_INDEX = new Map<string, CommandSpec>();
for (const spec of COMMANDS) for (const v of spec.verbs) VERB_INDEX.set(v, spec);

const ALL_VERBS = [...VERB_INDEX.keys()];

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[a.length][b.length];
}

function closestVerb(verb: string): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const v of ALL_VERBS) {
    const d = levenshtein(verb, v);
    if (d < bestD) { bestD = d; best = v; }
  }
  return best !== null && bestD <= 2 ? best : null;
}

/** Resolve a typed command line into an Intent, or an error message to show. */
export function resolveCommand(line: string, ctx: ResolveContext): ResolveResult {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return err("type a command, e.g. `mine copper`");
  const [verb, ...args] = tokens;
  const spec = VERB_INDEX.get(verb.toLowerCase());
  if (!spec) {
    const suggestion = closestVerb(verb.toLowerCase());
    return err(suggestion ? `unknown command "${verb}" — did you mean "${suggestion}"?` : `unknown command "${verb}"`);
  }
  return spec.parse(args, ctx);
}

/** Verbs (canonical + aliases) matching a prefix, for tab-completion. */
export function completions(prefix: string): string[] {
  const p = prefix.toLowerCase();
  return ALL_VERBS.filter((v) => v.startsWith(p)).sort();
}

import {
  createCliRenderer,
  BoxRenderable,
  RGBA,
  type CliRenderer,
  type KeyEvent,
  type MouseEvent as TuiMouseEvent,
  type OptimizedBuffer,
} from "@opentui/core";
import { ITEM_KINDS, NPC_KINDS, RESOURCE_KINDS, EQUIP_SLOTS, type Intent } from "@termenor/protocol";
import type { GameState } from "../game-state";
import { CommandLine, classifyDirectInput } from "../command-line";
import { legendLines, type Mode } from "./legend";
import { LogState, type LogTier } from "../log";
import { resolveCommand, type ResolveContext, type EntityRef } from "../resolve";
import { helpPanelLines, resolveHelp } from "../help";
import type { ChatState } from "../chat";
import { isoCamera, pickTile } from "./camera";
import { rasterizeIso, type IsoFrame } from "./rasterize";
import { cellGridFor, selectTier, type CapsLike } from "./tiers";
import { arrowDelta } from "./input";
import { tileToScreen } from "./iso";
import { textCells, centerCol } from "./overlay";
import { type CellGrid, type Tier } from "./types";
import { isHudClick, type HudRegions } from "./click-gate";
import { pageCount, clampPage, indexForDigit, pageSlice } from "./paging";

export interface RendererHandle {
  stop(): void;
  tier: Tier;
}

export interface RendererHooks {
  /** Called with a destination tile when the player clicks / presses an arrow. */
  onMoveTo(x: number, y: number): void;
  /** Called with trimmed chat text when the user submits a chat message. */
  onChat(text: string): void;
  /** Called when the player presses 'g' to pick up a ground item. */
  onPickup?(): void;
  /** Drop an inventory slot (now via the `/drop` command → intent path). */
  onDrop?(slot: number): void;
  /** Called when the player presses 'a' to attack the nearest NPC. */
  onAttack?(targetId: string): void;
  /** Called when the player presses 'c' to chop/gather the nearest resource. */
  onGather?(id: string): void;
  /** Use a skill on an inventory slot (now via the `/use` command → intent path). */
  onUse?(action: string, slot: number): void;
  /** Open a bank booth / store (now via the `/bank` / `/shop` command → intent path). */
  onOpen?(what: "bank" | "shop", targetId: string): void;
  /** Called for a bank deposit/withdraw on the given slot (qty=-1 means "all"). */
  onBankAction?(action: "deposit" | "withdraw", slot: number, qty: number): void;
  /** Called for a shop buy/sell of the given item id. */
  onShopAction?(action: "buy" | "sell", item: string, qty: number): void;
  /** Called for an equip (by inventory slot) / unequip (by equipment-slot index). */
  onEquipAction?(action: "equip" | "unequip", slot: number): void;
  /** Called when the command line resolves a valid intent. */
  onIntent?(intent: Intent): void;
}

const BLACK = RGBA.fromInts(0, 0, 0, 255);

/** Nearest entity to (ox, oy) by Euclidean distance, or null for an empty list. */
function nearest<T extends { x: number; y: number }>(list: T[], ox: number, oy: number): T | null {
  let best: T | null = null;
  let bestD = Infinity;
  for (const e of list) {
    const d = Math.hypot(e.x - ox, e.y - oy);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

function buildResolveContext(state: GameState, _log: LogState): ResolveContext {
  const now = performance.now();
  const me = state.samplePositions(now).find((p) => p.id === state.localId);
  const player = me ? { x: me.x, y: me.y } : { x: 0, y: 0 };
  const npcs: EntityRef[] = state.sampleNpcs(now).map((n) => ({
    id: n.id, type: n.type, name: n.type.replace(/_/g, " "), x: n.x, y: n.y,
  }));
  const resources: EntityRef[] = state.sampleResources().map((r) => ({
    id: r.id, type: r.type, name: (RESOURCE_KINDS[r.type]?.name ?? r.type).toLowerCase(), x: r.x, y: r.y,
  }));
  return {
    player, npcs, resources,
    inventory: state.inventory,
    equipment: state.equipment,
    itemName: (id) => ITEM_KINDS[id]?.name ?? id,
    nearestOfType: (type) => state.nearestResourceOfType(type, now),
    equipSlotName: (index) => (["weapon", "body", "shield"][index] ?? null),
  };
}

/**
 * Boots OpenTUI, drives a 60fps frame callback that samples GameState and
 * blits a cell grid. Returns a handle. Requires a real terminal.
 */
export async function startRenderer(state: GameState, chat: ChatState, hooks: RendererHooks): Promise<RendererHandle> {
  const renderer: CliRenderer = await createCliRenderer({ targetFps: 60, useMouse: true });
  const tier: Tier = selectTier((renderer.capabilities as CapsLike | null) ?? null);

  let lastFrame: IsoFrame | null = null;
  // Panel-local modes for the bank/shop panels (which digit actions mean).
  let bankMode: "deposit" | "withdraw" = "deposit";
  let shopMode: "buy" | "sell" = "buy";
  let equipMode: "equip" | "unequip" = "equip";
  const hud: HudRegions = { modalOpen: false, panelCol: 0, panelBottomRow: 0, skillsRows: 0, skillsWidth: 0 };
  let modalPage = 0;
  let lastModal: "bank" | "shop" | "equip" | null = null;
  // Bank rows for the current frame/mode: withdraw -> bank entries, deposit -> the
  // player's non-empty inventory slots. `slot` is the index the server action expects.
  let bankRows: { slot: number; item: string; qty: number }[] = [];
  const cmd = new CommandLine();
  const log = new LogState();

  // Route a submitted Direct-mode line. Commands (leading "/") go through the
  // shared intent boundary; bare "/equip"|"/gear" toggles the client-only
  // equipment view (it has no server intent); everything else is chat.
  const routeDirectLine = (line: string): void => {
    const input = classifyDirectInput(line);
    if (input.kind === "chat") { hooks.onChat(input.text); return; }
    const verb = input.command.split(/\s+/)[0]?.toLowerCase() ?? "";
    if ((verb === "equip" || verb === "gear") && !/\s/.test(input.command)) {
      equipMode = "equip";
      state.toggleEquip();
      log.push("ambient", "» equip");
      return;
    }
    if (verb === "help") {
      const action = resolveHelp(input.command);
      if (action.kind === "open") { state.helpOpen = true; log.push("ambient", "» help"); }
      else if (action.kind === "verb") { for (const l of action.lines) log.push("ambient", l); }
      else log.push("notable", action.suggestion
        ? `no help for "${action.verb}" — did you mean "${action.suggestion}"?`
        : `no help for "${action.verb}"`);
      return;
    }
    if (input.command.length === 0) { log.push("notable", "type a command, e.g. /mine copper"); return; }
    const result = resolveCommand(input.command, buildResolveContext(state, log));
    if (result.ok) { hooks.onIntent?.(result.intent); log.push("ambient", `» ${input.command}`); }
    else log.push("notable", result.message);
  };

  renderer.setFrameCallback(async () => {
    const curModal = state.bankOpen ? "bank" : state.shopOpen ? "shop" : state.equipOpen ? "equip" : null;
    if (curModal !== lastModal) { modalPage = 0; lastModal = curModal; }
    const buffer = renderer.nextRenderBuffer;
    const map = state.map;
    if (!buffer || !map) return;

    const cols = renderer.terminalWidth;
    const rows = renderer.terminalHeight;
    const pxW = cols;
    const pxH = tier === "halfblock" ? rows * 2 : rows;

    const now = performance.now();
    const players = state.samplePositions(now);
    const npcs = state.sampleNpcs(now);
    const resources = state.sampleResources();
    const me = players.find((p) => p.id === state.localId);
    const center = me ? tileToScreen(me.x, me.y, me.h) : tileToScreen(map.width / 2, map.height / 2, 0);
    const cam = isoCamera(center.sx, center.sy, pxW, pxH);

    const frame = rasterizeIso(map, players, cam.ox, cam.oy, pxW, pxH, state.localId, state.ground, npcs, resources, now);
    lastFrame = frame;
    const grid = cellGridFor(tier, frame.buf);
    blit(buffer, grid);

    // --- Overlays (drawn directly via setCell after blit) ---

    const WHITE = RGBA.fromInts(255, 255, 255, 255);
    const YELLOW = RGBA.fromInts(255, 255, 0, 255);
    const CYAN = RGBA.fromInts(0, 220, 220, 255);
    const DIM = RGBA.fromInts(180, 180, 180, 255);

    // Name labels: one cell-row above each player's billboard
    for (const p of players) {
      const { sx, sy } = tileToScreen(p.x, p.y, p.h);
      // Billboard top is ~2 px above tile center; name label one cell higher.
      // halfblock: 1 cell = 2 px. Add 4 extra px so label clears the billboard.
      const labelSy = sy - cam.oy - 6;
      const labelRow = tier === "halfblock" ? Math.round(labelSy / 2) - 1 : Math.round(labelSy) - 1;
      const labelSx = sx - cam.ox;
      const labelCol = centerCol(labelSx, p.id.length); // jitter-free centering (see overlay.ts)
      const color = p.id === state.localId ? YELLOW : WHITE;
      for (const cell of textCells(p.id, labelCol, labelRow, cols, rows)) {
        buffer.setCell(cell.col, cell.row, cell.char, color, BLACK);
      }
    }

    // NPC name labels: type name above each NPC's billboard
    for (const npc of npcs) {
      const { sx, sy } = tileToScreen(npc.x, npc.y, npc.h);
      const labelSy = sy - cam.oy - 6;
      const labelRow = tier === "halfblock" ? Math.round(labelSy / 2) - 1 : Math.round(labelSy) - 1;
      const labelSx = sx - cam.ox;
      const label = NPC_KINDS[npc.type]?.name ?? npc.type;
      const labelCol = centerCol(labelSx, label.length);
      const entry = NPC_KINDS[npc.type];
      const [r, g, b] = entry ? entry.color : [200, 200, 200];
      const color = RGBA.fromInts(r, g, b, 255);
      for (const cell of textCells(label, labelCol, labelRow, cols, rows)) {
        buffer.setCell(cell.col, cell.row, cell.char, color, BLACK);
      }
    }

    // Damage splats: red number floating above hit entity
    const RED = RGBA.fromInts(255, 60, 60, 255);
    for (const splat of state.activeSplats(now)) {
      // Find target in current sample (players + npcs); skip if not visible
      const targetPlayer = players.find((p) => p.id === splat.targetId);
      const targetNpc = npcs.find((n) => n.id === splat.targetId);
      const target = targetPlayer ?? targetNpc;
      if (!target) continue;
      const { sx, sy } = tileToScreen(target.x, target.y, target.h);
      const splatSy = sy - cam.oy - 8; // above the HP bar
      const splatRow = tier === "halfblock" ? Math.round(splatSy / 2) - 1 : Math.round(splatSy) - 1;
      const splatSx = sx - cam.ox;
      const label = `-${splat.amount}`;
      const splatCol = centerCol(splatSx, label.length);
      for (const cell of textCells(label, splatCol, splatRow, cols, rows)) {
        buffer.setCell(cell.col, cell.row, cell.char, RED, BLACK);
      }
    }

    // Chat log: bottom-left, last 6 messages
    const LOG_LINES = 6;
    const recentMsgs = chat.recent(LOG_LINES);
    const logStartRow = rows - LOG_LINES - (cmd.active ? 2 : 1);
    for (let i = 0; i < recentMsgs.length; i++) {
      const { from, text } = recentMsgs[i];
      const line = `${from}: ${text}`;
      const row = logStartRow + i;
      for (const cell of textCells(line, 1, row, cols, rows)) {
        buffer.setCell(cell.col, cell.row, cell.char, DIM, BLACK);
      }
    }

    // Tiered event log: rendered above the command input line
    const TIER_COLORS: Record<LogTier, ReturnType<typeof RGBA.fromInts>> = {
      ambient: DIM,
      notable: RGBA.fromInts(230, 210, 140, 255),
      critical: RGBA.fromInts(230, 110, 110, 255),
    };
    const logLines = log.recent(5);
    const logTop = rows - 7 - logLines.length - (cmd.active ? 1 : 0);
    for (let i = 0; i < logLines.length; i++) {
      const e = logLines[i];
      for (const cell of textCells(e.text, 1, logTop + i, cols, rows))
        buffer.setCell(cell.col, cell.row, cell.char, TIER_COLORS[e.tier], BLACK);
    }

    // Direct-mode input line: "»" prompt for commands (leading "/"), ">" for chat.
    if (cmd.active) {
      const prompt = cmd.input.startsWith("/") ? "»" : ">";
      const cmdLine = `${prompt} ${cmd.input}_`;
      for (const cell of textCells(cmdLine, 1, rows - 1, cols, rows))
        buffer.setCell(cell.col, cell.row, cell.char, CYAN, BLACK);
    }

    // Skills HUD: top-left corner, one line per skill
    const SKILLS_COLOR = RGBA.fromInts(100, 220, 100, 255);
    const skillLines = state.skillsLines();
    for (let si = 0; si < skillLines.length; si++) {
      for (const cell of textCells(skillLines[si], 1, si, cols, rows)) {
        buffer.setCell(cell.col, cell.row, cell.char, SKILLS_COLOR, BLACK);
      }
    }

    // Inventory panel: right edge, list non-empty slots
    const PANEL_COL = cols - 22;
    const PANEL_COLOR = RGBA.fromInts(200, 200, 160, 255);
    buffer.setCell(PANEL_COL, 1, "[", PANEL_COLOR, BLACK);
    const invLabel = " Inventory ]";
    for (const cell of textCells(invLabel, PANEL_COL + 1, 1, cols, rows)) {
      buffer.setCell(cell.col, cell.row, cell.char, PANEL_COLOR, BLACK);
    }
    const nonEmpty = state.inventory
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s !== null);
    const maxSlots = Math.min(nonEmpty.length, rows - 4);
    for (let row = 0; row < maxSlots; row++) {
      const { s, i } = nonEmpty[row];
      if (!s) continue;
      const entry = ITEM_KINDS[s.item];
      const label = `${i + 1}: ${entry?.name ?? s.item} x${s.qty}`;
      for (const cell of textCells(label, PANEL_COL, row + 2, cols, rows)) {
        buffer.setCell(cell.col, cell.row, cell.char, PANEL_COLOR, BLACK);
      }
    }

    // Expose this frame's HUD layout to the click handler (cell coords).
    hud.modalOpen = state.bankOpen || state.shopOpen || state.equipOpen || state.helpOpen;
    hud.panelCol = PANEL_COL;
    hud.panelBottomRow = maxSlots + 1; // header at row 1, items at rows 2..(maxSlots+1)
    hud.skillsRows = skillLines.length;
    hud.skillsWidth = skillLines.reduce((w, l) => Math.max(w, l.length), 0);

    // Bank panel (modal, left side below the skills HUD). Lists bank entries by
    // index — withdraw mode picks from here; deposit mode picks from inventory.
    if (state.bankOpen) {
      const BANK_COLOR = RGBA.fromInts(210, 195, 90, 255);
      const startRow = skillLines.length + 2;
      // Withdraw picks from the bank; deposit picks from your inventory slots.
      bankRows = bankMode === "withdraw"
        ? state.bank.map((it, i) => ({ slot: i, item: it.item, qty: it.qty }))
        : state.inventory
            .map((s, i) => ({ s, i }))
            .filter((e): e is { s: NonNullable<typeof e.s>; i: number } => e.s !== null)
            .map(({ s, i }) => ({ slot: i, item: s.item, qty: s.qty }));
      const pages = pageCount(bankRows.length);
      const header = `[ Bank — ${bankMode.toUpperCase()} ]`;
      for (const cell of textCells(header, 2, startRow, cols, rows)) buffer.setCell(cell.col, cell.row, cell.char, BANK_COLOR, BLACK);
      const hint = `d deposit · w withdraw · 1-9 item · [ ] page ${modalPage + 1}/${pages} · Esc close`;
      for (const cell of textCells(hint, 2, startRow + 1, cols, rows)) buffer.setCell(cell.col, cell.row, cell.char, DIM, BLACK);
      const { start, end } = pageSlice(modalPage, bankRows.length);
      for (let i = start; i < end; i++) {
        const r = bankRows[i];
        const label = `${i - start + 1}: ${ITEM_KINDS[r.item]?.name ?? r.item} x${r.qty}`;
        for (const cell of textCells(label, 2, startRow + 2 + (i - start), cols, rows)) buffer.setCell(cell.col, cell.row, cell.char, BANK_COLOR, BLACK);
      }
    }

    // Shop panel (modal, left side). Same paged entry list for buy and sell.
    if (state.shopOpen && state.shop) {
      const SHOP_COLOR = RGBA.fromInts(210, 130, 210, 255);
      const startRow = skillLines.length + 2;
      const entries = state.shop.entries;
      const pages = pageCount(entries.length);
      const header = `[ ${state.shop.name} — ${shopMode.toUpperCase()} ]`;
      for (const cell of textCells(header, 2, startRow, cols, rows)) buffer.setCell(cell.col, cell.row, cell.char, SHOP_COLOR, BLACK);
      const hint = `b buy · s sell · 1-9 item · [ ] page ${modalPage + 1}/${pages} · Esc close`;
      for (const cell of textCells(hint, 2, startRow + 1, cols, rows)) buffer.setCell(cell.col, cell.row, cell.char, DIM, BLACK);
      const { start, end } = pageSlice(modalPage, entries.length);
      for (let i = start; i < end; i++) {
        const e = entries[i];
        const label = `${i - start + 1}: ${ITEM_KINDS[e.item]?.name ?? e.item}  ${e.price}gp (${e.stock})`;
        for (const cell of textCells(label, 2, startRow + 2 + (i - start), cols, rows)) buffer.setCell(cell.col, cell.row, cell.char, SHOP_COLOR, BLACK);
      }
    }

    // Equipment panel (modal, left side). Lists the three slots in EQUIP_SLOTS order.
    if (state.equipOpen) {
      const EQUIP_COLOR = RGBA.fromInts(150, 200, 230, 255);
      const startRow = skillLines.length + 2;
      const header = `[ Equipment — ${equipMode.toUpperCase()} ]`;
      for (const cell of textCells(header, 2, startRow, cols, rows)) buffer.setCell(cell.col, cell.row, cell.char, EQUIP_COLOR, BLACK);
      const hint = "q equip · u unequip · 1-9 slot · Esc close";
      for (const cell of textCells(hint, 2, startRow + 1, cols, rows)) buffer.setCell(cell.col, cell.row, cell.char, DIM, BLACK);
      for (let i = 0; i < EQUIP_SLOTS.length; i++) {
        const slot = EQUIP_SLOTS[i];
        const item = state.equipment[slot];
        const slotName = slot.charAt(0).toUpperCase() + slot.slice(1);
        const label = `${i + 1}: ${slotName}: ${item ? (ITEM_KINDS[item]?.name ?? item) : "(empty)"}`;
        for (const cell of textCells(label, 2, startRow + 2 + i, cols, rows)) buffer.setCell(cell.col, cell.row, cell.char, EQUIP_COLOR, BLACK);
      }
    }

    // Help overlay (modal, left side). A static control + command reference.
    if (state.helpOpen) {
      const HELP_HEADER = RGBA.fromInts(120, 200, 160, 255);
      const HELP_BODY = RGBA.fromInts(200, 200, 200, 255);
      const startRow = skillLines.length + 2;
      const lines = helpPanelLines();
      for (let i = 0; i < lines.length; i++) {
        const color = i === 0 ? HELP_HEADER : HELP_BODY;
        for (const cell of textCells(lines[i], 2, startRow + i, cols, rows)) {
          buffer.setCell(cell.col, cell.row, cell.char, color, BLACK);
        }
      }
    }

    // --- Control legend: a single bottom strip, generated from live state ---
    const LEGEND_COLOR = RGBA.fromInts(120, 200, 160, 255);
    const mode: Mode = cmd.active ? "direct" : "play";
    const meTileX = me ? Math.round(me.x) : null;
    const meTileY = me ? Math.round(me.y) : null;
    const under = meTileX !== null
      ? state.ground.find((gi) => gi.x === meTileX && gi.y === meTileY)
      : undefined;
    const enemy = me ? nearest(npcs, me.x, me.y) : null;
    const gatherables = resources.filter((r) => RESOURCE_KINDS[r.type]?.gatherable);
    const res = me ? nearest(gatherables, me.x, me.y) : null;
    const legend = legendLines({
      mode,
      nearestEnemy: enemy ? (NPC_KINDS[enemy.type]?.name ?? enemy.type) : null,
      nearestResource: res ? (RESOURCE_KINDS[res.type]?.name ?? res.type) : null,
      itemUnderfoot: under ? (ITEM_KINDS[under.item]?.name ?? under.item) : null,
    });
    // Bottom row in Play mode; one row up in Direct mode so it clears the input line.
    const legendRow = rows - 1 - (cmd.active ? 1 : 0);
    for (const cell of textCells(legend.join("   "), 1, legendRow, cols, rows)) {
      buffer.setCell(cell.col, cell.row, cell.char, LEGEND_COLOR, BLACK);
    }
  });

  // OpenTUI dispatches mouse events only to renderables registered in the hit
  // grid; the RootRenderable never registers itself, and we draw the world by
  // writing pixels straight to the buffer (no child renderables). So clicks
  // landed on nothing and `onMouseDown` never fired. A full-screen, invisible
  // box (no border, no fill) registers in the hit grid and catches every click
  // without painting over the world.
  const clickLayer = new BoxRenderable(renderer, {
    id: "click-layer",
    width: "100%",
    height: "100%",
    border: false,
    shouldFill: false,
  });
  renderer.root.add(clickLayer);

  clickLayer.onMouseDown = (e: TuiMouseEvent) => {
    if (cmd.active) return; // gate clicks while typing in Direct mode
    if (isHudClick(e.x, e.y, hud)) return; // gate clicks on HUD chrome / open modals
    if (!lastFrame || !state.map) return;
    const px = e.x;
    const py = tier === "halfblock" ? e.y * 2 : e.y;
    const t = pickTile(lastFrame, px, py, state.map.width);
    if (t) hooks.onMoveTo(t.x, t.y);
  };

  renderer.keyInput.on("keypress", (key: KeyEvent) => {
    // Help overlay: consume keys while open; ? or Esc closes it.
    if (state.helpOpen) {
      if (key.name === "escape" || key.sequence === "?") state.closeHelp();
      return;
    }

    // --- Modal panels (bank/shop/equip): consume all keys while open ---
    if (state.bankOpen) {
      if (key.name === "escape") { state.closeBank(); return; }
      if (key.name === "d") { bankMode = "deposit"; modalPage = 0; return; }
      if (key.name === "w") { bankMode = "withdraw"; modalPage = 0; return; }
      if (key.name === "]" || key.sequence === "]") { modalPage = clampPage(modalPage + 1, bankRows.length); return; }
      if (key.name === "[" || key.sequence === "[") { modalPage = clampPage(modalPage - 1, bankRows.length); return; }
      const m = /^([1-9])$/.exec(key.name ?? "");
      if (m) {
        const idx = indexForDigit(modalPage, parseInt(m[1], 10), bankRows.length);
        if (idx >= 0) hooks.onBankAction?.(bankMode, bankRows[idx].slot, -1); // -1 = all
      }
      return;
    }
    if (state.shopOpen) {
      if (key.name === "escape") { state.closeShop(); return; }
      if (key.name === "b") { shopMode = "buy"; modalPage = 0; return; }
      if (key.name === "s") { shopMode = "sell"; modalPage = 0; return; }
      const entries = state.shop?.entries ?? [];
      if (key.name === "]" || key.sequence === "]") { modalPage = clampPage(modalPage + 1, entries.length); return; }
      if (key.name === "[" || key.sequence === "[") { modalPage = clampPage(modalPage - 1, entries.length); return; }
      const m = /^([1-9])$/.exec(key.name ?? "");
      if (m) {
        const idx = indexForDigit(modalPage, parseInt(m[1], 10), entries.length);
        const entry = entries[idx];
        if (idx >= 0 && entry) hooks.onShopAction?.(shopMode, entry.item, 1);
      }
      return;
    }
    if (state.equipOpen) {
      if (key.name === "escape") { state.closeEquip(); return; }
      if (key.name === "q") { equipMode = "equip"; return; }
      if (key.name === "u") { equipMode = "unequip"; return; }
      const m = /^([1-9])$/.exec(key.name ?? "");
      if (m) hooks.onEquipAction?.(equipMode, parseInt(m[1], 10) - 1);
      return;
    }

    // --- Direct mode: the typing layer (commands + chat share one line) ---
    if (cmd.active) {
      if (key.name === "return" || key.name === "enter") {
        const line = cmd.submit();
        if (line) routeDirectLine(line);
      } else if (key.name === "escape") {
        cmd.cancel();
      } else if (key.name === "backspace") {
        cmd.backspace();
      } else if (key.name === "up") {
        cmd.historyPrev();
      } else if (key.name === "down") {
        cmd.historyNext();
      } else {
        cmd.type(key.sequence ?? key.name ?? "");
      }
      return;
    }

    // --- Play mode ---
    // Enter opens the typing layer chat-ready; "/" opens it command-ready.
    if (key.name === "return" || key.name === "enter") { cmd.open(); return; }
    if (key.sequence === "/") { cmd.open(); cmd.type("/"); return; }
    if (key.sequence === "?") { state.toggleHelp(); return; }

    // Pick up the item underfoot.
    if (key.name === "g") { hooks.onPickup?.(); return; }

    // Attack nearest NPC.
    if (key.name === "a") {
      const attackNow = performance.now();
      const meAtk = state.samplePositions(attackNow).find((p) => p.id === state.localId);
      const attackNpcs = state.sampleNpcs(attackNow);
      if (meAtk && attackNpcs.length > 0) {
        let best = attackNpcs[0], bestD = Infinity;
        for (const n of attackNpcs) {
          const d = Math.hypot(n.x - meAtk.x, n.y - meAtk.y);
          if (d < bestD) { bestD = d; best = n; }
        }
        hooks.onAttack?.(best.id);
      }
      return;
    }

    // Gather nearest gatherable resource.
    if (key.name === "c") {
      const gatherNow = performance.now();
      const gatherMe = state.samplePositions(gatherNow).find((p) => p.id === state.localId);
      const gatherResources = state.sampleResources().filter((r) => RESOURCE_KINDS[r.type]?.gatherable);
      if (gatherMe && gatherResources.length > 0) {
        let best = gatherResources[0], bestD = Infinity;
        for (const r of gatherResources) {
          const d = Math.hypot(r.x - gatherMe.x, r.y - gatherMe.y);
          if (d < bestD) { bestD = d; best = r; }
        }
        hooks.onGather?.(best.id);
      }
      return;
    }

    // Arrow-key movement.
    const d = arrowDelta(key.name);
    if (!d) return;
    const players = state.samplePositions(performance.now());
    const meMove = players.find((p) => p.id === state.localId);
    if (!meMove) return;
    hooks.onMoveTo(Math.round(meMove.x) + d.dx, Math.round(meMove.y) + d.dy);
  });

  renderer.start();
  return { stop: () => renderer.destroy(), tier };
}

function blit(buffer: OptimizedBuffer, grid: CellGrid): void {
  buffer.clear(BLACK);
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const cell = grid.cells[r * grid.cols + c];
      // fromInts: 0–255 channels. (fromValues expects normalized 0–1 floats.)
      const fg = RGBA.fromInts(cell.fg[0], cell.fg[1], cell.fg[2], 255);
      const bg = RGBA.fromInts(cell.bg[0], cell.bg[1], cell.bg[2], 255);
      buffer.setCell(c, r, cell.char, fg, bg);
    }
  }
}

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
import { CommandLine } from "../command-line";
import { LogState, type LogTier } from "../log";
import { resolveCommand, type ResolveContext, type EntityRef } from "../resolve";
import type { ChatState } from "../chat";
import { isoCamera, pickTile } from "./camera";
import { rasterizeIso, type IsoFrame } from "./rasterize";
import { cellGridFor, selectTier, type CapsLike } from "./tiers";
import { arrowDelta } from "./input";
import { tileToScreen } from "./iso";
import { textCells, centerCol } from "./overlay";
import { type CellGrid, type Tier } from "./types";

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
  /** Called when the player presses a number key to drop inventory slot `slot`. */
  onDrop?(slot: number): void;
  /** Called when the player presses 'a' to attack the nearest NPC. */
  onAttack?(targetId: string): void;
  /** Called when the player presses 'c' to chop/gather the nearest resource. */
  onGather?(id: string): void;
  /** Called when the player presses 'f' or 'k' to use a skill on an inventory slot. */
  onUse?(action: string, slot: number): void;
  /** Called when the player presses 'b'/'o' near a bank booth / store to open it. */
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
  const cmd = new CommandLine();
  const log = new LogState();

  renderer.setFrameCallback(async () => {
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
    const logStartRow = rows - LOG_LINES - (chat.active ? 2 : 1);
    for (let i = 0; i < recentMsgs.length; i++) {
      const { from, text } = recentMsgs[i];
      const line = `${from}: ${text}`;
      const row = logStartRow + i;
      for (const cell of textCells(line, 1, row, cols, rows)) {
        buffer.setCell(cell.col, cell.row, cell.char, DIM, BLACK);
      }
    }

    // Input line: shown when chat is active
    if (chat.active) {
      const inputLine = `> ${chat.input}_`;
      for (const cell of textCells(inputLine, 1, rows - 1, cols, rows)) {
        buffer.setCell(cell.col, cell.row, cell.char, CYAN, BLACK);
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

    // Command input line: shown when cmd is active
    if (cmd.active) {
      const cmdLine = `» ${cmd.input}_`;
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

    // Bank panel (modal, left side below the skills HUD). Lists bank entries by
    // index — withdraw mode picks from here; deposit mode picks from inventory.
    if (state.bankOpen) {
      const BANK_COLOR = RGBA.fromInts(210, 195, 90, 255);
      const startRow = skillLines.length + 2;
      const header = `[ Bank — ${bankMode.toUpperCase()} ]`;
      for (const cell of textCells(header, 2, startRow, cols, rows)) buffer.setCell(cell.col, cell.row, cell.char, BANK_COLOR, BLACK);
      const hint = "d deposit · w withdraw · 1-9 item · Esc close";
      for (const cell of textCells(hint, 2, startRow + 1, cols, rows)) buffer.setCell(cell.col, cell.row, cell.char, DIM, BLACK);
      const maxRows = Math.max(0, rows - startRow - 4);
      const max = Math.min(state.bank.length, maxRows);
      for (let i = 0; i < max; i++) {
        const it = state.bank[i];
        const label = `${i + 1}: ${ITEM_KINDS[it.item]?.name ?? it.item} x${it.qty}`;
        for (const cell of textCells(label, 2, startRow + 2 + i, cols, rows)) buffer.setCell(cell.col, cell.row, cell.char, BANK_COLOR, BLACK);
      }
    }

    // Shop panel (modal, left side). Same index set for buy and sell.
    if (state.shopOpen && state.shop) {
      const SHOP_COLOR = RGBA.fromInts(210, 130, 210, 255);
      const startRow = skillLines.length + 2;
      const header = `[ ${state.shop.name} — ${shopMode.toUpperCase()} ]`;
      for (const cell of textCells(header, 2, startRow, cols, rows)) buffer.setCell(cell.col, cell.row, cell.char, SHOP_COLOR, BLACK);
      const hint = "b buy · s sell · 1-9 item · Esc close";
      for (const cell of textCells(hint, 2, startRow + 1, cols, rows)) buffer.setCell(cell.col, cell.row, cell.char, DIM, BLACK);
      const entries = state.shop.entries;
      const maxRows = Math.max(0, rows - startRow - 4);
      const max = Math.min(entries.length, maxRows);
      for (let i = 0; i < max; i++) {
        const e = entries[i];
        const label = `${i + 1}: ${ITEM_KINDS[e.item]?.name ?? e.item}  ${e.price}gp (${e.stock})`;
        for (const cell of textCells(label, 2, startRow + 2 + i, cols, rows)) buffer.setCell(cell.col, cell.row, cell.char, SHOP_COLOR, BLACK);
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
    if (chat.active) return; // gate clicks while typing
    if (!lastFrame || !state.map) return;
    const px = e.x;
    const py = tier === "halfblock" ? e.y * 2 : e.y;
    const t = pickTile(lastFrame, px, py, state.map.width);
    if (t) hooks.onMoveTo(t.x, t.y);
  };

  renderer.keyInput.on("keypress", (key: KeyEvent) => {
    if (cmd.active) {
      if (key.name === "return" || key.name === "enter") {
        const line = cmd.submit();
        if (line) {
          const result = resolveCommand(line, buildResolveContext(state, log));
          if (result.ok) { hooks.onIntent?.(result.intent); log.push("ambient", `» ${line}`); }
          else log.push("notable", result.message);
        }
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

    if (chat.active) {
      // Chat input mode — consume all keys; movement is gated
      if (key.name === "return" || key.name === "enter") {
        const text = chat.submit();
        if (text) hooks.onChat(text);
      } else if (key.name === "escape") {
        chat.cancel();
      } else if (key.name === "backspace") {
        chat.backspace();
      } else {
        chat.type(key.sequence ?? key.name ?? ""); // sequence carries the real glyph (space, uppercase)
      }
      return; // always return early — block arrows/mouse movement while typing
    }

    // Bank panel open (modal): consume all keys so digits never fall through to onDrop.
    if (state.bankOpen) {
      if (key.name === "escape") { state.closeBank(); return; }
      if (key.name === "d") { bankMode = "deposit"; return; }
      if (key.name === "w") { bankMode = "withdraw"; return; }
      const m = /^([1-9])$/.exec(key.name ?? "");
      if (m) {
        const idx = parseInt(m[1], 10) - 1;
        hooks.onBankAction?.(bankMode, idx, -1); // -1 = all
      }
      return;
    }

    // Shop panel open (modal): same index set for buy and sell.
    if (state.shopOpen) {
      if (key.name === "escape") { state.closeShop(); return; }
      if (key.name === "b") { shopMode = "buy"; return; }
      if (key.name === "s") { shopMode = "sell"; return; }
      const m = /^([1-9])$/.exec(key.name ?? "");
      if (m) {
        const entry = state.shop?.entries[parseInt(m[1], 10) - 1];
        if (entry) hooks.onShopAction?.(shopMode, entry.item, 1);
      }
      return;
    }

    // Equipment panel open (modal): EQUIP picks an inventory slot, UNEQUIP an equipped slot.
    if (state.equipOpen) {
      if (key.name === "escape") { state.closeEquip(); return; }
      if (key.name === "q") { equipMode = "equip"; return; }
      if (key.name === "u") { equipMode = "unequip"; return; }
      const m = /^([1-9])$/.exec(key.name ?? "");
      if (m) hooks.onEquipAction?.(equipMode, parseInt(m[1], 10) - 1);
      return;
    }

    // Not in chat mode
    if (key.name === "return" || key.name === "enter") {
      chat.open();
      return;
    }

    // Open the command line
    if (key.sequence === ":") { cmd.open(); return; }

    // Open the bank booth / store nearest the player.
    if (key.name === "b") {
      const id = state.nearestResourceOfType("bank_booth", performance.now());
      if (id) { bankMode = "deposit"; hooks.onOpen?.("bank", id); }
      return;
    }
    if (key.name === "o") {
      const id = state.nearestResourceOfType("general_store", performance.now());
      if (id) { shopMode = "buy"; hooks.onOpen?.("shop", id); }
      return;
    }

    // Toggle the equipment panel (always available — no world object to open).
    if (key.name === "e") { equipMode = "equip"; state.toggleEquip(); return; }

    // Inventory keys
    if (key.name === "g") { hooks.onPickup?.(); return; }
    const numMatch = /^([1-9])$/.exec(key.name ?? "");
    if (numMatch) { hooks.onDrop?.(parseInt(numMatch[1], 10) - 1); return; }

    // Attack nearest NPC
    if (key.name === "a") {
      const attackNow = performance.now();
      const attackPlayers = state.samplePositions(attackNow);
      const me = attackPlayers.find((p) => p.id === state.localId);
      const attackNpcs = state.sampleNpcs(attackNow);
      if (me && attackNpcs.length > 0) {
        let best = attackNpcs[0], bestD = Infinity;
        for (const n of attackNpcs) {
          const d = Math.hypot(n.x - me.x, n.y - me.y);
          if (d < bestD) { bestD = d; best = n; }
        }
        hooks.onAttack?.(best.id);
      }
      return;
    }

    // Gather nearest gatherable resource (excludes fire)
    if (key.name === "c") {
      const gatherNow = performance.now();
      const gatherPlayers = state.samplePositions(gatherNow);
      const gatherMe = gatherPlayers.find((p) => p.id === state.localId);
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

    // Firemaking: use logs from inventory
    if (key.name === "f") {
      const s = state.firstSlotOf("logs");
      if (s >= 0) hooks.onUse?.("firemaking", s);
      return;
    }

    // Cooking: use raw_shrimp from inventory
    if (key.name === "k") {
      const s = state.firstSlotOf("raw_shrimp");
      if (s >= 0) hooks.onUse?.("cooking", s);
      return;
    }

    // Arrow key movement
    const d = arrowDelta(key.name);
    if (!d) return;
    const players = state.samplePositions(performance.now());
    const me = players.find((p) => p.id === state.localId);
    if (!me) return;
    hooks.onMoveTo(Math.round(me.x) + d.dx, Math.round(me.y) + d.dy);
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

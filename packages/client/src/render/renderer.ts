import {
  createCliRenderer,
  BoxRenderable,
  RGBA,
  type CliRenderer,
  type KeyEvent,
  type MouseEvent as TuiMouseEvent,
  type OptimizedBuffer,
} from "@opentui/core";
import { ITEM_KINDS, NPC_KINDS, RESOURCE_KINDS, combatLevel, questGivenBy, type Intent } from "@termenor/protocol";
import type { GameState } from "../game-state";
import { CommandLine, classifyDirectInput } from "../command-line";
import { legendLines, type Mode } from "./legend";
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
import { isWorldClick, type HudRegions } from "./click-gate";
import { pageCount, clampPage, indexForDigit, pageSlice } from "./paging";
import {
  TABS, TAB_LABELS, layoutTabs, inventoryView, actionsForItem, ACTION_LABELS,
  examineText, skillLines, gearRows, questLines, type Tab, type ItemAction,
} from "./panel";
import { pickEntity, regionAt, type HitEntity, type Region } from "./hit";
import { FIRST_RUN_HINT, FIRST_RUN_HINT_MS, HELP_TITLE, HELP_LINES } from "./help";

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
 * Boots OpenTUI, drives a 30fps frame callback that samples GameState, blits the
 * iso world, and paints the reserved side panel + overlays. Routes mouse clicks to
 * world actions or panel controls. Returns a handle. Requires a real terminal.
 */
export async function startRenderer(state: GameState, chat: ChatState, hooks: RendererHooks): Promise<RendererHandle> {
  // 30 fps: the server ticks at 15 Hz, so this still renders two frames per tick
  // for smooth interpolation while halving client CPU and the truecolor bytes/sec.
  const renderer: CliRenderer = await createCliRenderer({ targetFps: 30, useMouse: true });
  const tier: Tier = selectTier((renderer.capabilities as CapsLike | null) ?? null);

  let lastFrame: IsoFrame | null = null;

  // Modal (bank/shop) local state.
  let bankMode: "deposit" | "withdraw" = "deposit";
  let shopMode: "buy" | "sell" = "buy";
  let modalPage = 0;
  let lastModal: "bank" | "shop" | null = null;
  let bankRows: { slot: number; item: string; qty: number }[] = [];

  // Side-panel state.
  let activeTab: Tab = "inventory";
  let selectedSlot: number | null = null; // selected inventory slot → action row

  // Onboarding / overlay state.
  let helpOpen = false;
  let firstClickDone = false;
  const connectAt = performance.now();

  const cmd = new CommandLine();
  const log = new LogState();

  // Click-router state, recomputed every frame.
  const hud: HudRegions = { overlayOpen: false, panelCol: 0 };
  let frameEntities: HitEntity[] = [];
  let tabRegions: Region<Tab>[] = [];
  let slotRegions: Region<number>[] = [];
  let actionRegions: Region<{ action: ItemAction; slot: number }>[] = [];
  let gearRegions: Region<number>[] = [];
  let bankRowRegions: Region<number>[] = [];
  let shopRowRegions: Region<number>[] = [];

  const cycleTab = (): void => {
    const i = TABS.indexOf(activeTab);
    activeTab = TABS[(i + 1) % TABS.length];
    selectedSlot = null;
  };

  // Fire an inventory-slot action chosen from the action row.
  const fireItemAction = (action: ItemAction, slot: number): void => {
    const stack = state.inventory[slot];
    if (!stack) { selectedSlot = null; return; }
    if (action === "equip") hooks.onEquipAction?.("equip", slot);
    else if (action === "drop") hooks.onDrop?.(slot);
    else if (action === "examine") log.push("notable", examineText(stack.item));
    if (action !== "examine") selectedSlot = null;
  };

  // Act on a clicked world entity: fight / talk / gather / grab.
  const actOnEntity = (target: HitEntity, meTileX: number, meTileY: number): void => {
    if (target.kind === "npc") {
      const npc = state.sampleNpcs(performance.now()).find((n) => n.id === target.id);
      if (!npc) return;
      const kind = NPC_KINDS[npc.type];
      if (kind && kind.maxHit > 0) hooks.onAttack?.(target.id);
      else if (questGivenBy(npc.type)) hooks.onIntent?.({ kind: "talk", targetId: target.id });
      return;
    }
    if (target.kind === "resource") { hooks.onGather?.(target.id); return; }
    if (target.kind === "ground") {
      const gi = state.ground.find((g) => `${g.id}` === target.id);
      if (!gi) return;
      if (gi.x === meTileX && gi.y === meTileY) hooks.onPickup?.();
      else hooks.onMoveTo(gi.x, gi.y);
    }
  };

  // Route a submitted Direct-mode line. "/equip"|"/gear" with no args jumps to the
  // Gear tab (no server intent); other commands go through the intent boundary;
  // everything else is chat.
  const routeDirectLine = (line: string): void => {
    const input = classifyDirectInput(line);
    if (input.kind === "chat") { hooks.onChat(input.text); return; }
    const verb = input.command.split(/\s+/)[0]?.toLowerCase() ?? "";
    if ((verb === "equip" || verb === "gear") && !/\s/.test(input.command)) {
      activeTab = "gear"; selectedSlot = null; log.push("ambient", "» gear"); return;
    }
    if (input.command.length === 0) { log.push("notable", "type a command, e.g. /mine copper"); return; }
    const result = resolveCommand(input.command, buildResolveContext(state, log));
    if (result.ok) { hooks.onIntent?.(result.intent); log.push("ambient", `» ${input.command}`); }
    else log.push("notable", result.message);
  };

  renderer.setFrameCallback(async () => {
    const curModal = state.bankOpen ? "bank" : state.shopOpen ? "shop" : null;
    if (curModal !== lastModal) { modalPage = 0; lastModal = curModal; }
    const buffer = renderer.nextRenderBuffer;
    const map = state.map;
    if (!buffer || !map) return;

    const cols = renderer.terminalWidth;
    const rows = renderer.terminalHeight;
    const pxW = cols;
    const pxH = tier === "halfblock" ? rows * 2 : rows;

    const PANEL_COLS = Math.min(28, Math.max(0, cols - 20));
    const panelCol = cols - PANEL_COLS;

    const now = performance.now();
    const players = state.samplePositions(now);
    const npcs = state.sampleNpcs(now);
    const resources = state.sampleResources();
    const me = players.find((p) => p.id === state.localId);
    const center = me ? tileToScreen(me.x, me.y, me.h) : tileToScreen(map.width / 2, map.height / 2, 0);
    // Center the player in the VISIBLE play area (left of the panel), not the full buffer.
    const cam = isoCamera(center.sx, center.sy, pxW - PANEL_COLS, pxH);

    const frame = rasterizeIso(map, players, cam.ox, cam.oy, pxW, pxH, state.localId, state.ground, npcs, resources, now);
    lastFrame = frame;
    const grid = cellGridFor(tier, frame.buf);
    blit(buffer, grid);

    const WHITE = RGBA.fromInts(255, 255, 255, 255);
    const YELLOW = RGBA.fromInts(255, 255, 0, 255);
    const CYAN = RGBA.fromInts(0, 220, 220, 255);
    const DIM = RGBA.fromInts(180, 180, 180, 255);
    const write = (text: string, col: number, row: number, fg: ReturnType<typeof RGBA.fromInts>, bg = BLACK): void => {
      for (const cell of textCells(text, col, row, cols, rows)) buffer.setCell(cell.col, cell.row, cell.char, fg, bg);
    };

    // --- world overlays (covered on the right by the opaque panel, drawn later) ---
    for (const p of players) {
      const { sx, sy } = tileToScreen(p.x, p.y, p.h);
      const labelSy = sy - cam.oy - 16;
      const labelRow = tier === "halfblock" ? Math.round(labelSy / 2) - 1 : Math.round(labelSy) - 1;
      const labelCol = centerCol(sx - cam.ox, p.id.length);
      write(p.id, labelCol, labelRow, p.id === state.localId ? YELLOW : WHITE);
    }
    for (const npc of npcs) {
      const { sx, sy } = tileToScreen(npc.x, npc.y, npc.h);
      const labelSy = sy - cam.oy - 16;
      const labelRow = tier === "halfblock" ? Math.round(labelSy / 2) - 1 : Math.round(labelSy) - 1;
      const label = NPC_KINDS[npc.type]?.name ?? npc.type;
      const [r, g, b] = NPC_KINDS[npc.type]?.color ?? [200, 200, 200];
      write(label, centerCol(sx - cam.ox, label.length), labelRow, RGBA.fromInts(r, g, b, 255));
    }
    const RED = RGBA.fromInts(255, 60, 60, 255);
    for (const splat of state.activeSplats(now)) {
      const target = players.find((p) => p.id === splat.targetId) ?? npcs.find((n) => n.id === splat.targetId);
      if (!target) continue;
      const { sx, sy } = tileToScreen(target.x, target.y, target.h);
      const splatSy = sy - cam.oy - 20;
      const splatRow = tier === "halfblock" ? Math.round(splatSy / 2) - 1 : Math.round(splatSy) - 1;
      const label = `-${splat.amount}`;
      write(label, centerCol(sx - cam.ox, label.length), splatRow, RED);
    }

    // --- bottom-left logs + command line ---
    const LOG_LINES = 6;
    const recentMsgs = chat.recent(LOG_LINES);
    const logStartRow = rows - LOG_LINES - (cmd.active ? 2 : 1);
    for (let i = 0; i < recentMsgs.length; i++) {
      const { from, text } = recentMsgs[i];
      write(`${from}: ${text}`.slice(0, panelCol - 1), 1, logStartRow + i, DIM);
    }
    const TIER_COLORS: Record<LogTier, ReturnType<typeof RGBA.fromInts>> = {
      ambient: DIM,
      notable: RGBA.fromInts(230, 210, 140, 255),
      critical: RGBA.fromInts(230, 110, 110, 255),
    };
    const logLines = log.recent(5);
    const logTop = rows - 7 - logLines.length - (cmd.active ? 1 : 0);
    for (let i = 0; i < logLines.length; i++) {
      const e = logLines[i];
      write(e.text.slice(0, panelCol - 1), 1, logTop + i, TIER_COLORS[e.tier]);
    }
    if (cmd.active) {
      const prompt = cmd.input.startsWith("/") ? "»" : ">";
      write(`${prompt} ${cmd.input}_`, 1, rows - 1, CYAN);
    }

    // --- control legend (left of the panel) ---
    const LEGEND_COLOR = RGBA.fromInts(120, 200, 160, 255);
    const mode: Mode = cmd.active ? "direct" : "play";
    const meTileX = me ? Math.round(me.x) : null;
    const meTileY = me ? Math.round(me.y) : null;
    const under = meTileX !== null ? state.ground.find((gi) => gi.x === meTileX && gi.y === meTileY) : undefined;
    const enemy = me ? nearest(npcs.filter((n) => (NPC_KINDS[n.type]?.maxHit ?? 0) > 0), me.x, me.y) : null;
    const gatherables = resources.filter((r) => RESOURCE_KINDS[r.type]?.gatherable);
    const res = me ? nearest(gatherables, me.x, me.y) : null;
    const legend = legendLines({
      mode,
      nearestEnemy: enemy ? (NPC_KINDS[enemy.type]?.name ?? enemy.type) : null,
      nearestResource: res ? (RESOURCE_KINDS[res.type]?.name ?? res.type) : null,
      itemUnderfoot: under ? (ITEM_KINDS[under.item]?.name ?? under.item) : null,
    });
    const legendRow = rows - 1 - (cmd.active ? 1 : 0);
    write(legend.join("   ").slice(0, panelCol - 1), 1, legendRow, LEGEND_COLOR);

    // --- reserved side panel (opaque) ---
    tabRegions = []; slotRegions = []; actionRegions = []; gearRegions = [];
    if (PANEL_COLS > 0) {
      const PANEL_BG = RGBA.fromInts(20, 22, 30, 255);
      const BORDER = RGBA.fromInts(90, 100, 120, 255);
      const TAB_ON = RGBA.fromInts(255, 230, 140, 255);
      const TAB_OFF = RGBA.fromInts(130, 140, 155, 255);
      const BODY = RGBA.fromInts(200, 205, 215, 255);
      const SEL = RGBA.fromInts(255, 245, 200, 255);
      for (let r = 0; r < rows; r++) {
        for (let c = panelCol; c < cols; c++) buffer.setCell(c, r, " ", BODY, PANEL_BG);
        buffer.setCell(panelCol, r, "│", BORDER, PANEL_BG);
      }
      const bodyCol = panelCol + 1;
      const writeP = (text: string, row: number, fg = BODY): void => {
        for (const cell of textCells(text.slice(0, PANEL_COLS - 1), bodyCol, row, cols, rows)) buffer.setCell(cell.col, cell.row, cell.char, fg, PANEL_BG);
      };
      for (const s of layoutTabs(panelCol)) {
        for (const cell of textCells(TAB_LABELS[s.tab], s.col0, 0, cols, rows)) buffer.setCell(cell.col, cell.row, cell.char, s.tab === activeTab ? TAB_ON : TAB_OFF, PANEL_BG);
        tabRegions.push({ row: 0, col0: s.col0, col1: s.col1, value: s.tab });
      }
      for (const cell of textCells("─".repeat(PANEL_COLS - 1), bodyCol, 1, cols, rows)) buffer.setCell(cell.col, cell.row, cell.char, BORDER, PANEL_BG);

      const bodyTop = 2;
      const bodyBottom = rows - 3;
      if (activeTab === "inventory") {
        const rowsV = inventoryView(state.inventory, (id) => ITEM_KINDS[id]?.name ?? id);
        for (let i = 0; i < rowsV.length; i++) {
          const row = bodyTop + i;
          if (row > bodyBottom - 1) break;
          const rv = rowsV[i];
          const sel = rv.slot === selectedSlot;
          writeP(`${sel ? "▸ " : "  "}${rv.label}`, row, sel ? SEL : BODY);
          slotRegions.push({ row, col0: bodyCol, col1: cols - 1, value: rv.slot });
        }
        if (rowsV.length === 0) writeP("  (empty)", bodyTop, DIM);
        const sel = selectedSlot;
        if (sel != null && state.inventory[sel]) {
          let c = bodyCol;
          for (const a of actionsForItem(state.inventory[sel]!.item)) {
            const seg = `[${ACTION_LABELS[a]}]`;
            for (const cell of textCells(seg, c, bodyBottom, cols, rows)) buffer.setCell(cell.col, cell.row, cell.char, TAB_ON, PANEL_BG);
            actionRegions.push({ row: bodyBottom, col0: c, col1: c + seg.length - 1, value: { action: a, slot: sel } });
            c += seg.length + 1;
          }
        }
      } else if (activeTab === "skills") {
        const lines = skillLines(state.skills);
        for (let i = 0; i < lines.length; i++) {
          const row = bodyTop + i;
          if (row > bodyBottom) break;
          writeP(lines[i], row, i === 0 ? TAB_ON : BODY);
        }
      } else if (activeTab === "gear") {
        const rowsG = gearRows(state.equipment, (id) => ITEM_KINDS[id]?.name ?? id);
        for (let i = 0; i < rowsG.length; i++) {
          const row = bodyTop + i;
          const g = rowsG[i];
          writeP(g.label, row, g.filled ? BODY : DIM);
          if (g.filled) gearRegions.push({ row, col0: bodyCol, col1: cols - 1, value: g.index });
        }
        writeP("click a slot to remove it", bodyTop + rowsG.length + 1, DIM);
      } else {
        const lines = questLines();
        for (let i = 0; i < lines.length; i++) {
          const row = bodyTop + i;
          if (row > bodyBottom) break;
          writeP(lines[i], row, lines[i].startsWith("  ") ? DIM : BODY);
        }
      }

      // vitals footer
      const xpMap: Record<string, number> = {};
      for (const k in state.skills) xpMap[k] = state.skills[k].xp;
      const gp = state.inventory.find((s) => s?.item === "coins")?.qty ?? 0;
      for (const cell of textCells("─".repeat(PANEL_COLS - 1), bodyCol, rows - 2, cols, rows)) buffer.setCell(cell.col, cell.row, cell.char, BORDER, PANEL_BG);
      writeP(`HP ${me ? me.hp : 0}/${me ? me.maxHp : 0}  Cmb ${combatLevel(xpMap)}  ${gp}gp`, rows - 1, RGBA.fromInts(150, 220, 150, 255));
    }

    // --- bank / shop modals (left side, opaque, clickable rows) ---
    bankRowRegions = []; shopRowRegions = [];
    if (state.bankOpen) {
      const BANK = RGBA.fromInts(210, 195, 90, 255);
      const MODBG = RGBA.fromInts(20, 20, 12, 255);
      const boxCol = 2, boxW = 42, top = 1;
      bankRows = bankMode === "withdraw"
        ? state.bank.map((it, i) => ({ slot: i, item: it.item, qty: it.qty }))
        : state.inventory
            .map((s, i) => ({ s, i }))
            .filter((e): e is { s: NonNullable<typeof e.s>; i: number } => e.s !== null)
            .map(({ s, i }) => ({ slot: i, item: s.item, qty: s.qty }));
      const pages = pageCount(bankRows.length);
      const { start, end } = pageSlice(modalPage, bankRows.length);
      const boxH = 3 + Math.max(1, end - start);
      for (let r = top; r < top + boxH; r++) for (let c = boxCol - 1; c < boxCol - 1 + boxW; c++) buffer.setCell(c, r, " ", BANK, MODBG);
      const wb = (t: string, r: number, fg = BANK): void => { for (const cell of textCells(t, boxCol, r, cols, rows)) buffer.setCell(cell.col, cell.row, cell.char, fg, MODBG); };
      wb(`[ Bank — ${bankMode.toUpperCase()} ]`, top);
      wb(`d deposit · w withdraw · 1-9/click · [ ] page ${modalPage + 1}/${pages} · Esc`, top + 1, DIM);
      for (let i = start; i < end; i++) {
        const r = bankRows[i];
        const row = top + 2 + (i - start);
        wb(`${i - start + 1}: ${ITEM_KINDS[r.item]?.name ?? r.item} x${r.qty}`, row);
        bankRowRegions.push({ row, col0: boxCol - 1, col1: boxCol - 1 + boxW - 1, value: i });
      }
    }
    if (state.shopOpen && state.shop) {
      const SHOP = RGBA.fromInts(210, 130, 210, 255);
      const MODBG = RGBA.fromInts(22, 14, 22, 255);
      const boxCol = 2, boxW = 46, top = 1;
      const entries = state.shop.entries;
      const pages = pageCount(entries.length);
      const { start, end } = pageSlice(modalPage, entries.length);
      const boxH = 3 + Math.max(1, end - start);
      for (let r = top; r < top + boxH; r++) for (let c = boxCol - 1; c < boxCol - 1 + boxW; c++) buffer.setCell(c, r, " ", SHOP, MODBG);
      const ws = (t: string, r: number, fg = SHOP): void => { for (const cell of textCells(t, boxCol, r, cols, rows)) buffer.setCell(cell.col, cell.row, cell.char, fg, MODBG); };
      ws(`[ ${state.shop.name} — ${shopMode.toUpperCase()} ]`, top);
      ws(`b buy · s sell · 1-9/click · [ ] page ${modalPage + 1}/${pages} · Esc`, top + 1, DIM);
      for (let i = start; i < end; i++) {
        const e = entries[i];
        const row = top + 2 + (i - start);
        ws(`${i - start + 1}: ${ITEM_KINDS[e.item]?.name ?? e.item}  ${e.price}gp (${e.stock})`, row);
        shopRowRegions.push({ row, col0: boxCol - 1, col1: boxCol - 1 + boxW - 1, value: i });
      }
    }

    // --- first-run hint ---
    if (!firstClickDone && now - connectAt < FIRST_RUN_HINT_MS && !state.bankOpen && !state.shopOpen && !helpOpen) {
      write(FIRST_RUN_HINT, Math.max(1, Math.floor((panelCol - FIRST_RUN_HINT.length) / 2)), 1, RGBA.fromInts(255, 240, 180, 255));
    }

    // --- help overlay (topmost) ---
    if (helpOpen) {
      const lines = [HELP_TITLE, "", ...HELP_LINES];
      const w = Math.min(cols - 2, lines.reduce((m, l) => Math.max(m, l.length), 0) + 4);
      const h = lines.length + 2;
      const col0 = Math.max(0, Math.floor((cols - w) / 2));
      const row0 = Math.max(0, Math.floor((rows - h) / 2));
      const HBG = RGBA.fromInts(15, 18, 28, 255);
      const HFG = RGBA.fromInts(220, 225, 235, 255);
      const HBR = RGBA.fromInts(110, 150, 200, 255);
      for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) buffer.setCell(col0 + c, row0 + r, " ", HFG, HBG);
      for (let c = 0; c < w; c++) { buffer.setCell(col0 + c, row0, "─", HBR, HBG); buffer.setCell(col0 + c, row0 + h - 1, "─", HBR, HBG); }
      for (let r = 0; r < h; r++) { buffer.setCell(col0, row0 + r, "│", HBR, HBG); buffer.setCell(col0 + w - 1, row0 + r, "│", HBR, HBG); }
      for (let i = 0; i < lines.length; i++) {
        const fg = i === 0 ? RGBA.fromInts(255, 230, 150, 255) : HFG;
        for (const cell of textCells(lines[i], col0 + 2, row0 + 1 + i, cols, rows)) buffer.setCell(cell.col, cell.row, cell.char, fg, HBG);
      }
    }

    // --- expose router state ---
    hud.overlayOpen = state.bankOpen || state.shopOpen || helpOpen;
    hud.panelCol = panelCol;
    const lift = tier === "halfblock" ? 5 : 3;
    const ents: HitEntity[] = [];
    for (const n of npcs) { const { sx, sy } = tileToScreen(n.x, n.y, n.h); ents.push({ id: n.id, kind: "npc", vx: sx - cam.ox, vy: sy - cam.oy - lift }); }
    for (const r of resources) {
      if (!RESOURCE_KINDS[r.type]?.gatherable) continue;
      const { sx, sy } = tileToScreen(r.x, r.y, r.h);
      ents.push({ id: r.id, kind: "resource", vx: sx - cam.ox, vy: sy - cam.oy - lift });
    }
    for (const g of state.ground) {
      const gh = map.heights[g.y * map.width + g.x] ?? 0;
      const { sx, sy } = tileToScreen(g.x, g.y, gh);
      ents.push({ id: `${g.id}`, kind: "ground", vx: sx - cam.ox, vy: sy - cam.oy });
    }
    frameEntities = ents;
  });

  // Full-screen invisible box: registers in the hit grid so clicks reach onMouseDown
  // even though the world is painted straight to the buffer (no child renderables).
  const clickLayer = new BoxRenderable(renderer, {
    id: "click-layer",
    width: "100%",
    height: "100%",
    border: false,
    shouldFill: false,
  });
  renderer.root.add(clickLayer);

  clickLayer.onMouseDown = (e: TuiMouseEvent) => {
    if (cmd.active) return;
    const cx = e.x, cy = e.y;
    if (helpOpen) { helpOpen = false; return; }
    if (state.bankOpen) {
      const idx = regionAt(cx, cy, bankRowRegions);
      if (idx != null) hooks.onBankAction?.(bankMode, bankRows[idx].slot, -1);
      return;
    }
    if (state.shopOpen) {
      const idx = regionAt(cx, cy, shopRowRegions);
      if (idx != null) { const entry = state.shop?.entries[idx]; if (entry) hooks.onShopAction?.(shopMode, entry.item, 1); }
      return;
    }
    if (cx >= hud.panelCol) {
      const tab = regionAt(cx, cy, tabRegions);
      if (tab) { activeTab = tab; selectedSlot = null; return; }
      const act = regionAt(cx, cy, actionRegions);
      if (act) { fireItemAction(act.action, act.slot); return; }
      const slot = regionAt(cx, cy, slotRegions);
      if (slot != null) { selectedSlot = selectedSlot === slot ? null : slot; return; }
      const gi = regionAt(cx, cy, gearRegions);
      if (gi != null) hooks.onEquipAction?.("unequip", gi);
      return;
    }
    if (!isWorldClick(cx, cy, hud) || !lastFrame || !state.map) return;
    firstClickDone = true;
    const px = cx;
    const py = tier === "halfblock" ? cy * 2 : cy;
    const meNow = state.samplePositions(performance.now()).find((p) => p.id === state.localId);
    const target = pickEntity(px, py, frameEntities, 6);
    if (target) { actOnEntity(target, meNow ? Math.round(meNow.x) : -1, meNow ? Math.round(meNow.y) : -1); return; }
    const t = pickTile(lastFrame, px, py, state.map.width);
    if (t) hooks.onMoveTo(t.x, t.y);
  };

  renderer.keyInput.on("keypress", (key: KeyEvent) => {
    if (helpOpen) { if (key.name === "escape" || key.sequence === "?") helpOpen = false; return; }

    if (state.bankOpen) {
      if (key.name === "escape") { state.closeBank(); return; }
      if (key.name === "d") { bankMode = "deposit"; modalPage = 0; return; }
      if (key.name === "w") { bankMode = "withdraw"; modalPage = 0; return; }
      if (key.name === "]" || key.sequence === "]") { modalPage = clampPage(modalPage + 1, bankRows.length); return; }
      if (key.name === "[" || key.sequence === "[") { modalPage = clampPage(modalPage - 1, bankRows.length); return; }
      const m = /^([1-9])$/.exec(key.name ?? "");
      if (m) {
        const idx = indexForDigit(modalPage, parseInt(m[1], 10), bankRows.length);
        if (idx >= 0) hooks.onBankAction?.(bankMode, bankRows[idx].slot, -1);
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

    if (cmd.active) {
      if (key.name === "return" || key.name === "enter") { const line = cmd.submit(); if (line) routeDirectLine(line); }
      else if (key.name === "escape") cmd.cancel();
      else if (key.name === "backspace") cmd.backspace();
      else if (key.name === "up") cmd.historyPrev();
      else if (key.name === "down") cmd.historyNext();
      else cmd.type(key.sequence ?? key.name ?? "");
      return;
    }

    // --- Play mode ---
    if (key.sequence === "?") { helpOpen = true; return; }
    if (key.name === "return" || key.name === "enter") { cmd.open(); return; }
    if (key.sequence === "/") { cmd.open(); cmd.type("/"); return; }
    if (key.name === "tab") { cycleTab(); return; }
    if (key.name === "g") { hooks.onPickup?.(); return; }
    if (key.name === "a") {
      const meAtk = state.samplePositions(performance.now()).find((p) => p.id === state.localId);
      const target = meAtk ? nearest(state.sampleNpcs(performance.now()).filter((n) => (NPC_KINDS[n.type]?.maxHit ?? 0) > 0), meAtk.x, meAtk.y) : null;
      if (target) hooks.onAttack?.(target.id);
      return;
    }
    if (key.name === "c") {
      const meG = state.samplePositions(performance.now()).find((p) => p.id === state.localId);
      const target = meG ? nearest(state.sampleResources().filter((r) => RESOURCE_KINDS[r.type]?.gatherable), meG.x, meG.y) : null;
      if (target) hooks.onGather?.(target.id);
      return;
    }
    const d = arrowDelta(key.name);
    if (!d) return;
    const meMove = state.samplePositions(performance.now()).find((p) => p.id === state.localId);
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

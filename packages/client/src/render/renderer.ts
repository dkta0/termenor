import {
  createCliRenderer,
  RGBA,
  type CliRenderer,
  type KeyEvent,
  type MouseEvent as TuiMouseEvent,
  type OptimizedBuffer,
} from "@opentui/core";
import { ITEMS, NPC_TYPES } from "@termenor/protocol";
import type { GameState } from "../game-state";
import type { ChatState } from "../chat";
import { isoCamera, pickTile } from "./camera";
import { rasterizeIso, type IsoFrame } from "./rasterize";
import { cellGridFor, selectTier, type CapsLike } from "./tiers";
import { arrowDelta } from "./input";
import { tileToScreen } from "./iso";
import { textCells } from "./overlay";
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
}

const BLACK = RGBA.fromInts(0, 0, 0, 255);

/**
 * Boots OpenTUI, drives a 60fps frame callback that samples GameState and
 * blits a cell grid. Returns a handle. Requires a real terminal.
 */
export async function startRenderer(state: GameState, chat: ChatState, hooks: RendererHooks): Promise<RendererHandle> {
  const renderer: CliRenderer = await createCliRenderer({ targetFps: 60, useMouse: true });
  const tier: Tier = selectTier((renderer.capabilities as CapsLike | null) ?? null);

  let lastFrame: IsoFrame | null = null;

  renderer.setFrameCallback(async () => {
    const buffer = renderer.nextRenderBuffer;
    const map = state.map;
    if (!buffer || !map) return;

    const cols = renderer.terminalWidth;
    const rows = renderer.terminalHeight;
    const pxW = cols;
    const pxH = tier === "halfblock" ? rows * 2 : rows;

    const players = state.samplePositions(performance.now());
    const npcs = state.sampleNpcs(performance.now());
    const me = players.find((p) => p.id === state.localId);
    const center = me ? tileToScreen(me.x, me.y, me.h) : tileToScreen(map.width / 2, map.height / 2, 0);
    const cam = isoCamera(center.sx, center.sy, pxW, pxH);

    const frame = rasterizeIso(map, players, cam.ox, cam.oy, pxW, pxH, state.localId, state.ground, npcs);
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
      const labelCol = Math.round(labelSx - p.id.length / 2);
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
      const label = NPC_TYPES[npc.type]?.name ?? npc.type;
      const labelCol = Math.round(labelSx - label.length / 2);
      const entry = NPC_TYPES[npc.type];
      const [r, g, b] = entry ? entry.color : [200, 200, 200];
      const color = RGBA.fromInts(r, g, b, 255);
      for (const cell of textCells(label, labelCol, labelRow, cols, rows)) {
        buffer.setCell(cell.col, cell.row, cell.char, color, BLACK);
      }
    }

    // Damage splats: red number floating above hit entity
    const RED = RGBA.fromInts(255, 60, 60, 255);
    const now = performance.now();
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
      const splatCol = Math.round(splatSx - label.length / 2);
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
      const entry = ITEMS[s.item];
      const label = `${i + 1}: ${entry?.name ?? s.item} x${s.qty}`;
      for (const cell of textCells(label, PANEL_COL, row + 2, cols, rows)) {
        buffer.setCell(cell.col, cell.row, cell.char, PANEL_COLOR, BLACK);
      }
    }
  });

  renderer.root.onMouseDown = (e: TuiMouseEvent) => {
    if (chat.active) return; // gate clicks while typing
    if (!lastFrame || !state.map) return;
    const px = e.x;
    const py = tier === "halfblock" ? e.y * 2 : e.y;
    const t = pickTile(lastFrame, px, py, state.map.width);
    if (t) hooks.onMoveTo(t.x, t.y);
  };

  renderer.keyInput.on("keypress", (key: KeyEvent) => {
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

    // Not in chat mode
    if (key.name === "return" || key.name === "enter") {
      chat.open();
      return;
    }

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

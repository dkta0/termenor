import {
  createCliRenderer,
  RGBA,
  type CliRenderer,
  type KeyEvent,
  type MouseEvent as TuiMouseEvent,
  type OptimizedBuffer,
} from "@opentui/core";
import type { GameState } from "../game-state";
import { computeCameraPx, screenCellToTile } from "./camera";
import { rasterize } from "./rasterize";
import { cellGridFor, selectTier, type CapsLike } from "./tiers";
import { arrowDelta } from "./input";
import { PIXELS_PER_TILE as PPT, type Camera, type CellGrid, type Tier } from "./types";

export interface RendererHandle {
  stop(): void;
  tier: Tier;
}

export interface RendererHooks {
  /** Called with a destination tile when the player clicks / presses an arrow. */
  onMoveTo(x: number, y: number): void;
}

const BLACK = RGBA.fromInts(0, 0, 0, 255);

/**
 * Boots OpenTUI, drives a 60fps frame callback that samples GameState and
 * blits a cell grid. Returns a handle. Requires a real terminal.
 */
export async function startRenderer(state: GameState, hooks: RendererHooks): Promise<RendererHandle> {
  const renderer: CliRenderer = await createCliRenderer({ targetFps: 60, useMouse: true });
  const tier: Tier = selectTier((renderer.capabilities as CapsLike | null) ?? null);

  let lastCam: Camera = { ox: 0, oy: 0 };

  renderer.setFrameCallback(async () => {
    const buffer = renderer.nextRenderBuffer;
    const map = state.map;
    if (!buffer || !map) return;

    const cols = renderer.terminalWidth;
    const rows = renderer.terminalHeight;
    const pxW = cols;
    const pxH = tier === "halfblock" ? rows * 2 : rows;

    const players = state.samplePositions(performance.now());
    const me = players.find((p) => p.id === state.localId);
    const centerX = me ? me.x * PPT + PPT / 2 : (map.width * PPT) / 2;
    const centerY = me ? me.y * PPT + PPT / 2 : (map.height * PPT) / 2;
    const cam = computeCameraPx(centerX, centerY, pxW, pxH, map.width * PPT, map.height * PPT);
    lastCam = cam;

    const buf = rasterize(map, players, cam, pxW, pxH, state.localId);
    const grid = cellGridFor(tier, buf);
    blit(buffer, grid);
  });

  // mouse click → move
  renderer.root.onMouseDown = (e: TuiMouseEvent) => {
    const t = screenCellToTile(e.x, e.y, lastCam, tier);
    hooks.onMoveTo(t.x, t.y);
  };

  // arrow keys → step one tile from current rounded position
  renderer.keyInput.on("keypress", (key: KeyEvent) => {
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

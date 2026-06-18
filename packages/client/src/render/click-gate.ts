/** Screen regions occupied by HUD chrome, in terminal-cell coordinates.
 *  Recomputed each frame by the renderer and consumed by the click gate so
 *  clicks on panels don't leak through to world movement. */
export interface HudRegions {
  /** A bank/shop/equip modal is open — it owns the screen; ignore world clicks. */
  modalOpen: boolean;
  /** Left edge (col) of the always-on inventory panel. */
  panelCol: number;
  /** Last row (inclusive) the inventory panel occupies; its header sits at row 1. */
  panelBottomRow: number;
  /** Number of rows the top-left skills HUD occupies (rows 0..skillsRows-1). */
  skillsRows: number;
  /** Width (cols) of the skills HUD block, measured from col 1. */
  skillsWidth: number;
}

/** True when a click at cell (x, y) lands on HUD chrome rather than the world. */
export function isHudClick(x: number, y: number, h: HudRegions): boolean {
  if (h.modalOpen) return true;
  if (x >= h.panelCol && y >= 1 && y <= h.panelBottomRow) return true; // inventory panel
  if (y >= 0 && y < h.skillsRows && x >= 1 && x <= h.skillsWidth) return true; // skills HUD
  return false;
}

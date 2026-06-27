/** Screen regions occupied by HUD chrome, in terminal-cell coordinates.
 *  Recomputed each frame by the renderer and consumed by the click router so
 *  clicks on the side panel / open overlays don't leak through to world
 *  movement. Panel and overlay clicks get their own routing in the renderer;
 *  this only answers "is this a world click?". */
export interface HudRegions {
  /** A bank/shop modal or the help overlay is open — it owns the screen. */
  overlayOpen: boolean;
  /** Left edge (col) of the reserved side panel; col >= this is panel chrome. */
  panelCol: number;
}

/** True when a click at cell (x, y) targets the world (not panel chrome / an overlay). */
export function isWorldClick(x: number, _y: number, h: HudRegions): boolean {
  if (h.overlayOpen) return false;
  return x < h.panelCol;
}

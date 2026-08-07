export interface OverlayCell { col: number; row: number; char: string; }

/** Width reserved by the ADR-0004 side panel at this terminal width. */
export function panelColumns(cols: number): number {
  return Math.min(28, Math.max(0, cols - 20));
}

/** One current-objective line, clipped before the reserved side panel. */
export function objectiveCells(text: string, cols: number, rows: number): OverlayCell[] {
  const playColumns = cols - panelColumns(cols);
  return textCells(`• ${text}`, 1, 0, playColumns, rows);
}

/**
 * Starting column for a `labelLen`-char label centered on screen-x `screenX`, free of
 * sub-pixel jitter. Round the anchor to its pixel FIRST, then offset by an INTEGER
 * half-length. Rounding `screenX - labelLen/2` together reintroduces a half-integer for
 * odd-length labels which, with a fractional `screenX`, flips the column ±1 every frame
 * — that's what kept the camera-pinned player's nameplate jittering after the camera fix.
 */
export function centerCol(screenX: number, labelLen: number): number {
  return Math.round(screenX) - Math.floor(labelLen / 2);
}

/**
 * Convert a text string into a list of cells to write, clipped to the grid bounds.
 * `col` and `row` are the top-left origin of the text in cell coordinates.
 * `cols` and `rows` are the grid dimensions.
 */
export function textCells(
  text: string,
  col: number,
  row: number,
  cols: number,
  rows: number,
): OverlayCell[] {
  if (row < 0 || row >= rows) return [];
  const out: OverlayCell[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = col + i;
    if (c < 0) continue;
    if (c >= cols) break;
    out.push({ col: c, row, char: text[i] });
  }
  return out;
}

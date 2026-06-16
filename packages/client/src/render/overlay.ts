export interface OverlayCell { col: number; row: number; char: string; }

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

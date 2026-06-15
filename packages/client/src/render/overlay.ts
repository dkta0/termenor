export interface OverlayCell { col: number; row: number; char: string; }

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

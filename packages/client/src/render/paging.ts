const PAGE_SIZE = 9;

/** Number of pages needed to show `count` items, 9 per page (always >= 1). */
export function pageCount(count: number, size = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(count / size));
}

/** Clamp `page` into [0, pageCount(count)-1]. */
export function clampPage(page: number, count: number, size = PAGE_SIZE): number {
  return Math.min(Math.max(0, page), pageCount(count, size) - 1);
}

/** Absolute list index for 1-based digit `d` (1..size) on `page`,
 *  or -1 when `d` is out of range or the index falls past the list end. */
export function indexForDigit(page: number, d: number, count: number, size = PAGE_SIZE): number {
  if (d < 1 || d > size) return -1;
  const idx = page * size + (d - 1);
  return idx < count ? idx : -1;
}

/** The half-open range [start, end) of items visible on `page`. */
export function pageSlice(page: number, count: number, size = PAGE_SIZE): { start: number; end: number } {
  const start = page * size;
  return { start, end: Math.min(start + size, count) };
}

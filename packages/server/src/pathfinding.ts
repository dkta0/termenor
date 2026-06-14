import type { MapData } from "@termenor/protocol";

export interface Point { x: number; y: number; }

export function isWalkable(map: MapData, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
  return map.tiles[y * map.width + x] === 0;
}

const key = (x: number, y: number) => `${x},${y}`;
const NEIGHBORS = [ [1, 0], [-1, 0], [0, 1], [0, -1] ];

/**
 * 4-connected A*. Returns the list of steps AFTER `from` up to and including
 * `to`. Empty array if from === to. null if `to` is blocked or unreachable.
 */
export function findPath(map: MapData, from: Point, to: Point): Point[] | null {
  if (!isWalkable(map, to.x, to.y)) return null;
  if (from.x === to.x && from.y === to.y) return [];

  const h = (x: number, y: number) => Math.abs(x - to.x) + Math.abs(y - to.y);
  const open: Array<{ x: number; y: number; g: number; f: number }> = [
    { x: from.x, y: from.y, g: 0, f: h(from.x, from.y) },
  ];
  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>([[key(from.x, from.y), 0]]);
  const closed = new Set<string>();

  while (open.length > 0) {
    // pick lowest f (small grids — linear scan is fine)
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0];
    const ck = key(cur.x, cur.y);
    if (cur.x === to.x && cur.y === to.y) {
      // reconstruct
      const path: Point[] = [];
      let k: string | undefined = ck;
      while (k && k !== key(from.x, from.y)) {
        const [px, py] = k.split(",").map(Number);
        path.push({ x: px, y: py });
        k = cameFrom.get(k);
      }
      return path.reverse();
    }
    if (closed.has(ck)) continue;
    closed.add(ck);

    for (const [dx, dy] of NEIGHBORS) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (!isWalkable(map, nx, ny)) continue;
      const nk = key(nx, ny);
      if (closed.has(nk)) continue;
      const tentative = cur.g + 1;
      if (tentative < (gScore.get(nk) ?? Infinity)) {
        cameFrom.set(nk, ck);
        gScore.set(nk, tentative);
        open.push({ x: nx, y: ny, g: tentative, f: tentative + h(nx, ny) });
      }
    }
  }
  return null;
}

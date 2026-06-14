import type { MapData } from "@termenor/protocol";
import type { RenderPlayer } from "../game-state";
import { Kind, PIXELS_PER_TILE as PPT, SPRITE_PX, type Camera, type PixelBuffer } from "./types";

/**
 * Rasterize the visible region into a pixel buffer of `pxW`×`pxH` pixels.
 * `cam` is the world-pixel offset of the top-left. `localId` marks the
 * local player's sprite as LOCAL (vs PLAYER for others).
 */
export function rasterize(
  map: MapData, players: RenderPlayer[], cam: Camera,
  pxW: number, pxH: number, localId: string | null,
): PixelBuffer {
  const kinds = new Uint8Array(pxW * pxH); // EMPTY (0) by default

  // tiles
  for (let py = 0; py < pxH; py++) {
    const worldPy = cam.oy + py;
    const tileY = Math.floor(worldPy / PPT);
    for (let px = 0; px < pxW; px++) {
      const worldPx = cam.ox + px;
      const tileX = Math.floor(worldPx / PPT);
      if (tileX < 0 || tileY < 0 || tileX >= map.width || tileY >= map.height) continue;
      const blocked = map.tiles[tileY * map.width + tileX] === 1;
      kinds[py * pxW + px] = blocked ? Kind.WALL : Kind.FLOOR;
    }
  }

  // players on top
  const off = Math.floor((PPT - SPRITE_PX) / 2);
  for (const p of players) {
    const kind = p.id === localId ? Kind.LOCAL : Kind.PLAYER;
    const baseX = Math.round(p.x * PPT) + off - cam.ox;
    const baseY = Math.round(p.y * PPT) + off - cam.oy;
    for (let dy = 0; dy < SPRITE_PX; dy++) {
      for (let dx = 0; dx < SPRITE_PX; dx++) {
        const sx = baseX + dx;
        const sy = baseY + dy;
        if (sx < 0 || sy < 0 || sx >= pxW || sy >= pxH) continue;
        kinds[sy * pxW + sx] = kind;
      }
    }
  }

  return { width: pxW, height: pxH, kinds };
}

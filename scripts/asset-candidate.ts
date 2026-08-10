import { resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { MODELS, solidFootprint, validateModel } from "@termenor/protocol";
import type { Facing, MapData, Model, Scenery } from "@termenor/protocol";
import { isoCamera } from "../packages/client/src/render/camera";
import { tileToScreen } from "../packages/client/src/render/iso";
import { renderModelToAscii } from "../packages/client/src/render/model-preview";
import { rasterizeIso } from "../packages/client/src/render/rasterize";
import type { IsoFrame } from "../packages/client/src/render/rasterize";

export interface AssetCandidate {
  key: string;
  brief: string;
  model: Model;
  facing?: Facing;
  activated?: boolean;
  previewAtMs?: number;
  previewFrames?: number;
  previewFrameMs?: number;
}

const MAP_SIZE = 15;
const PLACEMENT = { x: 7, y: 7 };
const PREVIEW_WIDTH = 80;
const PREVIEW_HEIGHT = 60;

export function validateCandidate(candidate: AssetCandidate): string[] {
  const errors: string[] = [];
  if (!/^[a-z][a-z0-9_]*$/.test(candidate.key)) {
    errors.push("candidate key must be snake_case and start with a letter");
  }
  if (!candidate.brief.trim()) errors.push("candidate brief must not be empty");
  if (
    candidate.previewFrames !== undefined
    && (!Number.isInteger(candidate.previewFrames) || candidate.previewFrames < 2 || candidate.previewFrames > 60)
  ) {
    errors.push("candidate previewFrames must be an integer from 2 to 60");
  }
  if (
    candidate.previewFrameMs !== undefined
    && (candidate.previewFrameMs <= 0 || candidate.previewFrameMs > 65_535)
  ) {
    errors.push("candidate previewFrameMs must be between 1 and 65535");
  }
  if (Object.hasOwn(MODELS, candidate.key)) {
    errors.push(`${candidate.key}: key already exists in the promoted MODELS catalog`);
  }
  errors.push(...validateModel(candidate.key, candidate.model));

  const occupied = candidate.model.kind === "block"
    ? candidate.model.footprint.flatMap((row, y) =>
        Array.from(row, (glyph, x) => glyph === "." ? null : { x: PLACEMENT.x + x, y: PLACEMENT.y + y }),
      ).filter((cell): cell is { x: number; y: number } => cell !== null)
    : [PLACEMENT];
  for (const cell of occupied) {
    if (cell.x < 1 || cell.y < 1 || cell.x >= MAP_SIZE - 1 || cell.y >= MAP_SIZE - 1) {
      errors.push(`${candidate.key}: placed model exceeds preview map bounds`);
      break;
    }
  }
  return errors;
}

export function createCandidateMap(
  candidate: AssetCandidate,
  activated = candidate.activated,
): MapData {
  const tiles = new Array(MAP_SIZE * MAP_SIZE).fill(0);
  const heights = new Array(MAP_SIZE * MAP_SIZE).fill(0);
  const scenery: Scenery[] = [{
    model: candidate.key,
    ...PLACEMENT,
    facing: candidate.facing ?? "south",
    ...(activated === undefined ? {} : { activated }),
  }];

  for (let x = 0; x < MAP_SIZE; x++) {
    tiles[x] = 1;
    tiles[(MAP_SIZE - 1) * MAP_SIZE + x] = 1;
  }
  for (let y = 0; y < MAP_SIZE; y++) {
    tiles[y * MAP_SIZE] = 1;
    tiles[y * MAP_SIZE + MAP_SIZE - 1] = 1;
  }
  for (const cell of solidFootprint(candidate.model, PLACEMENT.x, PLACEMENT.y)) {
    tiles[cell.y * MAP_SIZE + cell.x] = 1;
  }
  return { width: MAP_SIZE, height: MAP_SIZE, tiles, heights, scenery };
}

export function renderCandidate(
  candidate: AssetCandidate,
  now = candidate.previewAtMs ?? 0,
  activated = candidate.activated,
): IsoFrame {
  const errors = validateCandidate(candidate);
  if (errors.length > 0) throw new Error(errors.join("\n"));

  const map = createCandidateMap(candidate, activated);
  const modelHeight = candidate.model.kind === "block" ? candidate.model.footprint.length : 1;
  const modelWidth = candidate.model.kind === "block" ? candidate.model.footprint[0].length : 1;
  const center = tileToScreen(
    PLACEMENT.x + (modelWidth - 1) / 2,
    PLACEMENT.y + (modelHeight - 1) / 2,
    0,
  );
  const camera = isoCamera(center.sx, center.sy, PREVIEW_WIDTH, PREVIEW_HEIGHT);
  MODELS[candidate.key] = candidate.model;
  try {
    return rasterizeIso(
      map, [], camera.ox, camera.oy, PREVIEW_WIDTH, PREVIEW_HEIGHT, null,
      [], [], [], now,
    );
  } finally {
    delete MODELS[candidate.key];
  }
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}

function scaledScanlines(frame: IsoFrame): { width: number; height: number; data: Uint8Array } {
  const scale = 4;
  const width = frame.buf.width * scale;
  const height = frame.buf.height * scale;
  const data = new Uint8Array(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 3);
    const sourceY = Math.floor(y / scale);
    for (let x = 0; x < width; x++) {
      const sourceX = Math.floor(x / scale);
      const source = (sourceY * frame.buf.width + sourceX) * 3;
      const target = rowStart + 1 + x * 3;
      data[target] = frame.buf.rgb[source];
      data[target + 1] = frame.buf.rgb[source + 1];
      data[target + 2] = frame.buf.rgb[source + 2];
    }
  }
  return { width, height, data };
}

export function encodePreviewPng(frame: IsoFrame): Uint8Array {
  const scaled = scaledScanlines(frame);
  const ihdr = new Uint8Array(13);
  const dimensions = new DataView(ihdr.buffer);
  dimensions.setUint32(0, scaled.width);
  dimensions.setUint32(4, scaled.height);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const parts = [
    Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(scaled.data)),
    pngChunk("IEND", new Uint8Array()),
  ];
  const png = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}

export function encodePreviewApng(frames: IsoFrame[], frameMs: number): Uint8Array {
  if (frames.length < 2) throw new Error("animated preview requires at least two frames");
  if (frameMs <= 0 || frameMs > 65_535) throw new Error("animated preview frame duration is invalid");
  const scaled = frames.map(scaledScanlines);
  const { width, height } = scaled[0];
  if (scaled.some((frame) => frame.width !== width || frame.height !== height)) {
    throw new Error("animated preview frames must have equal dimensions");
  }

  const ihdr = new Uint8Array(13);
  const dimensions = new DataView(ihdr.buffer);
  dimensions.setUint32(0, width);
  dimensions.setUint32(4, height);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const animationControl = new Uint8Array(8);
  const animationView = new DataView(animationControl.buffer);
  animationView.setUint32(0, frames.length);
  animationView.setUint32(4, 0);
  const parts: Uint8Array[] = [
    Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("acTL", animationControl),
  ];
  let sequence = 0;
  for (let index = 0; index < scaled.length; index++) {
    const frameControl = new Uint8Array(26);
    const controlView = new DataView(frameControl.buffer);
    controlView.setUint32(0, sequence++);
    controlView.setUint32(4, width);
    controlView.setUint32(8, height);
    controlView.setUint16(20, frameMs);
    controlView.setUint16(22, 1_000);
    parts.push(pngChunk("fcTL", frameControl));
    const compressed = deflateSync(scaled[index].data);
    if (index === 0) {
      parts.push(pngChunk("IDAT", compressed));
    } else {
      const frameData = new Uint8Array(4 + compressed.length);
      new DataView(frameData.buffer).setUint32(0, sequence++);
      frameData.set(compressed, 4);
      parts.push(pngChunk("fdAT", frameData));
    }
  }
  parts.push(pngChunk("IEND", new Uint8Array()));
  const png = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}


async function main(): Promise<void> {
  const [candidateArg, outputArg] = process.argv.slice(2);
  if (!candidateArg) {
    throw new Error("usage: bun run scripts/asset-candidate.ts <candidate.ts> [preview.png]");
  }
  const candidatePath = resolve(candidateArg);
  // Candidate paths are operator-selected at runtime, so a static import cannot name this module.
  const module = await import(candidatePath);
  const candidate = module.default as AssetCandidate;
  if (!candidate || typeof candidate !== "object") throw new Error("candidate module must default-export an AssetCandidate");

  const frameCount = candidate.previewFrames ?? 1;
  const frameMs = candidate.previewFrameMs ?? 150;
  const frames = Array.from(
    { length: frameCount },
    (_, index) => renderCandidate(candidate, (candidate.previewAtMs ?? 0) + index * frameMs),
  );
  const preview = frames.length === 1
    ? encodePreviewPng(frames[0])
    : encodePreviewApng(frames, frameMs);
  if (outputArg === "-") {
    const base64 = Buffer.from(preview).toString("base64");
    console.log("PNG_BASE64_BEGIN");
    for (let offset = 0; offset < base64.length; offset += 120) console.log(base64.slice(offset, offset + 120));
    console.log("PNG_BASE64_END");
  } else {
    const outputPath = resolve(outputArg ?? `${candidate.key || "candidate"}.png`);
    await Bun.write(outputPath, preview);
    console.log(outputPath);
  }
  console.log(renderModelToAscii(candidate.model, candidate.facing));
  console.log(`validated: schema, placement bounds, collision footprint, production raster${frames.length > 1 ? `, ${frames.length}-frame animation` : ""}`);
}

if (import.meta.main) await main();

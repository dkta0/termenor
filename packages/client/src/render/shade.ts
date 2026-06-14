export type Face = "top" | "left" | "right";

/** Fixed light direction → per-face brightness multiplier (face normals). */
const FACE_MUL: Record<Face, number> = { top: 1.0, right: 0.78, left: 0.6 };

export function shade(rgb: [number, number, number], face: Face): [number, number, number] {
  const m = FACE_MUL[face];
  return [
    Math.min(255, Math.round(rgb[0] * m)),
    Math.min(255, Math.round(rgb[1] * m)),
    Math.min(255, Math.round(rgb[2] * m)),
  ];
}

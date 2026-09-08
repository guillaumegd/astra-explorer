import { orbitalOffset } from './orbits.ts';
import type { Vector3 } from 'three';

// CPU mirror of the vertex shader, used only for the focused body and its local neighbours.
export function particlePosition(
  positions: Float32Array,
  seeds: Float32Array,
  id: number,
  rotation: number,
  time: number,
  out: Vector3,
  offsets?: Float32Array,
  orbits?: Float32Array,
) {
  const x = positions[id * 3],
    y = positions[id * 3 + 1],
    z = positions[id * 3 + 2];
  const radius = Math.hypot(x, z);
  const angle = rotation * (0.35 + 0.65 / (radius * 0.15 + 1));
  out.set(
    Math.cos(angle) * x + Math.sin(angle) * z,
    y,
    -Math.sin(angle) * x + Math.cos(angle) * z,
  );
  out.y += Math.sin(time * 0.25 + radius * 1.3 + seeds[id] * 12) * 0.035;
  if (orbits) orbitalOffset(orbits, id * 12, rotation, out);
  else if (offsets) {
    out.x += offsets[id * 3];
    out.y += offsets[id * 3 + 1];
    out.z += offsets[id * 3 + 2];
  }
  return out;
}

export function buildParticleIndex(positions: Float32Array, cellSize = 0.5) {
  const cells = new Map<string, number[]>();
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  for (let id = 0; id < positions.length / 3; id++) {
    const cell = key(
      Math.floor(positions[id * 3] / cellSize),
      Math.floor(positions[id * 3 + 1] / cellSize),
      Math.floor(positions[id * 3 + 2] / cellSize),
    );
    const list = cells.get(cell);
    if (list) list.push(id);
    else cells.set(cell, [id]);
  }
  return (id: number, count: number) => {
    const x = positions[id * 3],
      y = positions[id * 3 + 1],
      z = positions[id * 3 + 2];
    const cx = Math.floor(x / cellSize),
      cy = Math.floor(y / cellSize),
      cz = Math.floor(z / cellSize);
    const candidates: { id: number; distance: number }[] = [];
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++)
        for (let c = -1; c <= 1; c++) {
          for (const index of cells.get(key(cx + a, cy + b, cz + c)) ?? []) {
            if (index >= count) continue;
            candidates.push({
              id: index,
              distance:
                (positions[index * 3] - x) ** 2 +
                (positions[index * 3 + 1] - y) ** 2 +
                (positions[index * 3 + 2] - z) ** 2,
            });
          }
        }
    return candidates
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 96)
      .map((c) => c.id);
  };
}

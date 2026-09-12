import type { Vector3 } from 'three';
import type { RegionDefinition } from './catalogue/types.ts';
import { framingDistance } from './system-framing.ts';
import { galacticShear, particlePosition } from './particle-motion.ts';

/** One group-space centre for rendering, camera tracking and presence. */
export function animatedRegionCenter(
  region: RegionDefinition,
  positions: Float32Array,
  seeds: Float32Array,
  rotation: number,
  time: number,
  out: Vector3,
) {
  return region.hostBodyId === undefined
    ? galacticShear(...region.center, rotation, out)
    : particlePosition(
        positions,
        seeds,
        region.hostBodyId,
        rotation,
        time,
        out,
      );
}

/** Orbit into the volume, then orbit/zoom back out; never select an incidental star. */
export function regionZoomDistance(
  distance: number,
  factor: number,
  envelope: number,
) {
  if (!Number.isFinite(factor) || factor <= 0) return distance;
  return Math.max(
    Math.min(envelope * 0.01, distance),
    Math.min(65, distance / factor),
  );
}

/** Preserve intentional interior zoom; keep an exterior camera outside on resize. */
export function resizeRegionDistance(
  distance: number,
  envelope: number,
  before: number,
  after: number,
) {
  return distance <= envelope
    ? distance
    : Math.max(
        envelope * 1.001,
        (distance * framingDistance(1, after)) / framingDistance(1, before),
      );
}

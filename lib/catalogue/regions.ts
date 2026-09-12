import {
  CATALOGUE_SEED,
  GALAXY_ENVELOPE,
  NEBULA_CELL,
  NEBULA_OFFSET_LIMIT,
  NEBULA_PALETTES,
  NEBULA_PROBABILITY,
  NEBULA_RADIUS_SPAN,
  REGION_ENVELOPE_MARGIN,
  REMNANT_PALETTES,
  REMNANT_PROBABILITY,
  REMNANT_SIZE_SPAN,
} from './config.ts';
import { stream, subSeed } from './random.ts';
import type { RegionDefinition, SystemDefinition } from './types.ts';

/**
 * Regions are generated from a fixed spatial partition, never from the system
 * list, so density can never add or remove one. The grid is the spatial index:
 * there is no structure to build, keep in sync or invalidate.
 */
export const CELL_SPAN = Math.ceil(GALAXY_ENVELOPE.radius / NEBULA_CELL);
export const cellCentre = (i: number) => (i + 0.5) * NEBULA_CELL;
/** Eligible cells are those whose centre falls inside the galactic disc. */
export function cellEligible(i: number, k: number) {
  return Math.hypot(cellCentre(i), cellCentre(k)) <= GALAXY_ENVELOPE.radius;
}
const cellIndex = (i: number, k: number) =>
  (i + CELL_SPAN) * CELL_SPAN * 2 + (k + CELL_SPAN);
const pad = (n: number, width: number) => String(n).padStart(width, '0');

/** At most one nebula per cell, drawn from a stream no other code touches. */
export function nebulaFor(
  i: number,
  k: number,
  globalSeed = CATALOGUE_SEED,
): RegionDefinition | null {
  if (!cellEligible(i, k)) return null;
  const draw = stream(subSeed(globalSeed, 'regions'), `cell:${i}:${k}`);
  if (draw() >= NEBULA_PROBABILITY) return null;
  const span = NEBULA_RADIUS_SPAN[1] - NEBULA_RADIUS_SPAN[0];
  const radius = (NEBULA_RADIUS_SPAN[0] + draw() * span) * NEBULA_CELL;
  const offset = NEBULA_OFFSET_LIMIT * NEBULA_CELL;
  const index = cellIndex(i, k);
  const palette = NEBULA_PALETTES[Math.floor(draw() * NEBULA_PALETTES.length)];
  return {
    regionId: `v2:region:nebula:${pad(index, 6)}`,
    type: 'nebula',
    seed: draw() * 100,
    name: `NEB-V2-${pad(index, 5)}`,
    center: [
      cellCentre(i) + (draw() * 2 - 1) * offset,
      (draw() * 2 - 1) * GALAXY_ENVELOPE.halfHeight * 0.5,
      cellCentre(k) + (draw() * 2 - 1) * offset,
    ],
    radius,
    envelope: radius * REGION_ENVELOPE_MARGIN,
    palette: [palette[0], palette[1], palette[2]],
    density: 0.55 + draw() * 0.45,
  };
}

export function listNebulae(globalSeed = CATALOGUE_SEED) {
  const regions: RegionDefinition[] = [];
  for (let i = -CELL_SPAN; i < CELL_SPAN; i++)
    for (let k = -CELL_SPAN; k < CELL_SPAN; k++) {
      const region = nebulaFor(i, k, globalSeed);
      if (region) regions.push(region);
    }
  return regions;
}

/**
 * Seeded from its host, so it is activated and hidden with it. Drawn from a
 * sub-seed of the system rather than any of its streams: not one existing draw
 * shifts, and no body moves.
 */
export function remnantFor(system: SystemDefinition): RegionDefinition | null {
  if (system.architecture !== 'pulsar') return null;
  const draw = stream(subSeed(system.seed, 'region:remnant'), 'presence');
  if (draw() >= REMNANT_PROBABILITY) return null;
  const host = system.bodies[0];
  const span = REMNANT_SIZE_SPAN[1] - REMNANT_SIZE_SPAN[0];
  // A planetless pulsar still deserves a visible shell.
  const radius = Math.max(
    (host.pulsar?.envelope ?? host.radius) * 3,
    system.envelope * (REMNANT_SIZE_SPAN[0] + draw() * span),
  );
  const palette =
    REMNANT_PALETTES[Math.floor(draw() * REMNANT_PALETTES.length)];
  return {
    regionId: `v2:region:remnant:${pad(system.index, 6)}`,
    type: 'remnant',
    seed: draw() * 100,
    name: `REM-V2-${pad(system.index + 1, 5)}`,
    center: [system.anchor[0], system.anchor[1], system.anchor[2]],
    radius,
    envelope: radius * REGION_ENVELOPE_MARGIN,
    palette: [palette[0], palette[1], palette[2]],
    density: 0.6 + draw() * 0.4,
    hostSystem: system.index,
    hostBodyId: host.id,
  };
}

/** Distance from a base-space point to a region centre, in region radii. */
export function regionDepth(
  region: RegionDefinition,
  x: number,
  y: number,
  z: number,
) {
  return (
    Math.hypot(
      x - region.center[0],
      y - region.center[1],
      z - region.center[2],
    ) / region.radius
  );
}

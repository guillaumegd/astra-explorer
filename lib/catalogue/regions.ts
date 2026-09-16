import {
  CATALOGUE_SEED,
  GALAXY_ENVELOPE,
  NEBULA_CELL,
  NEBULA_PALETTES,
  NEBULA_PROBABILITY,
  NEBULA_RADIUS_SPAN,
  REGION_ENVELOPE_MARGIN,
  REMNANT_HOST_LIMIT,
  REMNANT_HOST_MARGIN,
  REMNANT_PALETTES,
  REMNANT_PROBABILITY,
  REMNANT_RADIUS_SPAN,
} from './config.ts';
import { stream, subSeed } from './random.ts';
import type { RegionDefinition, SystemDefinition } from './types.ts';

/**
 * Persistent slots determine presence independently of the system list.
 * Separate clustered placement removes any spatial lattice without renaming IDs.
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
  // IDs keep their original slots; placement is a separate clustered stream.
  const location = stream(
    subSeed(globalSeed, 'nebula:placement'),
    `slot:${i}:${k}`,
  );
  const complex = Math.floor(location() * 5);
  const cluster = stream(
    subSeed(globalSeed, 'nebula:complex'),
    String(complex),
  );
  const angle = cluster() * Math.PI * 2;
  const distance = 0.6 + cluster() ** 1.35 * (GALAXY_ENVELOPE.radius - 3.6);
  const scatter = 0.7 + cluster() * 1.5;
  const gaussian = () =>
    Math.sqrt(-2 * Math.log(Math.max(location(), 0.0001))) *
    Math.cos(location() * Math.PI * 2);
  let x = Math.cos(angle) * distance + gaussian() * scatter;
  let z = Math.sin(angle) * distance + gaussian() * scatter;
  const limit = GALAXY_ENVELOPE.radius - radius * REGION_ENVELOPE_MARGIN;
  const clamp = Math.min(1, limit / Math.max(Math.hypot(x, z), 0.001));
  x *= clamp;
  z *= clamp;
  const index = cellIndex(i, k);
  const palette = NEBULA_PALETTES[Math.floor(draw() * NEBULA_PALETTES.length)];
  return {
    regionId: `v2:region:nebula:${pad(index, 6)}`,
    type: 'nebula',
    seed: draw() * 100,
    name: `NEB-V2-${pad(index, 5)}`,
    center: [x, (draw() * 2 - 1) * GALAXY_ENVELOPE.halfHeight * 0.5, z],
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
  const span = REMNANT_RADIUS_SPAN[1] - REMNANT_RADIUS_SPAN[0];
  // Size comes from the galactic ladder the nebulae use, not from the host:
  // how many planets a pulsar drew must not decide how large its shell looks.
  // The host only raises two floors — the pulsar wind the cavity has to hold
  // (a planetless pulsar still deserves a visible shell), and the clearance
  // that keeps the system it surrounds inside the shell. Past
  // REMNANT_HOST_LIMIT the clearance stops following an outsized system.
  const radius = Math.max(
    (REMNANT_RADIUS_SPAN[0] + draw() * span) * NEBULA_CELL,
    (host.pulsar?.envelope ?? host.radius) * 3,
    Math.min(system.envelope, REMNANT_HOST_LIMIT) * REMNANT_HOST_MARGIN,
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

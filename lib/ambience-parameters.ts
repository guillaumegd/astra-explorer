import type { BodyKind } from './stellar-lod';

export function zoomProximity(distance: number, radius: number | null): number {
  if (radius === null || radius <= 0 || !Number.isFinite(distance)) return 0;
  // Relative scale makes a small moon sound as close as a large star at the same framing.
  const octaves = Math.log2(Math.max(distance / radius, 1));
  return Math.min(1, Math.max(0, (10 - octaves) / 8));
}

const ease = (value: number) => {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
};

// Continuous layers: a sparse score, a system motif, then local atmosphere.
export function ambienceMix(proximity: number) {
  const p = Number.isFinite(proximity)
    ? Math.min(1, Math.max(0, proximity))
    : 0;
  const local = ease((p - 0.4) / 0.6);
  const system = ease(p / 0.45) * (1 - local);
  return {
    cutoff: 650 + p * 1100,
    pad: 0.42 - local * 0.28,
    melody: 0.012 + system * 0.07 + local * 0.006,
    wet: 0.62 - local * 0.24,
    noteInterval: 12 - system * 6 + local * 3,
    chordInterval: 32 - system * 8,
    local,
  };
}

export const BINARY_COLOUR_DEPTH = 0.06;
/**
 * A light colouring of the existing score, as the guide asks: no extra voice
 * and no new layer, only a shallow breath and drift following the pair's angle,
 * and nothing at all from the galaxy view.
 */
export function binaryColour(angle: number, local: number) {
  const wave = Math.sin(Number.isFinite(angle) ? angle : 0);
  const close = Number.isFinite(local) ? Math.min(1, Math.max(0, local)) : 0;
  return {
    gain: 1 - BINARY_COLOUR_DEPTH * close * (0.5 - 0.5 * wave),
    pan: 0.22 * close * wave,
  };
}

export const REGION_DEPTH = 0.3;
/**
 * Presence of the camera inside a region volume: 1 at the core, 0 beyond the
 * envelope, continuous in between. A region is a place, not a target, so this
 * is a function of position alone and never of what is selected.
 */
export function regionPresence(distance: number, radius: number) {
  if (!Number.isFinite(distance) || !Number.isFinite(radius) || radius <= 0)
    return 0;
  return 1 - ease((distance / radius - 0.35) / 0.73);
}
/**
 * A secondary layer, mixed on top of whatever body is being observed, as the
 * guide requires. Capped well under the score so it colours without covering.
 */
export function regionAmbience(
  presence: number,
  type: 'nebula' | 'remnant' | null,
) {
  const p = Number.isFinite(presence) ? Math.min(1, Math.max(0, presence)) : 0;
  // Only the absence of a region short-circuits: cutting out at zero presence
  // as well would put a step in the filter right where the layer fades in.
  if (!type) return { gain: 0, wet: 0, cutoff: 400 };
  const airy = type === 'nebula';
  return {
    gain: REGION_DEPTH * p * (airy ? 1 : 0.72),
    wet: 0.25 * p * (airy ? 1 : 0.68),
    cutoff: airy ? 320 + p * 260 : 520 + p * 380,
  };
}

// Noise band, breath speed, drone and resonant detail share the score's A root.
export const soundProfiles: Record<
  BodyKind,
  {
    band: number;
    q: number;
    breath: number;
    noise: number;
    drone: number;
    tone: number;
    sparkle: number;
  }
> = {
  pulsar: {
    band: 1600,
    q: 0.8,
    breath: 0,
    noise: 0.045,
    drone: 220,
    tone: 0.014,
    sparkle: 0.012,
  },
  'black-hole': {
    band: 100,
    q: 1.5,
    breath: 0.025,
    noise: 0.08,
    drone: 27.5,
    tone: 0.025,
    sparkle: 0.002,
  },
  'red-dwarf': {
    band: 220,
    q: 0.7,
    breath: 0.09,
    noise: 0.12,
    drone: 55,
    tone: 0.04,
    sparkle: 0.005,
  },
  'giant-star': {
    band: 420,
    q: 0.6,
    breath: 0.065,
    noise: 0.15,
    drone: 55,
    tone: 0.04,
    sparkle: 0.01,
  },
  'blue-star': {
    band: 1700,
    q: 0.8,
    breath: 0.13,
    noise: 0.1,
    drone: 110,
    tone: 0.025,
    sparkle: 0.018,
  },
  'white-dwarf': {
    band: 2200,
    q: 1.2,
    breath: 0.11,
    noise: 0.07,
    drone: 220,
    tone: 0.018,
    sparkle: 0.024,
  },
  'rocky-planet': {
    band: 650,
    q: 0.7,
    breath: 0.12,
    noise: 0.15,
    drone: 110,
    tone: 0.012,
    sparkle: 0.014,
  },
  'ocean-world': {
    band: 800,
    q: 0.45,
    breath: 0.085,
    noise: 0.23,
    drone: 110,
    tone: 0.014,
    sparkle: 0.012,
  },
  'desert-planet': {
    band: 1200,
    q: 1.6,
    breath: 0.055,
    noise: 0.13,
    drone: 110,
    tone: 0.008,
    sparkle: 0.009,
  },
  'volcanic-world': {
    band: 140,
    q: 0.8,
    breath: 0.23,
    noise: 0.32,
    drone: 55,
    tone: 0.045,
    sparkle: 0.004,
  },
  'ice-planet': {
    band: 2800,
    q: 2,
    breath: 0.045,
    noise: 0.055,
    drone: 220,
    tone: 0.006,
    sparkle: 0.07,
  },
  'gas-giant': {
    band: 330,
    q: 1.3,
    breath: 0.16,
    noise: 0.28,
    drone: 55,
    tone: 0.032,
    sparkle: 0.005,
  },
  'rocky-moon': {
    band: 1600,
    q: 3,
    breath: 0.035,
    noise: 0.025,
    drone: 110,
    tone: 0.005,
    sparkle: 0.04,
  },
  asteroid: {
    band: 2100,
    q: 4,
    breath: 0.028,
    noise: 0.018,
    drone: 220,
    tone: 0.003,
    sparkle: 0.032,
  },
};

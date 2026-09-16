import type { BodyKind } from './types.ts';
export const CATALOGUE_VERSION = 'v2';
export const ARCHITECTURE_WEIGHTS = [94, 5, 0.7, 0.3] as const;
export const JET_PROBABILITY = 0.15;
export const COMET_PROBABILITY = 0.02;
// Separation is drawn in combined stellar radii, then clipped to a third of the
// first planetary orbit: the circumbinary rule holds without moving any orbit.
export const BINARY_SEPARATION_SPAN = [7, 18] as const;
export const BINARY_SEPARATION_LIMIT = 1 / 3;
/** Artistic masses. The primary is 1 by convention; only the ratio is rendered. */
export const BINARY_MASS_SPAN = [0.4, 1] as const;
export const BINARY_SPEED_SPAN = [0.9, 1.5] as const;
export const BINARY_INCLINATION_SPAN = [0.05, 0.22] as const;
export const BINARY_CONTRAST_PROBABILITY = 0.75;
/** Artistic luminosity per stellar family, used to weight the two local lights. */
export const STELLAR_LUMINOSITY = {
  'red-dwarf': 0.35,
  'giant-star': 1,
  'blue-star': 1.6,
  'white-dwarf': 0.5,
} as const;
export const CATALOGUE_SEED = 91724;
export const MAX_BODIES = 120000;
// The shape the anchors already produce; naming it moves no system. The disc
// radius mirrors `0.65 + placement ** 0.72 * 12` in generate.ts.
export const GALAXY_ENVELOPE = { radius: 12.8, halfHeight: 0.95 } as const;
// A local system must remain visually local. This leaves ample space for its
// hierarchy while preventing a long generated orbit chain from eclipsing the
// galaxy that contains it.
export const SYSTEM_ENVELOPE_LIMIT = GALAXY_ENVELOPE.radius * 0.1;
/** One tenth of the disc diameter, as the phenomena guide prescribes. */
export const NEBULA_CELL = (GALAXY_ENVELOPE.radius * 2) / 10;
// The guide writes 1%, which over the ~79 eligible cells of this galaxy yields
// 0.79 nebulae in total. The method is kept; only this rate is raised.
export const NEBULA_PROBABILITY = 0.15;
// Both region families are drawn on one ladder: a fraction of the nebula cell,
// hence of the galactic diameter — a span × 0.2 is the rendered diameter as a
// fraction of the disc's. Comparison points, as real diameters in light years:
// galactic disc 100 000; H II complex 20–300 (Orion 24, Eagle 70, W51 350);
// pulsar-bearing remnant 8–40 (Crab 11, Cassiopeia A 16). Both spans are
// compressed and amplified for navigation, by the same factor, so the ratio
// between the two families survives. See docs/PHENOMENES-SPATIAUX.md.
// 0.5–1.4% of the galactic diameter: still enlarged for navigation, but
// no longer galaxy-sized clouds (the former range occupied 7–13%).
export const NEBULA_RADIUS_SPAN = [0.025, 0.07] as const;
/** Of pulsar systems, so roughly 0.105% of all systems. */
export const REMNANT_PROBABILITY = 0.15;
// 0.12–0.26% of the galactic diameter, so about a quarter of a nebula: the
// astronomical ratio between the two families, on the nebulae's own ladder.
// Used to be 2–4× the host system's envelope, which made the shell's size a
// function of how many planets its pulsar happened to draw — a 217× spread
// with no astronomical meaning, and remnants larger than any nebula.
export const REMNANT_RADIUS_SPAN = [0.006, 0.013] as const;
// A shell must still enclose the system it surrounds — rendered systems are
// amplified far more than any region, so this clearance floor, not the span,
// sets the size of most shells. It is a floor, not the scale law.
export const REMNANT_HOST_MARGIN = 1.15;
// Past this host envelope it is the rendered system that is out of scale, not
// the shell: it stops following rather than growing to a nebula's size. About
// one host in ten, and three in a hundred and twenty-six are then large enough
// to leave their outermost bodies outside the shell's envelope.
export const REMNANT_HOST_LIMIT = 0.05;
/** Rigid rotation preserves the sphere; the margin only covers the edge fade. */
export const REGION_ENVELOPE_MARGIN = 1.08;
export const REGION_DETAIL_LIMIT = 2;
/** Restrained palettes: glow, filament, dark pocket. Illustrative, not spectra. */
export const NEBULA_PALETTES = [
  ['#e86296', '#75c9f5', '#180d24'],
  ['#ed784b', '#ffe2a4', '#25100b'],
  ['#4ab7cc', '#edf0f5', '#091926'],
  ['#b068dd', '#ef92b1', '#180d28'],
  ['#deaa59', '#72bce8', '#20170f'],
  ['#5894eb', '#bbb7ff', '#0a1328'],
  ['#e34d64', '#fac4ab', '#260d15'],
  ['#62cbb6', '#d3d8f1', '#0a201f'],
] as const;
export const REMNANT_PALETTES = [
  ['#7fb7ff', '#dce9ff', '#0b1a2c'],
  ['#ff9a5a', '#ffd8a8', '#2a1408'],
] as const;
export const PLANET_WEIGHTS = [5, 8, 12, 16, 18, 16, 11, 7, 4, 2, 1] as const;
export const COMPACT_PLANET_WEIGHTS = [40, 30, 18, 9, 3] as const;
export const SOLID_MOON_WEIGHTS = [80, 17, 3] as const;
export const GAS_MOON_WEIGHTS = [35, 35, 18, 9, 3] as const;
export const ASTEROID_WEIGHTS = [55, 28, 12, 5] as const;
export const families: {
  kind: BodyKind;
  type: number;
  range: [number, number];
  colors: string[];
}[] = [
  {
    kind: 'red-dwarf',
    type: 0,
    range: [0.003, 0.009],
    colors: ['#ff9875', '#ffbd92'],
  },
  {
    kind: 'giant-star',
    type: 0,
    range: [0.012, 0.03],
    colors: ['#ffdd9a', '#ffc381'],
  },
  {
    kind: 'blue-star',
    type: 0,
    range: [0.008, 0.02],
    colors: ['#80baff', '#bbdcff'],
  },
  {
    kind: 'white-dwarf',
    type: 0,
    range: [0.0015, 0.0035],
    colors: ['#e2edff', '#d4e1ff'],
  },
  {
    kind: 'rocky-planet',
    type: 1,
    range: [0.002, 0.007],
    colors: ['#71a679', '#c5af84', '#9295b4'],
  },
  {
    kind: 'ocean-world',
    type: 4,
    range: [0.0025, 0.009],
    colors: ['#398eac', '#3572bc'],
  },
  {
    kind: 'desert-planet',
    type: 5,
    range: [0.0015, 0.006],
    colors: ['#d38c5b', '#cbab78'],
  },
  {
    kind: 'volcanic-world',
    type: 6,
    range: [0.0015, 0.005],
    colors: ['#ff7831', '#ffc453'],
  },
  {
    kind: 'ice-planet',
    type: 7,
    range: [0.0015, 0.006],
    colors: ['#aadada', '#c3d6ee'],
  },
  {
    kind: 'gas-giant',
    type: 2,
    range: [0.005, 0.015],
    colors: ['#d7ae82', '#85c4cc', '#d09bba'],
  },
  {
    kind: 'rocky-moon',
    type: 3,
    range: [0.0008, 0.003],
    colors: ['#a9a398', '#a88874', '#c2c7d0'],
  },
  {
    kind: 'asteroid',
    type: 8,
    range: [0.00025, 0.0012],
    colors: ['#82776b', '#a08a7c', '#6f7880'],
  },
];

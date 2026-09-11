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

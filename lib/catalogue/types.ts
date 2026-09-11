import type { Orbit } from '../orbits.ts';
// Stable, language-agnostic ids. Displayed labels live in lib/i18n — never
// render these directly, they also key the ambience sound profiles.
export type BodyKind =
  | 'red-dwarf'
  | 'giant-star'
  | 'blue-star'
  | 'white-dwarf'
  | 'rocky-planet'
  | 'ocean-world'
  | 'desert-planet'
  | 'volcanic-world'
  | 'ice-planet'
  | 'gas-giant'
  | 'rocky-moon'
  | 'asteroid'
  | 'black-hole'
  | 'pulsar';
export type BodyIdentity = {
  /** Compact picking index; never persist this number. */
  id: number;
  bodyId: string;
  rootId: number;
  role: 'central' | 'planet' | 'moon' | 'asteroid';
  orbit: Orbit | null;
  capabilities: {
    hasSolidSurface: boolean;
    canSurfaceExplore: boolean;
    emitsLight: boolean;
    observationProfile: 'surface' | 'stellar' | 'gas' | 'black-hole' | 'pulsar';
    renderClass: 'ordinary' | 'black-hole' | 'pulsar';
  };
  systemId: number;
  systemName: string;
  parentId: number | null;
  name: string;
  kind: BodyKind;
  type: number;
  seed: number;
  radius: number;
  color: string;
  rings: boolean;
  pulsar?: {
    period: number;
    phase: number;
    magneticTilt: number;
    axisTilt: number;
    envelope: number;
    exclusion: number;
  };
  phenomenon?: {
    shadowRadius: number;
    diskInner: number;
    diskOuter: number;
    envelope: number;
    exclusion: number;
    jets: boolean;
    tilt: number;
  };
};

export type Architecture = 'single' | 'binary' | 'pulsar' | 'black-hole';
export type OrbitNode = {
  id: string;
  parentId: string | null;
  bodyId: string | null;
  orbit: Orbit | null;
};
export type SystemDefinition = {
  id: string;
  index: number;
  seed: number;
  architecture: Architecture;
  rootId: number;
  orbitalRootId: string;
  bodies: BodyIdentity[];
  nodes: OrbitNode[];
  reservedBodyIds: string[];
  anchor: [number, number, number];
  motionSeed: number;
  envelope: number;
};

import type {
  BodyIdentity,
  RegionDefinition,
  SystemDefinition,
} from './catalogue/types.ts';

// The visitor's own record of what they have found. Keys use persistent
// identities (bodyId, regionId), never compact picking indices, so a record
// survives catalogue growth and density changes.
export const DISCOVERIES_STORAGE_KEY = 'astra-discoveries-v1';

export type DiscoveryKey = string;

export const regionDiscoveryKey = (region: Pick<RegionDefinition, 'regionId'>) =>
  `region:${region.regionId}`;

/**
 * What a body counts as in the notebook, or null for ordinary sky. Both
 * components of a double star share one entry, keyed by the system's first
 * body — the same body the notebook lists.
 */
export function bodyDiscoveryKey(
  body: Pick<BodyIdentity, 'bodyId' | 'role' | 'capabilities'>,
  system: Pick<SystemDefinition, 'architecture' | 'bodies'>,
): DiscoveryKey | null {
  if (body.capabilities.renderClass !== 'ordinary') return `body:${body.bodyId}`;
  if (system.architecture === 'binary' && body.role === 'central')
    return `body:${system.bodies[0].bodyId}`;
  return null;
}

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

const defaultStorage = (): Storage | null => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
};

export function loadDiscoveries(
  storage: Storage | null = defaultStorage(),
): Set<DiscoveryKey> {
  try {
    const parsed: unknown = JSON.parse(
      storage?.getItem(DISCOVERIES_STORAGE_KEY) ?? '[]',
    );
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((key): key is string => typeof key === 'string')
        : [],
    );
  } catch {
    return new Set();
  }
}

export function saveDiscoveries(
  discoveries: ReadonlySet<DiscoveryKey>,
  storage: Storage | null = defaultStorage(),
) {
  try {
    storage?.setItem(DISCOVERIES_STORAGE_KEY, JSON.stringify([...discoveries]));
  } catch {
    // Private browsing or storage disabled: discoveries last for the visit.
  }
}

/** `?reveal` lists the whole catalogue, as the menu did before the notebook. */
export const isRevealAll = (search: string) =>
  new URLSearchParams(search).has('reveal');

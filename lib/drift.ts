// The contemplative drift launched by « Découvrir »: an endless, varied tour
// that picks its next stop on its own. Kept pure (the catalogue view and the
// random source are passed in) so its promises are testable without WebGL:
// it never opens on a phenomenon, it favours what the visitor has not found
// yet, and it does not revisit its recent stops.
import type { RuntimeCatalogue } from './catalogue/runtime.ts';
import type { BodyIdentity } from './catalogue/types.ts';
import { bodyDiscoveryKey, regionDiscoveryKey } from './discoveries.ts';

export type DriftStepType =
  | 'star'
  | 'system'
  | 'planet'
  | 'region'
  | 'galaxy'
  | 'phenomenon';

export type DriftStep =
  | { type: 'star' | 'planet' | 'system'; bodyIndex: number }
  | { type: 'phenomenon'; bodyIndex: number; key: string }
  | { type: 'phenomenon' | 'region'; regionId: string; key: string }
  | { type: 'galaxy' };

/** A discoverable destination, keyed like lib/discoveries.ts. */
export type DriftDiscoverable = {
  key: string;
  category: string;
  bodyIndex?: number;
  regionId?: string;
};

type DriftSystem = {
  index: number;
  rootId: number;
  architecture: string;
  bodies: readonly { id: number; role: string }[];
};

export type DriftWorld = {
  /** Only systems fully inside the active density, in catalogue order. */
  systems: readonly DriftSystem[];
  discoverables: readonly DriftDiscoverable[];
  /** Nebulae only: remnants are discoverables in their own right. */
  nebulae: readonly string[];
};

export type DriftState = {
  step: number;
  history: string[];
  types: DriftStepType[];
  /** The system the camera is currently in, for system and planet stops. */
  systemIndex: number | null;
};

/** Opening stops show ordinary sky only: discovery comes little by little. */
export const DRIFT_OPENING_STEPS = 3;
export const DRIFT_HISTORY = 20;
export const DRIFT_PHENOMENON_SHARE = 1 / 3;
/**
 * Category weights for a phenomenon stop. The rarest, most striking sights
 * come up most: with a flat draw, a visitor skipping stops met one black hole
 * in dozens while double stars, far more common, kept coming back.
 */
export const DRIFT_CATEGORY_WEIGHTS: Record<string, number> = {
  'black-hole': 3,
  pulsar: 2.5,
  remnant: 2,
  comet: 1.5,
  nebula: 1,
  binary: 1,
};
/** Once everything is found, phenomena still come back, but rarely. */
export const DRIFT_REVISIT_SHARE = 0.06;

const ORDINARY_WEIGHTS: Record<
  Exclude<DriftStepType, 'phenomenon'>,
  number
> = {
  // Planets and systems are only on offer inside a system, so they weigh
  // more than their share of the draw to keep the tour varied.
  star: 0.28,
  planet: 0.32,
  system: 0.18,
  region: 0.1,
  galaxy: 0.12,
};

/**
 * The drift's view of the catalogue under a density. `density` must already
 * be generated (the engine caps it at what the GPU buffers hold), so nothing
 * here forces a blocking catalogue burst.
 */
export function buildDriftWorld(
  catalogue: RuntimeCatalogue,
  density: number,
): DriftWorld {
  const count = catalogue.activeCountWithin(density);
  const systems: DriftSystem[] = [];
  for (const system of catalogue.systems) {
    if (system.rootId + system.bodies.length > count) break;
    systems.push(system);
  }
  const bodyEntry = (category: string) => (body: BodyIdentity) => ({
    // Both lists hold only phenomena and binary roots, so the key exists.
    key: bodyDiscoveryKey(body, catalogue.getSystem(body.systemId))!,
    category,
    bodyIndex: body.id,
  });
  const phenomena = catalogue.getPhenomena(count);
  const nebulae = catalogue.listNebulae();
  return {
    systems,
    discoverables: [
      ...phenomena.map((b) => bodyEntry(b.kind)(b)),
      ...catalogue.getBinaries(count).map(bodyEntry('binary')),
      ...catalogue.getRemnants(count).map((r) => ({
        key: regionDiscoveryKey(r),
        category: 'remnant',
        regionId: r.regionId,
      })),
      ...nebulae.map((r) => ({
        key: regionDiscoveryKey(r),
        category: 'nebula',
        regionId: r.regionId,
      })),
    ],
    nebulae: nebulae.map((r) => r.regionId),
  };
}

export const createDriftState = (): DriftState => ({
  step: 0,
  history: [],
  types: [],
  systemIndex: null,
});

export function driftDwellSeconds(
  type: DriftStepType,
  rng: () => number,
  reducedMotion: boolean,
) {
  // Short stops: the journey itself, now slower, carries the contemplation.
  const [low, high] =
    type === 'galaxy'
      ? [8, 14]
      : type === 'phenomenon' || type === 'region'
        ? [20, 32]
        : [14, 26];
  return (low + (high - low) * rng()) * (reducedMotion ? 1.5 : 1);
}

const pick = <T>(list: readonly T[], rng: () => number) =>
  list[Math.min(list.length - 1, Math.floor(rng() * list.length))];

const bodyKey = (index: number) => `index:${index}`;

function pickOrdinaryStar(
  world: DriftWorld,
  state: DriftState,
  rng: () => number,
) {
  // Rejection sampling: the active list holds thousands of systems, and a
  // filtered copy per stop would be wasted work for a handful of exclusions.
  let fallback: DriftSystem | null = null;
  for (let attempt = 0; attempt < 24; attempt++) {
    const system = pick(world.systems, rng);
    if (!system || system.index === 0 || system.architecture !== 'single')
      continue;
    fallback ??= system;
    if (!state.history.includes(bodyKey(system.rootId))) return system;
  }
  return (
    fallback ??
    world.systems.find((s) => s.index !== 0 && s.architecture === 'single') ??
    null
  );
}

const planetsOf = (world: DriftWorld, systemIndex: number | null) => {
  if (systemIndex === null) return [];
  const system = world.systems.find((s) => s.index === systemIndex);
  return (
    system?.bodies.filter((b) => b.role === 'planet' || b.role === 'moon') ?? []
  );
};

function pickDiscoverable(
  world: DriftWorld,
  state: DriftState,
  discovered: ReadonlySet<string>,
  rng: () => number,
) {
  const unseen = world.discoverables.filter((d) => !discovered.has(d.key));
  const pool = (unseen.length ? unseen : world.discoverables).filter(
    (d) => !state.history.includes(d.key),
  );
  if (!pool.length) return null;
  // Category first, so the many binaries never drown the few black holes.
  const categories = [...new Set(pool.map((d) => d.category))];
  const weight = (c: string) => DRIFT_CATEGORY_WEIGHTS[c] ?? 1;
  let roll = rng() * categories.reduce((sum, c) => sum + weight(c), 0);
  let category = categories[categories.length - 1];
  for (const c of categories)
    if ((roll -= weight(c)) < 0) {
      category = c;
      break;
    }
  return pick(
    pool.filter((d) => d.category === category),
    rng,
  );
}

/**
 * Chooses the next stop and returns the state that follows it. Never throws:
 * with nothing else available it falls back to a breath in the galaxy view.
 */
export function nextDriftStep(
  world: DriftWorld,
  state: DriftState,
  discovered: ReadonlySet<string>,
  rng: () => number,
): { step: DriftStep; state: DriftState } {
  const opening = state.step < DRIFT_OPENING_STEPS;
  const [last, beforeLast] = [state.types.at(-1), state.types.at(-2)];
  const allowed = (type: DriftStepType) => !(type === last && type === beforeLast);
  const weights = new Map<DriftStepType, number>();
  const planets = planetsOf(world, state.systemIndex);
  const system =
    state.systemIndex === null
      ? null
      : world.systems.find((s) => s.index === state.systemIndex);
  // The very first stop leaves the galaxy for a star: planets and systems need one.
  if (state.step === 0) weights.set('star', 1);
  else {
    const available: Exclude<DriftStepType, 'phenomenon'>[] = ['star', 'galaxy'];
    if (planets.length) available.push('planet');
    if (system && system.bodies.length > 1) available.push('system');
    if (!opening && world.nebulae.length) available.push('region');
    for (const type of available)
      if (allowed(type)) weights.set(type, ORDINARY_WEIGHTS[type]);
    if (!opening && world.discoverables.length && allowed('phenomenon')) {
      const allFound = world.discoverables.every((d) => discovered.has(d.key));
      const share = allFound ? DRIFT_REVISIT_SHARE : DRIFT_PHENOMENON_SHARE;
      const ordinary = [...weights.values()].reduce((a, b) => a + b, 0);
      // Scale so phenomena hold `share` of the draw whatever else is on offer.
      if (ordinary > 0) weights.set('phenomenon', (ordinary * share) / (1 - share));
      else weights.set('phenomenon', 1);
    }
  }

  let roll = rng() * [...weights.values()].reduce((a, b) => a + b, 0);
  let type: DriftStepType = 'galaxy';
  for (const [candidate, weight] of weights) {
    type = candidate;
    if ((roll -= weight) < 0) break;
  }

  let step: DriftStep = { type: 'galaxy' };
  let key: string | null = null;
  let systemIndex: number | null = null;
  if (type === 'phenomenon') {
    const target = pickDiscoverable(world, state, discovered, rng);
    if (target?.regionId !== undefined) {
      step = { type, regionId: target.regionId, key: target.key };
      key = target.key;
    } else if (target?.bodyIndex !== undefined) {
      step = { type, bodyIndex: target.bodyIndex, key: target.key };
      key = target.key;
      systemIndex =
        world.systems.find(
          (s) =>
            target.bodyIndex! >= s.rootId &&
            target.bodyIndex! < s.rootId + s.bodies.length,
        )?.index ?? null;
    } else type = 'star';
  }
  if (type === 'region') {
    const fresh = world.nebulae.filter(
      (id) => !state.history.includes(`region:${id}`),
    );
    const regionId = pick(fresh.length ? fresh : world.nebulae, rng);
    key = `region:${regionId}`;
    step = { type, regionId, key };
  }
  if (type === 'planet') {
    const fresh = planets.filter((b) => !state.history.includes(bodyKey(b.id)));
    const body = pick(fresh.length ? fresh : planets, rng);
    step = { type, bodyIndex: body.id };
    key = bodyKey(body.id);
    systemIndex = state.systemIndex;
  }
  if (type === 'system' && system) {
    step = { type, bodyIndex: system.rootId };
    systemIndex = system.index;
  }
  if (type === 'star') {
    const star = pickOrdinaryStar(world, state, rng);
    if (star) {
      step = { type, bodyIndex: star.rootId };
      key = bodyKey(star.rootId);
      systemIndex = star.index;
    } else type = 'galaxy';
  }
  if (type === 'galaxy') step = { type: 'galaxy' };

  return {
    step,
    state: {
      step: state.step + 1,
      history: key ? [...state.history, key].slice(-DRIFT_HISTORY) : state.history,
      types: [...state.types, step.type].slice(-2),
      systemIndex,
    },
  };
}

/**
 * The occasional descent over relief, in seconds after arrival: hold the
 * framing while orbiting, glide down, hover over the terrain, then rise
 * again. Slow on purpose — contemplative, never a swoop.
 */
export const DRIFT_DESCENT = {
  hold: 3,
  descend: 16,
  hover: 10,
  ascend: 13,
  rest: 4,
} as const;
export const DRIFT_DESCENT_SECONDS = Object.values(DRIFT_DESCENT).reduce(
  (sum, seconds) => sum + seconds,
  0,
);
/** Only for bodies with relief; a stop in two, so it stays an event. */
export const DRIFT_DESCENT_CHANCE = 0.5;

/** Low enough for the surface view to lean toward the horizon, never into the ground. */
export const descentLowRatio = (minimumRatio: number) =>
  Math.max(minimumRatio + 0.05, 1.1);

const smooth = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};
// Distance ratios glide in log space: the last metres take as long as the first.
const glide = (from: number, to: number, t: number) =>
  Math.exp(Math.log(from) + (Math.log(to) - Math.log(from)) * smooth(t));

/** Camera distance, as a multiple of the body radius, `seconds` into the descent. */
export function descentRatio(
  seconds: number,
  from: number,
  low: number,
  high: number,
) {
  const { hold, descend, hover, ascend } = DRIFT_DESCENT;
  if (seconds < hold) return from;
  if (seconds < hold + descend) return glide(from, low, (seconds - hold) / descend);
  if (seconds < hold + descend + hover) return low;
  return glide(low, high, (seconds - hold - descend - hover) / ascend);
}

// The drift's own flights, loaded with it: nothing on the first-canvas path.
const smoother = (x: number) => {
  x = Math.max(0, Math.min(1, x));
  return x * x * x * (x * (x * 6 - 15) + 10);
};
const logMix = (a: number, b: number, k: number) =>
  Math.exp(Math.log(a) * (1 - k) + Math.log(b) * k);
// How much the ends of the zoom are stretched. A body is only a disc over the
// first few e-folds of a retreat that may span ten: without this, it vanishes
// in a fraction of a second and pops back in at the other end.
const LINGER = 2.5;

/** Share of a contemplative flight spent panning at cruise distance. */
export const CONTEMPLATIVE_PAN = 0.22;

/**
 * The drift's slower flight: the departing body visibly recedes, the view
 * pans at cruise distance, and the destination visibly grows. Each end
 * lingers where the body is actually seen, and each phase gets time in
 * proportion to the zoom it really covers: a retreat that is already at
 * cruise distance, or a pan with nothing to cross (`pan` 0), takes none.
 */
export function sampleContemplativeTravel(
  t: number,
  start: number,
  cruise: number,
  end: number,
  pan = CONTEMPLATIVE_PAN,
) {
  const out = Math.max(0, Math.log(cruise / start));
  const back = Math.max(0, Math.log(cruise / end));
  const zoom = out + back;
  const retreatEnd = zoom > 1e-9 ? ((1 - pan) * out) / zoom : 0;
  const approachStart = zoom > 1e-9 ? retreatEnd + pan : 1;
  const retreat =
    retreatEnd > 0 ? smoother(t / retreatEnd) ** LINGER : 1;
  const approach =
    approachStart < 1
      ? 1 - (1 - smoother((t - approachStart) / (1 - approachStart))) ** LINGER
      : t >= 1
        ? 1
        : 0;
  const distance =
    t < retreatEnd || approachStart >= 1
      ? logMix(start, cruise, retreat)
      : logMix(cruise, end, approach);
  if (pan > 0)
    return { progress: smoother((t - retreatEnd) / pan), distance };
  // With no pan phase of its own, the recentring follows the zoom, not the
  // clock: leaving a body it waits until the camera is halfway out (in log
  // distance) and the body a speck; closing in it is done by halfway. Driven
  // by the clock, a galaxy glide slid a pulsar out of frame while still close.
  const span = Math.log(end / start);
  if (Math.abs(span) < 1e-9) return { progress: smoother(t), distance };
  const covered = Math.log(distance / start) / span;
  return {
    progress: smoother(span > 0 ? (covered - 0.5) * 2 : covered * 2),
    distance,
  };
}

/** Whether a flight crosses enough ground, next to its zoom, to need its own pan. */
export const contemplativePan = (separation: number, cruise: number) =>
  separation * 1.5 >= cruise * 0.5 ? CONTEMPLATIVE_PAN : 0;

/** Longer flights for longer zooms, within a contemplative range. */
export function contemplativeTravelSeconds(
  start: number,
  cruise: number,
  end: number,
) {
  const efolds =
    Math.abs(Math.log(cruise / start)) + Math.abs(Math.log(cruise / end));
  return Math.min(16, Math.max(8, 6 + efolds * 0.5));
}

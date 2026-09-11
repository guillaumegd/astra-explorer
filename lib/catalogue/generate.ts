import {
  ARCHITECTURE_WEIGHTS,
  JET_PROBABILITY,
  COMET_PROBABILITY,
  CATALOGUE_SEED,
  CATALOGUE_VERSION,
  families,
  PLANET_WEIGHTS,
  COMPACT_PLANET_WEIGHTS,
  SOLID_MOON_WEIGHTS,
  GAS_MOON_WEIGHTS,
  ASTEROID_WEIGHTS,
} from './config.ts';
import { stream, subSeed, weighted } from './random.ts';
import type { Architecture, BodyIdentity, SystemDefinition } from './types.ts';
import type { Orbit } from '../orbits.ts';

export function naturalArchitecture(
  index: number,
  seed = CATALOGUE_SEED,
): Architecture {
  const draw = stream(subSeed(seed, `system:${index}`), 'architecture');
  return (['single', 'binary', 'pulsar', 'black-hole'] as const)[
    weighted(draw, ARCHITECTURE_WEIGHTS)
  ];
}
export function architectureFor(
  index: number,
  seed = CATALOGUE_SEED,
): Architecture {
  if (index === 0) return 'black-hole';
  if (
    index === 511 &&
    !Array.from({ length: 510 }, (_, i) => i + 1).some(
      (i) => naturalArchitecture(i, seed) === 'pulsar',
    )
  )
    return 'pulsar';
  return naturalArchitecture(index, seed);
}

/** No meshes, renderer state or density participates in system generation. */
export function generateSystem(
  index: number,
  firstParticle: number,
  globalSeed = CATALOGUE_SEED,
): SystemDefinition {
  const seed = subSeed(globalSeed, `system:${index}`);
  const id = `${CATALOGUE_VERSION}:system:${String(index).padStart(6, '0')}`;
  const architecture = architectureFor(index, globalSeed);
  const population = stream(seed, 'population'),
    placement = stream(seed, 'anchor');
  const bodies: BodyIdentity[] = [];
  const reservedBodyIds: string[] = [];
  let slot = 0;
  const persistentId = (n: number) =>
    `${id}:body:${String(n).padStart(3, '0')}`;
  const add = (
    familyIndex: number,
    role: BodyIdentity['role'],
    parent: BodyIdentity | null,
    orbit: Orbit | null,
  ) => {
    const bodyId = persistentId(slot++);
    const appearance = stream(seed, `appearance:${bodyId}`);
    const family = families[familyIndex];
    const radius =
      (family.range[0] * (family.range[1] / family.range[0]) ** appearance()) /
      (family.type === 0 ? 40 : 160);
    const solid = ![0, 2].includes(family.type);
    const body: BodyIdentity = {
      id: firstParticle + bodies.length,
      bodyId,
      rootId: firstParticle,
      systemId: index,
      systemName: `SYS-V2-${String(index + 1).padStart(5, '0')}`,
      parentId: parent?.id ?? null,
      role,
      orbit,
      name: `AST-V2-${String(index + 1).padStart(5, '0')}-${String(slot).padStart(3, '0')}`,
      kind: family.kind,
      type: family.type,
      radius,
      seed: stream(seed, `activity:${bodyId}`)() * 100,
      color: family.colors[Math.floor(appearance() * family.colors.length)],
      rings: family.type === 2 && appearance() > 0.45,
      capabilities: {
        hasSolidSurface: solid,
        canSurfaceExplore: family.type !== 0,
        emitsLight: family.type === 0,
        observationProfile: solid
          ? 'surface'
          : family.type === 0
            ? 'stellar'
            : 'gas',
        renderClass: 'ordinary',
      },
    };
    bodies.push(body);
    return body;
  };
  // Reserved architectures use a single ordinary source until their renderer ships.
  // Its persistent ID stays unchanged when that capability is enabled.
  const compact = architecture === 'pulsar' || architecture === 'black-hole';
  const central = add(
    compact ? 3 : Math.floor(stream(seed, 'appearance:source')() * 4),
    'central',
    null,
    null,
  );
  if (architecture === 'black-hole') {
    const draw = stream(seed, 'appearance:black-hole');
    central.radius = 0.0002 * 3 ** draw();
    const palette = draw();
    central.color =
      palette < 0.7 ? '#ffc47d' : palette < 0.9 ? '#ff8658' : '#b8dbff';
    const diskOuter = central.radius * (12 + 8 * draw());
    const jets = stream(seed, 'activity:jets')() < JET_PROBABILITY;
    central.phenomenon = {
      shadowRadius: central.radius * 2.6,
      diskInner: central.radius * 3,
      diskOuter,
      envelope: jets ? central.radius * 40 : diskOuter,
      exclusion: diskOuter * 1.12,
      jets,
      tilt: draw() * 0.35 - 0.175,
    };
    central.kind = 'black-hole';
    central.capabilities = {
      hasSolidSurface: false,
      canSurfaceExplore: false,
      emitsLight: false,
      observationProfile: 'black-hole',
      renderClass: 'black-hole',
    };
  }
  if (architecture === 'binary') reservedBodyIds.push(persistentId(slot++));
  const orbitStream = stream(seed, 'orbits');
  const spacing = 1.5 + orbitStream() * 0.4;
  // Reserve clearance for the future compact renderer, even while substituted.
  let orbitalRadius = Math.max(
    0.025,
    central.radius * 8,
    (central.phenomenon?.envelope ?? 0) * 1.5,
  );
  const planetCount = weighted(
    population,
    compact ? COMPACT_PLANET_WEIGHTS : PLANET_WEIGHTS,
  );
  let envelope = central.phenomenon?.envelope ?? central.radius;
  const makeOrbit = (
    parent: BodyIdentity,
    radius: number,
    rank: number,
    moon = false,
  ): Orbit => ({
    parentId: parent.id,
    radius,
    phase: orbitStream() * Math.PI * 2,
    speed: moon ? 0.7 + orbitStream() * 0.4 : 0.16 / (rank + 1) ** 1.5,
    inclination: (moon ? 0.15 : 0.08) + orbitStream() * 0.12,
  });
  for (let rank = 0; rank < planetCount; rank++) {
    const planet = add(
      4 + Math.floor(population() * 6),
      'planet',
      central,
      makeOrbit(central, orbitalRadius, rank),
    );
    const moons = weighted(
      population,
      planet.type === 2 ? GAS_MOON_WEIGHTS : SOLID_MOON_WEIGHTS,
    );
    let moonRadius = Math.max(0.0003, 4 * (planet.radius + 0.003 / 160));
    for (let m = 0; m < moons; m++) {
      if (moonRadius + 0.003 / 160 > orbitalRadius * 0.18) break;
      add(10, 'moon', planet, makeOrbit(planet, moonRadius, m, true));
      envelope = Math.max(envelope, orbitalRadius + moonRadius + 0.003 / 160);
      moonRadius *= 1.8;
    }
    envelope = Math.max(envelope, orbitalRadius + planet.radius);
    orbitalRadius *= spacing;
  }
  const asteroids = weighted(population, ASTEROID_WEIGHTS);
  for (let rank = 0; rank < asteroids; rank++) {
    const body = add(
      11,
      'asteroid',
      central,
      makeOrbit(central, orbitalRadius, planetCount + rank),
    );
    envelope = Math.max(envelope, orbitalRadius + body.radius);
    orbitalRadius *= spacing;
  }
  if (!compact && stream(seed, 'comet')() < COMET_PROBABILITY)
    reservedBodyIds.push(persistentId(slot++));
  const gaussian = () =>
    Math.sqrt(-2 * Math.log(Math.max(placement(), 0.0001))) *
    Math.cos(placement() * Math.PI * 2);
  const core = placement() < 0.23;
  const r = core ? placement() ** 1.4 * 2.9 : 0.65 + placement() ** 0.72 * 12;
  const angle =
    (Math.floor(placement() * 4) * Math.PI) / 2 +
    r * 0.38 +
    gaussian() * (core ? 2 : 0.15 + r * 0.006);
  const spread = core ? 0.18 : 0.12 + r * 0.025;
  const anchor: [number, number, number] = [
    Math.cos(angle) * r + gaussian() * spread,
    gaussian() * (core ? 0.36 : 0.1 + r * 0.017),
    Math.sin(angle) * r + gaussian() * spread,
  ];
  if (index % 45 === 0) {
    const a = placement() * Math.PI * 2,
      haloRadius = 18 + placement() * 35;
    anchor.splice(
      0,
      3,
      Math.cos(a) * haloRadius,
      (placement() - 0.5) * 30,
      Math.sin(a) * haloRadius,
    );
  }
  if (index === 0) anchor.splice(0, 3, 5.1, 0.08, 0);
  const barycentre = `${id}:barycentre`;
  const orbitalRootId =
    architecture === 'binary' ? barycentre : `${central.bodyId}:orbit`;
  const nodes = bodies.map((body) => ({
    id: `${body.bodyId}:orbit`,
    parentId:
      body.parentId === null
        ? architecture === 'binary'
          ? barycentre
          : null
        : `${bodies[body.parentId - firstParticle].bodyId}:orbit`,
    bodyId: body.bodyId as string | null,
    orbit: body.orbit,
  }));
  if (architecture === 'binary')
    nodes.unshift({
      id: barycentre,
      parentId: null,
      bodyId: null,
      orbit: null,
    });
  return {
    id,
    index,
    seed,
    architecture,
    rootId: firstParticle,
    orbitalRootId,
    bodies,
    reservedBodyIds,
    anchor,
    motionSeed: placement(),
    envelope,
    nodes,
  };
}

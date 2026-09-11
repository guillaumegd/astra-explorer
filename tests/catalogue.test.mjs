import test from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeCatalogue } from '../lib/catalogue/runtime.ts';
import {
  generateSystem,
  naturalArchitecture,
  architectureFor,
} from '../lib/catalogue/generate.ts';
import { describeBodyV1 } from './fixtures/catalogue-v1.ts';
import { weighted, stream } from '../lib/catalogue/random.ts';
import {
  PLANET_WEIGHTS,
  COMPACT_PLANET_WEIGHTS,
  SOLID_MOON_WEIGHTS,
  GAS_MOON_WEIGHTS,
  ASTEROID_WEIGHTS,
} from '../lib/catalogue/config.ts';
import { compileOrbitChain, ORBIT_STRIDE } from '../lib/orbits.ts';

test('V2 references never reinterpret an old selection; V1 fixture remains stable', () => {
  const cat = new RuntimeCatalogue();
  assert.equal(describeBodyV1(6).parentId, 5);
  assert.equal(describeBodyV1(6).kind, 'rocky-moon');
  assert.equal(cat.resolveReference('AST-000006'), null);
  assert.equal(cat.resolveReference('v1:system:000001:body:000'), null);
  const body = cat.getBody(98);
  assert.equal(cat.resolveReference(body.bodyId), body);
});
test('query order, regeneration and density preserve identities and complete systems', () => {
  const a = new RuntimeCatalogue(),
    b = new RuntimeCatalogue();
  a.ensure(120000);
  for (const id of [51923, 0, 100, 789, 119999, 9999])
    assert.deepEqual(a.getBody(id), b.getBody(id));
  for (const budget of [10000, 65000, 120000, 10000, 119999]) {
    const count = a.activeCount(budget);
    assert.ok(count <= budget && budget - count < 56);
    const last = a.getBody(count - 1),
      system = a.getSystem(last.systemId);
    assert.equal(system.rootId + system.bodies.length, count);
    assert.equal(a.resolvePick(count, budget), null);
    assert.equal(a.resolvePick(count - 1, budget), last);
    for (const body of a.bodies.slice(0, count)) {
      if (body.parentId !== null) assert.ok(body.parentId < count);
    }
  }
  const sizes = new Set(a.systems.map((system) => system.bodies.length));
  assert.ok(sizes.has(1));
  assert.ok(Math.max(...sizes) > 20);
  assert.equal(a.getSystem(0).architecture, 'black-hole');
  assert.deepEqual(a.getSystem(0).anchor, [5.1, 0.08, 0]);
  assert.ok(a.systems.slice(0, 512).some((s) => s.architecture === 'pulsar'));
});
test('named streams and independent systems reproduce every property', () => {
  for (let i = 0; i < 512; i++) {
    const expected = generateSystem(i, 100);
    generateSystem(i + 777, 500);
    assert.deepEqual(generateSystem(i, 100), expected);
    assert.ok(expected.bodies.every((b) => b.rootId === 100));
    assert.equal(
      new Set(expected.bodies.map((b) => b.bodyId)).size,
      expected.bodies.length,
    );
    const cat = new Map(expected.bodies.map((b) => [b.id, b]));
    for (const body of expected.bodies)
      assert.equal(
        compileOrbitChain(body.id, (id) => cat.get(id)).length,
        ORBIT_STRIDE,
      );
  }
  const before = stream(123, 'orbits')();
  stream(123, 'appearance')();
  assert.equal(stream(123, 'orbits')(), before);
});
test('100000 natural architectures and weighted populations match configured probabilities', () => {
  const counts = { single: 0, binary: 0, pulsar: 0, 'black-hole': 0 };
  const n = 100000;
  for (let i = 512; i < n + 512; i++) counts[naturalArchitecture(i)]++;
  for (const [kind, probability] of Object.entries({
    single: 0.94,
    binary: 0.05,
    pulsar: 0.007,
    'black-hole': 0.003,
  })) {
    // Six binomial standard deviations plus two counts: deterministic, non-flaky tolerance.
    assert.ok(
      Math.abs(counts[kind] - n * probability) <
        6 * Math.sqrt(n * probability * (1 - probability)) + 2,
      kind,
    );
  }
  for (const weights of [
    PLANET_WEIGHTS,
    COMPACT_PLANET_WEIGHTS,
    SOLID_MOON_WEIGHTS,
    GAS_MOON_WEIGHTS,
    ASTEROID_WEIGHTS,
  ]) {
    const random = stream(91724, `population:${weights.length}:${weights[0]}`),
      observed = weights.map(() => 0);
    for (let i = 0; i < n; i++) observed[weighted(random, weights)]++;
    weights.forEach((weight, i) => {
      const p = weight / 100;
      assert.ok(
        Math.abs(observed[i] - n * p) < 6 * Math.sqrt(n * p * (1 - p)) + 2,
      );
    });
  }
  assert.equal(architectureFor(0), 'black-hole');
});

test('100000 generated systems obey the population bounds and invisible-node graph', () => {
  const planets = Array(11).fill(0),
    asteroids = Array(4).fill(0);
  let ordinary = 0;
  for (let i = 512; i < 100512; i++) {
    const system = generateSystem(i, 0);
    const isOrdinary =
      system.architecture === 'single' || system.architecture === 'binary';
    const ps = system.bodies.filter((b) => b.role === 'planet');
    const rocks = system.bodies.filter((b) => b.role === 'asteroid');
    if (isOrdinary) {
      ordinary++;
      planets[ps.length]++;
    } else assert.ok(ps.length <= 4);
    asteroids[rocks.length]++;
    const nodes = new Map(system.nodes.map((n) => [n.id, n]));
    assert.ok(nodes.has(system.orbitalRootId));
    for (const node of system.nodes) {
      let current = node,
        depth = 0;
      while (current.parentId !== null) {
        current = nodes.get(current.parentId);
        assert.ok(current);
        assert.ok(++depth <= 3);
      }
    }
    for (const p of ps) {
      const moons = system.bodies.filter((b) => b.parentId === p.id);
      assert.ok(moons.length <= (p.type === 2 ? 4 : 2));
      for (const moon of moons)
        assert.ok(moon.orbit.radius + moon.radius < p.orbit.radius * 0.2);
    }
    if (system.architecture === 'binary') {
      assert.equal(nodes.get(system.orbitalRootId).bodyId, null);
      // The reservation is consumed: the companion now carries that identifier.
      const components = system.bodies.filter((b) => b.role === 'central');
      assert.equal(components.length, 2);
      assert.equal(components[1].bodyId, `${system.id}:body:001`);
      assert.ok(system.reservedBodyIds.every((r) => !r.endsWith(':body:001')));
      for (const planet of ps)
        assert.equal(
          nodes.get(`${planet.bodyId}:orbit`).parentId,
          `${system.id}:barycentre`,
        );
    }
  }
  for (const [actual, weights, n] of [
    [planets, PLANET_WEIGHTS, ordinary],
    [asteroids, ASTEROID_WEIGHTS, 100000],
  ]) {
    weights.forEach((weight, i) => {
      const p = weight / 100;
      assert.ok(
        Math.abs(actual[i] - n * p) < 6 * Math.sqrt(n * p * (1 - p)) + 2,
      );
    });
  }
});

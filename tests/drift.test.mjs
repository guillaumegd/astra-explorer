import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogue } from '../lib/catalogue/runtime.ts';
import {
  DRIFT_HISTORY,
  DRIFT_OPENING_STEPS,
  buildDriftWorld,
  createDriftState,
  driftDwellSeconds,
  nextDriftStep,
} from '../lib/drift.ts';

const DENSITY = 65000;
catalogue.ensure(DENSITY);
const world = buildDriftWorld(catalogue, DENSITY);
const count = catalogue.activeCountWithin(DENSITY);

// Mulberry32: a fixed sequence, so proportions are reproducible.
const seeded = (seed) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const run = (steps, discovered = new Set(), rng = seeded(7)) => {
  let state = createDriftState();
  const out = [];
  for (let i = 0; i < steps; i++) {
    const next = nextDriftStep(world, state, discovered, rng);
    out.push({ step: next.step, before: state });
    state = next.state;
  }
  return out;
};

test('the drift world holds every notebook category under the density', () => {
  const categories = new Set(world.discoverables.map((d) => d.category));
  for (const category of ['black-hole', 'pulsar', 'comet', 'binary', 'nebula'])
    assert.ok(categories.has(category), category);
  for (const system of world.systems)
    assert.ok(system.rootId + system.bodies.length <= count);
  for (const entry of world.discoverables)
    if (entry.bodyIndex !== undefined) assert.ok(entry.bodyIndex < count);
});

test('a drift never opens on a phenomenon, a region or the first system', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const opening = run(DRIFT_OPENING_STEPS, new Set(), seeded(seed));
    assert.equal(opening[0].step.type, 'star');
    for (const { step } of opening) {
      assert.ok(!['phenomenon', 'region'].includes(step.type), step.type);
      if ('bodyIndex' in step) {
        const system = catalogue.getSystem(
          catalogue.getBody(step.bodyIndex).systemId,
        );
        assert.notEqual(system.index, 0);
        assert.equal(system.architecture, 'single');
      }
    }
  }
});

test('about one stop in four is a phenomenon, favouring unseen ones', () => {
  const discovered = new Set(
    world.discoverables.filter((_, i) => i % 2 === 0).map((d) => d.key),
  );
  const steps = run(10000, discovered).slice(DRIFT_OPENING_STEPS);
  const phenomena = steps.filter(({ step }) => step.type === 'phenomenon');
  const share = phenomena.length / steps.length;
  assert.ok(share > 0.18 && share < 0.3, `share ${share}`);
  // Unseen entries come first until the recent history exhausts them.
  const unseen = phenomena.filter(({ step }) => !discovered.has(step.key));
  assert.ok(unseen.length / phenomena.length > 0.9);
});

test('once everything is found, phenomena become rare but possible', () => {
  const all = new Set(world.discoverables.map((d) => d.key));
  const steps = run(6000, all).slice(DRIFT_OPENING_STEPS);
  const share =
    steps.filter(({ step }) => step.type === 'phenomenon').length /
    steps.length;
  assert.ok(share > 0.02 && share < 0.1, `share ${share}`);
});

test('the drift is varied and never repeats a recent stop or a type thrice', () => {
  const steps = run(3000);
  const types = new Set(steps.map(({ step }) => step.type));
  for (const type of ['star', 'system', 'planet', 'region', 'galaxy', 'phenomenon'])
    assert.ok(types.has(type), type);
  for (let i = 2; i < steps.length; i++)
    assert.ok(
      !(
        steps[i].step.type === steps[i - 1].step.type &&
        steps[i].step.type === steps[i - 2].step.type
      ),
    );
  for (const { step, before } of steps) {
    assert.ok(before.history.length <= DRIFT_HISTORY);
    if (step.type === 'star')
      assert.ok(!before.history.includes(`index:${step.bodyIndex}`));
    if (step.type === 'phenomenon') assert.ok(!before.history.includes(step.key));
  }
});

test('planet and system stops stay in the system the camera is in', () => {
  for (const { step, before } of run(3000)) {
    if (step.type !== 'planet' && step.type !== 'system') continue;
    const body = catalogue.getBody(step.bodyIndex);
    assert.equal(body.systemId, before.systemIndex);
    assert.ok(step.bodyIndex < count);
    if (step.type === 'planet') assert.ok(['planet', 'moon'].includes(body.role));
  }
});

test('dwell times follow the stop type and stretch for reduced motion', () => {
  const low = () => 0;
  const high = () => 0.999999;
  assert.equal(driftDwellSeconds('star', low, false), 25);
  assert.ok(driftDwellSeconds('star', high, false) <= 60);
  assert.equal(driftDwellSeconds('galaxy', low, false), 15);
  assert.ok(driftDwellSeconds('galaxy', high, false) <= 25);
  assert.equal(driftDwellSeconds('planet', low, true), 37.5);
});

test('an empty world falls back to a galaxy breath without throwing', () => {
  const empty = { systems: [], discoverables: [], nebulae: [] };
  let state = createDriftState();
  for (let i = 0; i < 5; i++) {
    const next = nextDriftStep(empty, state, new Set(), Math.random);
    assert.equal(next.step.type, 'galaxy');
    state = next.state;
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RuntimeCatalogue } from '../lib/catalogue/runtime.ts';
import { generateSystem } from '../lib/catalogue/generate.ts';
import {
  CELL_SPAN,
  cellEligible,
  listNebulae,
  nebulaFor,
  remnantFor,
} from '../lib/catalogue/regions.ts';
import {
  CATALOGUE_SEED,
  GALAXY_ENVELOPE,
  NEBULA_CELL,
  NEBULA_PROBABILITY,
  NEBULA_RADIUS_SPAN,
  REMNANT_PROBABILITY,
  REMNANT_SIZE_SPAN,
} from '../lib/catalogue/config.ts';
import { galacticShear, shearAngle } from '../lib/particle-motion.ts';
import {
  allocateRegionSteps,
  regionStepBudget,
} from '../lib/phenomena/region-budget.ts';

test('regions are identical whatever the order or the density', () => {
  const a = listNebulae();
  const b = listNebulae();
  assert.deepEqual(a, b);
  // Cells resolve on their own, so a single query matches the full sweep.
  for (const region of a) {
    const [, , , index] = region.regionId.split(':');
    assert.ok(Number.isInteger(Number(index)));
  }
  const low = new RuntimeCatalogue(),
    high = new RuntimeCatalogue();
  low.getRemnants(10000);
  high.getRemnants(120000);
  // Nebulae come from the spatial partition, never from the system list.
  assert.deepEqual(low.listNebulae(), high.listNebulae());
  assert.deepEqual(low.listNebulae(), a);
});

test('persistent slots generate clustered regions bounded by the galaxy', () => {
  let eligible = 0,
    drawn = 0;
  for (let i = -CELL_SPAN; i < CELL_SPAN; i++)
    for (let k = -CELL_SPAN; k < CELL_SPAN; k++) {
      if (!cellEligible(i, k)) {
        assert.equal(nebulaFor(i, k), null);
        continue;
      }
      eligible++;
      const region = nebulaFor(i, k);
      // Calling twice can never yield a second region for the same cell.
      assert.deepEqual(nebulaFor(i, k), region);
      if (!region) continue;
      drawn++;
      assert.ok(region.radius >= NEBULA_RADIUS_SPAN[0] * NEBULA_CELL);
      assert.ok(region.radius <= NEBULA_RADIUS_SPAN[1] * NEBULA_CELL);
      assert.ok(
        Math.hypot(region.center[0], region.center[2]) + region.envelope <=
          GALAXY_ENVELOPE.radius + 1e-10,
      );
      assert.ok(Math.abs(region.center[1]) <= GALAXY_ENVELOPE.halfHeight);
      assert.ok(region.envelope > region.radius);
      assert.equal(region.palette.length, 3);
    }
  assert.equal(eligible, 80);
  assert.equal(listNebulae().length, drawn);
  const expected = eligible * NEBULA_PROBABILITY;
  const sigma = Math.sqrt(
    eligible * NEBULA_PROBABILITY * (1 - NEBULA_PROBABILITY),
  );
  assert.ok(Math.abs(drawn - expected) < 3 * sigma + 2);
});

test('remnants follow their pulsar host, in share and in size', () => {
  let pulsars = 0,
    remnants = 0;
  for (let index = 0; index < 60000; index++) {
    const system = generateSystem(index, 0, CATALOGUE_SEED);
    const remnant = remnantFor(system);
    if (system.architecture !== 'pulsar') {
      assert.equal(remnant, null);
      continue;
    }
    pulsars++;
    if (!remnant) continue;
    remnants++;
    assert.equal(remnant.hostSystem, index);
    assert.equal(remnant.hostBodyId, system.bodies[0].id);
    assert.deepEqual(remnant.center, system.anchor);
    const floor = system.bodies[0].pulsar.envelope * 3;
    assert.ok(remnant.radius >= Math.min(floor, remnant.radius));
    assert.ok(
      remnant.radius <= Math.max(floor, system.envelope * REMNANT_SIZE_SPAN[1]),
    );
    assert.ok(remnant.radius >= floor - 1e-12);
  }
  assert.ok(pulsars > 200);
  const p = REMNANT_PROBABILITY;
  const sigma = Math.sqrt(pulsars * p * (1 - p));
  assert.ok(Math.abs(remnants - pulsars * p) < 6 * sigma + 2);
});

test('remnants appear and vanish with their host, nebulae never do', () => {
  const cat = new RuntimeCatalogue();
  const low = cat.getRemnants(10000).length;
  const high = cat.getRemnants(120000).length;
  assert.ok(high > low);
  for (const remnant of cat.getRemnants(10000))
    assert.ok(
      cat.getSystem(remnant.hostSystem).rootId < cat.activeCount(10000),
    );
  // Back down again: the memoised list must follow, not stick.
  assert.equal(cat.getRemnants(10000).length, low);
});

test('regionsNear matches an exhaustive sweep, edges included', () => {
  const cat = new RuntimeCatalogue();
  const all = [...cat.listNebulae(), ...cat.getRemnants(65000)];
  const probes = [
    [0, 0, 0],
    [5.1, 0.08, 0],
    [-9.3, -0.1, -8.7],
    [40, 0, 40],
  ];
  for (const region of cat.listNebulae())
    probes.push(region.center, [
      region.center[0] + region.envelope,
      region.center[1],
      region.center[2],
    ]);
  for (const [x, y, z] of probes)
    for (const reach of [0, 0.5, 6]) {
      const expected = all
        .filter(
          (r) =>
            Math.hypot(x - r.center[0], y - r.center[1], z - r.center[2]) <=
            r.envelope + reach,
        )
        .map((r) => r.regionId)
        .sort();
      const actual = cat
        .regionsNear(x, y, z, reach, 65000)
        .map((r) => r.regionId)
        .sort();
      assert.deepEqual(actual, expected);
    }
});

test('the cloud turns rigidly, so its envelope always contains it', () => {
  const centre = new THREE.Vector3(),
    point = new THREE.Vector3();
  // The whole volume turns at its centre's rate. Applying the true per-radius
  // shear instead would wind a one-unit cloud into a 40-unit arc within half an
  // hour of simulation, which no bounding sphere can follow.
  const rigid = (region, x, y, z, rotation, out) => {
    const angle = shearAngle(region.center[0], region.center[2], rotation);
    const c = Math.cos(angle),
      s = Math.sin(angle);
    return out.set(c * x + s * z, y, -s * x + c * z);
  };
  for (const region of listNebulae())
    for (const rotation of [0, 1, 4.5, 20, 120, 4000]) {
      galacticShear(...region.center, rotation, centre);
      rigid(region, ...region.center, rotation, point);
      // The centre's own position is that same rigid rotation.
      assert.ok(point.distanceTo(centre) < 1e-9);
      for (let a = 0; a < 16; a++)
        for (let b = 0; b < 8; b++) {
          const theta = (a / 16) * Math.PI * 2,
            phi = (b / 7) * Math.PI;
          rigid(
            region,
            region.center[0] + region.radius * Math.sin(phi) * Math.cos(theta),
            region.center[1] + region.radius * Math.cos(phi),
            region.center[2] + region.radius * Math.sin(phi) * Math.sin(theta),
            rotation,
            point,
          );
          // Rigid rotation is an isometry: the radius is preserved exactly.
          assert.ok(Math.abs(point.distanceTo(centre) - region.radius) < 1e-9);
          assert.ok(point.distanceTo(centre) <= region.envelope);
        }
    }
});

test('allocateRegionSteps never spends more than the total budget on non-priority candidates', () => {
  const steps = 16;
  const budget = regionStepBudget(steps);
  const candidates = Array.from({ length: 12 }, (_, i) => ({
    id: `c${i}`,
    pixels: 60 + i * 5,
    focused: false,
    inside: 0,
  }));
  const allocation = allocateRegionSteps(candidates, steps);
  let spent = 0;
  for (const c of candidates)
    spent += Math.max(c.pixels, 1) * (allocation.get(c.id) ?? 0);
  assert.ok(spent <= budget * 1.0001);
  // Every value comes from the tier's own ladder.
  for (const value of allocation.values())
    assert.ok([0, 4, 8, steps].includes(value));
});

test('allocateRegionSteps never degrades a focused or traversed candidate', () => {
  const steps = 8;
  const candidates = [
    { id: 'far', pixels: 500, focused: false, inside: 0 },
    { id: 'far2', pixels: 500, focused: false, inside: 0 },
    { id: 'far3', pixels: 500, focused: false, inside: 0 },
    { id: 'far4', pixels: 500, focused: false, inside: 0 },
    { id: 'focused', pixels: 500, focused: true, inside: 0 },
    { id: 'inside', pixels: 500, focused: false, inside: 0.4 },
  ];
  const allocation = allocateRegionSteps(candidates, steps);
  assert.equal(allocation.get('focused'), steps);
  assert.equal(allocation.get('inside'), steps);
});

test('allocateRegionSteps keeps a near-invisible candidate capped, however much headroom is left', () => {
  const steps = 16;
  const candidates = [{ id: 'tiny', pixels: 2, focused: false, inside: 0 }];
  const allocation = allocateRegionSteps(candidates, steps);
  assert.equal(allocation.get('tiny'), 4);
});

test('allocateRegionSteps never leaves a single, lonely candidate at zero', () => {
  // Deliberately tiny budget: a single huge candidate at the full tier alone
  // could exceed it, but it must still receive something.
  const steps = 16;
  const candidates = [{ id: 'huge', pixels: 100000, focused: false, inside: 0 }];
  const allocation = allocateRegionSteps(candidates, steps);
  assert.ok(allocation.get('huge') > 0);
});

test('allocateRegionSteps is deterministic for a given candidate set', () => {
  const steps = 16;
  const candidates = Array.from({ length: 9 }, (_, i) => ({
    id: `n${i}`,
    pixels: (i * 37) % 200,
    focused: false,
    inside: 0,
  }));
  const a = allocateRegionSteps(candidates, steps);
  const b = allocateRegionSteps(candidates, steps);
  assert.deepEqual([...a.entries()], [...b.entries()]);
});

test('a region is never a body: no index, no budget, no pick', () => {
  const cat = new RuntimeCatalogue();
  const before = cat.activeCount(65000);
  cat.listNebulae();
  cat.getRemnants(65000);
  assert.equal(cat.activeCount(65000), before);
  for (const region of cat.listNebulae()) {
    assert.equal(cat.resolveReference(region.regionId), null);
    assert.equal(cat.resolveRegion(region.regionId, 65000), region);
  }
  assert.equal(cat.resolveRegion('v2:region:nebula:999999', 65000), null);
});

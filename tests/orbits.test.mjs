import test from 'node:test';
import assert from 'node:assert/strict';
import { compileOrbitChain, orbitalOffset, orbitFor } from '../lib/orbits.ts';
import { describeBody } from '../lib/stellar-lod.ts';
import { particlePosition } from '../lib/particle-motion.ts';
import * as THREE from 'three';
import { catalogue } from '../lib/catalogue/runtime.ts';
catalogue.ensure(1000);
const moonBody = catalogue.bodies.find((b) => b.role === 'moon');
const moonSystem = catalogue.getSystemMembers(moonBody.systemId);

test('moon revolves around its moving parent at a stable distance', () => {
  const parent = describeBody(moonBody.parentId),
    moon = moonBody;
  const parentChain = compileOrbitChain(parent.id, describeBody),
    moonChain = compileOrbitChain(moon.id, describeBody);
  const orbit = orbitFor(moon, parent);
  let previous;
  for (const time of [0, 1, 5, 30, 100]) {
    const p = orbitalOffset(parentChain, 0, time, new THREE.Vector3());
    const m = orbitalOffset(moonChain, 0, time, new THREE.Vector3());
    assert.ok(Math.abs(p.distanceTo(m) - orbit.radius) < 1e-7);
    if (previous) assert.ok(previous.distanceTo(m) > 1e-5);
    previous = m;
  }
});
test('hierarchy supports nested satellites and rejects cycles', () => {
  const bodies = [0, 1, 2, 3].map((id) => ({
    id,
    parentId: id ? id - 1 : null,
    radius: 0.00001,
    seed: 0.4,
    orbit: id
      ? {
          parentId: id - 1,
          radius: 0.001 * id,
          phase: id,
          speed: 0.1,
          inclination: 0.2,
        }
      : null,
  }));
  assert.equal(
    compileOrbitChain(3, (id) => bodies[id])
      .filter((_, i) => i % 4 === 0)
      .every((r) => r > 0),
    true,
  );
  bodies[1].parentId = 2;
  assert.throws(() => compileOrbitChain(2, (id) => bodies[id]), /Cycle/);
});
test('CPU tracking adds the same orbital chain after common galactic motion', () => {
  const data = compileOrbitChain(6, describeBody);
  const positions = new Float32Array([1, 2, 3]),
    seeds = new Float32Array([0.5]);
  const base = particlePosition(positions, seeds, 0, 2, 3, new THREE.Vector3());
  const expected = orbitalOffset(data, 0, 2, base.clone());
  const actual = particlePosition(
    positions,
    seeds,
    0,
    2,
    3,
    new THREE.Vector3(),
    undefined,
    data,
  );
  assert.ok(expected.distanceTo(actual) < 1e-12);
});

test('system frame encloses descendants at every orbital phase and excludes siblings', async () => {
  const { systemBounds, framingDistance } =
    await import('../lib/system-framing.ts');
  const catalogue = moonSystem;
  const whole = systemBounds(moonBody.rootId, catalogue),
    local = systemBounds(moonBody.parentId, catalogue);
  assert.ok(local.members.includes(moonBody.id));
  assert.ok(!local.members.includes(moonBody.rootId));
  assert.equal(whole.members.length, catalogue.length);
  for (const root of [moonBody.rootId, moonBody.parentId]) {
    const bound = systemBounds(root, catalogue);
    for (const time of [0, 5, 50, 500]) {
      const center = orbitalOffset(
        compileOrbitChain(root, describeBody),
        0,
        time,
        new THREE.Vector3(),
      );
      for (const id of bound.members) {
        const pos = orbitalOffset(
          compileOrbitChain(id, describeBody),
          0,
          time,
          new THREE.Vector3(),
        );
        assert.ok(
          pos.distanceTo(center) + describeBody(id).radius <=
            bound.radius + 1e-7,
        );
      }
    }
  }
  assert.ok(
    framingDistance(whole.radius, 0.5) > framingDistance(whole.radius, 2),
  );
  assert.deepEqual(systemBounds(moonBody.parentId, [moonBody]).members, []);
});

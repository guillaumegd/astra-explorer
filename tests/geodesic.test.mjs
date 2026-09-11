import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CRITICAL_IMPACT, traceGeodesic } from '../lib/phenomena/geodesic.ts';
const incoming = (b, step = 0.04, r = 1000) => {
  const sine = (b / r) * Math.sqrt(1 - 1 / r);
  return traceGeodesic(
    new THREE.Vector3(0, 0, r),
    new THREE.Vector3(sine, 0, -Math.sqrt(1 - sine * sine)),
    3,
    20,
    step,
  );
};
test('Schwarzschild capture threshold and radial finite observer directions', () => {
  for (const fraction of [0.9, 0.99, 0.999])
    assert.equal(incoming(CRITICAL_IMPACT * fraction).captured, true);
  for (const fraction of [1.001, 1.01, 1.1])
    assert.equal(incoming(CRITICAL_IMPACT * fraction).captured, false);
  const origin = new THREE.Vector3(0, 0, 20);
  assert.equal(
    traceGeodesic(origin, new THREE.Vector3(0, 0, -1)).captured,
    true,
  );
  assert.equal(
    traceGeodesic(origin, new THREE.Vector3(0, 0, 1)).captured,
    false,
  );
  // A small impact parameter alone does not imply capture for an outgoing ray.
  assert.equal(
    traceGeodesic(origin, new THREE.Vector3(0.01, 0, 1).normalize()).captured,
    false,
  );
});
test('GPU step converges to a refined double precision reference, including photon ring', () => {
  for (const b of [
    CRITICAL_IMPACT * 0.999,
    CRITICAL_IMPACT * 1.001,
    3,
    5,
    10,
    30,
  ]) {
    const coarse = incoming(b),
      fine = incoming(b, 0.005);
    assert.equal(coarse.captured, fine.captured);
    assert.equal(coarse.unresolved, false);
    assert.ok(
      coarse.residual < 2e-6,
      `${b}: energy residual ${coarse.residual}`,
    );
    if (!coarse.captured)
      assert.ok(coarse.direction.angleTo(fine.direction) < 0.0001);
  }
});
test('weak field approaches Einstein deflection 2rs/b', () => {
  const b = 100,
    result = incoming(b, 0.01, 1e6);
  const deflection = Math.atan2(-result.direction.x, -result.direction.z);
  assert.ok(Math.abs(deflection - 2 / b) < 0.0007, String(deflection));
});
test('curved rays see the back of the disc more than once', () => {
  const origin = new THREE.Vector3(0, 15, 35);
  let secondary = 0;
  for (let x = -3; x <= 3; x += 0.15)
    for (let y = -3; y <= 3; y += 0.15) {
      const target = new THREE.Vector3(x, y, 0);
      const ray = traceGeodesic(origin, target.sub(origin).normalize());
      if (ray.intersections.some((hit) => hit.phi > Math.PI)) secondary++;
      for (const hit of ray.intersections) {
        assert.ok(Math.abs(hit.point.y) < 0.181);
        assert.ok(
          Math.hypot(hit.point.x, hit.point.z) >= 3 &&
            Math.hypot(hit.point.x, hit.point.z) <= 20,
        );
        assert.ok(Math.abs(hit.direction.length() - 1) < 1e-10);
      }
    }
  assert.ok(
    secondary > 0,
    'secondary disc images must result from curved trajectories',
  );
});

test('finite emitting disc remains visible edge-on without geometric rings', () => {
  const result = traceGeodesic(
    new THREE.Vector3(8, 0.1, 40),
    new THREE.Vector3(0, 0, -1),
  );
  assert.ok(result.intersections.some((hit) => hit.opacity > 0.1));
});

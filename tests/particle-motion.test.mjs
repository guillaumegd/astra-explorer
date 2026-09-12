import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  particlePosition,
  buildParticleIndex,
  galacticShear,
  shearAngle,
} from '../lib/particle-motion.ts';

test('focused bodies follow the GPU column-major rotation', () => {
  const positions = new Float32Array([2, 0, 0]),
    seeds = new Float32Array([0]);
  const out = new THREE.Vector3();
  const angle = 0.35 + 0.65 / 1.3;
  particlePosition(positions, seeds, 0, 1, 0, out);
  assert.ok(Math.abs(out.x - 2 * Math.cos(angle)) < 1e-10);
  assert.ok(Math.abs(out.z + 2 * Math.sin(angle)) < 1e-10);
});

test('spatial candidates remain local and respect the density limit', () => {
  const positions = new Float32Array([
    0, 0, 0, 0.2, 0, 0, 10, 0, 10, 0.3, 0, 0,
  ]);
  const neighbours = buildParticleIndex(positions);
  assert.deepEqual(neighbours(0, 4), [0, 1, 3]);
  assert.deepEqual(neighbours(0, 2), [0, 1]);
});

test('system members retain their separation under rotation', () => {
  const positions = new Float32Array([2, 0, 3, 2, 0, 3]);
  const seeds = new Float32Array([0.4, 0.4]);
  const offsets = new Float32Array([0, 0, 0, 0.03, 0.002, 0.04]);
  for (const time of [0, 0.2, 1, 3, 10]) {
    const star = particlePosition(
      positions,
      seeds,
      0,
      time,
      time,
      new THREE.Vector3(),
      offsets,
    );
    const planet = particlePosition(
      positions,
      seeds,
      1,
      time,
      time,
      new THREE.Vector3(),
      offsets,
    );
    assert.ok(
      Math.abs(star.distanceTo(planet) - Math.hypot(...offsets.slice(3))) <
        1e-10,
    );
  }
});

// The extraction feeds every CPU position, so hold it to the inline formula.
test('shared shear reproduces the formula particlePosition used inline', () => {
  const out = new THREE.Vector3();
  for (const [x, y, z] of [
    [2, 0, 0],
    [0.4, 0.12, -6.3],
    [-11.7, -0.3, 4.1],
    [0, 0, 0],
  ])
    for (const rotation of [0, 0.7, 3.9, 41.2]) {
      const radius = Math.hypot(x, z);
      const angle = rotation * (0.35 + 0.65 / (radius * 0.15 + 1));
      galacticShear(x, y, z, rotation, out);
      assert.ok(Math.abs(shearAngle(x, z, rotation) - angle) < 1e-12);
      assert.ok(
        Math.abs(out.x - (Math.cos(angle) * x + Math.sin(angle) * z)) < 1e-12,
      );
      assert.equal(out.y, y);
      assert.ok(
        Math.abs(out.z - (-Math.sin(angle) * x + Math.cos(angle) * z)) < 1e-12,
      );
      // Shear is a rotation about the axis: it never changes the radius.
      assert.ok(Math.abs(Math.hypot(out.x, out.z) - radius) < 1e-12);
    }
});

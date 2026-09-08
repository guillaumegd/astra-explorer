import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  particlePosition,
  buildParticleIndex,
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
    const star = particlePosition(positions, seeds, 0, time, time, new THREE.Vector3(), offsets);
    const planet = particlePosition(positions, seeds, 1, time, time, new THREE.Vector3(), offsets);
    assert.ok(Math.abs(star.distanceTo(planet) - Math.hypot(...offsets.slice(3))) < 1e-10);
  }
});

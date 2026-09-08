import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { lightInView } from '../lib/body-lighting.ts';

test('camera orbit cannot move the day/night boundary on a body', () => {
  const parent = new THREE.Matrix4().makeRotationY(0.7);
  const light = new THREE.Vector3(1, 0.2, -0.3).normalize();
  const normal = new THREE.Vector3(0.6, 0.1, -0.8).normalize();
  const expected = normal.dot(light);
  for (const angle of [0, 0.4, 1.5, Math.PI, 5]) {
    const view = new THREE.Matrix4().makeRotationY(angle);
    const n = normal
      .clone()
      .transformDirection(parent)
      .transformDirection(view);
    assert.ok(
      Math.abs(n.dot(lightInView(light, parent, view)) - expected) < 1e-12,
    );
  }
});

test('rotating terrain into the stellar light changes its illumination', () => {
  const light = new THREE.Vector3(1, 0, 0);
  const identity = new THREE.Matrix4();
  const normal = new THREE.Vector3(1, 0, 0);
  assert.equal(normal.dot(lightInView(light, identity, identity)), 1);
  normal.applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  assert.ok(normal.dot(lightInView(light, identity, identity)) < -0.999);
});

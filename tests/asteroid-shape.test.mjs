import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { asteroidRadius, sculptAsteroid } from '../lib/asteroid-shape.ts';

test('fractured asteroids remain bounded, asymmetric and deterministic', () => {
  for (const seed of [1, 17, 42, 89]) {
    const radii = [];
    let asymmetry = 0;
    for (let i = 0; i < 200; i++) {
      const p = new THREE.Vector3(
        Math.cos(i * 2.4),
        Math.sin(i * 0.79),
        Math.sin(i * 2.4),
      ).normalize();
      const r = asteroidRadius(p.x, p.y, p.z, seed);
      assert.ok(r > 0.35 && r <= 1);
      assert.equal(r, asteroidRadius(p.x, p.y, p.z, seed));
      asymmetry = Math.max(
        asymmetry,
        Math.abs(r - asteroidRadius(-p.x, -p.y, -p.z, seed)),
      );
      radii.push(r);
    }
    assert.ok(Math.max(...radii) - Math.min(...radii) > 0.15);
    assert.ok(asymmetry > 0.1);
  }
});

test('CPU picking geometry follows the fracture field without altering shared sphere geometry', () => {
  const source = new THREE.SphereGeometry(1, 48, 24);
  const original = source.attributes.position.array.slice();
  const shape = sculptAsteroid(source, 42);
  const p = new THREE.Vector3();
  for (let i = 0; i < shape.attributes.position.count; i++) {
    p.fromBufferAttribute(shape.attributes.position, i);
    const radius = p.length();
    p.normalize();
    assert.ok(Math.abs(radius - asteroidRadius(p.x, p.y, p.z, 42)) < 1e-6);
  }
  assert.deepEqual(source.attributes.position.array, original);
  shape.dispose();
  source.dispose();
});

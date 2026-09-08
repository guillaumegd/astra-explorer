import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  createStellarActivity,
  eruptionState,
} from '../lib/stellar-activity.ts';

test('eruption events vary but remain reproducible across cache recreation', () => {
  const a = eruptionState(120, 42, 0);
  assert.deepEqual(eruptionState(120, 42, 0), a);
  assert.notEqual(eruptionState(152, 42, 0).strength, a.strength);
  for (let t = 0; t < 500; t++) {
    const state = eruptionState(t, 42, 0);
    assert.ok(state.strength >= 0.55 && state.strength <= 1);
    assert.ok(Number.isFinite(state.age));
  }
});

test('activity fades with distance and releases all GPU resources', () => {
  const activity = createStellarActivity(42, '#ff9875', 'red-dwarf');
  const camera = new THREE.Vector3(0, 0, 4);
  activity.update(120, 1, 200, camera);
  assert.equal(activity.group.visible, true);
  const particles = activity.group.children.filter((child) => child.isPoints);
  assert.equal(particles.length, 4);
  let disposed = 0;
  for (const mesh of activity.group.children) {
    mesh.geometry.addEventListener('dispose', () => disposed++);
    mesh.material.addEventListener('dispose', () => disposed++);
  }
  activity.fadeOut(121, 2);
  assert.equal(activity.group.visible, false);
  activity.update(122, 1, 20, camera);
  assert.equal(activity.group.visible, false);
  activity.dispose();
  assert.equal(disposed, 20);
});

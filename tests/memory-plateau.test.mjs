import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBodyLOD, describeBody } from '../lib/stellar-lod.ts';
import { createPhenomenaManager } from '../lib/phenomena/manager.ts';
import { createRegionManager } from '../lib/phenomena/region-manager.ts';
import { listNebulae } from '../lib/catalogue/regions.ts';
import { RuntimeCatalogue } from '../lib/catalogue/runtime.ts';
import { estimateBufferBytes } from '../lib/performance-memory.ts';

// The idle-eviction window every manager already uses (stellar-lod.ts,
// phenomena/manager.ts, phenomena/region-manager.ts): jumping the clock past
// it forces a deterministic return to the fully-released state instead of
// waiting on a fade.
const PAST_IDLE_WINDOW = 4.5;

test('visiting many bodies over many trips leaves the shared geometry caches and buffer bytes at zero, not growing', () => {
  const parent = new THREE.Group();
  const lod = createBodyLOD(parent);
  assert.equal(lod.stats().geometries, 0);
  assert.equal(estimateBufferBytes([parent]).bufferBytes, 0);

  let t = 0;
  for (let trip = 0; trip < 20; trip++) {
    // Different bodies each trip, including some with rings/oceans/atmospheres
    // so the ring-geometry share and the atmosphere/ocean materials are
    // exercised, not just the base terrain mesh.
    const body = describeBody(trip * 137 + 5);
    const candidate = {
      identity: body,
      position: new THREE.Vector3(),
      pixels: 300,
      distanceInRadii: 1.05,
      cameraPosition: new THREE.Vector3(0, 0, body.radius * 1.1),
    };
    for (let f = 0; f < 5; f++) {
      t += 0.1;
      lod.update([candidate], t, 0);
    }
    // Bounded caches regardless of how many distinct bodies have been
    // visited: at most one shared geometry per resolved segment count.
    assert.ok(lod.stats().geometries <= 4);
    t += PAST_IDLE_WINDOW;
    lod.update([], t, 0);
    assert.equal(lod.stats().cached, 0);
  }
  // Nothing left attached, and the shared caches released with it.
  assert.equal(lod.stats().geometries, 0);
  assert.equal(parent.children.length, 0);
  assert.equal(estimateBufferBytes([parent]).bufferBytes, 0);
  lod.dispose();
});

test('visiting many phenomena over many trips leaves nothing attached and no buffer bytes behind', () => {
  const catalogue = new RuntimeCatalogue();
  catalogue.ensure(120000);
  const holes = catalogue
    .getPhenomena(120000)
    .filter((b) => b.kind === 'black-hole');
  assert.ok(holes.length >= 20);
  const parent = new THREE.Group();
  const manager = createPhenomenaManager(parent);
  assert.equal(estimateBufferBytes([parent]).bufferBytes, 0);

  let t = 0;
  for (let trip = 0; trip < 20; trip++) {
    const candidate = {
      identity: holes[trip],
      position: new THREE.Vector3(),
      pixels: 200,
      distanceInRadii: 3,
    };
    t += 0.1;
    manager.update([candidate], t, t);
    t += 0.1;
    manager.update([candidate], t, t);
    assert.ok(manager.stats().cached <= 4);
    t += PAST_IDLE_WINDOW;
    manager.update([], t, t);
    assert.equal(manager.stats().cached, 0);
  }
  assert.equal(parent.children.length, 0);
  assert.equal(estimateBufferBytes([parent]).bufferBytes, 0);
  manager.dispose();
});

test('leaving and re-entering nebula space over many trips releases every renderer, not just the cache slots', () => {
  const list = listNebulae();
  assert.ok(list.length >= 4);
  const parent = new THREE.Group();
  const manager = createRegionManager(parent);
  assert.equal(estimateBufferBytes([parent]).bufferBytes, 0);

  const candidates = list.map((region) => ({
    region,
    position: new THREE.Vector3(...region.center),
    pixels: 50,
    inside: 0,
    focused: false,
  }));
  let t = 0;
  for (let trip = 0; trip < 20; trip++) {
    t += 0.1;
    manager.update(candidates, t, t, 0);
    t += 0.1;
    manager.update(candidates, t, t, 0);
    assert.equal(manager.stats().persistent, list.length);
    // Every nebula out of view: disposed immediately, not merely faded.
    t += 0.1;
    manager.update([], t, t, 0);
    assert.equal(manager.stats().persistent, 0);
    assert.equal(manager.stats().cached, 0);
  }
  assert.equal(parent.children.length, 0);
  assert.equal(estimateBufferBytes([parent]).bufferBytes, 0);
  manager.dispose();
});

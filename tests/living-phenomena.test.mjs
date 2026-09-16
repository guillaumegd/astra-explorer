import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { listNebulae } from '../lib/catalogue/regions.ts';
import { GALAXY_ENVELOPE } from '../lib/catalogue/config.ts';
import { createRegionManager } from '../lib/phenomena/region-manager.ts';
import {
  cometGrain,
  createCometGrains,
} from '../lib/phenomena/comet-grains.ts';
import { createBlackHole } from '../lib/phenomena/black-hole.ts';
import { catalogue } from '../lib/catalogue/runtime.ts';

test('lens sky capture includes offscreen volumes and restores all state after failure', () => {
  const parent = new THREE.Group(),
    sky = new THREE.Group();
  parent.rotation.set(0.1, 0.2, 0.3);
  parent.position.set(1, 2, 3);
  parent.updateMatrixWorld(true);
  sky.matrixAutoUpdate = false;
  sky.matrix.copy(parent.matrixWorld);
  const manager = createRegionManager(parent);
  const candidates = listNebulae().map((region, i) => ({
    region,
    position: new THREE.Vector3(...region.center),
    pixels: i === 0 ? 200 : 0,
    inside: 0,
    focused: false,
  }));
  manager.update(candidates, 0, 0, 0);
  parent.updateMatrixWorld(true);
  const original = [...parent.children];
  const state = original.map((g) => ({
    visible: g.visible,
    fade: g.children[0].material.uniforms.uFade.value,
    steps: g.children[0].material.defines.STEPS,
    position: g.getWorldPosition(new THREE.Vector3()),
  }));
  let visited = 0;
  assert.throws(
    () =>
      manager.captureSky(sky, () => {
        sky.updateMatrixWorld(true);
        assert.equal(sky.children.length, candidates.length);
        for (let i = 0; i < original.length; i++) {
          const g = original[i];
          assert.equal(g.parent, sky);
          assert.equal(g.visible, true);
          assert.equal(g.children[0].material.uniforms.uFade.value, 1);
          assert.ok(
            g
              .getWorldPosition(new THREE.Vector3())
              .distanceTo(state[i].position) < 1e-10,
          );
          assert.ok(g.children[0].material.defines.STEPS <= 8);
          visited++;
        }
        throw new Error('capture failure');
      }),
    /capture failure/,
  );
  assert.equal(visited, candidates.length);
  assert.deepEqual(parent.children, original);
  assert.equal(sky.children.length, 0);
  original.forEach((g, i) => {
    assert.equal(g.visible, state[i].visible);
    assert.equal(g.children[0].material.uniforms.uFade.value, state[i].fade);
    assert.equal(g.children[0].material.defines.STEPS, state[i].steps);
  });
  manager.dispose();
});

test('repeated sky captures never force a defines.STEPS shader recompile', () => {
  const parent = new THREE.Group(),
    sky = new THREE.Group();
  const manager = createRegionManager(parent);
  const candidates = listNebulae().map((region, i) => ({
    region,
    position: new THREE.Vector3(...region.center),
    // A mix of priority and non-priority steps, so the view material's
    // defines.STEPS differs from the capture material's on more than one entry.
    pixels: i === 0 ? 200 : 20,
    inside: 0,
    focused: false,
  }));
  // Two updates: the first settles each material's real STEPS value (one
  // legitimate recompile away from the placeholder used at construction);
  // steady state is what captures must never disturb.
  manager.update(candidates, 0, 0, 0);
  manager.update(candidates, 0.1, 0.1, 0);
  const viewVersions = parent.children.map(
    (g) => g.children[0].material.version,
  );
  manager.captureSky(sky, () => {});
  manager.captureSky(sky, () => {});
  manager.captureSky(sky, () => {});
  const finalVersions = parent.children.map(
    (g) => g.children[0].material.version,
  );
  // `.version` only increments on `needsUpdate = true`: never touched by
  // swapping mesh.material between the two stable variants, so three rounds
  // of capture leave every material exactly where the steady-state left it.
  assert.deepEqual(viewVersions, finalVersions);
  manager.dispose();
});

test('nebulae occupy at most 1.4 percent of the galaxy diameter and keep a low LOD at distance', () => {
  const list = listNebulae(),
    parent = new THREE.Group(),
    manager = createRegionManager(parent);
  for (const region of list)
    assert.ok(region.radius / GALAXY_ENVELOPE.radius <= 0.01400001);
  // Remnants read as the smaller family from every distance, so they sit well
  // under the nebulae's own share of the disc (issue #12).
  for (const region of catalogue.getRemnants(120000))
    assert.ok(region.radius / GALAXY_ENVELOPE.radius <= 0.0045);
  manager.update(
    list.map((region) => ({
      region,
      position: new THREE.Vector3(...region.center),
      pixels: 2,
      inside: 0,
      focused: false,
    })),
    0,
    0,
    0,
  );
  assert.equal(manager.stats().visible, list.length);
  assert.ok(
    parent.children.every((g) => g.children[0].material.defines.STEPS === 4),
  );
  manager.dispose();
});

test('comet grains move within the tail envelope and freeze without accumulating history', () => {
  const radius = 0.001,
    length = radius * 120,
    point = new THREE.Vector3();
  for (let i = 0; i < 128; i++)
    for (const time of [0, 1, 12, 500, 10000]) {
      const opacity = cometGrain(i, 17, time, radius, length, point);
      assert.ok(opacity >= 0 && opacity <= 1);
      assert.ok(point.length() < length + radius * 8);
    }
  const grains = createCometGrains(radius, length, 17);
  const position = grains.points.geometry.attributes.position;
  grains.update(0, 1, 1, false);
  const start = Array.from(position.array);
  grains.update(1, 1, 1, false);
  assert.notDeepEqual(Array.from(position.array), start);
  const moving = Array.from(position.array);
  grains.update(1, 1, 1, false);
  assert.deepEqual(Array.from(position.array), moving);
  grains.update(500, 1, 1, true);
  assert.deepEqual(Array.from(position.array), start);
  grains.update(900, 1, 1, true);
  assert.deepEqual(Array.from(position.array), start);
  let disposed = 0;
  for (const resource of [grains.points.geometry, grains.points.material])
    resource.addEventListener('dispose', () => disposed++);
  grains.dispose();
  assert.equal(disposed, 2);
});

test('black hole disk clock is deterministic and reduced motion freezes accretion', () => {
  const effect = createBlackHole(catalogue.getBody(0));
  const disk = effect.group.children[1];
  effect.update(12, 1);
  assert.equal(disk.material.uniforms.uTime.value, 12);
  effect.update(12, 0.5);
  assert.equal(disk.material.uniforms.uTime.value, 12);
  effect.update(500, 1, true);
  assert.equal(disk.material.uniforms.uTime.value, 0);
  effect.update(900, 1, true);
  assert.equal(disk.material.uniforms.uTime.value, 0);
  effect.dispose();
});

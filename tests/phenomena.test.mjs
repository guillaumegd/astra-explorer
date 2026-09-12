import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RuntimeCatalogue } from '../lib/catalogue/runtime.ts';
import { createBlackHole } from '../lib/phenomena/black-hole.ts';
import {
  createPhenomenaManager,
  phenomenonVisibility,
} from '../lib/phenomena/manager.ts';
import {
  createRegionManager,
  regionVisibility,
} from '../lib/phenomena/region-manager.ts';
import { minimumOrbitRatio, createBodyLOD } from '../lib/stellar-lod.ts';
import { systemBounds } from '../lib/system-framing.ts';
const catalogue = new RuntimeCatalogue();
const body = catalogue.getBody(0);

test('black hole has distinct reference, visual, and exclusion radii, no surface renderer', () => {
  const p = body.phenomenon;
  assert.equal(body.kind, 'black-hole');
  assert.equal(body.capabilities.canSurfaceExplore, false);
  assert.ok(body.radius >= 0.0002 && body.radius <= 0.0006);
  assert.equal(p.shadowRadius, body.radius * 2.6);
  assert.ok(p.diskOuter > p.diskInner && p.diskInner > p.shadowRadius);
  assert.ok(minimumOrbitRatio(body) * body.radius > p.diskOuter);
  const system = catalogue.getSystemMembers(body.systemId);
  assert.ok(systemBounds(body.id, system).radius >= p.envelope);
  for (const planet of system.filter((b) => b.parentId === body.id))
    assert.ok(planet.orbit.radius > p.envelope * 1.5 - 1e-12);
  const group = new THREE.Group(),
    lod = createBodyLOD(group);
  lod.update(
    [
      {
        identity: body,
        position: new THREE.Vector3(),
        pixels: 500,
        distanceInRadii: 2,
      },
    ],
    0,
    0,
  );
  assert.equal(lod.stats().cached, 0);
  lod.dispose();
});
test('shadow and disk are a single selectable destination at face, profile, and three quarters', () => {
  const renderer = createBlackHole(body);
  renderer.update(10, 1);
  renderer.group.updateMatrixWorld(true);
  for (const direction of [
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(1, 1, 1).normalize(),
  ]) {
    const ray = new THREE.Raycaster(
      direction.clone().multiplyScalar(0.1),
      direction.clone().negate(),
    );
    const hit = renderer.pick(ray);
    assert.equal(hit.object.userData.bodyId, body.id);
  }
  const diskPoint = new THREE.Vector3(
    body.phenomenon.diskOuter * 0.6,
    0,
    0,
  ).applyMatrix4(renderer.group.matrixWorld);
  const normal = new THREE.Vector3(0, 1, 0).transformDirection(
    renderer.group.matrixWorld,
  );
  const diskRay = new THREE.Raycaster(
    diskPoint.clone().addScaledVector(normal, 0.1),
    normal.clone().negate(),
  );
  assert.equal(renderer.pick(diskRay).object.userData.bodyId, body.id);
  const materials = [],
    geometries = [];
  renderer.group.traverse((obj) => {
    if (obj.isMesh) {
      materials.push(obj.material);
      geometries.push(obj.geometry);
    }
  });
  let disposed = 0;
  for (const resource of new Set([...materials, ...geometries]))
    resource.addEventListener('dispose', () => disposed++);
  renderer.dispose();
  assert.equal(disposed, new Set([...materials, ...geometries]).size);
});
test('special cache is bounded and expires while simulation is paused; fade remains smooth', () => {
  catalogue.ensure(120000);
  const holes = catalogue
    .getPhenomena(120000)
    .filter((b) => b.kind === 'black-hole');
  assert.ok(holes.length >= 30);
  const parent = new THREE.Group(),
    manager = createPhenomenaManager(parent);
  const c = (b) => ({
    identity: b,
    position: new THREE.Vector3(),
    pixels: 200,
    distanceInRadii: 3,
  });
  assert.equal(phenomenonVisibility(5), 0);
  assert.equal(phenomenonVisibility(80), 1);
  for (let i = 0; i < 30; i++) {
    manager.update([c(holes[i])], i * 0.2, 5);
    const fades = manager.update([c(holes[i])], i * 0.2 + 0.1, 5);
    assert.ok(fades.find((f) => f.id === holes[i].id).fade < 0.3);
    assert.ok(manager.stats().cached <= 4);
  }
  manager.update([], 11, 5);
  assert.equal(manager.stats().cached, 0);
  assert.equal(parent.children.length, 0);
  manager.dispose();
});

test('finite disk is selectable edge-on away from the shadow and stays inside its envelope', () => {
  const effect = createBlackHole(body);
  effect.update(0, 1);
  effect.group.updateMatrixWorld(true);
  const origin = new THREE.Vector3(
    body.phenomenon.diskOuter * 0.6,
    body.radius * 0.15,
    0.1,
  ).applyMatrix4(effect.group.matrixWorld);
  const direction = new THREE.Vector3(0, 0, -1).transformDirection(
    effect.group.matrixWorld,
  );
  const hit = effect.pick(new THREE.Raycaster(origin, direction));
  assert.ok(hit, 'A ray above the old zero-thickness plane must hit the disk');
  assert.equal(hit.object.userData.bodyId, body.id);
  assert.ok(
    hit.point.distanceTo(effect.group.position) <=
      body.phenomenon.envelope * 1.001,
  );
  effect.dispose();
});

test('region cache is bounded to two, expires, and releases everything', () => {
  const cat = new RuntimeCatalogue();
  const list = [...cat.listNebulae(), ...cat.getRemnants(120000)];
  assert.ok(list.length >= 6);
  const parent = new THREE.Group(),
    manager = createRegionManager(parent);
  const c = (region, pixels = 200, inside = 0, focused = false) => ({
    region,
    position: new THREE.Vector3(),
    pixels,
    inside,
    focused,
  });
  // Inside the volume a region is fully present however small it projects.
  assert.equal(regionVisibility(0, 1), 1);
  assert.equal(regionVisibility(4, 0), 0);
  assert.equal(regionVisibility(200, 0), 1);
  for (let i = 0; i < list.length; i++) {
    manager.update([c(list[i])], i * 0.2, 5, 0);
    manager.update([c(list[i])], i * 0.2 + 0.1, 5, 0);
    assert.ok(manager.stats().cached <= 2);
  }
  // Presence outranks coverage when the budget has to choose.
  manager.update([c(list[0], 5, 1), c(list[1], 400, 0)], 20, 5, 0);
  assert.equal(manager.stats().cached, 2);
  // The framed region keeps its slot even when two larger ones compete.
  manager.update(
    [c(list[0], 400), c(list[1], 300), c(list[2], 1, 0, true)],
    21,
    5,
    0,
  );
  assert.equal(manager.stats().cached, 2);
  // Past the four-second release the two evicted ones are gone, it remains.
  manager.update([c(list[2], 1, 0, true)], 27, 5, 0);
  assert.equal(manager.stats().cached, 1);
  const materials = [],
    geometries = [];
  parent.traverse((obj) => {
    if (obj.isMesh) {
      materials.push(obj.material);
      geometries.push(obj.geometry);
    }
  });
  const resources = new Set([...materials, ...geometries]);
  let disposed = 0;
  for (const resource of resources)
    resource.addEventListener('dispose', () => disposed++);
  // Four seconds out of sight and the entries are gone, meshes included.
  manager.update([], 32, 5, 0);
  assert.equal(manager.stats().cached, 0);
  assert.equal(parent.children.length, 0);
  assert.equal(disposed, resources.size);
  manager.dispose();
});

test('volumetric samples degrade only down the declared ladder', () => {
  const parent = new THREE.Group(),
    manager = createRegionManager(parent);
  assert.equal(manager.steps(), 16);
  manager.setSteps(8);
  assert.equal(manager.steps(), 8);
  manager.setSteps(4);
  assert.equal(manager.steps(), 4);
  manager.setSteps(16);
  assert.equal(manager.steps(), 16);
  manager.dispose();
});

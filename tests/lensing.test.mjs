import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createLensing } from '../lib/phenomena/lensing.ts';
import { RuntimeCatalogue } from '../lib/catalogue/runtime.ts';

test('one optical field owns two targets, preserves scene visibility and expires after four seconds', () => {
  const lens = createLensing(),
    scene = new THREE.Scene(),
    group = new THREE.Group();
  const body = new RuntimeCatalogue().getBody(0),
    camera = new THREE.PerspectiveCamera(48, 1, 0.000001, 180);
  scene.add(group);
  camera.position.set(0, 0, 0.1);
  camera.lookAt(0, 0, 0);
  const targets = new Set();
  let disposals = 0,
    renders = 0;
  const renderer = {
    getDrawingBufferSize: (v) => v.set(800, 600),
    setRenderTarget: (t) => {
      if (t) targets.add(t);
    },
    render: () => renders++,
  };
  const capture = (c) => targets.add(c.renderTarget);
  lens.render(renderer, scene, camera, null, 0, 0, capture);
  assert.deepEqual(lens.stats(), { active: 0, targets: 0 });
  lens.render(
    renderer,
    scene,
    camera,
    { body, group, fade: 1, seen: 1 },
    1,
    0,
    capture,
  );
  assert.deepEqual(lens.stats(), { active: 1, targets: 2 });
  assert.equal(group.visible, true);
  assert.equal(targets.size, 2);
  for (const target of targets)
    target.addEventListener('dispose', () => disposals++);
  const ray = new THREE.Ray(
    camera.position.clone(),
    new THREE.Vector3(0, 0, -1),
  );
  const trace = lens.trace(ray);
  assert.equal(trace.body.id, body.id);
  assert.equal(trace.captured, true);
  lens.render(renderer, scene, camera, null, 4.9, 0, capture);
  assert.equal(lens.stats().targets, 2);
  lens.render(renderer, scene, camera, null, 5.01, 0, capture);
  assert.equal(lens.stats().targets, 0);
  assert.equal(disposals, 2);
  assert.ok(renders >= 4);
  lens.dispose();
  assert.equal(disposals, 2);
});

test('both images of a distant source map to the same escaping direction', () => {
  const lens = createLensing(),
    body = new RuntimeCatalogue().getBody(0),
    group = new THREE.Group(),
    scene = new THREE.Scene();
  scene.add(group);
  const camera = new THREE.PerspectiveCamera(48, 1, 0.000001, 180);
  camera.position.set(0, 0, body.radius * 50);
  camera.lookAt(0, 0, 0);
  const renderer = {
    getDrawingBufferSize: (v) => v.set(800, 800),
    setRenderTarget: () => {},
    render: () => {},
  };
  lens.render(
    renderer,
    scene,
    camera,
    { body, group, fade: 1 },
    0,
    0,
    () => {},
  );
  const tangent = new THREE.Vector3(1, 1, 0).normalize();
  const star = tangent
    .clone()
    .multiplyScalar(Math.sin(0.1))
    .add(new THREE.Vector3(0, 0, -Math.cos(0.1)));
  const solve = (low, high) => {
    let hit;
    for (let i = 0; i < 30; i++) {
      const b = (low + high) / 2,
        d = tangent
          .clone()
          .multiplyScalar(b / 50)
          .add(new THREE.Vector3(0, 0, -1))
          .normalize();
      hit = lens.trace(new THREE.Ray(camera.position, d));
      const angle = Math.atan2(hit.direction.dot(tangent), -hit.direction.z);
      if (angle < 0.1) low = b;
      else high = b;
    }
    return hit;
  };
  for (const hit of [solve(-10, -8), solve(12, 15)]) {
    assert.equal(hit.captured, false);
    assert.equal(hit.disk, false);
    assert.ok(hit.direction.angleTo(star) < 1e-6);
  }
  lens.dispose();
});

test('transparent disc rim does not steal the background selection', () => {
  const lens = createLensing(),
    body = new RuntimeCatalogue().getBody(0),
    group = new THREE.Group(),
    scene = new THREE.Scene();
  scene.add(group);
  const camera = new THREE.PerspectiveCamera(48, 1, 0.000001, 180);
  camera.position.set(0, body.radius * 50, 0);
  camera.lookAt(0, 0, 0);
  const renderer = {
    getDrawingBufferSize: (v) => v.set(800, 800),
    setRenderTarget: () => {},
    render: () => {},
  };
  lens.render(
    renderer,
    scene,
    camera,
    { body, group, fade: 1 },
    0,
    0,
    () => {},
  );
  let transparent = 0,
    opaque = 0;
  for (let x = 3; x < 24; x += 0.05) {
    const d = new THREE.Vector3(x, -50, 0).normalize();
    const hit = lens.trace(new THREE.Ray(camera.position, d));
    if (hit?.transmission > 0.55 && hit.transmission < 0.98 && !hit.captured) {
      assert.equal(hit.disk, false);
      transparent++;
    }
    if (hit?.transmission < 0.45) {
      assert.equal(hit.disk, true);
      opaque++;
    }
  }
  assert.ok(transparent > 0 && opaque > 0);
  lens.dispose();
});

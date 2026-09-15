import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { catalogue } from '../lib/catalogue/runtime.ts';
import { listNebulae } from '../lib/catalogue/regions.ts';
import { createRegionManager } from '../lib/phenomena/region-manager.ts';
import { createComet } from '../lib/phenomena/comet.ts';
import { createBodyLOD } from '../lib/stellar-lod.ts';

const candidate = (region, pixels = 100) => ({
  region,
  pixels,
  position: new THREE.Vector3(...region.center),
  inside: 0,
  focused: false,
});

test('all nebulae remain present across detail competition, tiny projection, pause and reentry', () => {
  const list = listNebulae(),
    parent = new THREE.Group(),
    manager = createRegionManager(parent);
  const candidates = list.map((r) => candidate(r));
  manager.update(candidates, 0, 0, 0);
  assert.equal(manager.stats().persistent, list.length);
  assert.equal(manager.stats().visible, list.length);
  const original = [...parent.children];
  for (let frame = 1; frame <= 20; frame++) {
    candidates.forEach((c, i) => {
      c.pixels = i === frame % list.length ? 400 : 1;
      c.focused = i === frame % list.length;
    });
    manager.update(candidates, frame, 0, 0, true);
    assert.deepEqual(parent.children, original);
    assert.ok(
      parent.children.every(
        (g) => g.visible && g.children[0].material.uniforms.uFade.value === 1,
      ),
    );
    assert.ok(
      parent.children.filter((g) => g.children[0].material.defines.STEPS === 16)
        .length <= 2,
    );
  }
  candidates.forEach((c) => {
    c.pixels = 0;
    c.focused = false;
  });
  manager.update(candidates, 21, 0, 0);
  assert.equal(manager.stats().visible, 0);
  candidates.forEach((c) => (c.pixels = 50));
  manager.update(candidates, 22, 0, 0);
  assert.equal(manager.stats().visible, list.length);
  assert.deepEqual(parent.children, original);
  let disposed = 0;
  parent.traverse((o) => {
    if (o.isMesh)
      for (const resource of [o.geometry, o.material])
        resource.addEventListener('dispose', () => disposed++);
  });
  manager.dispose();
  assert.equal(disposed, list.length * 2);
  assert.equal(parent.children.length, 0);
});

test('default nebula layout has clusters, empty spans, distinct colours and morphologies', () => {
  const list = listNebulae();
  const radii = list.map((r) => Math.hypot(r.center[0], r.center[2]));
  assert.ok(Math.max(...radii) - Math.min(...radii) > 4, 'not a narrow ring');
  const distances = list.map((r, i) =>
    Math.min(
      ...list
        .filter((_, j) => i !== j)
        .map((other) =>
          Math.hypot(
            r.center[0] - other.center[0],
            r.center[2] - other.center[2],
          ),
        ),
    ),
  );
  assert.ok(
    Math.max(...distances) > Math.min(...distances) * 3,
    'unequal clustering',
  );
  assert.ok(new Set(list.map((r) => r.palette.join(','))).size >= 5);
  assert.equal(new Set(list.map((r) => Math.floor(r.seed) % 3)).size, 3);
});

catalogue.ensure(40000);
const comet = catalogue.bodies.find((b) => b.comet);
test('comet coma supports cameras inside its volume and shares fade/activity at all distances', () => {
  const effect = createComet(comet);
  effect.update(0, 1, false, 0);
  const coma = effect.group.children[1];
  assert.equal(coma.material.side, THREE.BackSide);
  const camera = new THREE.PerspectiveCamera(45, 1, comet.radius * 0.01, 10);
  effect.group.position.set(2, 3, 4);
  effect.group.updateMatrixWorld(true);
  for (const distance of [10, 8.001, 7.999, 3, 1.5]) {
    camera.position
      .copy(effect.group.position)
      .add(new THREE.Vector3(0, 0, comet.radius * distance));
    camera.updateMatrixWorld(true);
    coma.onBeforeRender(null, null, camera);
    assert.ok(
      Math.abs(
        coma.material.uniforms.uEye.value.length() / comet.radius - distance,
      ) < 1e-8,
    );
    assert.equal(coma.material.uniforms.uFade.value, 1);
    assert.ok(coma.material.uniforms.uActivity.value > 0);
  }
  const period = (2 * Math.PI) / (comet.orbit.speed * 0.065);
  assert.ok(period >= 80 && period < 600, 'visible artistic orbital period');
  effect.dispose();
});

test('both binary photospheres rotate about the common orbital normal', () => {
  const system = catalogue.systems.find((s) => s.binary);
  const parent = new THREE.Group(),
    lod = createBodyLOD(parent);
  const bodies = system.bodies.filter((b) => b.binary);
  const candidates = bodies.map((identity) => ({
    identity,
    position: new THREE.Vector3(),
    pixels: 250,
    distanceInRadii: 5,
  }));
  const normal = new THREE.Vector3(
    0,
    Math.cos(system.binary.inclination),
    -Math.sin(system.binary.inclination),
  );
  for (const spin of [0, 1, 10, 100]) {
    lod.update(candidates, spin, spin);
    for (const group of parent.children) {
      const mesh = group.children.find((o) => o.userData.bodyId !== undefined);
      assert.ok(mesh);
      const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(mesh.quaternion);
      assert.ok(axis.dot(normal) > 1 - 1e-10);
    }
  }
  lod.dispose();
});

test('a framed region eases into focus and lets go of it just as gradually', () => {
  const [region] = listNebulae();
  const parent = new THREE.Group();
  const manager = createRegionManager(parent);
  const c = candidate(region, 400);
  manager.update([c], 0, 0, 0);
  const { uFocus, uFade } = parent.children[0].children[0].material.uniforms;
  assert.equal(uFocus.value, 0);
  c.focused = true;
  const rise = [];
  let time = 0.1;
  for (; time < 3; time += 0.1) {
    manager.update([c], time, 0, 0);
    rise.push(uFocus.value);
  }
  // A cut would read as a HUD state change; the cloud has to come up to it.
  assert.ok(rise[0] > 0 && rise[0] < 0.4);
  assert.ok(rise.every((v, i) => i === 0 || v > rise[i - 1]));
  assert.ok(uFocus.value > 0.95);
  // Focus is a radiance lift, never an opacity one: the veil is unchanged.
  assert.equal(uFade.value, 1);
  c.focused = false;
  for (; time < 6; time += 0.1) manager.update([c], time, 0, 0);
  assert.equal(uFocus.value, 0);
  manager.dispose();
});

test('region focus brightens the volume and never thickens it', () => {
  const read = (path) =>
    readFileSync(new URL('../' + path, import.meta.url), 'utf8');
  assert.match(
    read('lib/phenomena/volume-shader.ts'),
    /uniform float [^;]*\buFocus\b/,
  );
  for (const path of [
    'lib/phenomena/nebula.ts',
    'lib/phenomena/supernova-remnant.ts',
  ]) {
    const source = read(path);
    assert.ok(source.includes('focusLift(colour / max(rawAlpha, 0.0001))'));
    // Raising the alpha of a framed cloud would turn the veil into a wall and
    // hide the stars behind it — the one thing the volumes must never do.
    assert.doesNotMatch(source, /float alpha = [^;]*uFocus/);
    assert.doesNotMatch(source, /rawAlpha[^;]*uFocus/);
  }
});

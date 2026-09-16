import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { catalogue } from '../lib/catalogue/runtime.ts';
import { listNebulae } from '../lib/catalogue/regions.ts';
import { createRegionManager } from '../lib/phenomena/region-manager.ts';
import { createComet } from '../lib/phenomena/comet.ts';
import {
  BLUE_NOISE_SIZE,
  blueNoiseRanks,
} from '../lib/phenomena/blue-noise.ts';
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
  const shared = read('lib/phenomena/volume-shader.ts');
  assert.match(shared, /uniform float [^;]*\buFocus\b/);
  // The one shared output lifts the light, and its alpha never sees the focus.
  assert.ok(shared.includes('focusLift(light * VOLUME_EXPOSURE)'));
  assert.doesNotMatch(shared, /alpha [*]?= [^;]*uFocus/);
  for (const path of [
    'lib/phenomena/nebula.ts',
    'lib/phenomena/supernova-remnant.ts',
  ]) {
    const source = read(path);
    assert.match(source, /volumeOutput\(colour, 1\.0 - transmittance, 0\.\d+\)/);
    // Raising the occlusion of a framed cloud would turn the veil into a wall
    // and hide the stars behind it — the one thing the volumes must never do.
    assert.doesNotMatch(source, /transmittance \*= [^;]*uFocus/);
  }
});

test('the march dither is blue noise: every rank once, early ranks spread apart', () => {
  const ranks = blueNoiseRanks();
  assert.equal(ranks.length, BLUE_NOISE_SIZE * BLUE_NOISE_SIZE);
  assert.equal(new Set(ranks).size, ranks.length);
  assert.ok(Math.min(...ranks) === 0 && Math.max(...ranks) === ranks.length - 1);
  // The first sixty-four ranks fill the tile evenly: no two of them touch,
  // across the wrap too, where white noise clumps within a few draws.
  const first = [];
  ranks.forEach((rank, i) => {
    if (rank < 64) first.push([i % BLUE_NOISE_SIZE, Math.floor(i / BLUE_NOISE_SIZE)]);
  });
  const wrap = (d) => Math.min(Math.abs(d), BLUE_NOISE_SIZE - Math.abs(d));
  let closest = Infinity;
  for (let a = 0; a < first.length; a++)
    for (let b = a + 1; b < first.length; b++)
      closest = Math.min(
        closest,
        Math.hypot(wrap(first[a][0] - first[b][0]), wrap(first[a][1] - first[b][1])),
      );
  assert.ok(closest >= 2.5, `closest early ranks ${closest}`);
  assert.deepEqual(blueNoiseRanks(), ranks);
});

test('volumes spend their samples where matter can be and dither with blue noise', () => {
  const read = (path) =>
    readFileSync(new URL('../' + path, import.meta.url), 'utf8');
  const nebula = read('lib/phenomena/nebula.ts');
  const remnant = read('lib/phenomena/supernova-remnant.ts');
  for (const source of [nebula, remnant]) {
    assert.ok(source.includes('marchDither() * dt'));
    assert.doesNotMatch(source, /hash13\(vec3\(gl_FragCoord/);
  }
  // The nebula marches its gas sphere, not the wider envelope.
  assert.ok(nebula.includes('sphereSpan(uEye, rd, GAS_RADIUS * uRadius, t0, t1)'));
  assert.ok(nebula.includes('1.-smoothstep(.86,1.04,length(q))'));
  // The remnant marches its shell band and skips the cavity.
  assert.ok(remnant.includes('sphereSpan(uEye, rd, SHELL_OUTER * uRadius, a0, a1)'));
  assert.ok(remnant.includes('sphereSpan(uEye, rd, SHELL_INNER * uRadius, b0, b1)'));
  // A sheet is never thinner than the step, and keeps its column.
  assert.ok(remnant.includes('float sheet = 0.055 / width;'));
});

test('a region impostor fades out once the eye is inside the volume', () => {
  const parent = new THREE.Group();
  const manager = createRegionManager(parent);
  const [region] = listNebulae();
  const alpha = (inside) => {
    manager.update(
      [{ region, position: new THREE.Vector3(...region.center), pixels: 900, inside, focused: false }],
      0,
      0,
      0,
    );
    return manager.impostorPoints.geometry.attributes.aAlpha.array[0];
  };
  assert.ok(alpha(0) > 0);
  assert.ok(alpha(0.5) < alpha(0));
  assert.equal(alpha(1), 0);
  manager.dispose();
});

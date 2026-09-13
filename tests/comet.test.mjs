import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { catalogue } from '../lib/catalogue/runtime.ts';
import { generateSystem } from '../lib/catalogue/generate.ts';
import {
  eccentricAnomaly,
  compileOrbitChain,
  orbitalOffset,
} from '../lib/orbits.ts';
import { systemBounds } from '../lib/system-framing.ts';
import { cometActivity, createComet } from '../lib/phenomena/comet.ts';
import { createPhenomenaManager } from '../lib/phenomena/manager.ts';

catalogue.ensure(20000);
const comets = catalogue.bodies.filter((b) => b.comet);
const position = (body, time) =>
  orbitalOffset(
    compileOrbitChain(body.id, (id) => catalogue.getBody(id)),
    0,
    time,
    new THREE.Vector3(),
  );

test('Kepler converges at maximum eccentricity including rapid periapsis passage', () => {
  for (const e of [0, 0.45, 0.8])
    for (let i = -1000; i <= 1000; i++) {
      const m = (i * Math.PI) / 1000;
      const a = eccentricAnomaly(m, e);
      const residual = Math.atan2(
        Math.sin(a - e * Math.sin(a) - m),
        Math.cos(a - e * Math.sin(a) - m),
      );
      assert.ok(Math.abs(residual) < 1e-12);
    }
});

test('comets consume reserved slots without compact hosts and match the 2% distribution', () => {
  let ordinary = 0,
    count = 0;
  for (let i = 0; i < 100000; i++) {
    const system = generateSystem(i, 0);
    const found = system.bodies.filter((b) => b.comet);
    const compact = ['pulsar', 'black-hole'].includes(system.architecture);
    if (!compact) ordinary++;
    assert.ok(found.length <= (compact ? 0 : 1));
    if (!found.length) continue;
    count++;
    assert.equal(system.bodies.at(-1).kind, 'comet');
    assert.ok(
      found[0].orbit.eccentricity >= 0.45 && found[0].orbit.eccentricity <= 0.8,
    );
    assert.ok(found[0].comet.periapsis >= (system.binary?.separation ?? 0) * 3);
  }
  assert.ok(
    Math.abs(count - ordinary * 0.02) < 6 * Math.sqrt(ordinary * 0.02 * 0.98),
  );
  assert.ok(catalogue.getPhenomena(10000).some((b) => b.comet));
});

test('framing contains apoapsis and tails; periapsis stays beyond the source envelope', () => {
  for (const body of comets) {
    const system = catalogue.getSystem(body.systemId);
    const bounds = systemBounds(
      system.binary ? null : system.rootId,
      system.bodies,
    );
    for (const phase of [0, 0.0001, Math.PI, Math.PI * 2]) {
      const time = (phase - body.orbit.phase) / body.orbit.speed;
      const pos = position(body, time);
      assert.ok(pos.length() + body.comet.envelope <= bounds.radius + 1e-6);
      assert.ok(pos.length() + body.comet.envelope <= system.envelope + 1e-6);
      if (phase === 0)
        assert.ok(Math.abs(pos.length() - body.comet.periapsis) < 1e-7);
    }
  }
});

test('tails point away from the star, fade with distance, pause, and only the nucleus picks', () => {
  const body = comets.find((b) => !catalogue.getSystem(b.systemId).binary);
  const renderer = createComet(body);
  const tail = renderer.group.children[2];
  const nucleus = renderer.group.children[0];
  nucleus.geometry.computeBoundingSphere();
  assert.ok(nucleus.geometry.boundingSphere.radius < body.radius * 1.5);
  for (const phase of [0, Math.PI / 2, Math.PI]) {
    const time = (phase - body.orbit.phase) / body.orbit.speed;
    renderer.update(10, 1, false, time);
    const direction = position(body, time).normalize();
    assert.ok(
      new THREE.Vector3(0, 1, 0)
        .applyQuaternion(tail.quaternion)
        .dot(direction) >
        1 - 1e-8,
    );
    const before = tail.quaternion.clone();
    renderer.update(100, 1, true, time);
    assert.ok(before.equals(tail.quaternion));
  }
  assert.ok(
    cometActivity(body.comet.periapsis, body.comet.periapsis) >
      cometActivity(body.orbit.radius * 1.8, body.comet.periapsis),
  );
  renderer.group.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(
    new THREE.Vector3(0, 0, body.radius * 5),
    new THREE.Vector3(0, 0, -1),
  );
  assert.equal(renderer.pick(ray)?.object.userData.bodyId, body.id);
  renderer.dispose();
});

test('comet cache respects the four effect slots and releases after four seconds', () => {
  const parent = new THREE.Group();
  const manager = createPhenomenaManager(parent);
  const candidates = comets.slice(0, 8).map((identity) => ({
    identity,
    position: new THREE.Vector3(),
    pixels: 100,
    distanceInRadii: 500,
  }));
  manager.update(candidates, 0, 0, false, 0);
  manager.update(candidates, 1, 1, false, 1);
  assert.equal(manager.stats().cached, 4);
  manager.update([], 6, 1, false, 1);
  assert.equal(manager.stats().cached, 0);
  assert.equal(parent.children.length, 0);
  manager.dispose();
});

test('a binary comet follows the moving primary for its antisolar direction', () => {
  const body = comets.find((b) => catalogue.getSystem(b.systemId).binary);
  assert.ok(body);
  const effect = createComet(body);
  const star = catalogue.getBody(body.rootId);
  for (const time of [0, 10, 100, 1000]) {
    effect.update(0, 1, false, time);
    const expected = position(body, time).sub(position(star, time)).normalize();
    const actual = new THREE.Vector3(0, 1, 0).applyQuaternion(
      effect.group.children[2].quaternion,
    );
    assert.ok(actual.dot(expected) > 1 - 1e-8);
  }
  effect.dispose();
});

test('dust trails orbital motion and the dark nucleus faces its illuminating star', () => {
  for (const body of comets.slice(0, 12)) {
    const effect = createComet(body);
    const star = catalogue.getBody(body.rootId);
    for (const time of [0, 17, 431]) {
      effect.update(0, 1, false, time);
      const relative = position(body, time).sub(position(star, time));
      const velocity = position(body, time + 0.001)
        .sub(position(star, time + 0.001))
        .sub(relative);
      const tail = effect.group.children[2];
      const dust = new THREE.Vector3(1, 0, 0).applyQuaternion(tail.quaternion);
      assert.ok(Math.abs(dust.dot(relative.clone().normalize())) < 1e-8);
      assert.ok(dust.dot(velocity) < 0, 'dust curves behind orbital motion');
      const sun = effect.group.children[0].material.uniforms.uSun.value;
      assert.ok(sun.dot(relative.clone().normalize()) < -1 + 1e-8);
      const orientation = tail.quaternion.clone();
      effect.update(500, 0.5, true, time);
      assert.ok(
        orientation.equals(tail.quaternion),
        'orientation has no frame history',
      );
      assert.equal(effect.group.children[0].material.uniforms.uFade.value, 0.5);
    }
    effect.dispose();
  }
});

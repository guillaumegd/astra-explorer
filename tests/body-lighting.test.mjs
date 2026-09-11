import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  createLocalLights,
  lightInView,
  mixLocalLights,
} from '../lib/body-lighting.ts';

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

const source = (x, y, z, power, color) => ({
  position: new THREE.Vector3(x, y, z),
  power,
  color: new THREE.Color(color),
});

test('a lone star renders exactly as it did before two sources existed', () => {
  const lights = createLocalLights();
  const [first, second] = mixLocalLights(
    new THREE.Vector3(),
    [source(3, 0, 0, 2, '#ff8040')],
    lights,
  );
  assert.equal(first.weight, 1);
  assert.equal(second.weight, 0);
  // The spare slot must never hold a zero vector: normalize(vec3(0)) is NaN.
  assert.ok(second.direction.equals(first.direction));
  assert.ok(second.direction.length() > 0.999);
  for (const tint of [first.tint, second.tint])
    assert.deepEqual([tint.r, tint.g, tint.b], [1, 1, 1]);
});

test('two sources share one unit of light, weighted by power and distance', () => {
  const lights = createLocalLights();
  const [first, second] = mixLocalLights(
    new THREE.Vector3(),
    [source(2, 0, 0, 1, '#ffffff'), source(-8, 0, 0, 1, '#ffffff')],
    lights,
  );
  assert.ok(Math.abs(first.weight + second.weight - 1) < 1e-12);
  assert.ok(first.weight > second.weight, 'the nearer star must dominate');
  for (const slot of [first, second])
    assert.ok(Math.abs(slot.direction.length() - 1) < 1e-12);
  // Tints are normalised to unit luminance, so only the contrast shows.
  const warm = mixLocalLights(
    new THREE.Vector3(),
    [source(2, 0, 0, 1, '#ff6020'), source(-2, 0, 0, 1, '#60a0ff')],
    createLocalLights(),
  );
  assert.ok(warm[0].tint.r > warm[0].tint.b);
  assert.ok(warm[1].tint.b > warm[1].tint.r);
});

test('a rotating pair never swaps slots nor steps the light', () => {
  const lights = createLocalLights();
  const target = new THREE.Vector3(0, 0, 0.6);
  let previous = null;
  for (let degree = 0; degree <= 360; degree++) {
    const angle = (degree * Math.PI) / 180;
    const a = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)),
      b = a.clone().multiplyScalar(-0.7);
    const [first, second] = mixLocalLights(
      target,
      [
        { position: a, power: 1, color: new THREE.Color('#ffffff') },
        { position: b, power: 0.7, color: new THREE.Color('#ffffff') },
      ],
      lights,
    );
    assert.ok(first.weight >= 0 && second.weight >= 0);
    assert.ok(Number.isFinite(first.weight) && Number.isFinite(second.weight));
    if (previous !== null) assert.ok(Math.abs(first.weight - previous) < 0.02);
    previous = first.weight;
  }
});

test('the distant impostor may keep aiming at the barycentre', () => {
  // It orients on the barycentre; the worst case is two equal masses, where the
  // dominant star sits one third of a separation away from a circumbinary world.
  for (const ratio of [1, 0.7, 0.4])
    for (let degree = 0; degree < 360; degree += 5) {
      const angle = (degree * Math.PI) / 180;
      const separation = 1,
        radiusA = (separation * ratio) / (1 + ratio);
      const star = new THREE.Vector3(
        Math.cos(angle) * radiusA,
        0,
        Math.sin(angle) * radiusA,
      );
      const planet = new THREE.Vector3(3 * separation, 0, 0);
      const toBarycentre = planet.clone().negate().normalize();
      const toStar = star.clone().sub(planet).normalize();
      assert.ok(toBarycentre.angleTo(toStar) < (20 * Math.PI) / 180);
    }
});

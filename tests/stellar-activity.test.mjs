import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  createStellarActivity,
  eruptionState,
  flareProfile,
  FLARE_DETAIL,
} from '../lib/stellar-activity.ts';

const STAR_KINDS = ['red-dwarf', 'giant-star', 'blue-star', 'white-dwarf'];

/** Event starts over a long window, all sites merged. */
function eruptionStarts(kind, seed = 42, span = 1800) {
  const starts = new Set();
  for (let t = 0; t < span; t += 0.25)
    for (let site = 0; site < 3; site++) {
      const state = eruptionState(t, seed, site, kind);
      if (state.age >= 0 && state.age < 0.25)
        starts.add(`${site}:${Math.round((t - state.age) * 100)}`);
    }
  return starts.size;
}

test('eruption events vary but remain reproducible across cache recreation', () => {
  const a = eruptionState(120, 42, 0);
  assert.deepEqual(eruptionState(120, 42, 0), a);
  const next = eruptionState(120 + flareProfile('red-dwarf').period, 42, 0);
  assert.notEqual(next.strength, a.strength);
  assert.notDeepEqual(next.axis, a.axis);
  for (let t = 0; t < 500; t++) {
    const state = eruptionState(t, 42, t % 3);
    assert.ok(state.strength >= 0.55 && state.strength <= 1);
    assert.ok(Number.isFinite(state.age));
    assert.ok(Math.abs(Math.hypot(...state.axis) - 1) < 1e-9);
    assert.ok(Math.abs(Math.hypot(...state.tangent) - 1) < 1e-9);
    // The arch lies in the surface: its orientation is tangent to the site.
    const dot = state.axis.reduce((sum, v, i) => sum + v * state.tangent[i], 0);
    assert.ok(Math.abs(dot) < 1e-9);
    // Eruptions keep to active latitudes, away from the poles.
    assert.ok(Math.abs(state.axis[1]) < Math.sin(0.62));
  }
});

test('an eruption never outlasts its own cycle', () => {
  for (const kind of STAR_KINDS)
    for (let t = 0; t < 900; t += 0.5)
      for (let site = 0; site < 3; site++) {
        const { age, duration } = eruptionState(t, 17, site, kind);
        const period = flareProfile(kind).period * (1 + site * 0.13);
        assert.ok(duration < period, `${kind} site ${site}`);
        assert.ok(age < period, `${kind} site ${site} at ${t}`);
      }
});

test('each star kind keeps its own eruption rhythm and scale', () => {
  const perMinute = Object.fromEntries(
    STAR_KINDS.map((kind) => [kind, eruptionStarts(kind) / 30]),
  );
  // One visible eruption every 15–30 s on average; quiet white dwarfs.
  assert.ok(perMinute['red-dwarf'] > 4 && perMinute['red-dwarf'] < 6);
  assert.ok(perMinute['giant-star'] > 2 && perMinute['giant-star'] < 3.5);
  assert.ok(perMinute['blue-star'] > 1.5 && perMinute['blue-star'] < 2.5);
  assert.ok(perMinute['white-dwarf'] < 1.2);
  assert.ok(
    flareProfile('giant-star').duration > flareProfile('red-dwarf').duration,
  );
  const span = (kind) => eruptionState(10, 42, 0, kind).span;
  assert.ok(span('giant-star') > span('red-dwarf'));
  assert.ok(span('white-dwarf') < span('red-dwarf'));
});

test('a quality level only changes draw ranges and shader switches', () => {
  const activity = createStellarActivity(42, '#ff9875', 'red-dwarf', 3);
  const children = [...activity.group.children];
  const drawCounts = () =>
    [...new Set(children.map((mesh) => mesh.geometry))].map(
      (geometry) => geometry.drawRange.count,
    );
  const full = drawCounts();
  activity.setDetail(0);
  assert.deepEqual(activity.group.children, children);
  const modest = drawCounts();
  assert.ok(modest.every((count, i) => count <= full[i]));
  assert.ok(modest.some((count, i) => count < full[i]));
  const rain = children.find((mesh) => mesh.isPoints);
  assert.equal(rain.geometry.drawRange.count, FLARE_DETAIL[0].rain);
  assert.equal(children[0].material.uniforms.uOctaves.value, 1);
  activity.setDetail(3);
  assert.deepEqual(drawCounts(), full);
  activity.dispose();
});

test('eruption layers are drawn only while their phase is lit', () => {
  const activity = createStellarActivity(42, '#ff9875', 'red-dwarf');
  const camera = new THREE.Vector3(0, 0, 4);
  // Find a quiet moment and an ejection on site 0.
  let quiet = null;
  let ejecting = null;
  for (let t = 0; t < 600 && (quiet === null || ejecting === null); t += 0.1) {
    const states = [0, 1, 2].map((site) => eruptionState(t, 42, site));
    const phases = states.map((s) => s.age / s.duration);
    if (quiet === null && phases.every((u) => u < 0 || u > 1)) quiet = t;
    if (ejecting === null && phases[0] > 0.5 && phases[0] < 0.6) ejecting = t;
  }
  activity.update(quiet, 1, 300, camera);
  const [corona, ...layers] = activity.group.children;
  assert.equal(corona.visible, true);
  assert.ok(layers.every((mesh) => !mesh.visible));
  activity.update(ejecting, 1, 300, camera);
  assert.ok(layers.filter((mesh) => mesh.visible).length >= 3);
  activity.dispose();
});

test('activity fades with distance and releases all GPU resources', () => {
  const activity = createStellarActivity(42, '#ff9875', 'red-dwarf');
  const camera = new THREE.Vector3(0, 0, 4);
  activity.update(120, 1, 200, camera);
  assert.equal(activity.group.visible, true);
  const geometries = new Set();
  const materials = new Set();
  for (const mesh of activity.group.children) {
    geometries.add(mesh.geometry);
    materials.add(mesh.material);
  }
  let disposed = 0;
  for (const resource of [...geometries, ...materials])
    resource.addEventListener('dispose', () => disposed++);
  activity.fadeOut(121, 2);
  assert.equal(activity.group.visible, false);
  activity.update(122, 1, 20, camera);
  assert.equal(activity.group.visible, false);
  activity.dispose();
  assert.equal(disposed, geometries.size + materials.size);
  // Geometry is shared by the three sites, never duplicated per event.
  assert.equal(geometries.size, 6);
});

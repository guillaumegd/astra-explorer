import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REFERENCE_SCENES,
  referencePose,
  summarize,
} from '../lib/reference-replay.ts';
import { RuntimeCatalogue } from '../lib/catalogue/runtime.ts';
test('versioned route contains valid stable destinations within each population', () => {
  const catalogue = new RuntimeCatalogue();
  assert.equal(catalogue.seed, 91724);
  assert.equal(
    new Set(REFERENCE_SCENES.map((s) => s.name)).size,
    REFERENCE_SCENES.length,
  );
  for (const scene of REFERENCE_SCENES) {
    const count = catalogue.activeCount(scene.density);
    if (scene.bodyId) {
      const body = catalogue.resolveReference(scene.bodyId);
      assert.ok(body && body.id < count);
    }
    if (scene.regionId)
      assert.ok(catalogue.resolveRegion(scene.regionId, scene.density));
  }
});
test('visual-fidelity reference set covers ice, ringed gas and both diffuse volume families', () => {
  const names = new Set(REFERENCE_SCENES.map((scene) => scene.name));
  for (const name of [
    'ice',
    'ringed-gas',
    // Each volume family is checked both crossed and at a distance, at the
    // same relative stand-off, so their apparent scales stay comparable.
    'nebula-crossing',
    'nebula-distant',
    'remnant',
    'remnant-distant',
  ])
    assert.ok(names.has(name), `missing visual reference scene: ${name}`);
});
test('reference pose depends only on scene and frame, preserves all fixed inputs', () => {
  const scene = REFERENCE_SCENES[0];
  assert.deepEqual(referencePose(scene, 0), {
    simulationTime: 12,
    rotation: 0.15,
    azimuth: 0,
    elevation: 0.62,
    distanceRatio: 29.4,
  });
  assert.equal(referencePose(scene, 180).simulationTime, 18);
  assert.deepEqual(referencePose(scene, 100), referencePose({ ...scene }, 100));
  assert.deepEqual(summarize([1, 2, 3, 200]), {
    count: 4,
    p50: 2,
    p95: 200,
    p99: 200,
    max: 200,
  });
});

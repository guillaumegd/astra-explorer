import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RuntimeCatalogue } from '../lib/catalogue/runtime.ts';
import { frameReach, withinFrame } from '../lib/frame-reach.ts';
import { lensingFragment } from '../lib/phenomena/lensing-shader.ts';

const catalogue = new RuntimeCatalogue();
catalogue.ensure(120000);
const holes = catalogue.bodies.filter((b) => b.kind === 'black-hole');

test('a black hole reaches the frame as far as its lens blends out', () => {
  // The same zone the composite fades over, in horizon radii.
  assert.ok(lensingFragment.includes('float zone=max(uOuter*2.,uJets*40.);'));
  assert.ok(holes.some((b) => b.phenomenon.jets));
  assert.ok(holes.some((b) => !b.phenomenon.jets));
  for (const hole of holes) {
    const zone = Math.max(
      (hole.phenomenon.diskOuter / hole.radius) * 2,
      hole.phenomenon.jets ? 40 : 0,
    );
    assert.ok(
      Math.abs(
        frameReach(hole, hole.phenomenon.envelope) - zone * hole.radius,
      ) < 1e-12,
    );
  }
  const planet = catalogue.bodies.find((b) => b.kind === 'desert-planet');
  assert.equal(frameReach(planet, planet.radius), planet.radius);
});

test('a lens stays in the frame until its whole reach has left it', () => {
  const hole = holes.find((b) => !b.phenomenon.jets);
  const reach = frameReach(hole, hole.phenomenon.envelope);
  const camera = new THREE.PerspectiveCamera(48, 1.6, 0.000001, 180);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  const elements = camera.projectionMatrix.elements;
  // Close enough that the lens radius covers a quarter of the frame height,
  // as when a planet sits next to its own black hole.
  const depth = (reach * elements[5]) / 0.5;
  const sample = (ndcX) => {
    const point = new THREE.Vector3(ndcX, 0, 0.5).unproject(camera);
    point.multiplyScalar(depth / -point.z);
    const ndc = point.clone().project(camera);
    return {
      old: Math.abs(ndc.x) < 1.2 && Math.abs(ndc.y) < 1.2 && ndc.z < 1,
      now: withinFrame(
        ndc,
        depth,
        point.length(),
        reach,
        camera.near,
        elements,
      ),
    };
  };
  // Centre just past the old limit, with the near side of the lens still on
  // screen: the old test had already dropped it, and its lens began to fade.
  const radius = (reach * elements[0]) / depth;
  assert.ok(1.25 - radius < 1);
  const past = sample(1.25);
  assert.equal(past.old, false);
  assert.equal(past.now, true);
  // Once the whole reach has cleared the same tolerance, it is gone.
  assert.equal(sample(1.2 + radius + 0.05).now, false);
  // In front of the camera only, unless the camera sits inside the reach.
  assert.equal(
    withinFrame(
      { x: 0, y: 0, z: 2 },
      -depth,
      depth,
      reach,
      camera.near,
      elements,
    ),
    false,
  );
  assert.equal(
    withinFrame(
      { x: 0, y: 0, z: 2 },
      -reach / 2,
      reach / 2,
      reach,
      camera.near,
      elements,
    ),
    true,
  );
});

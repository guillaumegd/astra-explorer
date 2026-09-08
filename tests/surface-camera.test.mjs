import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  desiredSurfaceTilt,
  surfaceCameraPose,
} from '../lib/surface-camera.ts';

test('surface camera gradually tilts and respects manual vertical mode', () => {
  assert.equal(desiredSurfaceTilt(2, null), 0);
  assert.equal(desiredSurfaceTilt(1.018, null), 60);
  assert.ok(
    desiredSurfaceTilt(1.4, null) > 0 && desiredSurfaceTilt(1.4, null) < 60,
  );
  assert.equal(desiredSurfaceTilt(1.018, 0), 0);
  assert.equal(desiredSurfaceTilt(1.018, 60), 60);
});
test('oblique camera stays outside the terrain envelope and has a fixed surface pivot', () => {
  for (const radius of [0.00001, 0.1, 1])
    for (const normal of [
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 1, 0),
    ]) {
      const center = new THREE.Vector3(3, 2, 1);
      const vertical = surfaceCameraPose(
        center,
        normal,
        radius,
        radius * 1.018,
        0,
      );
      assert.ok(
        Math.abs(vertical.position.distanceTo(center) - radius * 1.018) < 1e-12,
      );
      for (const angle of [20, 40, 60]) {
        const pose = surfaceCameraPose(
          center,
          normal,
          radius,
          radius * 1.018,
          angle,
        );
        assert.ok(pose.position.distanceTo(center) > radius * 1.016);
        assert.ok(pose.pivot.distanceTo(vertical.pivot) < 1e-12);
        assert.ok(Number.isFinite(pose.position.x));
      }
    }
});

test('positive inclination keeps the terrain upright and looks toward the horizon', () => {
  for (const normal of [
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, -1, 0),
    new THREE.Vector3(0, 0.7, 0.7).normalize(),
  ]) {
    for (const angle of [0, 20, 40, 60]) {
      const pose = surfaceCameraPose(
        new THREE.Vector3(),
        normal,
        1,
        1.03,
        angle,
      );
      const forward = pose.pivot.clone().sub(pose.position).normalize();
      assert.ok(Math.abs(forward.dot(pose.up)) < 1e-10);
      assert.ok(Math.abs(pose.up.length() - 1) < 1e-10);
      if (angle > 0) assert.ok(pose.up.dot(normal) > 0);
      const camera = new THREE.PerspectiveCamera();
      camera.position.copy(pose.position);
      camera.up.copy(pose.up);
      camera.lookAt(pose.pivot);
      camera.updateMatrixWorld();
      const screenUp = new THREE.Vector3(0, 1, 0).applyQuaternion(
        camera.quaternion,
      );
      assert.ok(screenUp.dot(pose.up) > 0.9999);
    }
  }
});

test('gas giant flyover remains outside its cloud envelope at every tilt', () => {
  for (const tilt of [0, 30, 60]) {
    const pose = surfaceCameraPose(
      new THREE.Vector3(),
      new THREE.Vector3(0, 0, 1),
      1,
      1.08,
      tilt,
      1.025,
    );
    assert.ok(pose.position.length() > 1.025);
    assert.ok(Math.abs(pose.pivot.length() - 1.025) < 1e-12);
    assert.ok(
      Math.abs(pose.up.dot(pose.pivot.clone().sub(pose.position).normalize())) <
        1e-12,
    );
  }
});

test('every body family reaches the requested tilt at its safe zoom limit', async () => {
  const { describeBody, minimumOrbitRatio } =
    await import('../lib/stellar-lod.ts');
  const kinds = new Set();
  for (let id = 0; id < 200; id++) {
    const body = describeBody(id);
    kinds.add(body.kind);
    const limit = minimumOrbitRatio(body);
    assert.equal(desiredSurfaceTilt(limit, null, limit), 60, body.kind);
    assert.equal(desiredSurfaceTilt(limit, 35, limit), 35, body.kind);
    assert.equal(desiredSurfaceTilt(limit, 0, limit), 0, body.kind);
    assert.equal(desiredSurfaceTilt(2, null, limit), 0, body.kind);
    const envelope = body.type === 0 || body.type === 2 ? 1.025 : 1.016;
    const pose = surfaceCameraPose(
      new THREE.Vector3(),
      new THREE.Vector3(0, 0, 1),
      1,
      limit,
      60,
      envelope,
    );
    assert.ok(pose.position.length() > envelope, body.kind);
  }
  assert.equal(kinds.size, 12);
});

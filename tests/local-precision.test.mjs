import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import {
  createLocalPrecision,
  LOCAL_SYSTEM_SLOTS,
  selectLocalSystems,
} from '../lib/local-precision.ts';
import { particlePosition, shearAngle } from '../lib/particle-motion.ts';
import { catalogue } from '../lib/catalogue/runtime.ts';
import { compileOrbitChain } from '../lib/orbits.ts';

const system = (rootId, x, envelope, size) => ({
  rootId,
  anchor: [x, 0, 0],
  envelope,
  bodies: Array.from({ length: size }, (_, i) => ({ id: rootId + i })),
});

test('nearest system bounds win the slots, the selected system first', () => {
  const systems = Array.from({ length: 40 }, (_, i) =>
    system(i * 10, i * 0.1, 0.01, 3),
  );
  const out = selectLocalSystems(systems.slice().reverse(), 0, 0, 0, 1e6, 350, []);
  assert.equal(out.length, LOCAL_SYSTEM_SLOTS);
  assert.equal(out[0].rootId, 350);
  assert.deepEqual(
    out.slice(1).map((s) => s.rootId),
    Array.from({ length: LOCAL_SYSTEM_SLOTS - 1 }, (_, i) => i * 10),
  );
  // A large envelope brings a farther system closer than its anchor.
  const wide = selectLocalSystems(
    [system(0, 0.5, 0.01, 1), system(10, 0.8, 0.5, 1)],
    0, 0, 0, 1e6, null, [],
  );
  assert.deepEqual(wide.map((s) => s.rootId), [10, 0]);
  // Systems beyond the drawn density are ignored.
  assert.deepEqual(
    selectLocalSystems([system(0, 0, 0, 2), system(10, 0.1, 0, 2)], 0, 0, 0, 5, null, [])
      .map((s) => s.rootId),
    [0],
  );
});

test('positions are written relative to the origin, slot by slot', () => {
  const precision = createLocalPrecision();
  const origin = new THREE.Vector3(8, 0.5, -3);
  const count = precision.update(
    [system(100, 0, 0, 3), system(40, 0, 0, 4)],
    origin,
    102,
    (id, out) => out.set(8 + id * 1e-6, 0.5, -3 - id * 1e-6),
  );
  const { uLocalSystems, uLocalCount, uLocalPositions, uOrigin } =
    precision.uniforms;
  assert.equal(count, 2);
  assert.equal(uLocalCount.value, 2);
  // Only the drawable prefix of the first system (ids 100 and 101).
  assert.deepEqual(uLocalSystems.value[0].toArray(), [100, 2, 0, 0]);
  assert.deepEqual(uLocalSystems.value[1].toArray(), [40, 4, 2, 0]);
  const data = uLocalPositions.value.image.data;
  assert.ok(Math.abs(data[4] - 101e-6) < 1e-10);
  assert.ok(Math.abs(data[5]) < 1e-10);
  assert.ok(Math.abs(data[3 * 4 + 2] + 41e-6) < 1e-10);
  const restore = precision.suspend();
  assert.equal(uLocalCount.value, 0);
  assert.deepEqual(uOrigin.value.toArray(), [0, 0, 0]);
  restore();
  assert.equal(uLocalCount.value, 2);
  assert.deepEqual(uOrigin.value.toArray(), [8, 0.5, -3]);
  precision.dispose();
});

test('a camera-relative float32 position holds a moon still where galactic float32 cannot', () => {
  catalogue.ensure(4000);
  let moon = null;
  for (let id = 0; id < 4000 && !moon; id++)
    if (catalogue.getBody(id).role === 'moon') moon = catalogue.getBody(id);
  const sys = catalogue.getSystem(moon.systemId);
  const positions = new Float32Array(sys.anchor),
    seeds = new Float32Array([sys.motionSeed]);
  const orbits = compileOrbitChain(moon.id, (i) => catalogue.getBody(i));
  const rotation = 3600 * 0.065; // one hour in the application
  const exact = particlePosition(positions, seeds, 0, rotation, 3600, new THREE.Vector3(), undefined, orbits);
  const camera = exact.clone().add(new THREE.Vector3(30 * moon.radius, 0, 0));

  const precision = createLocalPrecision();
  precision.update([system(moon.id, 0, 0, 1)], camera, Infinity, (_, out) =>
    out.copy(exact),
  );
  const [x, y, z] = precision.uniforms.uLocalPositions.value.image.data;
  const drift = new THREE.Vector3(x, y, z).add(camera).distanceTo(exact);
  assert.ok(drift < moon.radius * 1e-4, `camera-relative drift ${drift}`);

  // The GPU's galactic shear angle alone, in float32, is already off by
  // more than the moon's own radius at the same clock.
  const f = Math.fround;
  const [ax, , az] = sys.anchor;
  const angle = f(f(rotation) * f(shearAngle(ax, az, 1)));
  const shearError = Math.abs(angle - shearAngle(ax, az, rotation)) * Math.hypot(ax, az);
  assert.ok(shearError > moon.radius, `galactic float32 error ${shearError}`);
  precision.dispose();
});

test('every points pass of the galaxy uses the camera-relative path', () => {
  const galaxy = readFileSync(new URL('../lib/galaxy.ts', import.meta.url), 'utf8');
  const shader = galaxy.slice(galaxy.indexOf('const vertexShader'), galaxy.indexOf('const fragmentShader'));
  assert.ok(shader.indexOf('p = anchorToCamera(aId, p);') < shader.indexOf('modelViewMatrix * vec4(p'));
  assert.ok(galaxy.includes('const cameraAnchored = [stars, impostors, dust, pointDepth, pickPoints];'));
  const capture = galaxy.slice(galaxy.indexOf('const captureSky'), galaxy.indexOf('const pointDepthMaterial'));
  assert.ok(capture.includes('localPrecision.suspend()'));
  assert.ok(capture.includes('restorePrecision()'));
});

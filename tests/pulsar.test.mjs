import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { generateSystem } from '../lib/catalogue/generate.ts';
import { RuntimeCatalogue } from '../lib/catalogue/runtime.ts';
import { createPulsar, pulsarIntensity } from '../lib/phenomena/pulsar.ts';
import { createPhenomenaManager } from '../lib/phenomena/manager.ts';
import { minimumOrbitRatio } from '../lib/stellar-lod.ts';
import { framingDistance, systemBounds } from '../lib/system-framing.ts';

const catalogue = new RuntimeCatalogue();
const pulsars = catalogue
  .getPhenomena(10000)
  .filter((b) => b.kind === 'pulsar');
const body = pulsars[0];
const candidate = (identity) => ({
  identity,
  position: new THREE.Vector3(),
  pixels: 200,
  distanceInRadii: 40,
});

test('binary activation moves nothing else in the V2 baseline', () => {
  const shape = (o) =>
    o && {
      radius: o.radius,
      phase: o.phase,
      speed: o.speed,
      inclination: o.inclination,
    };
  const hash = createHash('sha256');
  let binaries = 0;
  for (let i = 0; i < 512; i++) {
    const s = generateSystem(i, i * 56);
    // Only what lot 5 is allowed to change is neutralised: the companion body,
    // the identifier it consumes, the compact index, and the orbital parenting
    // of binaries. Every planet of a binary still has to be bit-identical.
    const companion = s.architecture === 'binary' ? `${s.id}:body:001` : null;
    if (companion) binaries++;
    hash.update(
      JSON.stringify({
        id: s.id,
        anchor: s.anchor,
        reserved: s.reservedBodyIds.filter((r) => r !== companion),
        nodes: companion
          ? null
          : s.nodes.map((n) => ({
              id: n.id,
              parentId: n.parentId,
              bodyId: n.bodyId,
            })),
        bodies: s.bodies
          .filter((b) => b.bodyId !== companion)
          .map((b) => ({
            bodyId: b.bodyId,
            radius: b.radius,
            seed: b.seed,
            orbit: b.role === 'central' ? null : shape(b.orbit),
          })),
      }),
    );
  }
  // Fail loudly if the filters ever stop filtering anything.
  assert.equal(binaries, 25);
  // Captured from generateSystem at d44d924, before activating binaries.
  assert.equal(
    hash.digest('hex'),
    '6a3f67a8cb75975d7df4b598af6f419ce506fa35eb7129945bf8714609e485f8',
  );
});

test('binary geometry is frozen', () => {
  const hash = createHash('sha256');
  let binaries = 0;
  for (let i = 0; i < 512; i++) {
    const s = generateSystem(i, i * 56);
    if (s.architecture !== 'binary') continue;
    binaries++;
    hash.update(
      JSON.stringify({
        id: s.id,
        binary: s.binary,
        nodes: s.nodes,
        reserved: s.reservedBodyIds,
        bodies: s.bodies.map((b) => ({
          bodyId: b.bodyId,
          kind: b.kind,
          radius: b.radius,
          color: b.color,
          orbit: b.orbit,
          binary: b.binary,
        })),
      }),
    );
  }
  assert.equal(binaries, 25);
  // Captured from generateSystem once lot 5 activated the second source.
  assert.equal(
    hash.digest('hex'),
    '62b98582c583e58c07235565de469c65e6269b6168e07225b9ea15d8c4ad20a9',
  );
});

test('pulsars are discoverable at minimum density with safe observation and bounded envelopes', () => {
  assert.ok(pulsars.length > 0);
  for (const b of pulsars) {
    assert.equal(b.capabilities.renderClass, 'pulsar');
    assert.equal(b.capabilities.canSurfaceExplore, false);
    assert.equal(b.capabilities.hasSolidSurface, false);
    assert.equal(b.capabilities.emitsLight, true);
    assert.ok(b.pulsar.period >= 4 && b.pulsar.period <= 10);
    assert.ok(minimumOrbitRatio(b) * b.radius >= b.radius * 3);
    const members = catalogue.getSystemMembers(b.systemId);
    assert.ok(systemBounds(b.id, members).radius >= b.pulsar.envelope);
    for (const companion of members.filter((c) => c.parentId === b.id))
      assert.ok(companion.orbit.radius > b.pulsar.envelope * 1.5);
    for (const aspect of [1440 / 900, 390 / 844])
      assert.ok(
        framingDistance(b.pulsar.envelope, aspect) > b.pulsar.exclusion,
      );
  }
});

test('beam rotation is periodic, freezes with simulation time, and is fixed in reduced motion', () => {
  const effect = createPulsar(body);
  const rotor = effect.group.children[0];
  effect.update(2, 1);
  const before = rotor.quaternion.clone();
  effect.update(2, 0.5);
  assert.ok(before.angleTo(rotor.quaternion) < 1e-7);
  effect.update(2 + body.pulsar.period, 1);
  assert.ok(before.angleTo(rotor.quaternion) < 1e-7);
  effect.update(2 + body.pulsar.period / 4, 1);
  assert.ok(before.angleTo(rotor.quaternion) > 1);
  effect.update(2, 1, true);
  const reduced = rotor.quaternion.clone();
  effect.update(500, 1, true);
  assert.ok(reduced.angleTo(rotor.quaternion) < 1e-7);
  assert.equal(effect.pulse(), 0.5);
  for (let i = -100; i <= 100; i++) {
    const a = i / 100;
    assert.ok(pulsarIntensity(a) >= 0 && pulsarIntensity(a) <= 1);
    assert.equal(pulsarIntensity(a), pulsarIntensity(-a));
    assert.equal(pulsarIntensity(a, true), 0.5);
    if (i < 100)
      assert.ok(
        Math.abs(pulsarIntensity(a + 0.01) - pulsarIntensity(a)) < 0.11,
      );
  }
  effect.dispose();
});

test('pulsar core picking, beam bounds and disposal are independent of viewing angle', () => {
  const effect = createPulsar(body);
  effect.update(3, 1);
  effect.group.updateMatrixWorld(true);
  const resources = new Set();
  effect.group.traverse((obj) => {
    if (!obj.isMesh) return;
    resources.add(obj.geometry);
    resources.add(obj.material);
    const positions = obj.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      const point = new THREE.Vector3()
        .fromBufferAttribute(positions, i)
        .applyMatrix4(obj.matrixWorld);
      assert.ok(point.length() <= body.pulsar.envelope * 1.0001);
    }
  });
  for (const direction of [
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(1, 1, 1).normalize(),
  ]) {
    const hit = effect.pick(
      new THREE.Raycaster(
        direction.clone().multiplyScalar(0.1),
        direction.clone().negate(),
      ),
    );
    assert.equal(hit.object.userData.bodyId, body.id);
  }
  const magnetic = effect.group.children[0].children[0];
  const beamOrigin = new THREE.Vector3(0, body.radius * 5, 0.1).applyMatrix4(
    magnetic.matrixWorld,
  );
  const beamDirection = new THREE.Vector3(0, 0, -1).transformDirection(
    magnetic.matrixWorld,
  );
  assert.equal(
    effect.pick(new THREE.Raycaster(beamOrigin, beamDirection)),
    null,
    'decorative beams do not select the core',
  );
  let disposed = 0;
  for (const resource of resources)
    resource.addEventListener('dispose', () => disposed++);
  effect.dispose();
  assert.equal(disposed, resources.size);
});

test('mixed special cache reserves lensing for black holes and expires while paused', () => {
  const parent = new THREE.Group();
  const manager = createPhenomenaManager(parent);
  assert.equal(manager.detailThreshold(body.id), 6);
  manager.update([candidate(body)], 0, 10);
  assert.equal(manager.detailThreshold(body.id), 4.8);
  manager.update([candidate(body)], 0.1, 10);
  assert.equal(manager.lensSubject(), null);
  const hole = catalogue.getBody(0);
  manager.update([candidate(body), candidate(hole)], 0.2, 10);
  assert.equal(manager.lensSubject().body.kind, 'black-hole');
  const destinations = catalogue.getPhenomena(120000);
  for (let i = 0; i < 30; i++) {
    manager.update([candidate(destinations[i])], 1 + i * 0.1, 10);
    assert.ok(manager.stats().cached <= 4);
  }
  manager.update([], 9, 10);
  assert.equal(manager.stats().cached, 0);
  assert.equal(manager.detailThreshold(body.id), 6);
  assert.equal(manager.lensSubject(), null);
  assert.equal(parent.children.length, 0);
  manager.dispose();
});

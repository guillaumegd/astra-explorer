import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { generateSystem } from '../lib/catalogue/generate.ts';
import { catalogue, describeBody } from '../lib/catalogue/runtime.ts';
import {
  compileOrbitChain,
  orbitalOffset,
  ORBIT_DEPTH,
} from '../lib/orbits.ts';
import { particlePosition } from '../lib/particle-motion.ts';
import {
  framingDistance,
  localSystemRoot,
  systemBounds,
} from '../lib/system-framing.ts';
import { createBodyLOD, minimumOrbitRatio } from '../lib/stellar-lod.ts';
import {
  createLocalLights,
  mixLocalLights,
} from '../lib/body-lighting.ts';
import {
  BINARY_SEPARATION_LIMIT,
  BINARY_SEPARATION_SPAN,
} from '../lib/catalogue/config.ts';

catalogue.ensure(40000);
const binaries = catalogue.systems.filter((s) => s.architecture === 'binary');
const offset = (body, time) =>
  orbitalOffset(
    compileOrbitChain(body.id, describeBody),
    0,
    time,
    new THREE.Vector3(),
  );
const times = [0, 0.7, 3.3, 41, 500, 1000];

test('the two components stay opposed through the barycentre', () => {
  assert.ok(binaries.length > 20);
  for (const system of binaries.slice(0, 200)) {
    const [a, b] = system.bodies;
    const { separation, masses } = system.binary;
    for (const time of times) {
      const pa = offset(a, time),
        pb = offset(b, time);
      // Colinear with the origin, which is the barycentre itself.
      const cross = pa.clone().cross(pb).length() / separation ** 2;
      assert.ok(cross < 1e-6, `alignment ${cross}`);
      assert.ok(pa.dot(pb) < 0, 'components must sit on opposite sides');
      assert.ok(
        Math.abs(pa.distanceTo(pb) - separation) / separation < 1e-6,
        'separation must stay constant',
      );
      // Artistic masses balance around the origin.
      assert.ok(
        Math.abs(masses[0] * pa.length() - masses[1] * pb.length()) /
          separation <
          1e-6,
      );
    }
  }
});

test('a circumbinary chain adds no orbital depth and never reaches a star', () => {
  let moons = 0;
  for (const system of binaries.slice(0, 400)) {
    const { separation } = system.binary;
    for (const body of system.bodies) {
      const chain = compileOrbitChain(body.id, describeBody);
      let levels = 0;
      for (let level = 0; level < ORBIT_DEPTH; level++)
        if (chain[level * 4] !== 0) levels = level + 1;
      assert.ok(levels <= 2, `depth ${levels}`);
      if (body.role === 'moon') moons++;
      if (body.role !== 'planet' && body.role !== 'asteroid') continue;
      assert.equal(body.parentId, null);
      assert.ok(body.orbit.radius >= 3 * separation);
      // Three separations from the barycentre is two from either component.
      for (const time of times)
        for (const star of system.bodies.slice(0, 2))
          assert.ok(
            offset(body, time).distanceTo(offset(star, time)) >=
              2 * separation - 1e-9,
          );
    }
  }
  assert.ok(moons > 0, 'the sample must cover moons of binaries');
});

test('separation is readable and always leaves the first orbit clear', () => {
  let smallest = Infinity;
  for (let i = 0; i < 100000; i++) {
    const system = generateSystem(i, 0);
    if (system.architecture !== 'binary') continue;
    const [a, b] = system.bodies;
    const { separation } = system.binary;
    const ratio = separation / (a.radius + b.radius);
    smallest = Math.min(smallest, ratio);
    assert.ok(ratio <= BINARY_SEPARATION_SPAN[1] + 1e-9);
    assert.ok(separation <= 0.025 * BINARY_SEPARATION_LIMIT + 1e-9);
    const first = system.bodies.find(
      (x) => x.orbit && x.parentId === null && x.role !== 'central',
    );
    if (first) assert.ok(3 * separation <= first.orbit.radius + 1e-9);
  }
  // Worst mixture is a white dwarf beside a giant, where the clip bites hardest.
  assert.ok(smallest > 5, `closest pair sits at ${smallest} combined radii`);
});

test('CPU motion matches the shader summation at every sampled time', () => {
  const positions = new Float32Array(3),
    seeds = new Float32Array(1);
  const orbitPosition = (data, level, time) => {
    const r = data[level * 4];
    if (r === 0) return new THREE.Vector3();
    const angle = data[level * 4 + 1] + time * data[level * 4 + 2],
      tilt = data[level * 4 + 3];
    return new THREE.Vector3(
      Math.cos(angle) * r,
      Math.sin(angle) * r * Math.sin(tilt),
      Math.sin(angle) * r * Math.cos(tilt),
    );
  };
  for (const system of binaries.slice(0, 60))
    for (const body of system.bodies) {
      const chain = compileOrbitChain(body.id, describeBody);
      for (const time of times) {
        const shader = new THREE.Vector3();
        for (let level = 0; level < ORBIT_DEPTH; level++)
          shader.add(orbitPosition(chain, level, time));
        const cpu = orbitalOffset(chain, 0, time, new THREE.Vector3());
        assert.ok(shader.distanceTo(cpu) < 1e-12);
      }
    }
  // The base position of the root is the barycentre: no orbital offset at all.
  const system = binaries[0];
  const chain = compileOrbitChain(system.bodies[0].id, describeBody);
  const base = particlePosition(
    positions,
    seeds,
    0,
    0.4,
    2,
    new THREE.Vector3(),
  );
  const full = particlePosition(
    positions,
    seeds,
    0,
    0.4,
    2,
    new THREE.Vector3(),
    undefined,
    chain,
  );
  assert.ok(
    full
      .clone()
      .sub(base)
      .distanceTo(orbitalOffset(chain, 0, 0.4, new THREE.Vector3())) < 1e-12,
  );
});

test('barycentric framing holds every member at every phase and aspect', () => {
  for (const system of binaries.slice(0, 60)) {
    const members = system.bodies;
    const bounds = systemBounds(null, members);
    assert.equal(bounds.members.length, members.length);
    for (const time of times)
      for (const body of members)
        assert.ok(
          offset(body, time).length() + body.radius <= bounds.radius + 1e-7,
          'a member left the framed radius',
        );
    // Landscape and portrait both have to clear the camera exclusion.
    for (const aspect of [1440 / 900, 390 / 844]) {
      const distance = framingDistance(bounds.radius, aspect);
      for (const star of members.slice(0, 2))
        assert.ok(distance > star.radius * minimumOrbitRatio(star));
    }
  }
});

test('the barycentre is a marker, never a body', () => {
  for (const system of binaries.slice(0, 200)) {
    const root = system.nodes.find((n) => n.id === system.orbitalRootId);
    assert.equal(root.bodyId, null);
    assert.equal(root.parentId, null);
    assert.ok(!system.bodies.some((b) => b.bodyId === system.orbitalRootId));
    // It never inflates the density either.
    assert.equal(
      system.bodies.length,
      new Set(system.bodies.map((b) => b.bodyId)).size,
    );
  }
});

test('local framing survives planets that have no parent body', () => {
  let checked = 0;
  for (const system of binaries) {
    const members = system.bodies;
    for (const star of members.slice(0, 2))
      assert.equal(localSystemRoot(star, members), null);
    for (const planet of members.filter((b) => b.role === 'planet'))
      if (members.some((m) => m.parentId === planet.id)) {
        assert.equal(localSystemRoot(planet, members), planet.id);
        checked++;
      }
    if (checked > 30) break;
  }
  assert.ok(checked > 0, 'the sample must cover a binary planet with moons');
});

test('the ocean and air shells read the same two light slots as the ground', () => {
  const body = catalogue.bodies.slice(0, 400).find((b) => b.type === 4);
  const parent = new THREE.Group(),
    lod = createBodyLOD(parent);
  const lights = mixLocalLights(
    new THREE.Vector3(),
    [
      { position: new THREE.Vector3(2, 0, 0), power: 1, color: new THREE.Color('#ff6020') },
      { position: new THREE.Vector3(-3, 0, 0), power: 1, color: new THREE.Color('#60a0ff') },
    ],
    createLocalLights(),
  );
  lod.update(
    [
      {
        identity: body,
        position: new THREE.Vector3(),
        pixels: 200,
        distanceInRadii: 5,
        lights,
      },
    ],
    0,
    0,
  );
  const shells = parent.children[0].children.filter((c) => c.material?.uniforms);
  const ground = shells.find((c) => c.material.uniforms.uRelief);
  assert.ok(ground, 'the terrain shell must exist');
  const mix = ground.material.uniforms.uLightMix.value;
  assert.ok(Math.abs(mix.x - lights[0].weight) < 1e-12);
  assert.ok(Math.abs(mix.x + mix.y - 1) < 1e-12);
  // Shared by reference, so the shells can never drift apart across a frame.
  for (const shell of shells)
    for (const name of [
      'uLightDirection',
      'uLightDirection2',
      'uLightMix',
      'uLightColor1',
      'uLightColor2',
    ]) {
      assert.ok(shell.material.uniforms[name], `${name} missing`);
      assert.equal(
        shell.material.uniforms[name].value,
        ground.material.uniforms[name].value,
      );
      assert.ok(
        shell.material.fragmentShader.includes('localLight(') ||
          shell.material.fragmentShader.includes('localTint('),
        'a shell declares the slots without using them',
      );
    }
  lod.dispose();
});

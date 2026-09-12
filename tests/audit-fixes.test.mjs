import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { RuntimeCatalogue } from '../lib/catalogue/runtime.ts';
import {
  animatedRegionCenter,
  regionZoomDistance,
  resizeRegionDistance,
} from '../lib/region-navigation.ts';
import { particlePosition } from '../lib/particle-motion.ts';
import { regionPresence } from '../lib/ambience-parameters.ts';
import { framingDistance } from '../lib/system-framing.ts';
import { createQualityPolicy } from '../lib/quality-policy.ts';
import { createRegionManager } from '../lib/phenomena/region-manager.ts';

const cat = new RuntimeCatalogue();
const count = cat.activeCount(120000);
const positions = new Float32Array(count * 3),
  seeds = new Float32Array(count);
for (const r of cat.getRemnants(120000)) {
  const system = cat.getSystem(r.hostSystem);
  positions.set(system.anchor, r.hostBodyId * 3);
  seeds[r.hostBodyId] = system.motionSeed;
}
const list = [...cat.listNebulae(), ...cat.getRemnants(120000)];
test('all moving regions have coherent interior and boundary; remnants exactly follow hosts', () => {
  for (const r of list)
    for (const rotation of [0, 3.9, 7.8, 39, 120]) {
      const center = animatedRegionCenter(
        r,
        positions,
        seeds,
        rotation,
        rotation / 0.065,
        new THREE.Vector3(),
      );
      if (r.hostBodyId !== undefined)
        assert.deepEqual(
          center,
          particlePosition(
            positions,
            seeds,
            r.hostBodyId,
            rotation,
            rotation / 0.065,
            new THREE.Vector3(),
          ),
        );
      for (const scale of [0.7, 1.08, 1.2]) {
        const eye = center
          .clone()
          .add(new THREE.Vector3(r.radius * scale, 0, 0));
        const presence = regionPresence(eye.distanceTo(center), r.radius);
        if (scale < 1) assert.ok(presence > 0.4);
        else assert.ok(presence < 1e-10);
      }
    }
});
test('all regions zoom monotonically inside and back outside in portrait and landscape', () => {
  for (const r of list)
    for (const aspect of [1.6, 390 / 844]) {
      let distance = framingDistance(r.envelope, aspect);
      for (let i = 0; i < 40; i++) {
        const next = regionZoomDistance(distance, 1.2, r.envelope);
        assert.ok(next <= distance);
        distance = next;
      }
      assert.ok(distance < r.envelope);
      for (let i = 0; i < 50; i++)
        distance = regionZoomDistance(distance, 1 / 1.2, r.envelope);
      assert.ok(distance > r.envelope);
    }
});
test('quality descends resolution then steps and recovers steps then all resolution', () => {
  const q = createQualityPolicy(1.75),
    changes = [];
  for (let i = 0; i < 900; i++)
    if (q.update(50)) changes.push([q.dpr, q.steps]);
  assert.deepEqual(changes, [
    [1.55, 16],
    [1.35, 16],
    [1.15, 16],
    [0.95, 16],
    [0.8, 16],
    [0.8, 8],
    [0.8, 4],
  ]);
  for (let i = 0; i < 179; i++) q.update(25);
  assert.equal(q.steps, 4);
  q.update(25);
  assert.equal(q.steps, 8);
  for (let i = 0; i < 180 * 6; i++) q.update(25);
  assert.equal(q.steps, 16);
  assert.equal(q.dpr, 1.75);
  for (let i = 0; i < 1000; i++) q.update(i % 2 ? 35 : 40);
  assert.equal(q.dpr, 1.75);
});
test('replacing a visible region waits for fade-out and never exceeds two slots', () => {
  const parent = new THREE.Group(),
    manager = createRegionManager(parent);
  const c = (r) => ({
    region: r,
    position: new THREE.Vector3(),
    pixels: 200,
    inside: 0,
    focused: false,
  });
  let time = 0;
  for (; time < 2; time += 0.05)
    manager.update(list.slice(0, 2).map(c), time, 0, 0);
  const outgoing = parent.children[0];
  manager.update(list.slice(2, 4).map(c), time, 0, 0);
  assert.ok(parent.children.includes(outgoing));
  assert.ok(outgoing.children[0].material.uniforms.uFade.value > 0.5);
  for (; time < 6; time += 0.05) {
    manager.update(list.slice(2, 4).map(c), time, 0, 0);
    assert.ok(manager.stats().cached <= 2);
  }
  assert.ok(!parent.children.includes(outgoing));
  manager.dispose();
  assert.equal(parent.children.length, 0);
});
// Execute the production configure branch with renderer stubs, not a duplicate policy.
const source = readFileSync(
  new URL('../lib/galaxy.ts', import.meta.url),
  'utf8',
);
const configureCode = source.slice(
  source.indexOf('      const densityChanged ='),
  source.indexOf('\n    setOpeningProgress'),
);
// Trusted repository source: exercise the actual integration branch with inert renderer stubs.
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const configure = new Function(
  'catalogue',
  'settings',
  'selected',
  'framed',
  'regionFocus',
  'next',
  'geometry',
  'lensing',
  'dustGeometry',
  'dustCount',
  'targetInner',
  'targetOuter',
  'palettes',
  `let calls=[]; const overview=()=>calls.push('overview'); const frameSystem=s=>calls.push(s); ${configureCode.replace(/\n    },\s*$/, '')} return {calls,regionFocus};`,
);
const stubs = [
  { setDrawRange() {} },
  { invalidate() {} },
  { setDrawRange() {} },
  0,
  { set() {} },
  { set() {} },
  [['', '']],
];
test('configure preserves binary scope and ignores equivalent normalized budgets', () => {
  const binary = cat.getBinaries(65000)[0];
  for (const density of [65000, 120000]) {
    const result = configure(
      cat,
      { density: cat.activeCount(65000) },
      binary,
      { scope: 'stellar' },
      null,
      { density, palette: 0 },
      ...stubs,
    );
    assert.deepEqual(result.calls, density === 65000 ? [] : ['stellar']);
  }
});
test('configure resolves region identity and exits when its host is disabled', () => {
  const low = cat.activeCount(10000),
    r = cat.getRemnants(120000).find((r) => r.hostBodyId >= low);
  const result = configure(
    cat,
    { density: count },
    null,
    null,
    r,
    { density: 10000, palette: 0 },
    ...stubs,
  );
  assert.equal(result.regionFocus, null);
  assert.deepEqual(result.calls, ['overview']);
  const survivor = cat.getRemnants(10000)[0];
  const kept = configure(
    cat,
    { density: low },
    null,
    null,
    survivor,
    { density: 120000, palette: 0 },
    ...stubs,
  );
  assert.equal(kept.regionFocus.regionId, survivor.regionId);
  assert.deepEqual(kept.calls, []);
});

test('region notifications distinguish entry, framing changes and occupied overlaps', () => {
  const block = source.slice(
    source.indexOf('    const activeRegion = regionFocus'),
    source.indexOf(
      '    host.dataset.phenomena',
      source.indexOf('    const activeRegion = regionFocus'),
    ),
  );
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const report = new Function(
    'regionFocus',
    'insideRegion',
    'insidePresence',
    'regionCandidates',
    'reportedRegion',
    'onRegion',
    block + '\nreturn reportedRegion;',
  );
  const r = list[0],
    other = list[1],
    calls = [];
  let previous = '';
  const run = (focus, occupied, presence, focusedPresence) => {
    previous = report(
      focus,
      occupied,
      presence,
      [{ region: r, inside: focusedPresence }],
      previous,
      (v) => calls.push(v),
    );
  };
  run(r, null, 0, 0);
  run(r, r, 0.5, 0.5);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].inside, 0.5);
  run(null, r, 0.5, 0.5);
  assert.equal(calls[2].framed, false);
  run(r, other, 1, 0);
  assert.equal(calls[3].inside, 0);
  assert.equal(calls[3].occupied.regionId, other.regionId);
  run(r, other, 1, 0);
  assert.equal(calls.length, 4);
  run(null, null, 0, 0);
  assert.equal(calls.at(-1), null);
});

test('region resize preserves interior zoom and fits an exterior framing in portrait', () => {
  for (const r of list) {
    const before = framingDistance(r.envelope, 1.6);
    const portrait = resizeRegionDistance(before, r.envelope, 1.6, 390 / 844);
    assert.ok(
      Math.abs(portrait - framingDistance(r.envelope, 390 / 844)) < 1e-10,
    );
    assert.equal(
      resizeRegionDistance(r.envelope * 0.5, r.envelope, 1.6, 390 / 844),
      r.envelope * 0.5,
    );
    assert.ok(
      resizeRegionDistance(r.envelope * 1.1, r.envelope, 390 / 844, 1.6) >
        r.envelope,
    );
  }
});

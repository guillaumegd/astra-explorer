import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogue } from '../lib/catalogue/runtime.ts';
import {
  DISCOVERIES_STORAGE_KEY,
  bodyDiscoveryKey,
  isRevealAll,
  loadDiscoveries,
  regionDiscoveryKey,
  saveDiscoveries,
} from '../lib/discoveries.ts';

catalogue.ensure(65000);

const memory = () => {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
  };
};

test('phenomena are keyed by their persistent identity, ordinary sky is not', () => {
  const [blackHole] = catalogue.getPhenomena(65000);
  assert.equal(
    bodyDiscoveryKey(blackHole, catalogue.getSystem(blackHole.systemId)),
    `body:${blackHole.bodyId}`,
  );
  const ordinary = catalogue.bodies.find(
    (b) =>
      b.capabilities.renderClass === 'ordinary' &&
      catalogue.getSystem(b.systemId).architecture === 'single',
  );
  assert.equal(
    bodyDiscoveryKey(ordinary, catalogue.getSystem(ordinary.systemId)),
    null,
  );
});

test('both stars of a double share the notebook entry, their planets do not', () => {
  const [root] = catalogue.getBinaries(65000);
  const system = catalogue.getSystem(root.systemId);
  const companion = catalogue.getBody(root.binary.companionId);
  assert.equal(bodyDiscoveryKey(root, system), `body:${root.bodyId}`);
  assert.equal(bodyDiscoveryKey(companion, system), `body:${root.bodyId}`);
  const planet = system.bodies.find((b) => b.role === 'planet');
  if (planet) assert.equal(bodyDiscoveryKey(planet, system), null);
});

test('discoveries round-trip through storage and survive bad data', () => {
  const storage = memory();
  const [nebula] = catalogue.listNebulae();
  saveDiscoveries(new Set([regionDiscoveryKey(nebula), 'body:x']), storage);
  assert.deepEqual(
    [...loadDiscoveries(storage)],
    [`region:${nebula.regionId}`, 'body:x'],
  );
  storage.setItem(DISCOVERIES_STORAGE_KEY, '{not json');
  assert.equal(loadDiscoveries(storage).size, 0);
  storage.setItem(DISCOVERIES_STORAGE_KEY, '["a", 3, null]');
  assert.deepEqual([...loadDiscoveries(storage)], ['a']);
  assert.equal(loadDiscoveries(null).size, 0);
});

test('a storage that throws never breaks the notebook', () => {
  const hostile = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
  };
  assert.equal(loadDiscoveries(hostile).size, 0);
  assert.doesNotThrow(() => saveDiscoveries(new Set(['a']), hostile));
});

test('?reveal lists the whole catalogue', () => {
  assert.equal(isRevealAll('?reveal'), true);
  assert.equal(isRevealAll('?diagnostics=1&reveal=1'), true);
  assert.equal(isRevealAll(''), false);
});

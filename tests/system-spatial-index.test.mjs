import test from 'node:test';
import assert from 'node:assert/strict';
import { createSystemSpatialIndex } from '../lib/system-spatial-index.ts';

test('system index is incremental and includes every member covered by an envelope', () => {
  const index = createSystemSpatialIndex(1);
  const systems = [
    { rootId: 0, anchor: [0, 0, 0], envelope: 0.4, bodies: [{ id: 0 }, { id: 1 }] },
    { rootId: 2, anchor: [3, 0, 0], envelope: 1, bodies: [{ id: 2 }, { id: 3 }] },
  ];
  index.sync(systems.slice(0, 1));
  const out = [];
  assert.deepEqual(index.near(0.7, 0, 0, 0.35, 4, out), [0, 1]);
  index.sync(systems);
  assert.deepEqual(index.near(2, 0, 0, 0.1, 3, out), [2]);
  assert.deepEqual(index.stats(), { systems: 2, cells: 35 });
});

test('system index returns whole systems for camera-relative precision', () => {
  const index = createSystemSpatialIndex(1);
  const systems = [
    { rootId: 0, anchor: [0, 0, 0], envelope: 0.4, bodies: [{ id: 0 }, { id: 1 }] },
    { rootId: 2, anchor: [3, 0, 0], envelope: 1, bodies: [{ id: 2 }, { id: 3 }] },
  ];
  index.sync(systems);
  const out = [];
  assert.deepEqual(index.systemsNear(0.7, 0, 0, 0.35, out), [systems[0]]);
  assert.deepEqual(
    index.systemsNear(1.3, 0, 0, 1, out).map((s) => s.rootId).sort((a, b) => a - b),
    [0, 2],
  );
  // `near` keeps its own scratch list: the caller's array is not clobbered.
  index.near(3, 0, 0, 0.1, 4, []);
  assert.equal(out.length, 2);
});

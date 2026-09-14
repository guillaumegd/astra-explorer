import test from 'node:test';
import assert from 'node:assert/strict';
import { createGpuDiagnostics } from '../lib/gpu-diagnostics.ts';
function fixture(supported = true) {
  let available = false,
    disjoint = false,
    active = null,
    deleted = 0;
  const gl = {
    CURRENT_QUERY: 1,
    QUERY_RESULT_AVAILABLE: 2,
    QUERY_RESULT: 3,
    getExtension: () =>
      supported ? { TIME_ELAPSED_EXT: 4, GPU_DISJOINT_EXT: 5 } : null,
    isContextLost: () => false,
    getParameter: () => disjoint,
    getQuery: () => active,
    createQuery: () => ({}),
    beginQuery: (_target, query) => {
      assert.equal(active, null);
      active = query;
    },
    endQuery: () => {
      active = null;
    },
    deleteQuery: () => deleted++,
    getQueryParameter: (_query, key) => {
      if (key === 2) return available;
      assert.ok(available);
      return 2e6;
    },
  };
  const events = [];
  const probe = createGpuDiagnostics(gl, (kind, at, values) =>
    events.push({ kind, at, ...values }),
  );
  return {
    probe,
    events,
    ready: () => {
      available = true;
    },
    disjoint: () => {
      disjoint = true;
    },
    deleted: () => deleted,
  };
}
test('GPU frame waits for all non-overlapping passes and sums their GPU durations', () => {
  const f = fixture();
  let external = 0;
  f.probe.startFrame(7);
  f.probe.measure(
    'sky',
    () => {},
    (ms) => {
      external = ms;
    },
  );
  f.probe.measure('composite', () => {});
  f.probe.endFrame();
  f.probe.poll();
  assert.equal(f.events.filter((e) => e.kind === 'gpu-frame').length, 0);
  f.ready();
  f.probe.poll();
  assert.equal(external, 2);
  const frame = f.events.find((e) => e.kind === 'gpu-frame');
  assert.equal(frame.complete, true);
  assert.equal(frame.gpuMs, 4);
  assert.equal(frame.passes, 2);
  assert.equal(frame.frameId, 7);
  assert.equal(f.deleted(), 2);
});
test('disjoint measurements are discarded, never converted into CPU-labelled GPU data', () => {
  const f = fixture();
  f.probe.startFrame(1);
  f.probe.measure('scene', () => {});
  f.probe.endFrame();
  f.disjoint();
  f.probe.poll();
  assert.equal(f.events.find((e) => e.kind === 'gpu-frame').gpuMs, null);
  assert.equal(f.probe.status().pending, 0);
  assert.equal(f.deleted(), 1);
});
test('missing extension and full queue produce explicitly incomplete frames', () => {
  const missing = fixture(false);
  missing.probe.startFrame(1);
  missing.probe.measure('scene', () => {});
  missing.probe.endFrame();
  assert.equal(
    missing.events.find((e) => e.kind === 'gpu-frame').complete,
    false,
  );
  const f = fixture();
  for (let i = 0; i < 100; i++) {
    f.probe.startFrame(i);
    f.probe.measure('scene', () => {});
    f.probe.endFrame();
  }
  assert.equal(f.probe.status().pending, 64);
  f.probe.dispose();
  assert.equal(f.deleted(), 64);
});
test('a throwing pass still ends its query and permits the next pass', () => {
  const f = fixture();
  assert.throws(() =>
    f.probe.measure('broken', () => {
      throw new Error('expected');
    }),
  );
  f.probe.measure('next', () => {});
  f.ready();
  f.probe.poll();
  assert.equal(f.deleted(), 2);
});

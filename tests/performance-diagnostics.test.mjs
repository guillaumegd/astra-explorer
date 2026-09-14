import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiagnostics } from '../lib/performance-diagnostics.ts';
test('diagnostic ring retains chronological samples including spikes and reports dropped data', () => {
  const capture = createDiagnostics(3);
  [1, 2, 150, 4].forEach((cpuMs, at) => capture.record('frame', at, { cpuMs }));
  const result = capture.snapshot();
  assert.equal(result.dropped, 1);
  assert.deepEqual(
    result.samples.map((s) => s.values.cpuMs),
    [2, 150, 4],
  );
  assert.equal(result.gpu.completeFrame, 'unavailable');
});
test('empty capture and invalid capacities are explicit', () => {
  assert.deepEqual(createDiagnostics().snapshot().samples, []);
  for (const n of [0, -1, 1.5, NaN])
    assert.throws(() => createDiagnostics(n), RangeError);
});
test('milestones survive a frame ring rollover and remain bounded', () => {
  const capture = createDiagnostics(3);
  capture.record('first-frame', 0, { engineStartupMs: 12 });
  for (let i = 0; i < 100; i++) capture.record('frame', i, {});
  assert.equal(capture.snapshot().renderedFrames, 100);
  assert.equal(capture.snapshot().milestones[0].kind, 'first-frame');
  for (let i = 0; i < 100; i++) capture.record('picking', i, {});
  assert.equal(capture.snapshot().milestones.length, 64);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { zoomProximity, ambienceMix } from '../lib/ambience-parameters.ts';

test('zoom mix follows relative body scale and stays bounded', () => {
  assert.equal(zoomProximity(30, null), 0);
  assert.equal(zoomProximity(1000, 0.02), 0);
  assert.equal(zoomProximity(0.08, 0.02), 1);
  assert.equal(zoomProximity(0.16, 0.04), 1);
  assert.equal(zoomProximity(Infinity, 0.02), 0);
  let last = 0;
  for (const ratio of [2048, 512, 128, 32, 8, 4]) {
    const value = zoomProximity(ratio * 0.02, 0.02);
    assert.ok(value >= last && value <= 1);
    last = value;
  }
});

test('close-ups replace the score with atmosphere', () => {
  const far = ambienceMix(0),
    close = ambienceMix(1);
  assert.ok(close.cutoff > far.cutoff);
  assert.ok(close.noteInterval > far.noteInterval);
  assert.ok(close.melody < ambienceMix(0.4).melody);
  assert.equal(far.local, 0);
  assert.equal(close.local, 1);
  assert.ok(close.wet < far.wet);
  assert.ok(close.pad < far.pad / 2);
  assert.deepEqual(ambienceMix(-100), far);
  assert.deepEqual(ambienceMix(100), close);
  assert.deepEqual(ambienceMix(NaN), far);
});

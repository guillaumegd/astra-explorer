import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BINARY_COLOUR_DEPTH,
  REGION_DEPTH,
  ambienceMix,
  binaryColour,
  regionAmbience,
  regionPresence,
  zoomProximity,
} from '../lib/ambience-parameters.ts';

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

test('binary colouring stays light, continuous and silent from the galaxy view', () => {
  // Nothing at all until the local layer is actually audible.
  for (const angle of [0, 1.2, -4, Math.PI]) {
    const quiet = binaryColour(angle, 0);
    assert.equal(quiet.gain, 1);
    assert.equal(quiet.pan, 0);
  }
  let previous = null;
  for (let angle = -20; angle <= 20; angle += 0.01) {
    const { gain, pan } = binaryColour(angle, 1);
    assert.ok(gain <= 1 && gain >= 1 - BINARY_COLOUR_DEPTH);
    assert.ok(Math.abs(pan) <= 0.22);
    if (previous)
      assert.ok(
        Math.abs(gain - previous.gain) < 0.01 &&
          Math.abs(pan - previous.pan) < 0.01,
      );
    previous = { gain, pan };
  }
  // A frozen clock or a broken reading must never produce a silent layer.
  for (const bad of [NaN, Infinity, -Infinity])
    for (const local of [NaN, Infinity, bad]) {
      const { gain, pan } = binaryColour(bad, local);
      assert.ok(Number.isFinite(gain) && Number.isFinite(pan));
      assert.ok(gain <= 1 && gain >= 1 - BINARY_COLOUR_DEPTH);
    }
});

test('region presence is a continuous function of position alone', () => {
  assert.equal(regionPresence(0, 1), 1);
  assert.equal(regionPresence(2, 1), 0);
  assert.equal(regionPresence(1.2, 1), 0);
  // Invalid inputs never leak into the audio graph.
  for (const bad of [NaN, Infinity, -Infinity])
    assert.equal(regionPresence(bad, 1), 0);
  assert.equal(regionPresence(0.5, 0), 0);
  assert.equal(regionPresence(0.5, NaN), 0);
  let last = 1;
  for (let d = 0; d <= 1.5; d += 0.01) {
    const value = regionPresence(d, 1);
    assert.ok(Number.isFinite(value) && value >= 0 && value <= 1);
    assert.ok(value <= last + 1e-9);
    assert.ok(last - value < 0.05);
    last = value;
  }
});

test('the region layer colours without ever covering the score', () => {
  const silent = regionAmbience(0, 'nebula');
  assert.equal(silent.gain, 0);
  assert.equal(silent.wet, 0);
  // No region means no layer, whatever the presence value says.
  assert.equal(regionAmbience(1, null).gain, 0);
  for (const type of ['nebula', 'remnant']) {
    let last = regionAmbience(0, type);
    for (let p = 0; p <= 1; p += 0.01) {
      const value = regionAmbience(p, type);
      assert.ok(value.gain >= 0 && value.gain <= REGION_DEPTH);
      assert.ok(value.wet >= 0 && value.wet <= 0.25);
      assert.ok(Number.isFinite(value.cutoff) && value.cutoff > 0);
      assert.ok(Math.abs(value.gain - last.gain) < 0.01);
      assert.ok(Math.abs(value.cutoff - last.cutoff) < 20);
      last = value;
    }
  }
  // A nebula is the airier of the two; a remnant stays thinner.
  assert.ok(
    regionAmbience(1, 'nebula').gain > regionAmbience(1, 'remnant').gain,
  );
});

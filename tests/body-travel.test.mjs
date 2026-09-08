import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleBodyTravel } from '../lib/body-travel.ts';

test('body travel retreats before moving, then progressively approaches the destination', () => {
  const sample = t => sampleBodyTravel(t, 0.001, 12, 0.0001);
  assert.equal(sample(0).progress, 0);
  assert.equal(sample(0.2).progress, 0);
  assert.ok(sample(0.2).distance > sample(0).distance);
  assert.ok(Math.abs(sample(0.3).distance - 12) < 1e-10);
  let previous = sample(0.3);
  for (let i = 31; i <= 100; i++) {
    const current = sample(i / 100);
    assert.ok(current.progress >= previous.progress);
    assert.ok(current.distance <= previous.distance);
    assert.ok(current.distance > 0);
    previous = current;
  }
  assert.equal(sample(1).progress, 1);
  assert.ok(Math.abs(sample(1).distance - 0.0001) < 1e-12);
  assert.ok(Math.abs(sample(0.3 - 1e-6).distance - sample(0.3 + 1e-6).distance) < 1e-8);
});


test('destination is fully centered before its apparent size starts growing', () => {
  // A large separation previously dominated the actual camera distance until
  // the last frames, even though the nominal zoom was already almost complete.
  const separation = 100;
  const sample = t => sampleBodyTravel(t, 0.001, 150, 0.0001);
  for (const t of [0.25, 0.3, 0.35, 0.4, 0.45]) {
    assert.ok(Math.abs(sample(t).distance - 150) < 1e-10);
  }
  assert.equal(sample(0.45).progress, 1);
  for (const t of [0.5, 0.6, 0.7, 0.8, 0.9, 1]) {
    const flight = sample(t);
    const residualTranslation = separation * (1 - flight.progress);
    assert.equal(residualTranslation, 0);
    const actualDistance = Math.hypot(residualTranslation, flight.distance);
    assert.equal(actualDistance, flight.distance);
  }
});

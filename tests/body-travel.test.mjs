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

test('the drift flight lingers where the departing and arriving bodies are seen', async () => {
  const { sampleContemplativeTravel, contemplativeTravelSeconds } = await import(
    '../lib/drift.ts'
  );
  const start = 0.0004,
    cruise = 15,
    end = 0.0003;
  const sample = (t) => sampleContemplativeTravel(t, start, cruise, end);
  assert.ok(Math.abs(sample(0).distance - start) < 1e-12);
  assert.ok(Math.abs(sample(1).distance - end) < 1e-12);
  assert.equal(sample(0).progress, 0);
  assert.equal(sample(1).progress, 1);
  // The body stays a disc (within ~20x its framing distance) for a real share
  // of the flight at both ends, not a few frames.
  const seen = (d, ref) => d < ref * 20;
  let departing = 0,
    arriving = 0;
  let previous = sample(0);
  for (let i = 1; i <= 1000; i++) {
    const t = i / 1000;
    const current = sample(t);
    if (seen(current.distance, start) && t < 0.3) departing++;
    if (seen(current.distance, end) && t > 0.5) arriving++;
    // Continuous: no jump in log distance between samples.
    assert.ok(Math.abs(Math.log(current.distance / previous.distance)) < 0.2, `t=${t}`);
    assert.ok(current.progress >= previous.progress);
    previous = current;
  }
  assert.ok(departing / 1000 > 0.1, `departing ${departing}`);
  assert.ok(arriving / 1000 > 0.2, `arriving ${arriving}`);
  // The pan happens at cruise distance, between retreat and approach.
  const retreatEnd = (0.78 * Math.log(cruise / start)) /
    (Math.log(cruise / start) + Math.log(cruise / end));
  assert.equal(sample(retreatEnd - 1e-6).progress, 0);
  assert.ok(Math.abs(sample(retreatEnd + 0.11).distance - cruise) < 1e-9);
  assert.equal(sample(retreatEnd + 0.22).progress, 1);
  const seconds = contemplativeTravelSeconds(start, cruise, end);
  assert.ok(seconds >= 8 && seconds <= 16);
  assert.equal(contemplativeTravelSeconds(1, 1.1, 1), 8);
});

test('a drift flight spends no time on phases it does not need', async () => {
  const { sampleContemplativeTravel } = await import('../lib/drift.ts');
  // Zooming out to a system view already centred: no pan, the whole flight zooms.
  const out = (t) => sampleContemplativeTravel(t, 0.0004, 0.27, 0.27, 0);
  assert.ok(out(0.5).distance > 0.0004 && out(0.5).distance < 0.27);
  assert.ok(out(0.9).distance < 0.27);
  assert.ok(Math.abs(out(1).distance - 0.27) < 1e-9);
  // Zooming in from cruise distance: no idle retreat before the approach.
  const into = (t) => sampleContemplativeTravel(t, 0.27, 0.27, 0.0001);
  assert.ok(into(0.35).distance < 0.27);
  assert.ok(Math.abs(into(1).distance - 0.0001) < 1e-12);
  // The zoom out lingers early, where the departing body is still a disc.
  assert.ok(Math.log(out(0.3).distance / 0.0004) < Math.log(0.27 / 0.0004) * 0.2);
});

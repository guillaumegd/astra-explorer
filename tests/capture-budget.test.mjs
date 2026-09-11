import test from 'node:test';
import assert from 'node:assert/strict';
import { createCaptureBudget } from '../lib/phenomena/capture-budget.ts';

test('moving sky captures every rendered frame at every simulation speed', () => {
  const count = (speed) => {
    const budget = createCaptureBudget();
    let captures = 0;
    for (let frame = 0; frame < 300; frame++) {
      const wall = frame / 60,
        sim = wall * speed;
      if (budget.due(wall, sim)) {
        budget.end(null, wall, sim, 3);
        captures++;
      }
    }
    return captures;
  };
  assert.equal(count(1), count(0.2));
  assert.equal(count(1), count(3));
  assert.equal(count(1), 300);
});
test('pause freezes the last frame until resume or invalidation', () => {
  const budget = createCaptureBudget();
  budget.end(null, 0, 0, 15);
  assert.equal(budget.due(0.016, 0.016), true);
  assert.equal(budget.due(0.04, 0.016), true);
  budget.end(null, 0.04, 0.016, 15);
  assert.equal(budget.due(10, 0.016), false);
  assert.equal(budget.due(10, 0.017), true);
  assert.equal(budget.due(10, 0.016, false, true), true);
  assert.equal(budget.due(0.041, 0.016, true), true);
  budget.reset();
  assert.equal(budget.due(0.041, 0.016), true);
});
test('asynchronous GPU time replaces CPU submission cost and disjoint queries are discarded', () => {
  const budget = createCaptureBudget();
  let available = false,
    disjoint = false,
    deletes = 0;
  const gl = {
    CURRENT_QUERY: 1,
    QUERY_RESULT_AVAILABLE: 2,
    QUERY_RESULT: 3,
    getExtension: () => ({ TIME_ELAPSED_EXT: 4, GPU_DISJOINT_EXT: 5 }),
    getParameter: () => disjoint,
    getQuery: () => null,
    createQuery: () => ({}),
    beginQuery: () => {},
    endQuery: () => {},
    deleteQuery: () => deletes++,
    getQueryParameter: (_q, param) => (param === 2 ? available : 12e6),
  };
  budget.poll(gl);
  budget.end(budget.begin(), 0, 0, 0.1);
  assert.equal(budget.stats().source, 'cpu');
  assert.equal(budget.stats().pending, 1);
  budget.poll(gl);
  assert.equal(budget.stats().source, 'cpu');
  available = true;
  budget.poll(gl);
  assert.equal(budget.stats().source, 'gpu');
  assert.equal(budget.stats().costMs, 12);
  assert.equal(budget.due(0.016, 1), true);
  assert.equal(budget.due(0.081, 1), true);
  budget.end(budget.begin(), 0.081, 1, 0.1);
  disjoint = true;
  budget.poll(gl);
  assert.equal(budget.stats().source, 'cpu');
  assert.equal(budget.stats().pending, 0);
  assert.equal(deletes, 2);
  budget.reset();
});

test('expensive captures lower spatial quality with hysteresis, never temporal cadence', () => {
  const budget = createCaptureBudget();
  for (let i = 0; i < 40; i++) {
    assert.equal(budget.due(i / 60, i), true);
    budget.end(null, i / 60, i, 8);
  }
  assert.equal(budget.stats().resolution, 256);
  for (let i = 0; i < 120; i++) budget.end(null, 1 + i / 60, i, 0.1);
  assert.equal(
    budget.stats().resolution,
    256,
    'do not oscillate resolution on short cost dips',
  );
  for (let i = 0; i < 120; i++) budget.end(null, 3 + i / 60, i, 0.1);
  assert.equal(budget.stats().resolution, 512);
  budget.reset();
  assert.equal(budget.stats().resolution, 512);
});

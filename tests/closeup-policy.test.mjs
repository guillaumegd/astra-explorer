import test from 'node:test';
import assert from 'node:assert/strict';
import {
  closeupBudget,
  createCloseupVisitTracker,
} from '../lib/closeup-policy.ts';
import { QUALITY_TIERS } from '../lib/quality-policy.ts';

test('the close-up reservation is limited to Auto on constrained-device approaches', () => {
  const ultra = QUALITY_TIERS[0];
  assert.equal(closeupBudget(ultra, false, 2), ultra);
  assert.equal(closeupBudget(ultra, true, 9), ultra);

  const reserved = closeupBudget(ultra, true, 2);
  assert.notEqual(reserved, ultra);
  assert.equal(reserved.creationsPerFrame, 1);
  assert.equal(reserved.detailBodies, 1);
  assert.equal(reserved.gridResolution, 64);
  assert.equal(reserved.cloudSteps, 2);
  // The source object is the desktop/manual-Ultra contract and remains intact.
  assert.equal(ultra.gridResolution, 192);
  assert.equal(ultra.creationsPerFrame, Infinity);

  // A chosen visual profile may not silently lose close-up fidelity because
  // the device has a coarse pointer or a small viewport.
  assert.equal(closeupBudget(ultra, true, 2, false), ultra);
});

test('close-up metrics distinguish a first visit from a revisit', () => {
  const tracker = createCloseupVisitTracker();
  assert.equal(tracker.begin(42, 100), null);
  tracker.warm(130);
  tracker.recordCreations(1);
  tracker.recordCreations(0);
  tracker.ready(180);
  assert.deepEqual(tracker.end(220), {
    bodyId: 42,
    firstVisit: true,
    startedAt: 100,
    warmedAt: 130,
    readyAt: 180,
    created: 1,
    peakCreatedPerFrame: 1,
    endedAt: 220,
    durationMs: 120,
    warmupMs: 30,
    readyMs: 80,
  });

  tracker.begin(42, 500);
  assert.equal(tracker.snapshot().firstVisit, false);
  assert.equal(tracker.end(520).durationMs, 20);
});

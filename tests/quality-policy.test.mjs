import test from 'node:test';
import assert from 'node:assert/strict';
import {
  QUALITY_TIERS,
  createQualityController,
  effectivePixelRatio,
} from '../lib/quality-policy.ts';

/**
 * Frames of a given CPU cost, presented no faster than the cadence the
 * controller currently asks for: a frame that costs more than its period
 * stretches the interval, exactly as it would on screen.
 */
function load(
  controller,
  cost,
  seconds,
  { start = 0, gpuMs, excludedMs } = {},
) {
  let now = start;
  const end = start + seconds * 1000;
  const changes = [];
  while (now < end) {
    const scheduledMs = 1000 / controller.budget.targetFps;
    const cpuMs = typeof cost === 'function' ? cost(controller.budget) : cost;
    now += Math.max(scheduledMs, cpuMs);
    if (gpuMs !== undefined) controller.acceptGpu(gpuMs, now);
    if (controller.sample({ now, cpuMs, scheduledMs, excludedMs }))
      changes.push({ at: now - start, tier: controller.budget.tier });
  }
  return changes;
}

test('the budget contract is complete and ordered from rich to modest', () => {
  const fields = [
    'targetFps',
    'dpr',
    'pixelCap',
    'cpuBudgetMs',
    'detailBodies',
    'gridResolution',
    'cloudSteps',
    'volumeSteps',
    'opticalResolution',
    'population',
    'creationsPerFrame',
  ];
  QUALITY_TIERS.forEach((budget, index) => {
    assert.equal(budget.tier, index);
    for (const field of fields)
      assert.equal(typeof budget[field], 'number', `${budget.label}.${field}`);
    assert.ok([30, 60].includes(budget.targetFps));
    if (!index) return;
    const richer = QUALITY_TIERS[index - 1];
    for (const field of fields.filter((f) => f !== 'cpuBudgetMs'))
      assert.ok(
        budget[field] <= richer[field],
        `${field} must not grow at ${budget.label}`,
      );
  });
});

test('automatic starts cautious and economy is an explicit, capped choice', () => {
  const auto = createQualityController();
  assert.equal(auto.budget.label, 'balanced-30');
  assert.equal(auto.budget.targetFps, 30);
  assert.equal(auto.budget.dpr, 1);
  assert.equal(auto.stats().mode, 'auto');
  assert.equal(auto.setMode('economy', 0), true);
  assert.equal(auto.budget.label, 'economy-floor');
  assert.equal(auto.budget.dpr, 0.8);
  // Economy climbs to its own ceiling, never to the balanced tiers.
  load(auto, 2, 60, { start: 1000 });
  assert.equal(auto.budget.label, 'economy-30');
  assert.equal(auto.setMode('auto', 61000), true);
  assert.equal(auto.budget.label, 'balanced-30');
});

test('persistent overload drops quality within a second', () => {
  for (const cost of [40, 50, 100]) {
    const controller = createQualityController('auto', 0);
    const changes = load(controller, cost, 3);
    assert.ok(changes.length, `no change at ${cost} ms per frame`);
    assert.ok(
      changes[0].at <= 1000,
      `first drop after ${changes[0].at.toFixed(0)} ms at ${cost} ms per frame`,
    );
    assert.ok(changes[0].tier > 3);
  }
});

test('a drop answers with cadence, steps and details, not only the pixel ratio', () => {
  const controller = createQualityController('auto', 0);
  const before = controller.budget;
  load(controller, 120, 6);
  const after = controller.budget;
  assert.ok(after.volumeSteps < before.volumeSteps);
  assert.ok(after.detailBodies < before.detailBodies);
  assert.ok(after.pixelCap < before.pixelCap);
  assert.ok(after.dpr < before.dpr);
});

test('severe overload may fall back below the floor of a chosen mode', () => {
  const controller = createQualityController('economy', 0);
  load(controller, 400, 10);
  assert.equal(controller.budget.label, 'rescue');
  assert.equal(controller.stats().reason, 'severe-overload');
});

test('stable load holds a tier: no round trip within ten seconds', () => {
  const controller = createQualityController('auto', 0);
  const early = load(controller, 3, 10);
  assert.deepEqual(early, [], 'no promotion before the margin is proven');
  const later = load(controller, 3, 8, { start: 10000 });
  assert.equal(later.length, 1);
  assert.equal(controller.budget.tier, 2);
  assert.equal(controller.stats().reason, 'margin');
});

test('a tier that cannot hold is not tried again on the same clock', () => {
  const controller = createQualityController('auto', 0);
  // Comfortable at 30 fps, over budget at 60: the classic oscillation.
  const cost = (budget) => (budget.targetFps === 60 ? 20 : 5);
  const changes = load(controller, cost, 120);
  const gaps = changes
    .slice(1)
    .map((change, index) => change.at - changes[index].at);
  assert.ok(
    gaps.every((gap) => gap > 500),
    'changes are never immediate',
  );
  const promotions = changes.filter((change) => change.tier === 2);
  assert.ok(promotions.length >= 2, 'the ladder does retry');
  assert.ok(
    promotions[1].at - promotions[0].at > 24000,
    'each failed promotion widens the wait',
  );
  assert.ok(
    changes.length <= 8,
    `two minutes produced ${changes.length} changes`,
  );
});

test('time deliberately waited is not charged to the engine', () => {
  const controller = createQualityController('auto', 0);
  assert.deepEqual(
    load(controller, 40, 8, { excludedMs: 36 }),
    [],
    'a frame that waited on purpose is not an overloaded frame',
  );
});

test('GPU windows drive the ladder when queries are available', () => {
  const controller = createQualityController('auto', 0);
  assert.equal(controller.stats().gpu, 'unavailable');
  const changes = load(controller, 4, 3, { gpuMs: 40 });
  assert.equal(controller.stats().gpu, 'measured');
  assert.ok(changes.length, 'a saturated GPU lowers quality on a cheap CPU');
});

test('windows are reset by visibility, resize and context loss', () => {
  const controller = createQualityController('auto', 0);
  load(controller, 100, 0.4);
  assert.equal(controller.budget.tier, 3, 'no decision on a short window');
  controller.reset(400, 'visibility');
  assert.equal(controller.stats().reason, 'visibility');
  assert.deepEqual(
    load(controller, 100, 0.4, { start: 400 }),
    [],
    'the window restarts from zero after a reset',
  );
});

test('a frozen budget stops adaptation for the reference replay', () => {
  const controller = createQualityController('auto', 0);
  controller.freeze({ dpr: 1, volumeSteps: 16, opticalResolution: 512 });
  assert.deepEqual(load(controller, 200, 5), []);
  assert.equal(controller.budget.volumeSteps, 16);
  assert.equal(controller.stats().frozen, true);
  controller.release(5000);
  assert.equal(controller.budget.label, 'balanced-30');
  assert.ok(load(controller, 200, 3, { start: 5000 }).length);
});

test('the pixel ratio obeys the device, the tier and the pixel ceiling', () => {
  const [high, , , balanced, , floor] = QUALITY_TIERS;
  assert.equal(effectivePixelRatio(high, 800, 600, 3), 1.75);
  assert.equal(effectivePixelRatio(high, 800, 600, 1), 1);
  // 1728 x 1084 CSS pixels: the audit's reference window.
  assert.equal(effectivePixelRatio(balanced, 1728, 1084, 2), 1);
  assert.ok(effectivePixelRatio(high, 2560, 1440, 3) < 1.75);
  assert.equal(effectivePixelRatio(floor, 1024, 640, 2), 0.8);
  // The ceiling binds before the tier ratio on a large window.
  assert.equal(effectivePixelRatio(floor, 1728, 1084, 2), 0.73);
  assert.ok(effectivePixelRatio(floor, 6000, 4000, 3) >= 0.5);
});

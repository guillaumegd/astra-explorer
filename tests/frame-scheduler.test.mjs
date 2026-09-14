import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameScheduler } from '../lib/frame-scheduler.ts';

/** Feed perfectly regular callbacks of a simulated display for a duration. */
function run(scheduler, refreshHz, seconds, { jitter = 0, start = 0 } = {}) {
  const step = 1000 / refreshHz;
  const renders = [];
  const deltas = [];
  let seed = 7;
  const noise = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return ((seed / 2 ** 32) * 2 - 1) * jitter;
  };
  const callbacks = Math.round(seconds * refreshHz);
  for (let i = 1; i <= callbacks; i++) {
    const now = start + i * step + noise();
    const tick = scheduler.frame(now);
    if (tick.render) {
      renders.push(now);
      deltas.push(tick.deltaSeconds);
    }
  }
  const intervals = renders.slice(1).map((at, i) => at - renders[i]);
  return {
    renders,
    deltas,
    intervals,
    fps: intervals.length
      ? 1000 / (intervals.reduce((a, b) => a + b, 0) / intervals.length)
      : 0,
  };
}

test('rendered cadence matches the target on every simulated refresh rate', () => {
  // The old limiter turned these four screens into 30, 45, 40 and 36 fps.
  const cases = [
    [60, 30],
    [60, 60],
    [90, 30],
    [90, 60],
    [120, 30],
    [120, 60],
    [144, 30],
    [144, 60],
  ];
  for (const [refresh, target] of cases) {
    const scheduler = createFrameScheduler(target);
    const { fps } = run(scheduler, refresh, 6);
    assert.ok(
      Math.abs(fps - target) <= 0.6,
      `${refresh} Hz at ${target} fps rendered ${fps.toFixed(2)} fps`,
    );
  }
});

test('whole divisors render on uniform intervals, non-divisors stay bounded', () => {
  for (const [refresh, target, spread] of [
    [60, 30, 0.01],
    [120, 60, 0.01],
    [120, 30, 0.01],
    // 90 and 144 Hz cannot present a uniform 60: one refresh interval of
    // spread is the honest result, not a defect to hide.
    [90, 60, 1000 / 90 + 0.01],
    [144, 60, 1000 / 144 + 0.01],
  ]) {
    const { intervals } = run(createFrameScheduler(target), refresh, 4);
    const range = Math.max(...intervals) - Math.min(...intervals);
    assert.ok(
      range <= spread,
      `${refresh} Hz at ${target} fps spread ${range.toFixed(2)} ms`,
    );
  }
});

test('a 60 fps target on a 60 Hz screen never falls back to 30', () => {
  const { intervals } = run(createFrameScheduler(60), 60, 5, { jitter: 1.2 });
  assert.equal(
    intervals.filter((ms) => ms > 25).length,
    0,
    'no doubled interval',
  );
});

test('disturbed callbacks keep the average cadence and the time remainder', () => {
  const { fps, deltas } = run(createFrameScheduler(30), 60, 8, { jitter: 3 });
  assert.ok(Math.abs(fps - 30) < 0.8, `rendered ${fps.toFixed(2)} fps`);
  const simulated = deltas.reduce((a, b) => a + b, 0);
  // Simulation time follows the wall clock, not the render calendar.
  assert.ok(Math.abs(simulated - 8) < 0.1, `simulated ${simulated}s`);
});

test('a freeze is not replayed as a burst of catch-up frames', () => {
  const scheduler = createFrameScheduler(30);
  run(scheduler, 60, 2);
  const frozen = scheduler.frame(2000 + 3000);
  assert.equal(frozen.render, true);
  assert.equal(frozen.deltaSeconds, 0.1, 'the delta stays clamped');
  const after = run(scheduler, 60, 1, { start: 5000 });
  assert.ok(
    after.intervals.every((ms) => ms > 30),
    'no interval shorter than the target period after the freeze',
  );
  assert.ok(Math.abs(after.fps - 30) < 1);
});

test('returning from the background advances the world by nothing', () => {
  const scheduler = createFrameScheduler(30);
  run(scheduler, 60, 2);
  scheduler.suspend();
  scheduler.resume();
  const back = scheduler.frame(120000);
  assert.equal(back.render, true);
  assert.equal(back.deltaSeconds, 0);
  assert.equal(back.rafIntervalMs, null);
  const after = run(scheduler, 60, 1, { start: 120000 });
  assert.ok(Math.abs(after.fps - 30) < 1);
});

test('a target change takes effect without dropping the measured refresh', () => {
  const scheduler = createFrameScheduler(30);
  run(scheduler, 120, 2);
  assert.equal(Math.round(scheduler.stats().refreshHz), 120);
  scheduler.setTarget(60);
  const after = run(scheduler, 120, 3, { start: 2000 });
  assert.ok(Math.abs(after.fps - 60) < 0.6);
  assert.equal(scheduler.stats().targetFps, 60);
  assert.equal(scheduler.renderedFrames() > 0, true);
});

test('a target faster than the screen renders every callback, without backlog', () => {
  const scheduler = createFrameScheduler(60);
  const { fps, intervals } = run(scheduler, 50, 4);
  assert.ok(Math.abs(fps - 50) < 0.5, `rendered ${fps.toFixed(2)} fps`);
  assert.ok(Math.max(...intervals) - Math.min(...intervals) < 0.01);
  assert.ok(scheduler.stats().scheduledMs > 1000 / 60);
});

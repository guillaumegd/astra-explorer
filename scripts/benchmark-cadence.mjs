/**
 * Deterministic before/after for the render calendar and the quality ladder.
 *
 * "Before" is the rule of the audited revision ad69261, reproduced here
 * because lot 1 removed it: a 1000/45 - 1 ms gate that reset its reference on
 * every rendered frame, and a policy counting 90 rendered frames per step.
 * "After" calls the shipped modules. No browser, no GPU, no device: this
 * measures the controllers themselves, exactly like the audit tables did.
 */
import { createFrameScheduler } from '../lib/frame-scheduler.ts';
import { createQualityController } from '../lib/quality-policy.ts';

const round = (n) => +n.toFixed(3);
const REFRESHES = [60, 90, 120, 144];
const SECONDS = 10;

/** The audited limiter: whole callbacks dropped, remainder discarded. */
function legacyCadence(hz, seconds, jitter = 0) {
  let previous = 0,
    seed = 7;
  const renders = [];
  for (let i = 1; i <= hz * seconds; i++) {
    const now = i * (1000 / hz) + noise();
    if (now - previous < 1000 / 45 - 1) continue;
    renders.push(now);
    previous = now;
  }
  return summarise(renders, seconds);
  function noise() {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return ((seed / 2 ** 32) * 2 - 1) * jitter;
  }
}

function scheduledCadence(hz, target, seconds, jitter = 0) {
  const scheduler = createFrameScheduler(target);
  let seed = 7;
  const renders = [];
  for (let i = 1; i <= hz * seconds; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const now = i * (1000 / hz) + ((seed / 2 ** 32) * 2 - 1) * jitter;
    if (scheduler.frame(now).render) renders.push(now);
  }
  return summarise(renders, seconds);
}

function summarise(renders, seconds) {
  const intervals = renders.slice(1).map((at, i) => round(at - renders[i]));
  return {
    fps: round(renders.length / seconds),
    intervalsMs: [...new Set(intervals)].sort((a, b) => a - b).slice(0, 6),
  };
}

/**
 * The second that follows a 3 s freeze. A catch-up burst would render more
 * frames than the target; a shorter interval than the target period is normal
 * on a refresh the target does not divide, and is not a burst.
 */
function freezeRecovery(hz, target) {
  const scheduler = createFrameScheduler(target);
  const step = 1000 / hz;
  for (let i = 1; i <= hz * 2; i++) scheduler.frame(i * step);
  scheduler.frame(2000 + 3000);
  let renders = 0;
  for (let i = 1; i <= hz; i++)
    if (scheduler.frame(5000 + i * step).render) renders++;
  return {
    rendersInFirstSecond: renders,
    target,
    burst: renders > target * 1.05,
  };
}

/** The audited policy: 90 rendered frames per step, 45 slow ones to descend. */
function legacyAdaptation(frameMs, ceiling = 1.75) {
  const floor = Math.min(0.8, ceiling);
  let dpr = ceiling,
    steps = 16,
    count = 0,
    slow = 0;
  const changes = [];
  for (let i = 1; i <= 3000; i++) {
    count++;
    if (frameMs > 38) slow++;
    if (count >= 90) {
      if (slow > 45) {
        if (dpr > floor) dpr = Math.max(floor, +(dpr - 0.2).toFixed(2));
        else steps = steps > 8 ? 8 : 4;
        changes.push({ atSeconds: round((i * frameMs) / 1000), dpr, steps });
      }
      count = slow = 0;
    }
    if (dpr === floor && steps === 4) break;
  }
  return {
    firstDropSeconds: changes[0]?.atSeconds ?? null,
    floorSeconds: changes.at(-1)?.atSeconds ?? null,
    changes,
  };
}

function controlledAdaptation(frameMs) {
  const controller = createQualityController('auto', 0);
  const changes = [];
  let now = 0;
  while (now < 120000) {
    const scheduledMs = 1000 / controller.budget.targetFps;
    now += Math.max(scheduledMs, frameMs);
    if (controller.sample({ now, cpuMs: frameMs, scheduledMs }))
      changes.push({
        atSeconds: round(now / 1000),
        tier: controller.budget.label,
        targetFps: controller.budget.targetFps,
        dpr: controller.budget.dpr,
        volumeSteps: controller.budget.volumeSteps,
        detailBodies: controller.budget.detailBodies,
      });
  }
  return {
    firstDropSeconds: changes[0]?.atSeconds ?? null,
    floorSeconds: changes.at(-1)?.atSeconds ?? null,
    changes,
  };
}

const cadence = REFRESHES.map((hz) => ({
  hz,
  before: legacyCadence(hz, SECONDS),
  after30: scheduledCadence(hz, 30, SECONDS),
  after60: scheduledCadence(hz, 60, SECONDS),
  after30Jittered: scheduledCadence(hz, 30, SECONDS, 3),
  after60Jittered: scheduledCadence(hz, 60, SECONDS, 3),
  freezeRecovery60: freezeRecovery(hz, 60),
}));

const adaptation = [40, 50, 100].map((frameMs) => ({
  frameMs,
  before: legacyAdaptation(frameMs),
  after: controlledAdaptation(frameMs),
}));

console.log(
  JSON.stringify(
    {
      date: new Date().toISOString(),
      scope:
        'Controller simulation only: perfectly regular or jittered callbacks and constant frame costs. No browser, no GPU, no device. A real drop in quality usually changes the frame cost, which this cannot show.',
      seconds: SECONDS,
      cadence,
      adaptation,
    },
    null,
    2,
  ),
);

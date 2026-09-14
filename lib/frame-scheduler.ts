/**
 * One render calendar for the whole engine.
 *
 * rAF callbacks arrive at the display refresh; the calendar keeps the time
 * remainder instead of dropping it on the callbacks it skips. A 30 fps target
 * on a 60 Hz screen therefore renders every other callback, a 60 fps target on
 * 60 Hz renders every callback, and a target that does not divide the refresh
 * (60 on 90 or 144 Hz) alternates around an exact average rather than
 * collapsing onto the next whole divisor. Intervals are not uniform in that
 * case, and no amount of scheduling can make them uniform.
 *
 * Simulation time comes from the wall clock between rendered frames, never
 * from the calendar: skipping a render slows nothing down.
 */
export type FrameTick = {
  render: boolean;
  /** Wall time since the previous rendered frame, clamped. */
  deltaSeconds: number;
  rafIntervalMs: number | null;
  renderIntervalMs: number | null;
  /** Period the calendar is currently aiming for, in milliseconds. */
  scheduledMs: number;
};

const SAMPLES = 16;

export function createFrameScheduler(targetFps = 30, maxStepSeconds = 0.1) {
  const intervals: number[] = [];
  let cursor = 0;
  let target = targetFps;
  let lastRaf: number | null = null;
  let lastRender: number | null = null;
  let due: number | null = null;
  let rendered = 0;
  // Median once the estimate is settled; until then the shortest interval
  // seen, so a fast screen is not credited with a slow one's tolerance.
  const refreshMs = () => {
    if (!intervals.length) return null;
    const sorted = [...intervals].sort((a, b) => a - b);
    return intervals.length < 8 ? sorted[0] : sorted[sorted.length >> 1];
  };
  // Never ask for a cadence the screen cannot present: a 60 fps target on a
  // slower refresh becomes "every callback", not a permanent backlog.
  const period = () => {
    const refresh = refreshMs();
    return Math.max(1000 / target, refresh === null ? 0 : refresh - 1);
  };
  return {
    frame(now: number): FrameTick {
      const rafIntervalMs = lastRaf === null ? null : now - lastRaf;
      // Freezes and hidden tabs are not display intervals; they would poison
      // the refresh estimate.
      if (rafIntervalMs !== null && rafIntervalMs > 1 && rafIntervalMs < 200)
        intervals[cursor++ % SAMPLES] = rafIntervalMs;
      lastRaf = now;
      const scheduledMs = period();
      // Half a refresh interval: render on the callback closest to the due
      // date, so an exact divisor locks and never slips to half cadence.
      const tolerance = Math.min(refreshMs() ?? 1000 / 60, scheduledMs) / 2;
      if (due !== null && now < due - tolerance)
        return {
          render: false,
          deltaSeconds: 0,
          rafIntervalMs,
          renderIntervalMs: null,
          scheduledMs,
        };
      const renderIntervalMs = lastRender === null ? null : now - lastRender;
      due = (due ?? now) + scheduledMs;
      // A freeze or a hidden tab leaves the calendar behind: drop the backlog
      // instead of replaying it as a burst of catch-up frames.
      if (due <= now) due = now + scheduledMs;
      lastRender = now;
      rendered++;
      return {
        render: true,
        deltaSeconds:
          renderIntervalMs === null
            ? 0
            : Math.min(renderIntervalMs / 1000, maxStepSeconds),
        rafIntervalMs,
        renderIntervalMs,
        scheduledMs,
      };
    },
    setTarget(fps: number) {
      if (fps === target) return;
      target = fps;
      // Restart the calendar on the new period, keeping the simulation clock.
      due = null;
    },
    /** Tab hidden or loop stopped: forget the calendar, keep the estimate. */
    suspend() {
      lastRaf = lastRender = due = null;
    },
    /** Back from the background: the first frame advances the world by nothing. */
    resume() {
      lastRaf = lastRender = due = null;
    },
    renderedFrames: () => rendered,
    stats() {
      const refresh = refreshMs();
      return {
        targetFps: target,
        scheduledMs: period(),
        refreshHz: refresh === null ? null : 1000 / refresh,
        rendered,
      };
    },
  };
}

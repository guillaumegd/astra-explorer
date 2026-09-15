/**
 * The one quality controller. It watches elapsed time — not a count of
 * rendered frames — and publishes a budget object that the engine, the
 * surfaces, the regions, the lens and the audio all read. Lots 2 to 5 consume
 * the fields this controller already publishes; the engine consumes the
 * cadence, the pixel ratio, the pixel cap, the volumetric steps, the detailed
 * body count and the optical resolution today.
 *
 * Reduced motion is an accessibility preference and never an input here.
 */
export type QualityBudget = {
  /** Position on the ladder, 0 being the richest tier. */
  tier: number;
  label: string;
  targetFps: number;
  dpr: number;
  /** Ceiling on drawing-buffer pixels, applied on top of the ratio. */
  pixelCap: number;
  /** Engine CPU quota per rendered frame, in milliseconds. */
  cpuBudgetMs: number;
  detailBodies: number;
  gridResolution: number;
  /** Radial segments used for close-up planetary rings. */
  ringSegments: number;
  cloudSteps: number;
  volumeSteps: number;
  /** Replays the pre-performance per-region volumetric allocation in Ultra. */
  referenceVolumes: boolean;
  opticalResolution: number;
  /** Geodesic iterations for the lens; 320 preserves the reference integrator. */
  opticalSteps: number;
  /** Bodies prepared for the first render; consumed by lot 2. */
  population: number;
  /** New detailed entries (bodies, phenomena, regions) a manager may create per update() call. */
  creationsPerFrame: number;
};

/** A named, user-selectable profile. Auto is the only adaptive profile. */
export type QualityMode = 'auto' | 'economy' | 'balanced' | 'high' | 'ultra';
export type QualityPreset = Exclude<QualityMode, 'auto'> | 'rescue';

const tier = (
  label: string,
  targetFps: number,
  dpr: number,
  pixelCap: number,
  cpuBudgetMs: number,
  detailBodies: number,
  gridResolution: number,
  ringSegments: number,
  cloudSteps: number,
  volumeSteps: number,
  referenceVolumes: boolean,
  opticalResolution: number,
  opticalSteps: number,
  population: number,
  creationsPerFrame: number,
): QualityBudget => ({
  tier: 0,
  label,
  targetFps,
  dpr,
  pixelCap,
  cpuBudgetMs,
  detailBodies,
  gridResolution,
  ringSegments,
  cloudSteps,
  volumeSteps,
  referenceVolumes,
  opticalResolution,
  opticalSteps,
  population,
  creationsPerFrame,
});

/** Engineering starting values from the profile table of the parent issue. */
export const QUALITY_TIERS: readonly QualityBudget[] = [
  // This is the visual contract at ad69261, immediately before the performance
  // work: full relief/cloud detail, eight surfaces, native per-region volume
  // priority, 1.75 DPR ceiling and no drawing-buffer pixel cap.
  tier(
    'ultra-60',
    60,
    1.75,
    Infinity,
    8,
    8,
    192,
    72,
    6,
    16,
    true,
    512,
    320,
    65000,
    Infinity,
  ),
  tier('high-60', 60, 1.5, 8e6, 10, 8, 192, 72, 6, 16, false, 512, 320, 65000, 5),
  tier('high-entry', 60, 1.25, 5e6, 8, 8, 128, 72, 6, 16, false, 512, 320, 65000, 4),
  tier('balanced-60', 60, 1.25, 3e6, 8, 6, 128, 72, 4, 12, false, 512, 240, 40000, 3),
  tier('balanced-30', 30, 1, 2e6, 10, 4, 64, 72, 4, 8, false, 512, 192, 20000, 2),
  tier('economy-30', 30, 1, 1e6, 10, 2, 64, 64, 2, 4, false, 256, 128, 20000, 2),
  tier('economy-floor', 30, 0.8, 1e6, 10, 2, 32, 48, 0, 4, false, 256, 96, 10000, 1),
  tier('rescue', 30, 0.7, 7e5, 12, 1, 32, 32, 0, 2, false, 128, 64, 10000, 1),
].map((budget, index) => ({ ...budget, tier: index }));

const RESCUE = QUALITY_TIERS.length - 1;
/** start: where a mode begins · best: its ceiling · floor: its normal worst. */
const MODES: Record<
  QualityMode,
  { start: number; best: number; floor: number }
> = {
  auto: { start: 4, best: 0, floor: 6 },
  economy: { start: 5, best: 5, floor: 5 },
  balanced: { start: 4, best: 4, floor: 4 },
  high: { start: 1, best: 1, floor: 1 },
  ultra: { start: 0, best: 0, floor: 0 },
};

export function presetForBudget(budget: QualityBudget): QualityPreset {
  if (budget.label === 'rescue') return 'rescue';
  if (budget.label.startsWith('ultra')) return 'ultra';
  if (budget.label.startsWith('high')) return 'high';
  if (budget.label.startsWith('balanced')) return 'balanced';
  return 'economy';
}

export const QUALITY_STORAGE_KEY = 'astra-quality-v1';

export function loadStoredQuality(): QualityMode | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(QUALITY_STORAGE_KEY);
    return stored &&
      ['auto', 'economy', 'balanced', 'high', 'ultra'].includes(stored)
      ? (stored as QualityMode)
      : null;
  } catch {
    return null;
  }
}

export function storeQuality(mode: QualityMode) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(QUALITY_STORAGE_KEY, mode);
  } catch {
    // Storage can be unavailable in private browsing; the profile still works.
  }
}

export function resolveInitialQuality(): QualityMode {
  return loadStoredQuality() ?? 'auto';
}

const WINDOW_MS = 1000;
/** Enough elapsed time to call an overload persistent rather than a spike. */
const MIN_SPAN_MS = 500;
const EVALUATE_MS = 100;
const MIN_SAMPLES = 3;
/** Margin must hold this long before a promotion; doubles on ping-pong. */
const BASE_STABLE_MS = 12000;
const MAX_STABLE_MS = 48000;
const PING_PONG_MS = 20000;
const HEADROOM = 0.7;
/** Share of the frame period a complete GPU frame may take. */
const GPU_SHARE = 0.75;

const quantile = (sorted: number[], p: number) =>
  sorted.length
    ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)]
    : 0;

export type QualitySample = {
  now: number;
  cpuMs: number;
  /** Period the scheduler is aiming for; the margin is relative to it. */
  scheduledMs: number;
  /** Time the frame deliberately waited: never counted as engine cost. */
  excludedMs?: number;
};

export function createQualityController(
  initialMode: QualityMode = 'auto',
  now = 0,
) {
  let mode = initialMode;
  let level = MODES[mode].start;
  let frozen: QualityBudget | null = null;
  let cpuWindow: { at: number; ms: number; wait: number }[] = [];
  let gpuWindow: { at: number; ms: number }[] = [];
  let windowStart = now;
  let lastEvaluation = now;
  let comfortableSince: number | null = null;
  let stableMs = BASE_STABLE_MS;
  let lastPromotion = -Infinity;
  let lastReason = 'start';
  const clear = (at: number) => {
    cpuWindow = [];
    gpuWindow = [];
    windowStart = at;
    lastEvaluation = at;
    comfortableSince = null;
  };
  const move = (next: number, at: number, reason: string) => {
    if (next === level) return false;
    // A demotion that follows a recent promotion means the ladder guessed
    // wrong: make the next promotion wait longer instead of oscillating.
    if (next > level && at - lastPromotion < PING_PONG_MS)
      stableMs = Math.min(MAX_STABLE_MS, stableMs * 2);
    if (next < level) lastPromotion = at;
    level = next;
    lastReason = reason;
    clear(at);
    return true;
  };
  const evaluate = (at: number, scheduledMs: number) => {
    if (at - windowStart < MIN_SPAN_MS || cpuWindow.length < MIN_SAMPLES)
      return false;
    // Time deliberately spent waiting belongs to neither the span nor the cost.
    const excluded = cpuWindow.reduce((total, s) => total + s.wait, 0);
    const measuredMs = at - cpuWindow[0].at - excluded;
    if (measuredMs < MIN_SPAN_MS) return false;
    const budget = QUALITY_TIERS[level];
    const cadence = ((cpuWindow.length - 1) * 1000) / measuredMs;
    const scheduledFps = 1000 / scheduledMs;
    const cpu = cpuWindow.map((sample) => sample.ms).sort((a, b) => a - b);
    const gpu = gpuWindow.map((sample) => sample.ms).sort((a, b) => a - b);
    const gpuKnown = gpu.length >= MIN_SAMPLES;
    const gpuLimit = scheduledMs * GPU_SHARE;
    // A median over half a second is persistence; a single spike cannot move it.
    const overloaded =
      cadence < scheduledFps * 0.85 ||
      quantile(cpu, 0.5) > budget.cpuBudgetMs ||
      (gpuKnown && quantile(gpu, 0.5) > gpuLimit);
    if (overloaded) {
      comfortableSince = null;
      // Severe means the frame alone blows through its whole period, not
      // merely through the engine's share of it: two tiers at once is a
      // rescue, and a rescue should stay rare.
      const severe =
        cadence < scheduledFps * 0.5 ||
        quantile(cpu, 0.5) > scheduledMs * 1.5 ||
        (gpuKnown && quantile(gpu, 0.5) > gpuLimit * 2);
      // A named profile stays fixed under ordinary load. The pre-existing
      // emergency budget remains available only for a sustained, severe
      // failure; the engine reports it to the UI as an explicit fallback.
      if (mode !== 'auto')
        return severe ? move(RESCUE, at, 'safety-rescue') : false;
      // Severe overload may reach the rescue tier even under a chosen mode.
      const worst = severe ? RESCUE : MODES[mode].floor;
      return move(
        Math.min(worst, level + (severe ? 2 : 1)),
        at,
        severe ? 'severe-overload' : 'overload',
      );
    }
    if (mode !== 'auto') return false;
    if (level <= MODES[mode].best) {
      comfortableSince = null;
      return false;
    }
    // Judge the margin against the tier we would move to, not the current one:
    // its cadence and quota are what the device would have to sustain.
    const candidate = QUALITY_TIERS[level - 1];
    const candidateGpuLimit = (1000 / candidate.targetFps) * GPU_SHARE;
    const comfortable =
      cadence >= scheduledFps * 0.9 &&
      quantile(cpu, 0.95) <= candidate.cpuBudgetMs * HEADROOM &&
      (!gpuKnown || quantile(gpu, 0.95) <= candidateGpuLimit * HEADROOM);
    if (!comfortable) {
      comfortableSince = null;
      return false;
    }
    comfortableSince ??= at;
    if (at - comfortableSince < stableMs) return false;
    return move(level - 1, at, 'margin');
  };
  return {
    get budget(): QualityBudget {
      return frozen ?? QUALITY_TIERS[level];
    },
    /** Read without allocating a diagnostic status on the render path. */
    get mode(): QualityMode {
      return mode;
    },
    /** One rendered frame. Returns true when the budget changed. */
    sample({ now: at, cpuMs, scheduledMs, excludedMs = 0 }: QualitySample) {
      if (frozen) return false;
      const wait = Math.max(0, Math.min(excludedMs, cpuMs));
      cpuWindow.push({ at, ms: cpuMs - wait, wait });
      // Keep a few samples whatever their age: frames costing hundreds of
      // milliseconds must still be judged, and they are the urgent case.
      const oldest = at - WINDOW_MS;
      while (cpuWindow.length > MIN_SAMPLES && cpuWindow[0].at < oldest)
        cpuWindow.shift();
      while (gpuWindow.length && gpuWindow[0].at < oldest) gpuWindow.shift();
      if (at - lastEvaluation < EVALUATE_MS) return false;
      lastEvaluation = at;
      return evaluate(at, scheduledMs);
    },
    /** A complete GPU frame, when the driver exposes timer queries. */
    acceptGpu(milliseconds: number, at: number) {
      if (!Number.isFinite(milliseconds) || milliseconds < 0) return;
      gpuWindow.push({ at, ms: milliseconds });
    },
    /** Visibility change, resize, context loss: the windows no longer apply. */
    reset(at: number, reason = 'reset') {
      lastReason = reason;
      clear(at);
    },
    setMode(next: QualityMode, at: number) {
      if (next === mode && level === MODES[next].start) return false;
      mode = next;
      stableMs = BASE_STABLE_MS;
      lastPromotion = -Infinity;
      const changed = level !== MODES[mode].start;
      level = MODES[mode].start;
      lastReason = `mode:${mode}`;
      clear(at);
      return changed;
    },
    /** Pin an exact budget (reference replay); adaptation stops until released. */
    freeze(overrides: Partial<QualityBudget>) {
      frozen = { ...QUALITY_TIERS[level], ...overrides };
    },
    release(at: number) {
      frozen = null;
      clear(at);
    },
    stats() {
      return {
        mode,
        tier: this.budget.tier,
        label: this.budget.label,
        preset: presetForBudget(this.budget),
        targetFps: this.budget.targetFps,
        frozen: frozen !== null,
        reason: lastReason,
        stableMs,
        gpu: gpuWindow.length >= MIN_SAMPLES ? 'measured' : 'unavailable',
      };
    },
  };
}

/**
 * Device ratio, tier ratio and pixel ceiling, in that order of authority. The
 * cap is what keeps a large window on a modest GPU from paying full price.
 */
export function effectivePixelRatio(
  budget: QualityBudget,
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
) {
  const area = Math.max(1, cssWidth * cssHeight);
  const capped = Math.sqrt(budget.pixelCap / area);
  const ratio = Math.min(devicePixelRatio || 1, budget.dpr, capped);
  return Math.max(0.5, Math.round(ratio * 100) / 100);
}

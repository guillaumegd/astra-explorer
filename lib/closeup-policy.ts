import type { QualityBudget } from './quality-policy.ts';

/**
 * A close-up has a different failure mode from the all-sky view: creating a
 * surface and its local resources competes directly with camera motion. On a
 * coarse-pointer, small-screen device, reserve the transition for the selected
 * body. This is deliberately a transient rendering budget, not a new user
 * quality profile; desktop (including manual Ultra) keeps its exact budget.
 */
export function closeupBudget(
  budget: QualityBudget,
  constrainedDevice: boolean,
  distanceInRadii: number | null,
): QualityBudget {
  if (!constrainedDevice || distanceInRadii === null || distanceInRadii > 8)
    return budget;

  return {
    ...budget,
    // A single core/auxiliary creation leaves a frame for input and camera
    // damping. Other nearby bodies keep their point/impostor representation
    // until this visit has settled.
    creationsPerFrame: Math.min(1, budget.creationsPerFrame),
    detailBodies: Math.min(1, budget.detailBodies),
    // 64 is sufficient for the camera-local patch while avoiding a jump to a
    // 128/192 segment mesh after Auto earned a richer all-sky tier.
    gridResolution: Math.min(64, budget.gridResolution),
    ringSegments: Math.min(48, budget.ringSegments),
    cloudSteps: Math.min(2, budget.cloudSteps),
  };
}

export type CloseupVisit = {
  bodyId: number;
  firstVisit: boolean;
  startedAt: number;
  warmedAt: number | null;
  readyAt: number | null;
  created: number;
  peakCreatedPerFrame: number;
};

/** Records the part of a visit that generic frame metrics cannot identify. */
export function createCloseupVisitTracker() {
  const visited = new Set<number>();
  let active: CloseupVisit | null = null;

  const finish = (now: number) =>
    active
      ? {
          ...active,
          endedAt: now,
          durationMs: now - active.startedAt,
          warmupMs:
            active.warmedAt === null ? null : active.warmedAt - active.startedAt,
          readyMs:
            active.readyAt === null ? null : active.readyAt - active.startedAt,
        }
      : null;

  return {
    begin(bodyId: number, now: number) {
      const previous = finish(now);
      active = {
        bodyId,
        firstVisit: !visited.has(bodyId),
        startedAt: now,
        warmedAt: null,
        readyAt: null,
        created: 0,
        peakCreatedPerFrame: 0,
      };
      visited.add(bodyId);
      return previous;
    },
    warm(now: number) {
      if (!active || active.warmedAt !== null) return false;
      active.warmedAt = now;
      return true;
    },
    ready(now: number) {
      if (!active || active.readyAt !== null) return false;
      active.readyAt = now;
      return true;
    },
    recordCreations(created: number) {
      if (!active) return;
      active.created += created;
      active.peakCreatedPerFrame = Math.max(active.peakCreatedPerFrame, created);
    },
    end(now: number) {
      const finished = finish(now);
      active = null;
      return finished;
    },
    snapshot() {
      return active ? { ...active } : null;
    },
  };
}

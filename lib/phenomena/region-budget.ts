/**
 * Global raymarch budget for the nine nebulae and the cached remnants: a
 * total pixels-covered × steps ceiling, instead of a fixed count of
 * "priority" slots plus a flat fallback for everything else. The framed or
 * traversed region never degrades; everyone else gets the richest tier the
 * remaining budget can still afford, greedily, in priority order.
 *
 * The exact weights are a first cut, not a GPU profile (per issue #5's own
 * note that the true per-step cost needs one): pixels approximates the
 * fragment-shader invocation count a region's raymarch pays, so cost scales
 * with both screen footprint and step count.
 */
export type RegionStepCandidate = {
  id: string;
  pixels: number;
  focused: boolean;
  inside: number;
};

/** Roughly three regions at the current tier's full step count, at a size
 * matching regionVisibility's own "clearly on screen" reference (120px). */
export function regionStepBudget(steps: number) {
  return 3 * 120 * steps;
}

const regionCost = (pixels: number, stepCount: number) =>
  Math.max(pixels, 1) * stepCount;

/** Descending, deduplicated step choices available at this tier: the tier's
 * own ceiling, then 8 and 4 where they are actually smaller, then 0 (soft
 * impostor only, no raymarch this frame). */
function stepLadder(steps: number): number[] {
  return [...new Set([steps, Math.min(8, steps), Math.min(4, steps), 0])].sort(
    (a, b) => b - a,
  );
}

export function allocateRegionSteps<T extends RegionStepCandidate>(
  candidates: readonly T[],
  steps: number,
): Map<string, number> {
  const budget = regionStepBudget(steps);
  const ladder = stepLadder(steps);
  const sorted = [...candidates].sort(
    (a, b) =>
      Number(b.focused) - Number(a.focused) ||
      b.inside - a.inside ||
      b.pixels - a.pixels,
  );
  let spent = 0;
  const allocation = new Map<string, number>();
  for (const candidate of sorted) {
    if (candidate.focused || candidate.inside > 0) {
      allocation.set(candidate.id, steps);
      spent += regionCost(candidate.pixels, steps);
      continue;
    }
    // A near-invisible candidate stays capped regardless of leftover budget:
    // headroom does not make a 2px smudge worth a full raymarch.
    const ceiling = candidate.pixels < 6 ? Math.min(4, steps) : steps;
    let chosen = 0;
    for (const tier of ladder) {
      if (tier > ceiling) continue;
      const cost = regionCost(candidate.pixels, tier);
      if (spent + cost <= budget) {
        chosen = tier;
        break;
      }
    }
    if (chosen === 0 && spent === 0) {
      // Never zero out the very first, lonely candidate purely because it is
      // individually larger than the whole budget: fall back to the
      // smallest non-zero tier available at this quality level.
      const smallestNonZero = ladder
        .filter((tier) => tier > 0 && tier <= ceiling)
        .pop();
      if (smallestNonZero !== undefined) chosen = smallestNonZero;
    }
    allocation.set(candidate.id, chosen);
    spent += regionCost(candidate.pixels, chosen);
  }
  return allocation;
}

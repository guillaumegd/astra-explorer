import * as THREE from 'three';
import { createNebula } from './nebula.ts';
import { createRemnant } from './supernova-remnant.ts';
import { REGION_DETAIL_LIMIT } from '../catalogue/config.ts';
import type { RegionDefinition } from '../catalogue/types.ts';

export type RegionCandidate = {
  region: RegionDefinition;
  /** Sheared centre, in galaxy group space. */
  position: THREE.Vector3;
  pixels: number;
  /** 1 at the core, 0 outside the envelope. */
  inside: number;
  /** The framed region always keeps its slot, whatever else covers the screen. */
  focused: boolean;
};
/** Inside the volume it is always fully present, however small it projects. */
export function regionVisibility(pixels: number, inside: number) {
  return Math.max(inside, THREE.MathUtils.smoothstep(pixels, 8, 120));
}
/**
 * Two detailed regions at a time, as the graphics budget prescribes. Mirrors
 * the phenomena manager rather than extending it: the budgets differ, and the
 * candidates are not bodies.
 */
export function createRegionManager(parent: THREE.Group) {
  const entries = new Map<
    string,
    {
      renderer:
        | ReturnType<typeof createNebula>
        | ReturnType<typeof createRemnant>;
      fade: number;
      seen: number;
    }
  >();
  let previous: number | null = null;
  let steps = 16;
  return {
    update(
      candidates: RegionCandidate[],
      time: number,
      simulationTime: number,
      rotation: number,
      reducedMotion = false,
    ) {
      const dt =
        previous === null ? 0 : Math.min(0.1, Math.max(0, time - previous));
      previous = time;
      const active = candidates
        .filter(
          (c) =>
            c.focused ||
            c.inside > 0 ||
            c.pixels > (entries.has(c.region.regionId) ? 6.4 : 8),
        )
        // The framed region first, then presence, then screen coverage.
        .sort(
          (a, b) =>
            Number(b.focused) - Number(a.focused) ||
            b.inside - a.inside ||
            b.pixels - a.pixels,
        )
        .slice(0, REGION_DETAIL_LIMIT);
      const ids = new Set(active.map((c) => c.region.regionId));
      for (const c of active) {
        let entry = entries.get(c.region.regionId);
        const created = !entry;
        if (!entry) {
          if (entries.size >= REGION_DETAIL_LIMIT) {
            const stale = [...entries].find(([id]) => !ids.has(id));
            if (!stale) continue;
            stale[1].renderer.dispose();
            entries.delete(stale[0]);
          }
          entry = {
            renderer:
              c.region.type === 'remnant'
                ? createRemnant(c.region, steps)
                : createNebula(c.region, steps),
            fade: 0,
            seen: time,
          };
          entries.set(c.region.regionId, entry);
          parent.add(entry.renderer.group);
        }
        entry.seen = time;
        entry.renderer.group.position.copy(c.position);
        entry.fade +=
          (regionVisibility(c.pixels, c.inside) - entry.fade) *
          (1 - Math.exp(-(created ? 0 : dt) / 0.4));
      }
      for (const [id, entry] of entries) {
        if (!ids.has(id)) entry.fade *= Math.exp(-dt / 0.4);
        entry.renderer.update(
          simulationTime,
          entry.fade,
          reducedMotion,
          rotation,
        );
        if (time - entry.seen > 4) {
          entry.renderer.dispose();
          entries.delete(id);
        }
      }
    },
    /** Volumetric samples degrade only after resolution has hit its floor. */
    setSteps(next: number) {
      if (steps === next) return;
      steps = next;
      for (const entry of entries.values()) entry.renderer.setSteps(next);
    },
    steps() {
      return steps;
    },
    stats() {
      return {
        cached: entries.size,
        visible: [...entries.values()].filter((e) => e.fade > 0.002).length,
      };
    },
    dispose() {
      for (const entry of entries.values()) entry.renderer.dispose();
      entries.clear();
    },
  };
}

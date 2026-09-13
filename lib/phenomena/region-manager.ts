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
      renderer: ReturnType<typeof createRemnant>;
      fade: number;
      seen: number;
    }
  >();
  const nebulae = new Map<string, ReturnType<typeof createNebula>>();
  const active: RegionCandidate[] = [];
  const ids = new Set<string>();
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
      const dt = previous === null ? 0 : Math.max(0, time - previous);
      previous = time;
      const nebulaIds = new Set(
        candidates
          .filter((c) => c.region.type === 'nebula')
          .map((c) => c.region.regionId),
      );
      const priority = [...candidates]
        .filter((c) => c.pixels > 0 || c.focused || c.inside > 0)
        .sort(
          (a, b) =>
            Number(b.focused) - Number(a.focused) ||
            b.inside - a.inside ||
            b.pixels - a.pixels,
        )
        .slice(0, REGION_DETAIL_LIMIT);
      for (const c of candidates) {
        if (c.region.type !== 'nebula') continue;
        let nebula = nebulae.get(c.region.regionId);
        if (!nebula) {
          nebula = createNebula(c.region, Math.min(8, steps));
          nebulae.set(c.region.regionId, nebula);
          parent.add(nebula.group);
        }
        nebula.group.position.copy(c.position);
        const projectedSteps =
          c.pixels < 6 && !c.focused && c.inside === 0
            ? 4
            : priority.includes(c) &&
                (c.pixels > 48 || c.focused || c.inside > 0)
              ? steps
              : 8;
        nebula.setSteps(Math.min(projectedSteps, steps));
        // Frustum culling is safe: the object remains allocated and returns at
        // full presence, with no projected-size threshold or detail-slot fade.
        nebula.update(
          simulationTime,
          c.pixels > 0 || c.inside > 0 || c.focused ? 1 : 0,
          reducedMotion,
          rotation,
        );
      }
      for (const [id, nebula] of nebulae)
        if (!nebulaIds.has(id)) {
          nebula.dispose();
          nebulae.delete(id);
        }
      active.length = 0;
      for (const c of candidates)
        if (
          c.region.type === 'remnant' &&
          (c.focused ||
            c.inside > 0 ||
            c.pixels > (entries.has(c.region.regionId) ? 6.4 : 8))
        )
          active.push(c);
      active.sort(
        (a, b) =>
          Number(b.focused) - Number(a.focused) ||
          b.inside - a.inside ||
          b.pixels * (entries.has(b.region.regionId) ? 1.1 : 1) -
            a.pixels * (entries.has(a.region.regionId) ? 1.1 : 1) ||
          a.region.regionId.localeCompare(b.region.regionId),
      );
      active.length = Math.min(active.length, REGION_DETAIL_LIMIT);
      ids.clear();
      for (const c of active) ids.add(c.region.regionId);
      for (const [id, entry] of entries) {
        if (!ids.has(id)) entry.fade *= Math.exp(-dt / 0.4);
      }
      for (const c of active) {
        let entry = entries.get(c.region.regionId);
        const created = !entry;
        if (!entry) {
          if (entries.size >= REGION_DETAIL_LIMIT) {
            let stale:
              | (typeof entries extends Map<infer K, infer V> ? [K, V] : never)
              | undefined;
            for (const [id, cached] of entries) {
              if (!ids.has(id) && cached.fade <= 0.002) {
                stale = [id, cached];
                break;
              }
            }
            if (!stale) continue;
            stale[1].renderer.dispose();
            entries.delete(stale[0]);
          }
          entry = {
            renderer: createRemnant(c.region, steps),
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
        // Outgoing entries continue following their source while fading.
        const source = candidates.find((c) => c.region.regionId === id);
        if (source) entry.renderer.group.position.copy(source.position);
        entry.renderer.setSteps(
          source && priority.includes(source) ? steps : Math.min(8, steps),
        );
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
    /** Capture the same volumes from the lens, including those outside the main
     * camera frustum. The capture group must carry the galaxy world transform.
     * Always restore ownership/visibility/material state, even after a GPU error. */
    captureSky(captureParent: THREE.Group, render: () => void) {
      const effects = [
        ...nebulae.values(),
        ...Array.from(entries.values(), (e) => e.renderer),
      ];
      const children = [...parent.children];
      const saved = effects.map((effect) => {
        const mesh = effect.group.children[0] as THREE.Mesh<
          THREE.BufferGeometry,
          THREE.ShaderMaterial
        >;
        const state = {
          effect,
          visible: effect.group.visible,
          fade: mesh.material.uniforms.uFade.value,
          samples: mesh.material.defines.STEPS as number,
        };
        captureParent.add(effect.group);
        effect.setSteps(Math.min(8, steps));
        effect.group.visible = true;
        // Nebula presence must not depend on the observer's view frustum.
        if (effect.region.type === 'nebula')
          mesh.material.uniforms.uFade.value = 1;
        return state;
      });
      try {
        render();
      } finally {
        for (const { effect, visible, fade, samples } of saved) {
          effect.setSteps(samples);
          parent.add(effect.group);
          effect.group.visible = visible;
          const mesh = effect.group.children[0] as THREE.Mesh<
            THREE.BufferGeometry,
            THREE.ShaderMaterial
          >;
          mesh.material.uniforms.uFade.value = fade;
        }
        parent.children.splice(0, parent.children.length, ...children);
        parent.updateMatrixWorld(true);
      }
    },
    isVisible(id: string) {
      return (
        nebulae.get(id)?.group.visible ?? (entries.get(id)?.fade ?? 0) > 0.05
      );
    },
    stats() {
      return {
        cached: entries.size,
        persistent: nebulae.size,
        visible:
          Array.from(entries.values()).filter((e) => e.fade > 0.002).length +
          Array.from(nebulae.values()).filter((e) => e.group.visible).length,
      };
    },
    dispose() {
      for (const entry of entries.values()) entry.renderer.dispose();
      entries.clear();
      for (const nebula of nebulae.values()) nebula.dispose();
      nebulae.clear();
    },
  };
}

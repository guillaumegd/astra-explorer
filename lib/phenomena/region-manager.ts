import * as THREE from 'three';
import { createNebula } from './nebula.ts';
import { createRemnant } from './supernova-remnant.ts';
import { allocateRegionSteps } from './region-budget.ts';
import { createRegionImpostors } from './region-impostor.ts';
import { REGION_DETAIL_LIMIT } from '../catalogue/config.ts';
import type { RegionDefinition } from '../catalogue/types.ts';

/** No controller wired in: creation stays unthrottled, as it always was. */
const UNCONSTRAINED_CREATIONS = { budget: { creationsPerFrame: Infinity } };

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
export function createRegionManager(
  parent: THREE.Group,
  quality: { budget: { creationsPerFrame: number } } = UNCONSTRAINED_CREATIONS,
) {
  const entries = new Map<
    string,
    {
      renderer: ReturnType<typeof createRemnant>;
      fade: number;
      seen: number;
    }
  >();
  const nebulae = new Map<string, ReturnType<typeof createNebula>>();
  const impostors = createRegionImpostors();
  const active: RegionCandidate[] = [];
  const ids = new Set<string>();
  let previous: number | null = null;
  let steps = 16;
  let referenceVolumes = false;
  let lastCreations = 0;
  return {
    /** Not added to `parent`: the caller mounts it wherever the scene graph
     * needs it (production adds it to the shared engine group). */
    impostorPoints: impostors.points,
    update(
      candidates: RegionCandidate[],
      time: number,
      simulationTime: number,
      rotation: number,
      reducedMotion = false,
      renderer?: THREE.WebGLRenderer,
      camera?: THREE.Camera,
    ) {
      const dt = previous === null ? 0 : Math.max(0, time - previous);
      previous = time;
      let createdThisFrame = 0;
      const creationsPerFrame = quality.budget.creationsPerFrame;
      const nebulaCandidates = candidates.filter(
        (c) => c.region.type === 'nebula',
      );
      const nebulaIds = new Set(
        nebulaCandidates.map((c) => c.region.regionId),
      );
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
      const referencePriority = referenceVolumes
        ? [...candidates]
            .filter((c) => c.pixels > 0 || c.focused || c.inside > 0)
            .sort(
              (a, b) =>
                Number(b.focused) - Number(a.focused) ||
                b.inside - a.inside ||
                b.pixels - a.pixels,
            )
            .slice(0, REGION_DETAIL_LIMIT)
        : [];
      // One shared budget for every nebula (always rendered) and every
      // remnant that actually holds a cache slot: the total cost — not a
      // fixed count of "priority" slots — is what stays bounded.
      const allocation = referenceVolumes
        ? new Map<string, number>()
        : allocateRegionSteps(
            [...nebulaCandidates, ...active].map((c) => ({
              id: c.region.regionId,
              pixels: c.pixels,
              focused: c.focused,
              inside: c.inside,
            })),
            steps,
          );
      impostors.update(
        candidates.map((c) => {
          const allocatedSteps = allocation.get(c.region.regionId) ?? 0;
          const detailShare = steps > 0 ? allocatedSteps / steps : 0;
          return {
            position: c.position,
            size: c.region.envelope * 1.6,
            color: c.region.palette[0],
            // Strongest when the raymarch got little or no budget; never
            // fully off, so the region keeps an artistic presence even at
            // full detail (a soft halo behind the volumetric cloud).
            presence: referenceVolumes
              ? 0
              : regionVisibility(c.pixels, c.inside) *
                (0.15 + 0.85 * (1 - detailShare)),
          };
        }),
      );
      for (const c of nebulaCandidates) {
        let nebula = nebulae.get(c.region.regionId);
        if (!nebula) {
          // Not yet created this frame's share: the impostor already stands
          // in for it (it renders from `candidates` directly, not from
          // `nebulae`), so it just waits for a later frame.
          if (createdThisFrame >= creationsPerFrame) continue;
          createdThisFrame++;
          nebula = createNebula(c.region, Math.min(8, steps));
          nebulae.set(c.region.regionId, nebula);
          parent.add(nebula.group);
          if (renderer && camera) void renderer.compileAsync(nebula.group, camera);
        }
        nebula.group.position.copy(c.position);
        const projectedSteps = referenceVolumes
          ? c.pixels < 6 && !c.focused && c.inside === 0
            ? 4
            : referencePriority.includes(c) &&
                (c.pixels > 48 || c.focused || c.inside > 0)
              ? steps
              : 8
          : (allocation.get(c.region.regionId) ?? 0);
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
      for (const [id, entry] of entries) {
        if (!ids.has(id)) entry.fade *= Math.exp(-dt / 0.4);
      }
      for (const c of active) {
        let entry = entries.get(c.region.regionId);
        const created = !entry;
        if (!entry) {
          if (createdThisFrame >= creationsPerFrame) continue;
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
          createdThisFrame++;
          entry = {
            renderer: createRemnant(c.region, steps),
            fade: 0,
            seen: time,
          };
          entries.set(c.region.regionId, entry);
          parent.add(entry.renderer.group);
          if (renderer && camera)
            void renderer.compileAsync(entry.renderer.group, camera);
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
          referenceVolumes
            ? source && referencePriority.includes(source)
              ? steps
              : Math.min(8, steps)
            : (allocation.get(id) ?? Math.min(8, steps)),
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
      lastCreations = createdThisFrame;
    },
    /** Volumetric samples degrade only after resolution has hit its floor. */
    setSteps(next: number) {
      if (steps === next) return;
      steps = next;
      for (const entry of entries.values()) entry.renderer.setSteps(next);
    },
    setProfile(next: number, reference: boolean) {
      const changed = steps !== next || referenceVolumes !== reference;
      steps = next;
      referenceVolumes = reference;
      if (!changed) return;
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
        };
        captureParent.add(effect.group);
        // A separate, stable material variant: no defines.STEPS mutation (and
        // therefore no recompile) on the way in or on the way out.
        effect.setCaptureMode(true, Math.min(8, steps));
        effect.group.visible = true;
        // Nebula presence must not depend on the observer's view frustum.
        if (effect.region.type === 'nebula')
          mesh.material.uniforms.uFade.value = 1;
        return state;
      });
      try {
        render();
      } finally {
        for (const { effect, visible, fade } of saved) {
          effect.setCaptureMode(false, 0);
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
        created: lastCreations,
      };
    },
    dispose() {
      for (const entry of entries.values()) entry.renderer.dispose();
      entries.clear();
      for (const nebula of nebulae.values()) nebula.dispose();
      nebulae.clear();
      impostors.dispose();
    },
  };
}

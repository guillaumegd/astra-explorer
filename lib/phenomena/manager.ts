import * as THREE from 'three';
import { createComet } from './comet.ts';
import { createPulsar } from './pulsar.ts';
import { createBlackHole } from './black-hole.ts';
import type { LensSubject } from './lensing.ts';
import type { BodyCandidate } from '../stellar-lod.ts';

export function phenomenonVisibility(pixels: number) {
  return THREE.MathUtils.smoothstep(pixels, 6, 80);
}
/** No controller wired in: creation stays unthrottled, as it always was. */
const UNCONSTRAINED_CREATIONS = { budget: { creationsPerFrame: Infinity } };
/** Four reserved cache slots; ordinary bodies retain eight, total never exceeds twelve. */
export function createPhenomenaManager(
  parent: THREE.Group,
  quality: { budget: { creationsPerFrame: number } } = UNCONSTRAINED_CREATIONS,
) {
  const entries = new Map<
    number,
    {
      renderer:
        | ReturnType<typeof createBlackHole>
        | ReturnType<typeof createPulsar>
        | ReturnType<typeof createComet>;
      fade: number;
      seen: number;
    }
  >();
  let previous: number | null = null;
  let subject: LensSubject | null = null;
  let lastCreations = 0;
  return {
    update(
      candidates: BodyCandidate[],
      time: number,
      simulationTime: number,
      reducedMotion = false,
      orbitTime = simulationTime,
      renderer?: THREE.WebGLRenderer,
      camera?: THREE.Camera,
    ) {
      const dt =
        previous === null ? 0 : Math.min(0.1, Math.max(0, time - previous));
      previous = time;
      const active = candidates
        .filter(
          (c) =>
            c.identity.capabilities.renderClass !== 'ordinary' &&
            c.pixels > (entries.has(c.identity.id) ? 4.8 : 6),
        )
        .slice(0, 4);
      const ids = new Set(active.map((c) => c.identity.id));
      let createdThisFrame = 0;
      for (const c of active) {
        let entry = entries.get(c.identity.id);
        const created = !entry;
        if (!entry) {
          if (createdThisFrame >= quality.budget.creationsPerFrame) continue;
          if (entries.size >= 4) {
            const stale = [...entries].find(([id]) => !ids.has(id));
            if (!stale) continue;
            stale[1].renderer.dispose();
            entries.delete(stale[0]);
          }
          createdThisFrame++;
          entry = {
            renderer: c.identity.comet
              ? createComet(c.identity)
              : c.identity.pulsar
                ? createPulsar(c.identity)
                : createBlackHole(c.identity),
            fade: 0,
            seen: time,
          };
          entries.set(c.identity.id, entry);
          parent.add(entry.renderer.group);
          if (renderer && camera)
            void renderer.compileAsync(entry.renderer.group, camera);
        }
        entry.seen = time;
        entry.renderer.group.position.copy(c.position);
        entry.fade +=
          (phenomenonVisibility(c.pixels) - entry.fade) *
          (1 - Math.exp(-(created ? 0 : dt) / 0.4));
      }
      const fades: { id: number; fade: number }[] = [];
      for (const [id, entry] of entries) {
        if (!ids.has(id)) entry.fade *= Math.exp(-dt / 0.4);
        entry.renderer.update(
          simulationTime,
          entry.fade,
          reducedMotion,
          orbitTime,
        );
        if (time - entry.seen > 4) {
          entry.renderer.dispose();
          entries.delete(id);
        } else if (entry.fade > 0.002) fades.push({ id, fade: entry.fade });
      }
      const identity =
        active.find((c) => c.identity.kind === 'black-hole')?.identity ??
        subject?.body;
      const primary = identity && entries.get(identity.id);
      subject =
        primary && identity
          ? {
              body: identity,
              group: primary.renderer.group,
              fade: primary.fade,
              seen: primary.seen,
            }
          : null;
      lastCreations = createdThisFrame;
      return fades;
    },
    detailThreshold(id: number) {
      return entries.has(id) ? 4.8 : 6;
    },
    pulse(id: number) {
      const renderer = entries.get(id)?.renderer;
      return renderer && 'pulse' in renderer ? renderer.pulse() : 0.5;
    },
    lensSubject() {
      return subject;
    },
    pick(raycaster: THREE.Raycaster) {
      let closest: THREE.Intersection | null = null;
      for (const entry of entries.values()) {
        if (entry.fade < 0.1) continue;
        const hit = entry.renderer.pick(raycaster);
        if (hit && (!closest || hit.distance < closest.distance)) closest = hit;
      }
      return closest;
    },
    stats() {
      return {
        cached: entries.size,
        visible: [...entries.values()].filter((e) => e.fade > 0.002).length,
        created: lastCreations,
      };
    },
    dispose() {
      for (const e of entries.values()) e.renderer.dispose();
      entries.clear();
      subject = null;
    },
  };
}

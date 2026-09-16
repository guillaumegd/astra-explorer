import * as THREE from 'three';
import type { IndexedSystem } from './system-spatial-index.ts';

/**
 * The points shader places every body in float32, in galactic coordinates:
 * a planet of 1e-5 units sitting 8 units from the centre, sheared and orbited
 * by a rotation clock that never stops growing, drifts by several of its own
 * radii from one frame to the next (1e-4 u after 10 min, 5e-4 u after an
 * hour). The detailed mesh, placed in double precision, does not, so an
 * approaching or passing body visibly trembles until its mesh takes over.
 *
 * Nearby systems therefore receive CPU double-precision positions, expressed
 * relative to the camera, through a small float texture; the points objects
 * sit at that same origin so three.js resolves the large translation in
 * double. Far systems keep the GPU path, whose error is sub-pixel at their
 * depth. Both the system count and the texel count are capped.
 */
export const LOCAL_SYSTEM_SLOTS = 16;
const TEXTURE_WIDTH = 32;
const TEXTURE_HEIGHT = 16;
export const LOCAL_BODY_CAPACITY = TEXTURE_WIDTH * TEXTURE_HEIGHT;
/** Search radius around the camera; the slot cap, not the reach, bounds the cost. */
export const LOCAL_REACH = 1;

export const localPrecisionGLSL = `
 uniform vec3 uOrigin;
 uniform vec4 uLocalSystems[${LOCAL_SYSTEM_SLOTS}];
 uniform float uLocalCount;
 uniform sampler2D uLocalPositions;
 vec3 anchorToCamera(float id, vec3 p) {
   for(int i=0;i<${LOCAL_SYSTEM_SLOTS};i++){
     if(float(i)>=uLocalCount) break;
     float k=id-uLocalSystems[i].x;
     if(k>-.5 && k<uLocalSystems[i].y-.5){
       int t=int(uLocalSystems[i].z+k+.5);
       return texelFetch(uLocalPositions,ivec2(t%${TEXTURE_WIDTH},t/${TEXTURE_WIDTH}),0).xyz;
     }
   }
   return p-uOrigin;
 }
`;

/** Bodies of a system that are drawable: ids are contiguous and ascending. */
function drawableCount(system: IndexedSystem, bodyLimit: number) {
  let count = 0;
  while (count < system.bodies.length && system.bodies[count].id < bodyLimit)
    count++;
  return count;
}

/**
 * Keeps the systems whose bounds come closest to the (unsheared) camera, the
 * priority system first. Allocation-free apart from `out`'s own growth.
 */
export function selectLocalSystems(
  systems: readonly IndexedSystem[],
  x: number,
  y: number,
  z: number,
  bodyLimit: number,
  priorityRoot: number | null,
  out: IndexedSystem[],
  gaps: number[] = [],
) {
  out.length = 0;
  gaps.length = 0;
  for (const system of systems) {
    if (drawableCount(system, bodyLimit) === 0) continue;
    const [sx, sy, sz] = system.anchor;
    const gap =
      system.rootId === priorityRoot
        ? -Infinity
        : Math.hypot(x - sx, y - sy, z - sz) - system.envelope;
    if (out.length === LOCAL_SYSTEM_SLOTS && gap >= gaps[out.length - 1])
      continue;
    let i = Math.min(out.length, LOCAL_SYSTEM_SLOTS - 1);
    while (i > 0 && gaps[i - 1] > gap) {
      out[i] = out[i - 1];
      gaps[i] = gaps[i - 1];
      i--;
    }
    out[i] = system;
    gaps[i] = gap;
  }
  return out;
}

export function createLocalPrecision() {
  const data = new Float32Array(LOCAL_BODY_CAPACITY * 4);
  const texture = new THREE.DataTexture(
    data,
    TEXTURE_WIDTH,
    TEXTURE_HEIGHT,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  texture.minFilter = texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  const slots = Array.from(
    { length: LOCAL_SYSTEM_SLOTS },
    () => new THREE.Vector4(),
  );
  const uniforms = {
    uOrigin: { value: new THREE.Vector3() },
    uLocalSystems: { value: slots },
    uLocalCount: { value: 0 },
    uLocalPositions: { value: texture },
  };
  const scratch = new THREE.Vector3();
  let written = 0;
  return {
    uniforms,
    /**
     * `origin` and `locate` share the points objects' parent frame (galactic
     * group coordinates); the texture receives their difference.
     */
    update(
      systems: readonly IndexedSystem[],
      origin: THREE.Vector3,
      bodyLimit: number,
      locate: (id: number, out: THREE.Vector3) => void,
    ) {
      uniforms.uOrigin.value.copy(origin);
      let count = 0,
        texel = 0;
      for (const system of systems) {
        if (count === LOCAL_SYSTEM_SLOTS) break;
        const members = drawableCount(system, bodyLimit);
        if (members === 0 || texel + members > LOCAL_BODY_CAPACITY) continue;
        const first = system.bodies[0].id;
        slots[count++].set(first, members, texel, 0);
        for (let k = 0; k < members; k++, texel++) {
          locate(first + k, scratch);
          scratch.sub(origin);
          data[texel * 4] = scratch.x;
          data[texel * 4 + 1] = scratch.y;
          data[texel * 4 + 2] = scratch.z;
        }
      }
      uniforms.uLocalCount.value = count;
      if (texel > 0 || written > 0) texture.needsUpdate = true;
      written = texel;
      return count;
    },
    /** For passes whose points objects stay at the parent origin (sky capture). */
    suspend() {
      const origin = uniforms.uOrigin.value.clone(),
        count = uniforms.uLocalCount.value;
      uniforms.uOrigin.value.set(0, 0, 0);
      uniforms.uLocalCount.value = 0;
      return () => {
        uniforms.uOrigin.value.copy(origin);
        uniforms.uLocalCount.value = count;
      };
    },
    dispose() {
      texture.dispose();
    },
  };
}

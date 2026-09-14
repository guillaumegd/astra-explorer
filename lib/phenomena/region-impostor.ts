import * as THREE from 'three';

// A soft glow costs one GPU point, not a raymarch: mirrors the stellar-body
// point impostor (lib/galaxy.ts) so a region never goes fully invisible when
// its raymarch budget drops to zero — the nine nebulae keep an artistic
// presence at any quality tier.
const MAX_IMPOSTORS = 24;

const vertexShader = `
 attribute float aSize;
 attribute vec3 aColor;
 attribute float aAlpha;
 varying vec3 vColor;
 varying float vAlpha;
 void main() {
   vColor = aColor;
   vAlpha = aAlpha;
   vec4 mv = modelViewMatrix * vec4(position, 1.0);
   gl_PointSize = aAlpha > 0.0 ? aSize * (420.0 / max(0.001, -mv.z)) : 0.0;
   gl_Position = projectionMatrix * mv;
 }
`;
const fragmentShader = `
 varying vec3 vColor;
 varying float vAlpha;
 void main() {
   if (vAlpha <= 0.0) discard;
   vec2 uv = gl_PointCoord - 0.5;
   float r = length(uv) * 2.0;
   float glow = exp(-r * r * 3.2) * (1.0 - smoothstep(0.85, 1.0, r));
   if (glow < 0.01) discard;
   gl_FragColor = vec4(vColor * glow * vAlpha, glow * vAlpha);
 }
`;

export type RegionImpostorEntry = {
  position: THREE.Vector3;
  /** Point diameter in world units; scaled from the region's envelope. */
  size: number;
  color: string;
  /** 0..1: how much of the artistic presence the impostor alone must carry. */
  presence: number;
};

/**
 * One shared Points draw call for every region impostor, always present.
 * Deliberately does not parent itself: the caller decides where it lives in
 * the scene graph, so a region manager's own `parent` argument stays exactly
 * the set of nebula/remnant groups it always was.
 */
export function createRegionImpostors() {
  const positions = new Float32Array(MAX_IMPOSTORS * 3);
  const sizes = new Float32Array(MAX_IMPOSTORS);
  const colors = new Float32Array(MAX_IMPOSTORS * 3);
  const alphas = new Float32Array(MAX_IMPOSTORS);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  const scratchColor = new THREE.Color();
  return {
    points,
    update(entries: readonly RegionImpostorEntry[]) {
      const count = Math.min(entries.length, MAX_IMPOSTORS);
      for (let i = 0; i < count; i++) {
        const entry = entries[i];
        positions[i * 3] = entry.position.x;
        positions[i * 3 + 1] = entry.position.y;
        positions[i * 3 + 2] = entry.position.z;
        sizes[i] = entry.size;
        scratchColor.set(entry.color);
        colors[i * 3] = scratchColor.r;
        colors[i * 3 + 1] = scratchColor.g;
        colors[i * 3 + 2] = scratchColor.b;
        alphas[i] = Math.max(0, Math.min(1, entry.presence));
      }
      for (let i = count; i < MAX_IMPOSTORS; i++) alphas[i] = 0;
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.aSize.needsUpdate = true;
      geometry.attributes.aColor.needsUpdate = true;
      geometry.attributes.aAlpha.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      points.removeFromParent();
    },
  };
}

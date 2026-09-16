import * as THREE from 'three';

export const BLUE_NOISE_SIZE = 32;

/**
 * Ranks of a tileable blue-noise pattern, built by void filling: each pixel in
 * turn goes to the emptiest spot, measured by a toroidal Gaussian energy of
 * those already placed. Neighbouring ranks therefore land far apart, which is
 * what lets a march offset by them read as an even, fine dither with no
 * clumps and no regular grid. Seeded, so every run draws the same volumes.
 */
export function blueNoiseRanks(size = BLUE_NOISE_SIZE, seed = 0x9e3779b9) {
  const count = size * size;
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // Tie-breaking only: far below one kernel contribution.
  const energy = Float64Array.from({ length: count }, () => random() * 1e-6);
  const ranks = new Int32Array(count).fill(-1);
  const sigma2 = 2 * 1.9 * 1.9;
  const reach = 6;
  const kernel: number[] = [];
  for (let dy = -reach; dy <= reach; dy++)
    for (let dx = -reach; dx <= reach; dx++)
      kernel.push(Math.exp(-(dx * dx + dy * dy) / sigma2));
  for (let rank = 0; rank < count; rank++) {
    let best = -1;
    for (let i = 0; i < count; i++)
      if (ranks[i] < 0 && (best < 0 || energy[i] < energy[best])) best = i;
    ranks[best] = rank;
    const bx = best % size,
      by = (best - bx) / size;
    let k = 0;
    for (let dy = -reach; dy <= reach; dy++)
      for (let dx = -reach; dx <= reach; dx++) {
        const x = (bx + dx + size) % size,
          y = (by + dy + size) % size;
        energy[y * size + x] += kernel[k++];
      }
  }
  return ranks;
}

let texture: THREE.DataTexture | null = null;

/** Shared by every volume; built on first use, never disposed. */
export function blueNoiseTexture() {
  if (texture) return texture;
  const ranks = blueNoiseRanks();
  const count = ranks.length;
  const data = new Uint8Array(count);
  for (let i = 0; i < count; i++)
    data[i] = Math.floor((ranks[i] / count) * 256);
  texture = new THREE.DataTexture(
    data,
    BLUE_NOISE_SIZE,
    BLUE_NOISE_SIZE,
    THREE.RedFormat,
    THREE.UnsignedByteType,
  );
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/** Integer-only hash with named streams: appearance changes cannot move orbits. */
export function subSeed(seed: number, name: string): number {
  let hash = seed >>> 0;
  for (let i = 0; i < name.length; i++) {
    hash = Math.imul(hash ^ name.charCodeAt(i), 0x45d9f3b);
    hash ^= hash >>> 16;
  }
  return hash >>> 0;
}
export function stream(seed: number, name: string) {
  let state = subSeed(seed, name);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let n = Math.imul(state ^ (state >>> 15), 1 | state);
    n ^= n + Math.imul(n ^ (n >>> 7), 61 | n);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}
export function weighted(random: () => number, weights: readonly number[]) {
  let value = random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < weights.length; i++) {
    value -= weights[i];
    if (value < 0) return i;
  }
  return weights.length - 1;
}

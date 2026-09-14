import { generateChunk } from './generate';

/**
 * Pure compute worker: no state, no catalogue instance. Given the next
 * contiguous range, it runs `generateSystem` off the main thread and posts
 * the resulting systems back — the same deterministic output the main
 * thread would get from `RuntimeCatalogue.ensure`, just computed elsewhere.
 */
export type GenerateChunkRequest = {
  fromSystem: number;
  firstParticle: number;
  minBodies: number;
  seed: number;
};

self.onmessage = (event: MessageEvent<GenerateChunkRequest>) => {
  const { fromSystem, firstParticle, minBodies, seed } = event.data;
  const chunk = generateChunk(fromSystem, firstParticle, minBodies, seed);
  (self as unknown as Worker).postMessage(chunk);
};

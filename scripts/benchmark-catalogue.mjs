import { performance } from 'node:perf_hooks';
import { RuntimeCatalogue } from '../lib/catalogue/runtime.ts';
import { compileOrbitChain } from '../lib/orbits.ts';
import { CATALOGUE_SEED } from '../lib/catalogue/config.ts';
const results = [];
for (const budget of [10000, 20000, 65000, 120000]) {
  const runs = [];
  for (let run = 0; run < 6; run++) {
    const catalogue = new RuntimeCatalogue();
    const start = performance.now();
    const active = catalogue.activeCount(budget);
    const generated = performance.now();
    for (let id = 0; id < active; id++)
      compileOrbitChain(id, (i) => catalogue.bodies[i]);
    const end = performance.now();
    if (run)
      runs.push({
        active,
        generationMs: generated - start,
        orbitsMs: end - generated,
        totalMs: end - start,
      });
  }
  const median = (key) => runs.map((r) => r[key]).sort((a, b) => a - b)[2];
  results.push({
    budget,
    active: runs[0].active,
    generationMs: median('generationMs'),
    orbitsMs: median('orbitsMs'),
    totalMs: median('totalMs'),
    runs,
  });
}
console.log(
  JSON.stringify(
    {
      seed: CATALOGUE_SEED,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      warmupRuns: 1,
      results,
    },
    null,
    2,
  ),
);

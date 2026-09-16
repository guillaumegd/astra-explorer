import { readdir, readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { join, basename } from 'node:path';

// First-canvas critical path: the entry shell plus the engine chunk. The
// engine (three.js + lib/galaxy.ts) is dynamically imported but still
// indispensable before the galaxy can render — splitting it out does not
// exempt it from this budget. Only chunks that are NOT needed before first
// render (ambient audio, the catalogue growth worker, stellar activity) are
// excluded. A deferred chunk that also imports three.js makes the bundler
// split three.js out on its own; it stays on the critical path.
const CRITICAL_PREFIXES = ['index-', 'galaxy-', 'three.module-'];
// Temporary non-regression ceiling for the critical path. The issue's 250 kB
// target needs further byte attribution (icon set, three.js footprint) on
// top of this lot's chunk split — tracked as a follow-up, not met yet.
const CRITICAL_CEILING = 320000;
// Non-regression ceiling for everything shipped, deferred chunks included.
const TOTAL_CEILING = 340000;

async function javascriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((e) =>
        e.isDirectory()
          ? javascriptFiles(join(directory, e.name))
          : e.name.endsWith('.js')
            ? [join(directory, e.name)]
            : [],
      ),
    )
  ).flat();
}

const files = await javascriptFiles('out');
if (!files.length) throw new Error('No built JavaScript found');

let criticalBytes = 0,
  totalBytes = 0;
for (const file of files) {
  const bytes = gzipSync(await readFile(file)).length;
  totalBytes += bytes;
  if (CRITICAL_PREFIXES.some((prefix) => basename(file).startsWith(prefix)))
    criticalBytes += bytes;
}
console.log(
  `First-canvas critical path: ${criticalBytes} gzip bytes / ${CRITICAL_CEILING}`,
);
console.log(`All static JS: ${totalBytes} gzip bytes / ${TOTAL_CEILING}`);
if (criticalBytes > CRITICAL_CEILING || totalBytes > TOTAL_CEILING)
  process.exitCode = 1;

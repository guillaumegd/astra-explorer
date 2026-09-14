import { readdir, readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
// Temporary non-regression ceiling; the 250 kB target belongs to lot 2.
const ceiling = 315000;
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
let bytes = 0;
for (const file of files) bytes += gzipSync(await readFile(file)).length;
console.log(`All static JS: ${bytes} gzip bytes / ${ceiling}`);
if (bytes > ceiling) process.exitCode = 1;

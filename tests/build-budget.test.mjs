import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const script = fileURLToPath(
  new URL('../scripts/check-build-budget.mjs', import.meta.url),
);
test('build gate rejects missing and oversized output including nested chunks', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'astra-budget-'));
  const run = () =>
    spawnSync(process.execPath, [script], { cwd, encoding: 'utf8' });
  try {
    assert.notEqual(run().status, 0);
    mkdirSync(join(cwd, 'out', 'assets'), { recursive: true });
    assert.notEqual(run().status, 0);
    writeFileSync(
      join(cwd, 'out', 'assets', 'main.js'),
      'console.log("hello");',
    );
    assert.equal(run().status, 0);
    writeFileSync(join(cwd, 'out', 'assets', 'lazy.js'), randomBytes(400000));
    assert.equal(run().status, 1);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
test('build gate measures the first-canvas critical path separately from deferred chunks', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'astra-budget-'));
  const run = () =>
    spawnSync(process.execPath, [script], { cwd, encoding: 'utf8' });
  try {
    mkdirSync(join(cwd, 'out', 'assets'), { recursive: true });
    // Named like the real entry and engine chunks: on the critical path.
    writeFileSync(join(cwd, 'out', 'assets', 'index-abc123.js'), 'console.log(1);');
    writeFileSync(join(cwd, 'out', 'assets', 'galaxy-def456.js'), 'console.log(2);');
    // Named like the audio/worker chunks: not needed before first canvas,
    // so a chunk here — however large, within the overall total ceiling —
    // must not move the reported critical-path figure.
    writeFileSync(
      join(cwd, 'out', 'assets', 'ambient-audio-ghi789.js'),
      randomBytes(20000),
    );
    const result = run();
    assert.equal(result.status, 0);
    assert.match(result.stdout, /First-canvas critical path: \d+ gzip bytes/);
    const [, criticalBytes] = result.stdout.match(
      /First-canvas critical path: (\d+) gzip bytes/,
    );
    // Only the two tiny console.log files count toward the critical path.
    assert.ok(Number(criticalBytes) < 1000);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

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

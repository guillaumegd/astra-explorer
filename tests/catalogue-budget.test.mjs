import test from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeCatalogue } from '../lib/catalogue/runtime.ts';
import { compileOrbitChain } from '../lib/orbits.ts';
test('reference budgets preserve complete systems and finite orbital buffers', () => {
  const catalogue = new RuntimeCatalogue();
  for (const [budget, expected] of [
    [10000, 9991],
    [20000, 19997],
    [65000, 64995],
    [120000, 119999],
  ]) {
    const active = catalogue.activeCount(budget);
    assert.equal(active, expected);
    const last = catalogue.bodies[active - 1];
    const system = catalogue.getSystem(last.systemId);
    assert.equal(system.rootId + system.bodies.length, active);
    for (const id of [0, active - 1]) {
      assert.ok(
        compileOrbitChain(id, (i) => catalogue.bodies[i]).every(
          Number.isFinite,
        ),
      );
    }
  }
});

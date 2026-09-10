import test from 'node:test';
import assert from 'node:assert/strict';
import { describeBody } from '../lib/stellar-lod.ts';
import { localSystemRoot, systemBounds } from '../lib/system-framing.ts';

test('local controls omit duplicate stellar views and isolated bodies', () => {
  const catalogue = Array.from({ length: 8 }, (_, id) => describeBody(id));
  assert.equal(localSystemRoot(catalogue[0], catalogue), null);
  assert.equal(localSystemRoot(catalogue[1], catalogue), null);
  assert.equal(localSystemRoot(catalogue[5], catalogue), 5);
  assert.equal(localSystemRoot(catalogue[6], catalogue), 5);
  assert.ok(systemBounds(5, catalogue).members.length > 1);
  assert.ok(
    systemBounds(5, catalogue).members.length <
      systemBounds(0, catalogue).members.length,
  );
  assert.equal(localSystemRoot(catalogue[5], catalogue.slice(0, 6)), null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogue } from '../lib/catalogue/runtime.ts';
import { localSystemRoot, systemBounds } from '../lib/system-framing.ts';
test('local controls follow actual parents and omit duplicate stellar views', () => {
  catalogue.ensure(1000);
  const moon = catalogue.bodies.find((body) => body.role === 'moon');
  const members = catalogue.getSystemMembers(moon.systemId);
  const parent = catalogue.getBody(moon.parentId);
  assert.equal(localSystemRoot(catalogue.getBody(moon.rootId), members), null);
  assert.equal(localSystemRoot(parent, members), parent.id);
  assert.equal(localSystemRoot(moon, members), parent.id);
  assert.ok(systemBounds(parent.id, members).members.length > 1);
  assert.ok(systemBounds(parent.id, members).members.length < members.length);
  assert.equal(
    localSystemRoot(
      parent,
      members.filter((b) => b.parentId !== parent.id),
    ),
    null,
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogue } from '../lib/catalogue/runtime.ts';
import {
  framingDistance,
  localSystemRoot,
  systemBounds,
} from '../lib/system-framing.ts';
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

test('framing a region contains it in landscape and in portrait', () => {
  const half = (fov) => Math.tan((fov * Math.PI) / 360);
  const regions = [...catalogue.listNebulae(), ...catalogue.getRemnants(65000)];
  assert.ok(regions.length > 0);
  for (const region of regions)
    for (const [width, height] of [
      [1440, 900],
      [390, 844],
    ]) {
      const aspect = width / height;
      const distance = framingDistance(region.envelope, aspect);
      // The whole envelope fits on the narrow axis, margin included.
      const vertical = distance * half(48);
      const horizontal = vertical * aspect;
      assert.ok(Math.min(vertical, horizontal) >= region.envelope);
      // A region carries no camera exclusion: flying into it is the point.
      assert.ok(distance > 0 && Number.isFinite(distance));
    }
});

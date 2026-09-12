import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogue } from '../lib/catalogue/runtime.ts';
import {
  framingDistance,
  localSystemRoot,
  systemBounds,
  zoomSelection,
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

test('zooming in adopts only what the centre of the frame actually hit', () => {
  let casts = 0;
  const hit = (id) => () => {
    casts++;
    return id;
  };
  // The gesture takes the body under the centre, and nothing when there is none.
  assert.equal(zoomSelection(1.5, false, hit(4213)), 4213);
  assert.equal(zoomSelection(1.5, false, hit(null)), null);
  // Body 0 is the editorial reference black hole: it may only be reached by a
  // real hit, never as the fallback for an empty sky.
  assert.equal(zoomSelection(1.5, false, hit(0)), 0);
  assert.notEqual(zoomSelection(1.5, false, hit(null)), 0);
  assert.equal(casts, 4);
  // A body already selected keeps the focus, zooming out never reselects, and
  // neither case pays for a ray.
  assert.equal(zoomSelection(1.5, true, hit(4213)), null);
  assert.equal(zoomSelection(1 / 1.5, false, hit(4213)), null);
  assert.equal(casts, 4);
});

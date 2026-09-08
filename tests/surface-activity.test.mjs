import test from 'node:test';
import assert from 'node:assert/strict';
import { createSurfaceActivity } from '../lib/surface-activity.ts';

test('surface particles are selective, bounded and released', () => {
  for (const type of [0, 1, 2, 4])
    assert.equal(createSurfaceActivity(type, 42, '#ffffff'), null);
  for (const type of [3, 5, 6, 7, 8]) {
    const effect = createSurfaceActivity(type, 42, '#ffffff');
    assert.equal(effect.mesh.geometry.attributes.position.count, 768);
    effect.update(10, 1, 100);
    assert.equal(effect.mesh.visible, false);
    effect.update(11, 1, 600);
    assert.equal(effect.mesh.visible, true);
    const before = effect.mesh.material.uniforms.uFade.value;
    effect.fadeOut(0.1);
    assert.ok(effect.mesh.material.uniforms.uFade.value < before);
    let disposed = 0;
    effect.mesh.geometry.addEventListener('dispose', () => disposed++);
    effect.mesh.material.addEventListener('dispose', () => disposed++);
    effect.dispose();
    assert.equal(disposed, 2);
  }
});

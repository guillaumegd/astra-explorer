import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  estimateBufferBytes,
  estimateTargetBytes,
} from '../lib/performance-memory.ts';
test('shared and interleaved GPU payloads are counted once, including indices', () => {
  const geometry = new THREE.BufferGeometry();
  const data = new THREE.InterleavedBuffer(new Float32Array(60), 6);
  geometry.setAttribute(
    'position',
    new THREE.InterleavedBufferAttribute(data, 3, 0),
  );
  geometry.setAttribute(
    'normal',
    new THREE.InterleavedBufferAttribute(data, 3, 3),
  );
  geometry.setIndex([0, 1, 2]);
  const root = new THREE.Group();
  root.add(new THREE.Mesh(geometry), new THREE.Mesh(geometry));
  assert.equal(estimateBufferBytes([root]).bufferBytes, 246);
  assert.equal(estimateTargetBytes(100, 100), 80000);
  assert.equal(estimateTargetBytes(100, 100, 6, true), 560000);
  geometry.dispose();
});

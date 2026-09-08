import * as THREE from 'three';

// Normals in the body shaders are in view space; transform the physical light
// direction into that same space, rather than fixing a lamp to the camera.
export function lightInView(
  direction: THREE.Vector3,
  parentWorld: THREE.Matrix4,
  cameraView: THREE.Matrix4,
  out = new THREE.Vector3(),
) {
  return out
    .copy(direction)
    .transformDirection(parentWorld)
    .transformDirection(cameraView);
}

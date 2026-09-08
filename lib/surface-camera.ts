import * as THREE from 'three';

export function desiredSurfaceTilt(
  ratio: number,
  manual: number | null,
  minimumRatio = 1.08,
) {
  // Every family reaches the requested angle at its own closest safe distance.
  const fullTiltRatio = Math.max(1.08, minimumRatio);
  return (
    (manual ?? 60) * (1 - THREE.MathUtils.smoothstep(ratio, fullTiltRatio, 1.8))
  );
}

/** Orbit an elevated surface pivot: even at 60°, the camera stays above
 * the maximum terrain radius (1.016). All lengths are body-relative. */
export function surfaceCameraPose(
  center: THREE.Vector3,
  normal: THREE.Vector3,
  radius: number,
  distance: number,
  tilt: number,
  envelope = 1.016,
) {
  const pivot = center.clone().addScaledVector(normal, radius * envelope);
  const tangent = new THREE.Vector3(0, 1, 0).addScaledVector(normal, -normal.y);
  if (tangent.lengthSq() < 0.001)
    tangent.set(1, 0, 0).addScaledVector(normal, -normal.x);
  tangent.normalize();
  const angle = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(tilt, 0, 60));
  const altitude = Math.max(distance - radius * envelope, radius * 0.002);
  const position = pivot
    .clone()
    .addScaledVector(normal, Math.cos(angle) * altitude)
    .addScaledVector(tangent, -Math.sin(angle) * altitude);
  // The camera backs away along the ground and looks toward the horizon.
  // This local up vector remains orthogonal to its viewing direction.
  const up = tangent
    .clone()
    .multiplyScalar(Math.cos(angle))
    .addScaledVector(normal, Math.sin(angle));
  return { position, pivot, up };
}

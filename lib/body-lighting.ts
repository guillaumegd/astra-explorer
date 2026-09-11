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

export type LocalLight = {
  direction: THREE.Vector3;
  tint: THREE.Color;
  weight: number;
};
export type LightSource = {
  position: THREE.Vector3;
  power: number;
  color: THREE.Color;
};
export function createLocalLights(): [LocalLight, LocalLight] {
  return [0, 1].map(() => ({
    direction: new THREE.Vector3(1, 0, 0),
    tint: new THREE.Color(1, 1, 1),
    weight: 0,
  })) as [LocalLight, LocalLight];
}
const luminance = (color: THREE.Color) =>
  0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;

/**
 * Blend up to two local stars for one target.
 *
 * Slots follow catalogue order and are never sorted by distance or brightness:
 * a dynamic swap would make the specular highlight snap as the two components
 * cross. Weights sum to one, so a circumbinary world is lit no brighter than a
 * single-star one, and they vary continuously with position, which is what
 * keeps a rotating planet free of steps. Tints are normalised to unit luminance
 * so only the colour contrast shows.
 */
export function mixLocalLights(
  target: THREE.Vector3,
  sources: readonly LightSource[],
  out: [LocalLight, LocalLight],
): [LocalLight, LocalLight] {
  const [first, second] = out;
  const aim = (slot: LocalLight, source: LightSource) => {
    slot.direction.copy(source.position).sub(target);
    const squared = slot.direction.lengthSq();
    if (squared === 0) {
      slot.direction.set(1, 0, 0);
      return source.power;
    }
    slot.direction.multiplyScalar(1 / Math.sqrt(squared));
    return source.power / squared;
  };
  if (sources.length < 2) {
    if (sources.length) aim(first, sources[0]);
    else first.direction.set(1, 0, 0);
    // Copy the direction rather than leaving a zero vector: normalize(vec3(0))
    // is NaN, and a zero weight would not stop it propagating.
    second.direction.copy(first.direction);
    first.weight = 1;
    second.weight = 0;
    first.tint.setRGB(1, 1, 1);
    second.tint.setRGB(1, 1, 1);
    return out;
  }
  const near = aim(first, sources[0]),
    far = aim(second, sources[1]),
    total = near + far;
  first.weight = total > 0 ? near / total : 1;
  second.weight = total > 0 ? far / total : 0;
  for (const [slot, source] of [
    [first, sources[0]],
    [second, sources[1]],
  ] as const)
    slot.tint
      .copy(source.color)
      .multiplyScalar(1 / Math.max(luminance(source.color), 1e-4));
  return out;
}

import type * as THREE from 'three';
/** Known buffers only; avoids counting shared/interleaved attributes twice. */
export function estimateBufferBytes(roots: THREE.Object3D[]) {
  const arrays = new Set<ArrayBufferView>();
  const geometries = new Set<THREE.BufferGeometry>();
  for (const root of roots)
    root.traverse((object) => {
      const geometry = (object as THREE.Mesh).geometry;
      if (!geometry || geometries.has(geometry)) return;
      geometries.add(geometry);
      const attributes = [
        ...Object.values(geometry.attributes),
        ...Object.values(geometry.morphAttributes).flat(),
        ...(geometry.index ? [geometry.index] : []),
      ];
      for (const attribute of attributes) {
        if (!attribute) continue;
        const array =
          'data' in attribute ? attribute.data.array : attribute.array;
        arrays.add(array);
      }
    });
  return {
    geometryCount: geometries.size,
    bufferBytes: [...arrays].reduce((sum, array) => sum + array.byteLength, 0),
  };
}
export function estimateTargetBytes(
  width: number,
  height: number,
  faces = 1,
  mipmaps = false,
  depthBytes = 4,
) {
  const colorBytes = width * height * faces * 4 * (mipmaps ? 4 / 3 : 1);
  return Math.ceil(colorBytes + width * height * faces * depthBytes);
}

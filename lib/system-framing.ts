import { orbitFor, type OrbitalBody } from './orbits.ts';

/** Conservative bound: remains valid for every orbital phase. */
export function systemBounds(rootId: number, catalogue: OrbitalBody[]) {
  const byId = new Map(catalogue.map((body) => [body.id, body]));
  const members: number[] = [];
  let radius = byId.get(rootId)?.radius ?? 0;
  for (const body of catalogue) {
    let node = body,
      extent = body.radius;
    const seen = new Set<number>();
    while (node.id !== rootId && node.parentId !== null && !seen.has(node.id)) {
      seen.add(node.id);
      const parent = byId.get(node.parentId);
      if (!parent) break;
      extent += orbitFor(node, parent).radius;
      node = parent;
    }
    if (node.id === rootId) {
      members.push(body.id);
      radius = Math.max(radius, extent);
    }
  }
  return { members, radius };
}

export function framingDistance(radius: number, aspect: number, fov = 48) {
  const halfVertical = (fov * Math.PI) / 360;
  const halfHorizontal = Math.atan(Math.tan(halfVertical) * aspect);
  return (radius * 1.65) / Math.sin(Math.min(halfVertical, halfHorizontal));
}

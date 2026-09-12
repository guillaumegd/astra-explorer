import { orbitFor, type OrbitalBody } from './orbits.ts';

/**
 * Conservative bound: remains valid for every orbital phase.
 * A null root frames the invisible barycentre a binary turns around.
 */
export function systemBounds(rootId: number | null, catalogue: OrbitalBody[]) {
  const byId = new Map(catalogue.map((body) => [body.id, body]));
  const members: number[] = [];
  const visualRadius = (
    body: OrbitalBody & {
      phenomenon?: { envelope: number };
      pulsar?: { envelope: number };
    },
  ) => body.phenomenon?.envelope ?? body.pulsar?.envelope ?? body.radius;
  const root = rootId === null ? undefined : byId.get(rootId);
  let radius = root ? visualRadius(root) : 0;
  for (const body of catalogue) {
    let node = body,
      extent = visualRadius(body),
      atBarycentre = false;
    const seen = new Set<number>();
    while (node.id !== rootId && !seen.has(node.id)) {
      seen.add(node.id);
      if (node.parentId === null) {
        if (node.orbit) extent += node.orbit.radius;
        atBarycentre = true;
        break;
      }
      const parent = byId.get(node.parentId);
      if (!parent) break;
      extent += orbitFor(node, parent).radius;
      node = parent;
    }
    if (node.id === rootId || (rootId === null && atBarycentre)) {
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

/** Match local framing to its actual parent; omit a duplicate stellar view. */
export function localSystemRoot(
  body: OrbitalBody,
  catalogue: OrbitalBody[],
): number | null {
  const root = catalogue.some((member) => member.parentId === body.id)
    ? body.id
    : body.parentId;
  if (root === null) return null;
  const parent = catalogue.find((member) => member.id === root);
  // Test the orbit, not the parent: a circumbinary planet has no parent body.
  return parent && parent.orbit && catalogue.some((m) => m.parentId === root)
    ? root
    : null;
}

/**
 * Which body a zoom-in gesture adopts. Empty sky is not a destination: with
 * nothing under the centre of the frame the gesture only moves the camera.
 * Returning a fixed body instead teleported the viewer to that body from
 * anywhere in the galaxy. The hit is a callback so the ray is only cast when
 * the gesture could actually take a destination.
 */
export function zoomSelection(
  factor: number,
  selected: boolean,
  centreHit: () => number | null,
): number | null {
  return factor > 1 && !selected ? centreHit() : null;
}

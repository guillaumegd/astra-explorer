import type { BodyIdentity } from './catalogue/types.ts';

/**
 * How far from its centre a body still changes the picture, in world units.
 *
 * A black hole bends light well beyond its disc: the lens composite blends its
 * image out over `2 × diskOuter`, the `zone`
 * of lensing-shader.ts. Everything else reaches no further than the envelope
 * the engine already sizes it by.
 */
export function frameReach(body: BodyIdentity, envelope: number) {
  const hole = body.phenomenon;
  if (!hole) return body.comet?.envelope ?? envelope;
  return Math.max(envelope, hole.diskOuter * 2);
}

/**
 * Whether anything within `reach` of a point can reach the frame.
 *
 * Judging by the centre alone drops a large body while most of it is still on
 * screen: a black hole whose centre slips past the edge would lose its lens —
 * and start fading out — with half its distortion in view. The projected reach
 * widens the tolerance instead, and a camera inside the reach always counts.
 *
 * `projection` holds the camera projection elements [0] and [5]; `ndc` is the
 * projected centre, `depth` its distance along the view axis.
 */
export function withinFrame(
  ndc: { x: number; y: number; z: number },
  depth: number,
  distance: number,
  reach: number,
  near: number,
  projection: readonly number[],
  margin = 1.2,
) {
  if (distance <= reach) return true;
  if (depth <= near || ndc.z >= 1) return false;
  return (
    Math.abs(ndc.x) < margin + (reach * projection[0]) / depth &&
    Math.abs(ndc.y) < margin + (reach * projection[5]) / depth
  );
}

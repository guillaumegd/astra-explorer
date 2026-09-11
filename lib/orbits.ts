export type OrbitalBody = {
  id: number;
  parentId: number | null;
  radius: number;
  seed: number;
  orbit?: Orbit | null;
};
/** A null parent orbits the system origin: the invisible barycentre of a binary. */
export type Orbit = {
  parentId: number | null;
  radius: number;
  phase: number;
  speed: number;
  inclination: number;
};
export const ORBIT_DEPTH = 3;
export const ORBIT_STRIDE = ORBIT_DEPTH * 4;

export function orbitFor(body: OrbitalBody, parent: OrbitalBody | null): Orbit {
  if (body.parentId !== (parent?.id ?? null))
    throw new Error('Invalid orbital parent');
  if (!body.orbit) throw new Error('Missing explicit orbital elements');
  return body.orbit;
}

// Resolve the hierarchy once. The GPU then sums up to three parent-relative orbits.
export function compileOrbitChain(
  id: number,
  lookup: (id: number) => OrbitalBody,
): Float32Array {
  const data = new Float32Array(ORBIT_STRIDE),
    seen = new Set<number>();
  let body = lookup(id),
    depth = 0;
  // A body with an orbit but no parent closes the chain on the system origin.
  while (body.parentId !== null || body.orbit) {
    if (seen.has(body.id)) throw new Error('Cycle dans la hiérarchie orbitale');
    if (depth >= ORBIT_DEPTH)
      throw new Error('Hiérarchie orbitale trop profonde');
    seen.add(body.id);
    const parent = body.parentId === null ? null : lookup(body.parentId),
      orbit = orbitFor(body, parent);
    data.set(
      [orbit.radius, orbit.phase, orbit.speed, orbit.inclination],
      depth++ * 4,
    );
    if (!parent) break;
    body = parent;
  }
  return data;
}

export function orbitalOffset(
  data: Float32Array,
  start: number,
  time: number,
  out: { x: number; y: number; z: number },
) {
  for (let level = 0; level < ORBIT_DEPTH; level++) {
    const i = start + level * 4,
      r = data[i],
      angle = data[i + 1] + time * data[i + 2],
      tilt = data[i + 3];
    out.x += Math.cos(angle) * r;
    out.y += Math.sin(angle) * r * Math.sin(tilt);
    out.z += Math.sin(angle) * r * Math.cos(tilt);
  }
  return out;
}

export const orbitalGLSL = `
 vec3 orbitPosition(vec4 orbit,float clock){
   if(orbit.x==0.0)return vec3(0.0);
   float a=orbit.y+clock*orbit.z;
   return orbit.x*vec3(cos(a),sin(a)*sin(orbit.w),sin(a)*cos(orbit.w));
 }
`;

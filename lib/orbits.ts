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
  /** Semi-major axis is radius; absent eccentricity preserves circular V2 orbits. */
  eccentricity?: number;
};
export const ORBIT_DEPTH = 3;
export const ORBIT_STRIDE = ORBIT_DEPTH * 5;

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
  const data = new Float32Array(ORBIT_STRIDE);
  // Cycle guard: the chain is bounded to ORBIT_DEPTH links, so a plain scan
  // of the ids seen so far beats allocating a Set per call.
  const seen: number[] = [];
  let body = lookup(id),
    depth = 0;
  // A body with an orbit but no parent closes the chain on the system origin.
  while (body.parentId !== null || body.orbit) {
    if (seen.includes(body.id)) throw new Error('Cycle dans la hiérarchie orbitale');
    if (depth >= ORBIT_DEPTH)
      throw new Error('Hiérarchie orbitale trop profonde');
    seen.push(body.id);
    const parent = body.parentId === null ? null : lookup(body.parentId),
      orbit = orbitFor(body, parent);
    data[ORBIT_DEPTH * 4 + depth] = orbit.eccentricity ?? 0;
    data.set(
      [orbit.radius, orbit.phase, orbit.speed, orbit.inclination],
      depth++ * 4,
    );
    if (!parent) break;
    body = parent;
  }
  return data;
}

/** Fixed eight Newton steps, shared with GLSL, for 0 <= e <= 0.8. */
export function eccentricAnomaly(mean: number, eccentricity: number) {
  const tau = Math.PI * 2;
  const m = ((((mean + Math.PI) % tau) + tau) % tau) - Math.PI;
  let e = m;
  for (let i = 0; i < 8; i++)
    e -=
      (e - eccentricity * Math.sin(e) - m) / (1 - eccentricity * Math.cos(e));
  return e;
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
    const eccentricity = data[start + ORBIT_DEPTH * 4 + level] ?? 0;
    const anomaly = eccentricity
      ? eccentricAnomaly(angle, eccentricity)
      : angle;
    const minor = Math.sqrt(1 - eccentricity * eccentricity);
    out.x += (Math.cos(anomaly) - eccentricity) * r;
    out.y += Math.sin(anomaly) * r * minor * Math.sin(tilt);
    out.z += Math.sin(anomaly) * r * minor * Math.cos(tilt);
  }
  return out;
}

export const orbitalGLSL = `
 vec3 orbitPosition(vec4 orbit,float clock,float eccentricity){
   if(orbit.x==0.0)return vec3(0.0);
   float a=orbit.y+clock*orbit.z;
   if(eccentricity>0.){
     float m=mod(a+3.141592653589793,6.283185307179586)-3.141592653589793;
     a=m;
     for(int i=0;i<8;i++)a-=(a-eccentricity*sin(a)-m)/(1.-eccentricity*cos(a));
   }
   float minor=sqrt(1.-eccentricity*eccentricity);
   return orbit.x*vec3(cos(a)-eccentricity,sin(a)*minor*sin(orbit.w),sin(a)*minor*cos(orbit.w));
 }
`;

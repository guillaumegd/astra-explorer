import * as THREE from 'three';

// Schwarzschild units: the catalogue's body.radius is the horizon radius rs.
// Independently implemented from the orbit equation, no third-party shader code.
export const CRITICAL_IMPACT = Math.sqrt(27) / 2;
export const RAY_STEP = 0.04;
export const RAY_STEPS = 320;
export function advanceRay(u: number, v: number, h: number): [number, number] {
  const f = (x: number) => 1.5 * x * x - x;
  const a = f(u),
    b = f(u + (h * v) / 2);
  const c = f(u + (h * (v + (h * a) / 2)) / 2);
  const d = f(u + h * (v + (h * b) / 2));
  return [
    u + (h * (6 * v + h * (a + b + c))) / 6,
    v + (h * (a + 2 * b + 2 * c + d)) / 6,
  ];
}
export type OpticalRay = {
  captured: boolean;
  unresolved: boolean;
  direction: THREE.Vector3;
  intersections: {
    point: THREE.Vector3;
    direction: THREE.Vector3;
    phi: number;
    opacity: number;
  }[];
  residual: number;
};
/** CPU reference/picking: directions are in a static observer's local frame. */
export function traceGeodesic(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  inner = 3,
  outer = 20,
  step = RAY_STEP,
): OpticalRay {
  const radius = origin.length(),
    radial = origin.clone().normalize();
  const cosine = direction.dot(radial);
  const tangent = direction.clone().addScaledVector(radial, -cosine);
  const sine = tangent.length();
  const result: OpticalRay = {
    captured: false,
    unresolved: false,
    direction: direction.clone(),
    intersections: [],
    residual: 0,
  };
  if (radius <= 1 || sine < 1e-7) {
    result.captured = radius <= 1 || cosine < 0;
    return result;
  }
  tangent.divideScalar(sine);
  let u = 1 / radius,
    v = (-cosine * u * Math.sqrt(1 - u)) / sine,
    phi = 0;
  const energy = v * v + u * u * (1 - u);
  for (let i = 0; i < Math.ceil((RAY_STEPS * RAY_STEP) / step); i++) {
    // Limit the step for almost radial rays, which reach the horizon rapidly.
    const h = Math.min(step, 0.08 / Math.max(1, Math.abs(v)));
    const [nextU, nextV] = advanceRay(u, v, h);
    if (nextU > 0) {
      const start = radial
        .clone()
        .multiplyScalar(Math.cos(phi))
        .addScaledVector(tangent, Math.sin(phi))
        .divideScalar(u);
      const end = radial
        .clone()
        .multiplyScalar(Math.cos(phi + h))
        .addScaledVector(tangent, Math.sin(phi + h))
        .divideScalar(nextU);
      const dy = end.y - start.y;
      let lo = 0,
        hi = 1;
      if (Math.abs(dy) > 1e-7) {
        const a = (-0.18 - start.y) / dy,
          b = (0.18 - start.y) / dy;
        lo = Math.max(0, Math.min(a, b));
        hi = Math.min(1, Math.max(a, b));
      } else if (Math.abs(start.y) > 0.18) hi = -1;
      if (hi > lo) {
        const hDisk = (h * (lo + hi)) / 2,
          angle = phi + hDisk;
        const [diskU, diskV] = advanceRay(u, v, hDisk);
        const er = radial
          .clone()
          .multiplyScalar(Math.cos(angle))
          .addScaledVector(tangent, Math.sin(angle));
        const et = tangent
          .clone()
          .multiplyScalar(Math.cos(angle))
          .addScaledVector(radial, -Math.sin(angle));
        const point = er.clone().divideScalar(diskU),
          r = Math.hypot(point.x, point.z);
        if (r >= inner && r <= outer) {
          const density =
            THREE.MathUtils.smoothstep(r, inner, inner + 0.3) *
            (1 - THREE.MathUtils.smoothstep(r, outer * 0.8, outer));
          result.intersections.push({
            point,
            phi: angle,
            direction: er
              .multiplyScalar(-diskV)
              .addScaledVector(et, diskU * Math.sqrt(Math.max(0, 1 - diskU)))
              .normalize(),
            opacity:
              1 - Math.exp(-8 * start.distanceTo(end) * (hi - lo) * density),
          });
        }
      }
    }
    result.residual = Math.max(
      result.residual,
      Math.abs(nextV * nextV + nextU * nextU * (1 - nextU) - energy) /
        Math.max(energy, 1e-12),
    );
    if (nextU >= 1) {
      result.captured = true;
      return result;
    }
    if (nextU <= 0) {
      // Locate infinity within the last angular step.
      let lo = 0,
        hi = h;
      for (let j = 0; j < 16; j++) {
        const mid = (lo + hi) / 2;
        if (advanceRay(u, v, mid)[0] > 0) lo = mid;
        else hi = mid;
      }
      const angle = phi + (lo + hi) / 2;
      result.direction
        .copy(radial)
        .multiplyScalar(Math.cos(angle))
        .addScaledVector(tangent, Math.sin(angle))
        .normalize();
      return result;
    }
    u = nextU;
    v = nextV;
    phi += h;
  }
  result.unresolved = true;
  result.captured = true; // unresolved critical orbits never sample an arbitrary sky direction
  return result;
}

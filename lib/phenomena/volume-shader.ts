/**
 * Shared GLSL for the two volumetric regions, in the spirit of light-shaders.ts.
 *
 * The cloud turns rigidly at its centre's angular rate, exactly as a system
 * turns around its anchor. Applying the true differential shear per sample was
 * tried first and is not usable: the rate varies with radius, so a cloud one
 * unit across winds up into a 40-unit arc after half an hour of simulation, and
 * no bounding volume survives that. The cost is that stars drift slowly through
 * a cloud instead of staying locked to it; the rigid form is the lesser error.
 */
export const VOLUME_STEPS = [4, 8, 16] as const;
export const volumeChunk = `
  uniform vec2 uShear;
  uniform vec3 uGroupPos;
  uniform vec3 uCenterBase;
  uniform vec3 uEye;
  uniform float uEnvelope, uRadius, uFade, uDensity, uTime;
  uniform vec3 uGlow, uFilament, uPocket;
  varying vec3 vLocal;

  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }
  float valueNoise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x),
          mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x),
          mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p) {
    return valueNoise(p) * 0.54 +
           valueNoise(p * 2.03) * 0.3 +
           valueNoise(p * 4.11) * 0.16;
  }
  /** Entry and exit of the view ray through the bounding sphere. */
  bool volumeSpan(vec3 rd, out float t0, out float t1) {
    float b = dot(uEye, rd);
    float h = b * b - (dot(uEye, uEye) - uEnvelope * uEnvelope);
    if (h < 0.0) return false;
    h = sqrt(h);
    t0 = max(-b - h, 0.0);
    t1 = -b + h;
    return t1 > t0;
  }
  /** Base-space offset from the region centre; uShear is (cos, sin) of the
      centre's own rotation, so this is an exact rigid inverse. */
  vec3 basePoint(vec3 p) {
    vec3 g = p + uGroupPos;
    return vec3(
      uShear.x * g.x - uShear.y * g.z,
      g.y,
      uShear.y * g.x + uShear.x * g.z) - uCenterBase;
  }
`;
export const volumeVertex = `
  varying vec3 vLocal;
  void main() {
    vLocal = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

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
  uniform vec3 uEye;
  uniform float uEnvelope, uRadius, uFade, uDensity, uTime, uSeed, uFocus;
  uniform vec3 uGlow, uFilament, uPocket;
  uniform sampler2D uDither;
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
  /** Entry and exit of a ray through a sphere at the origin, clamped to t >= 0. */
  bool sphereSpan(vec3 ro, vec3 rd, float radius, out float t0, out float t1) {
    float b = dot(ro, rd);
    float h = b * b - (dot(ro, ro) - radius * radius);
    if (h < 0.0) return false;
    h = sqrt(h);
    t0 = max(-b - h, 0.0);
    t1 = -b + h;
    return t1 > t0;
  }
  /**
   * Per-pixel start offset for the march, from a tiled blue-noise pattern
   * (blue-noise.ts). A white hash turned undersampling into salt-and-pepper
   * grain, and interleaved gradient noise into a visible checkerboard, since
   * nothing here accumulates frames. The seed shifts the tile, so two
   * overlapping regions never dither in lockstep.
   */
  float marchDither() {
    vec2 shift = floor(fract(vec2(uSeed * 0.618034, uSeed * 0.754878)) * 32.0);
    return texture2D(uDither, (gl_FragCoord.xy + shift) / 32.0).r;
  }
  /**
   * How a framed region answers its selection: it brightens and saturates,
   * never thickens. The alpha is deliberately left untouched — raising it
   * would turn the veil into a wall and hide the stars behind it, which is
   * exactly what the volumes are written to avoid. Extrapolating past the
   * luminance can drive a channel negative, hence the clamp.
   */
  vec3 focusLift(vec3 straight) {
    float lum = dot(straight, vec3(0.2126, 0.7152, 0.0722));
    return max(vec3(0.0),
               mix(vec3(lum), straight, 1.0 + uFocus * 0.45)) *
           (1.0 + uFocus * 0.4);
  }
  /**
   * Output of a march for the premultiplied blend: emitted light, plus how
   * much of the background the gas hides. The occlusion is capped so a cloud
   * stays a veil, and the light is scaled down with it, never up. The light
   * is encoded as it is rather than divided by alpha and multiplied back:
   * mostly transparent glow would otherwise be darkened by the output curve
   * and lose exactly the faint, optically thin light a volume is made of.
   */
  // Calibrated against the former look (straight colour encoded, then
  // multiplied by alpha): a dense veil keeps its brightness, and thin glow
  // gains what that order used to take from it.
  const float VOLUME_EXPOSURE = 0.5;
  vec4 volumeOutput(vec3 light, float occlusion, float cap) {
    float alpha = min(cap, occlusion);
    light *= (alpha / max(occlusion, 0.0001)) * uFade;
    alpha *= uFade;
    if (alpha < 0.004 && max(light.r, max(light.g, light.b)) < 0.004) discard;
    gl_FragColor = vec4(focusLift(light * VOLUME_EXPOSURE), alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    return gl_FragColor;
  }
  /** Base-space offset from the region centre; uShear is (cos, sin) of the
      centre's own rotation. p is already relative to the animated host;
      its translation must never enter the noise/shell field. */
  vec3 basePoint(vec3 p) {
    vec3 g = p;
    return vec3(
      uShear.x * g.x - uShear.y * g.z,
      g.y,
      uShear.y * g.x + uShear.x * g.z);
  }
`;
export const volumeVertex = `
  varying vec3 vLocal;
  void main() {
    vLocal = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

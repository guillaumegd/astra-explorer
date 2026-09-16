import * as THREE from 'three';
import type { RegionDefinition } from '../catalogue/types.ts';
import { shearAngle } from '../particle-motion.ts';
import { blueNoiseTexture } from './blue-noise.ts';
import { volumeChunk, volumeVertex } from './volume-shader.ts';

const inverse = new THREE.Matrix4();

/**
 * A fragmented shell around a hollow cavity, sized on the same galactic ladder
 * as the nebulae (see REMNANT_RADIUS_SPAN) rather than on its host system. The
 * shock filaments stay steady; the envelope never expands, so the catalogue and
 * the framing stay fixed.
 */
export function createRemnant(region: RegionDefinition, steps = 16) {
  const group = new THREE.Group();
  const uniforms = {
    uShear: { value: new THREE.Vector2(1, 0) },
    uEye: { value: new THREE.Vector3() },
    uEnvelope: { value: region.envelope },
    uRadius: { value: region.radius },
    uFade: { value: 0 },
    uFocus: { value: 0 },
    uDensity: { value: region.density },
    uTime: { value: 0 },
    uSeed: { value: region.seed },
    uGlow: { value: new THREE.Color(region.palette[0]) },
    uFilament: { value: new THREE.Color(region.palette[1]) },
    uPocket: { value: new THREE.Color(region.palette[2]) },
    uDither: { value: blueNoiseTexture() },
  };
  const shaderOptions = {
    uniforms,
    vertexShader: volumeVertex,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.BackSide,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    fragmentShader: `
      ${volumeChunk}
      // Where the shell can hold matter, in radii: below the cavity gate and
      // past the outer cut the density is zero whatever the noise does.
      const float SHELL_INNER = 0.4;
      const float SHELL_OUTER = 1.0;
      // Mean radius of the corrugated shock front, and the radial spread of
      // its sheet once the folds (±0.11) are averaged with its own width.
      const float SHOCK_FRONT = 0.72;
      const float SHOCK_SPREAD = 0.085;
      // Share of the emitting column that also blocks background light.
      const float SHOCK_EXTINCTION = 0.35;
      void main() {
        vec3 rd = normalize(vLocal - uEye);
        // Matter only exists in the band between the cavity and the outer
        // cut, so the samples are spent there and nowhere else: the ray is
        // the outer sphere minus the cavity, walked as one continuous length.
        float a0, a1;
        if (!sphereSpan(uEye, rd, SHELL_OUTER * uRadius, a0, a1)) discard;
        float b0, b1;
        float near1 = a1, far0 = a1;
        if (sphereSpan(uEye, rd, SHELL_INNER * uRadius, b0, b1)) {
          near1 = clamp(b0, a0, a1);
          far0 = clamp(b1, a0, a1);
        }
        float nearLength = near1 - a0;
        float span = nearLength + (a1 - far0);
        if (span <= 0.0) discard;
        float dt = span / float(STEPS);
        float jitter = marchDither() * dt;
        // Below eight steps a ray gets too few samples to find two corrugated
        // sheets: the sampled filaments hand over to the shell's analytic
        // column, so a coarse tier keeps the hollow, limb-brightened ring and
        // only loses the filaments inside it. The blend follows the tier, not
        // the ray: per ray, grazing rays kept filaments the centre had already
        // given up, and drew a false ring.
        float detail = smoothstep(2.0, 10.0, float(STEPS));
        vec3 colour = vec3(0.0);
        float transmittance = 1.0;
        if (detail < 1.0) {
          float closest = -dot(uEye, rd) / uRadius;
          float impact2 = dot(uEye, uEye) / (uRadius * uRadius) - closest * closest;
          float chord2 = SHOCK_FRONT * SHOCK_FRONT - impact2;
          // A sheet of column sqrt(pi)·0.055 met at an angle: the path
          // through it lengthens as 1/cos, bounded at grazing incidence by
          // the thickness the corrugated front spreads over on average.
          float crossing = 1.7725 * 0.055 * SHOCK_FRONT /
            sqrt(max(chord2, 0.0) + 2.6 * SHOCK_FRONT * SHOCK_SPREAD);
          float chord = sqrt(max(chord2, 0.0));
          float shellColumn = chord2 > 0.0
            ? crossing * (step(0.0, closest - chord) + step(0.0, closest + chord))
            : 2.0 * crossing * step(0.0, closest) *
              exp(-pow((sqrt(impact2) - SHOCK_FRONT) / SHOCK_SPREAD, 2.0));
          // 0.95 is the mean of the sampled density factor over the front
          // (0.12 + 0.46 × 1.8, measured on the noise), 1.0 its mean tint gain.
          shellColumn *= uDensity * 0.95 * 3.2 * (1.0 - detail);
          // Linear in the column, like the thin gas it stands for: saturating
          // it would flatten the limb back into a uniform disc.
          colour += mix(uFilament, uGlow, 0.5) * (1.0 + uFocus * 0.3) *
                    min(shellColumn * 0.8, 1.5);
          transmittance *= exp(-shellColumn * SHOCK_EXTINCTION);
        }
        // A sheet thinner than a step is either hit or missed from one pixel
        // to the next: widen it to the step instead, and lower its peak by
        // the same factor so the column it contributes is unchanged. A coarse
        // tier then blurs the filaments rather than dissolving them.
        float width = max(0.055, dt / uRadius * 0.7);
        float sheet = 0.055 / width;
        // Expansion is imperceptible on the viewing timescale.
        for (int i = 0; i < STEPS; i++) {
          float s = jitter + float(i) * dt;
          float t = s < nearLength ? a0 + s : far0 + (s - nearLength);
          vec3 base = basePoint(uEye + rd * t);
          float r = length(base) / uRadius;
          vec3 q = base / uRadius;
          float folds = valueNoise(q * 4.2 + uSeed);
          float front = SHOCK_FRONT + (folds - 0.5) * 0.22;
          // Corrugated shock sheets; integration naturally brightens the limb.
          float shell = exp(-pow((r - front) / width, 2.0)) * sheet;
          shell *= smoothstep(0.35, 0.55, r) * (1.0 - smoothstep(0.87, 1.0, r));
          if (shell <= 0.002) continue;
          float n = fbm(q * 9.4 + folds * 2.0 + uSeed);
          float filament = 1.0 - smoothstep(0.025, 0.17, abs(n - 0.52));
          float fragments = smoothstep(0.26, 0.58, n);
          float density = uDensity * shell * (0.12 + filament * fragments * 1.8) * detail;
          float column = density * dt * 3.2 / uRadius;
          // Optically thin shock gas: it emits along the whole path but hides
          // little of what lies behind. A ray grazing the shell therefore
          // collects far more light than one crossing it face-on, which is
          // the limb-brightened ring a real remnant shows; one coverage term
          // for both saturated first and filled the disc evenly.
          float emitted = 1.0 - exp(-column);
          // Distinct line-emission layers; palette is an illustrative mapping.
          float outerShock = smoothstep(front - width, front + width, r);
          vec3 tint = mix(uFilament, uGlow, outerShock);
          // Focus sharpens the shock filaments first, as in the nebula.
          colour += tint * (0.6 + filament * (0.75 + uFocus * 0.6)) *
                    emitted * transmittance;
          transmittance *= exp(-column * SHOCK_EXTINCTION);
        }
        gl_FragColor = volumeOutput(colour, 1.0 - transmittance, 0.7);
      }`,
  };
  const viewMaterial = new THREE.ShaderMaterial({
    ...shaderOptions,
    defines: { STEPS: steps },
  });
  // Built lazily on first capture and never mutated again: sky capture no
  // longer forces a defines.STEPS recompile on every entry/exit.
  let captureMaterial: THREE.ShaderMaterial | null = null;
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(region.envelope, 32, 16),
    viewMaterial,
  );
  mesh.frustumCulled = false;
  mesh.onBeforeRender = (_renderer, _scene, camera) => {
    inverse.copy(mesh.matrixWorld).invert();
    uniforms.uEye.value
      .setFromMatrixPosition(camera.matrixWorld)
      .applyMatrix4(inverse);
  };
  group.add(mesh);
  return {
    group,
    region,
    update(
      time: number,
      fade: number,
      reducedMotion = false,
      rotation = 0,
      focus = 0,
    ) {
      uniforms.uTime.value = reducedMotion ? 0 : time;
      uniforms.uFade.value = fade;
      uniforms.uFocus.value = focus;
      const angle = shearAngle(region.center[0], region.center[2], rotation);
      uniforms.uShear.value.set(Math.cos(angle), Math.sin(angle));
      group.visible = fade > 0.002;
    },
    setSteps(next: number) {
      if (viewMaterial.defines.STEPS === next) return;
      viewMaterial.defines.STEPS = next;
      viewMaterial.needsUpdate = true;
    },
    setCaptureMode(active: boolean, captureSteps: number) {
      if (active) {
        captureMaterial ??= new THREE.ShaderMaterial({
          ...shaderOptions,
          defines: { STEPS: captureSteps },
        });
        mesh.material = captureMaterial;
      } else {
        mesh.material = viewMaterial;
      }
    },
    dispose() {
      mesh.geometry.dispose();
      viewMaterial.dispose();
      captureMaterial?.dispose();
      group.removeFromParent();
    },
  };
}

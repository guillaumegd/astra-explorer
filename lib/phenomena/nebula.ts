import * as THREE from 'three';
import type { RegionDefinition } from '../catalogue/types.ts';
import { shearAngle } from '../particle-motion.ts';
import { blueNoiseTexture } from './blue-noise.ts';
import { volumeChunk, volumeVertex } from './volume-shader.ts';

const inverse = new THREE.Matrix4();

/**
 * Back faces, not front: the volume keeps rendering when the camera enters it,
 * which is what makes entry, interior and exit continuous with no special case.
 * The mesh carries no rotation of its own, so its local space is the galaxy
 * group's space translated, which is the space the shear is defined in.
 */
export function createNebula(region: RegionDefinition, steps = 16) {
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
    // Premultiplied: the march accumulates light already weighted by coverage.
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.BackSide,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    fragmentShader: `
      ${volumeChunk}
      // Where the morphology is cut, in radii (see its last line).
      const float GAS_RADIUS = 1.04;
      // Emitted light per unit of glowing gas, matched by eye to the former
      // coverage-weighted colour so a cloud keeps its overall brightness.
      const float NEBULA_EMISSION = 0.7;
      // Three asymmetric morphologies, all strictly inside the integration bound.
      float morphology(vec3 q) {
        float angle = uSeed * 2.39996;
        q.xy = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * q.xy;
        float kind = mod(floor(uSeed), 3.0);
        float field;
        if (kind < 1.0) {
          // A folded ribbon with two unequal branches and a dark cleft.
          float spine = q.y - .24 * sin(q.x * 4.3 + uSeed);
          float spineGas = exp(-pow(spine / .22, 2.) - pow(q.z / .27, 2.));
          float branch = exp(-pow((q.y + .34 + q.x * .35) / .16, 2.) - pow((q.z - .15) / .2, 2.));
          field = max(spineGas, branch * .68) * (1. - smoothstep(.48, 1., abs(q.x)));
        } else if (kind < 2.0) {
          // Unequal lobes, with a pinched waist rather than a filled ball.
          float left = exp(-dot((q-vec3(-.38,.12,0.))/vec3(.36,.28,.25), (q-vec3(-.38,.12,0.))/vec3(.36,.28,.25)));
          float right = exp(-dot((q-vec3(.3,-.13,.1))/vec3(.5,.23,.3), (q-vec3(.3,-.13,.1))/vec3(.5,.23,.3)));
          field = max(left, right) * (1.-.65*exp(-q.x*q.x/.014));
        } else {
          // Broken wind-blown arc, offset cavity and trailing gas.
          float r = length(q.xy-vec2(-.14,.05));
          field = exp(-pow((r-.48)/.17,2.)-pow(q.z/.22,2.));
          field *= smoothstep(-.5,.15,q.x+q.y*.45);
        }
        return field * (1.-smoothstep(.86,1.04,length(q)));
      }
      void main() {
        // The morphology is cut at GAS_RADIUS, inside the envelope: the ray
        // is clipped there so no sample is spent where there is never gas.
        vec3 rd = normalize(vLocal - uEye);
        float t0, t1;
        if (!sphereSpan(uEye, rd, GAS_RADIUS * uRadius, t0, t1)) discard;
        float dt = (t1 - t0) / float(STEPS);
        float jitter = marchDither() * dt;
        // How much coarser than the reference (16 steps across a diameter)
        // this ray samples. Thin ridges and dust edges widen with it, so a
        // coarse tier softens the folds instead of breaking them into grain.
        float coarse = clamp(dt / uRadius / 0.13 - 1.0, 0.0, 4.0);
        float ridgeWidth = 0.15 * (1.0 + coarse * 0.5);
        float dustEdge = 0.82 + coarse * 0.05;
        vec3 colour = vec3(0.0);
        float transmittance = 1.0;
        for (int i = 0; i < STEPS; i++) {
          vec3 base = basePoint(uEye + rd * (t0 + jitter + float(i) * dt));
          vec3 q = base / uRadius;
          // Slow differential stirring, bounded well inside the region envelope.
          q += .025 * sin(vec3(q.y,q.z,q.x)*3. + uSeed + uTime*.035);
          float shape = valueNoise(q * 2.3 + uSeed);
          vec3 distorted = q + (vec3(shape, valueNoise(q*3.1+uSeed+9.), valueNoise(q*2.7+uSeed+23.))-.5)*.22;
          float falloff = morphology(distorted) * (1.-smoothstep(.9,1.04,length(q)));
          if (falloff <= 0.002) continue;
          // Coherent folds, rather than a spherical cloud of independent blobs.
          vec3 warp = vec3(shape, valueNoise(q * 2.1 + uSeed + 17.0),
                           valueNoise(q * 2.1 + uSeed + 39.0)) - 0.5;
          vec3 folded = q * vec3(3.4, 5.8, 3.4) + warp * 2.4 + uSeed +
                        vec3(0.0, uTime * 0.0015, uTime * 0.001);
          float n = fbm(folded);
          #if STEPS >= 12
          // Crossing a cloud puts gas a fraction of a radius from the eye,
          // where the three base octaves span a hundred pixels and the fold
          // reads as fog. Two finer octaves, faded in with proximity, give the
          // near gas the grain of its own filaments. Rich tiers only: a coarse
          // march could not resolve them anyway.
          float near = 1.0 - smoothstep(0.25, 1.1, (t0 + float(i) * dt) / uRadius);
          if (near > 0.0)
            n += ((valueNoise(folded * 8.3) - 0.5) * 0.16 +
                  (valueNoise(folded * 17.1) - 0.5) * 0.08) * near;
          #endif
          float dust = smoothstep(0.59, dustEdge, n);
          float ridge = 1.0 - smoothstep(0.035, ridgeWidth, abs(n - 0.48));
          float gas = smoothstep(0.25, 0.52, n) * (1.0 - dust * 0.8);
          // Gas glows and barely dims what lies behind it; dust glows faintly
          // and hides the background. Keeping the two apart is what gives the
          // cloud depth: a lane in front of a bright fold darkens it, where a
          // single coverage term only ever averaged their colours.
          float emitted = 1.0 - exp(-uDensity * falloff * gas * 0.55 * dt * 4.8 / uRadius);
          float veiled = 1.0 - exp(-uDensity * falloff * (gas * 0.2 + dust * 1.2) * dt * 4.8 / uRadius);
          float excitation = smoothstep(.3,.7,valueNoise(q*2.8+uSeed+51.));
          vec3 tint = mix(uGlow, uFilament, excitation);
          // Focus sharpens the filament ridges before it touches anything
          // else: what a framed cloud gains is structure, not bulk.
          tint *= 0.85 + ridge * (1.2 + uFocus * 0.9);
          colour += (tint * emitted * NEBULA_EMISSION + uPocket * 0.12 * veiled) *
                    transmittance;
          transmittance *= 1.0 - veiled;
        }
        // Seen from the core the cloud fills the whole field, so it has to stay
        // a veil: stars must remain readable and this must never be a wall.
        gl_FragColor = volumeOutput(colour, 1.0 - transmittance, 0.55);
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

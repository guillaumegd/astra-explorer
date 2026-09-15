import * as THREE from 'three';
import type { RegionDefinition } from '../catalogue/types.ts';
import { shearAngle } from '../particle-motion.ts';
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
        vec3 rd = normalize(vLocal - uEye);
        float t0, t1;
        if (!volumeSpan(rd, t0, t1)) discard;
        float dt = (t1 - t0) / float(STEPS);
        float jitter = hash13(vec3(gl_FragCoord.xy, uSeed)) * dt;
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
          float n = fbm(q * vec3(3.4, 5.8, 3.4) + warp * 2.4 + uSeed +
                       vec3(0.0, uTime * 0.0015, uTime * 0.001));
          float dust = smoothstep(0.59, 0.82, n);
          float ridge = 1.0 - smoothstep(0.035, 0.15, abs(n - 0.48));
          float gas = smoothstep(0.25, 0.52, n) * (1.0 - dust * 0.8);
          float density = uDensity * falloff * (gas * 0.55 + dust * 1.2);
          float coverage = 1.0 - exp(-density * dt * 4.8 / uRadius);
          float excitation = smoothstep(.3,.7,valueNoise(q*2.8+uSeed+51.));
          vec3 tint = mix(uGlow, uFilament, excitation);
          // Dust removes background light; it is not a dark luminous gas.
          // Focus sharpens the filament ridges before it touches anything
          // else: what a framed cloud gains is structure, not bulk.
          tint = mix(tint * (0.85 + ridge * (1.2 + uFocus * 0.9)),
                     uPocket * 0.12, dust);
          colour += tint * coverage * transmittance;
          transmittance *= 1.0 - coverage;
        }
        // Seen from the core the cloud fills the whole field, so it has to stay
        // a veil: stars must remain readable and this must never be a wall.
        float rawAlpha = 1.0 - transmittance;
        float alpha = min(0.55, rawAlpha) * uFade;
        if (alpha < 0.004) discard;
        // Convert straight emitted colour, then premultiply for the custom blend.
        gl_FragColor = vec4(focusLift(colour / max(rawAlpha, 0.0001)), alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        gl_FragColor.rgb *= alpha;
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

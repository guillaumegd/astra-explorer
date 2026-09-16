import * as THREE from 'three';
import type { RegionDefinition } from '../catalogue/types.ts';
import { shearAngle } from '../particle-motion.ts';
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
      void main() {
        vec3 rd = normalize(vLocal - uEye);
        float t0, t1;
        if (!volumeSpan(rd, t0, t1)) discard;
        float dt = (t1 - t0) / float(STEPS);
        float jitter = hash13(vec3(gl_FragCoord.xy, uSeed)) * dt;
        vec3 colour = vec3(0.0);
        float transmittance = 1.0;
        // Expansion is imperceptible on the viewing timescale.
        for (int i = 0; i < STEPS; i++) {
          vec3 base = basePoint(uEye + rd * (t0 + jitter + float(i) * dt));
          float r = length(base) / uRadius;
          vec3 q = base / uRadius;
          float folds = valueNoise(q * 4.2 + uSeed);
          float front = 0.72 + (folds - 0.5) * 0.22;
          // Corrugated shock sheets; integration naturally brightens the limb.
          float width = max(0.055, dt / uRadius * 0.32);
          float shell = exp(-pow((r - front) / width, 2.0));
          shell *= smoothstep(0.35, 0.55, r) * (1.0 - smoothstep(0.87, 1.0, r));
          if (shell <= 0.002) continue;
          float n = fbm(q * 9.4 + folds * 2.0 + uSeed);
          float filament = 1.0 - smoothstep(0.025, 0.17, abs(n - 0.52));
          float fragments = smoothstep(0.26, 0.58, n);
          float density = uDensity * shell * (0.12 + filament * fragments * 1.8);
          float coverage = 1.0 - exp(-density * dt * 3.2 / uRadius);
          // Distinct line-emission layers; palette is an illustrative mapping.
          float outerShock = smoothstep(front - width, front + width, r);
          vec3 tint = mix(uFilament, uGlow, outerShock);
          // Focus sharpens the shock filaments first, as in the nebula.
          colour += tint * (0.6 + filament * (0.75 + uFocus * 0.6)) *
                    coverage * transmittance;
          transmittance *= 1.0 - coverage;
        }
        float rawAlpha = 1.0 - transmittance;
        float alpha = min(0.7, rawAlpha) * uFade;
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

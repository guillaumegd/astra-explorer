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
    uDensity: { value: region.density },
    uTime: { value: 0 },
    uSeed: { value: region.seed },
    uGlow: { value: new THREE.Color(region.palette[0]) },
    uFilament: { value: new THREE.Color(region.palette[1]) },
    uPocket: { value: new THREE.Color(region.palette[2]) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    defines: { STEPS: steps },
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
      void main() {
        vec3 rd = normalize(vLocal - uEye);
        float t0, t1;
        if (!volumeSpan(rd, t0, t1)) discard;
        float dt = (t1 - t0) / float(STEPS);
        float jitter = hash13(vec3(gl_FragCoord.xy, uTime)) * dt;
        vec3 colour = vec3(0.0);
        float transmittance = 1.0;
        for (int i = 0; i < STEPS; i++) {
          vec3 base = basePoint(uEye + rd * (t0 + jitter + float(i) * dt));
          float r = length(base) / uRadius;
          // The silhouette follows a low frequency of the same field, so the
          // cloud is never the clean ball its bounding sphere would give.
          float shape = valueNoise(base * (0.9 / uRadius) + uSeed);
          float falloff =
            1.0 - smoothstep(0.28 + shape * 0.3, 0.72 + shape * 0.42, r);
          if (falloff <= 0.0) continue;
          float n = fbm(base * (3.4 / uRadius) + uSeed +
                        vec3(0.0, uTime * 0.015, uTime * 0.01));
          // Dark pockets: a soft threshold on the field, never a hard cut.
          float pocket = smoothstep(0.3, 0.62, n);
          float density = uDensity * falloff * pocket;
          if (density <= 0.002) continue;
          vec3 tint = mix(uPocket,
                          mix(uFilament, uGlow, smoothstep(0.46, 0.86, n)),
                          pocket);
          colour += tint * density * dt * transmittance * 0.42;
          transmittance *= exp(-density * dt * 0.3);
        }
        // Seen from the core the cloud fills the whole field, so it has to stay
        // a veil: stars must remain readable and this must never be a wall.
        float alpha = min(0.55, 1.0 - transmittance) * uFade;
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(colour * uFade, alpha);
      }`,
  });
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(region.envelope, 32, 16),
    material,
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
    update(time: number, fade: number, reducedMotion = false, rotation = 0) {
      uniforms.uTime.value = reducedMotion ? 0 : time;
      uniforms.uFade.value = fade;
      const angle = shearAngle(region.center[0], region.center[2], rotation);
      uniforms.uShear.value.set(Math.cos(angle), Math.sin(angle));
      group.visible = fade > 0.002;
    },
    setSteps(next: number) {
      if (material.defines.STEPS === next) return;
      material.defines.STEPS = next;
      material.needsUpdate = true;
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
      group.removeFromParent();
    },
  };
}

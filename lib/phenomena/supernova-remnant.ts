import * as THREE from 'three';
import type { RegionDefinition } from '../catalogue/types.ts';
import { shearAngle } from '../particle-motion.ts';
import { volumeChunk, volumeVertex } from './volume-shader.ts';

const inverse = new THREE.Matrix4();

/**
 * A fragmented shell around a hollow cavity, sized from its pulsar host. The
 * brightness breathes slowly; the envelope never expands, so the catalogue and
 * the framing stay fixed.
 */
export function createRemnant(region: RegionDefinition, steps = 16) {
  const group = new THREE.Group();
  const uniforms = {
    uShear: { value: new THREE.Vector2(1, 0) },
    uGroupPos: { value: new THREE.Vector3() },
    uCenterBase: { value: new THREE.Vector3(...region.center) },
    uEye: { value: new THREE.Vector3() },
    uEnvelope: { value: region.envelope },
    uRadius: { value: region.radius },
    uFade: { value: 0 },
    uDensity: { value: region.density },
    uTime: { value: 0 },
    uGlow: { value: new THREE.Color(region.palette[0]) },
    uFilament: { value: new THREE.Color(region.palette[1]) },
    uPocket: { value: new THREE.Color(region.palette[2]) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    defines: { STEPS: steps },
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
        float jitter = hash13(vec3(gl_FragCoord.xy, uTime)) * dt;
        vec3 colour = vec3(0.0);
        float transmittance = 1.0;
        // Luminosity breathes; the shell itself never moves.
        float breath = 0.86 + 0.14 * sin(uTime * 0.11);
        for (int i = 0; i < STEPS; i++) {
          vec3 base = basePoint(uEye + rd * (t0 + jitter + float(i) * dt));
          float r = length(base) / uRadius;
          // Narrow radial window: a hollow shell, not a filled cloud.
          float shell = exp(-pow((r - 0.76) / 0.17, 2.0));
          shell *= smoothstep(0.34, 0.56, r) * (1.0 - smoothstep(0.86, 1.0, r));
          if (shell <= 0.002) continue;
          // Higher frequency and harder contrast than a nebula: thin filaments.
          float n = fbm(base * (7.4 / uRadius));
          float filament = smoothstep(0.42, 0.72, n);
          float density = uDensity * shell * filament * breath;
          if (density <= 0.002) continue;
          vec3 tint = mix(uPocket, mix(uFilament, uGlow, filament), filament);
          colour += tint * density * dt * transmittance * 2.0 / uRadius;
          transmittance *= exp(-density * dt * 1.4 / uRadius);
        }
        float alpha = min(0.7, 1.0 - transmittance) * uFade;
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
      uniforms.uGroupPos.value.copy(group.position);
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

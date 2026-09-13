import * as THREE from 'three';

const fraction = (n: number) => n - Math.floor(n);
/** A steady dust outflow in tail-local space; lifecycle resets at zero opacity. */
export function cometGrain(
  index: number,
  seed: number,
  time: number,
  radius: number,
  tailLength: number,
  out: THREE.Vector3,
) {
  const key = fraction(Math.sin(index * 127.1 + seed * 31.7) * 43758.5453);
  const phase = fraction(time / (9 + key * 12) + key);
  const angle = index * 2.399963 + key * 6.283185;
  const spread = radius * (1.4 + phase * 12);
  out.set(
    Math.cos(angle) * spread + tailLength * 0.09 * phase * phase,
    radius * 1.3 + tailLength * 0.35 * phase ** 1.25,
    Math.sin(angle) * spread * 0.7,
  );
  return Math.sin(Math.PI * phase) ** 2;
}

export function createCometGrains(
  radius: number,
  tailLength: number,
  seed: number,
) {
  const count = 128;
  const positions = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
  const alphas = new THREE.BufferAttribute(new Float32Array(count), 1);
  positions.setUsage(THREE.DynamicDrawUsage);
  alphas.setUsage(THREE.DynamicDrawUsage);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', positions);
  geometry.setAttribute('aAlpha', alphas);
  const uniforms = {
    uFade: { value: 0 },
    uScale: { value: 600 },
    uSize: { value: radius * 0.22 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `attribute float aAlpha;varying float vAlpha;
      uniform float uScale,uSize;
      void main(){vec4 p=modelViewMatrix*vec4(position,1.);
        vAlpha=aAlpha;gl_Position=projectionMatrix*p;
        gl_PointSize=clamp(uSize*uScale/max(.000001,-p.z),1.,3.5);}`,
    fragmentShader: `varying float vAlpha;uniform float uFade;
      void main(){float r=length(gl_PointCoord-.5)*2.;
        float glow=exp(-r*r*4.)*(1.-smoothstep(.65,1.,r));
        gl_FragColor=vec4(.88,.83,.69,glow*vAlpha*uFade*.48);}`,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  const viewport = new THREE.Vector2(),
    scratch = new THREE.Vector3();
  points.onBeforeRender = (renderer, _scene, camera) => {
    renderer.getDrawingBufferSize(viewport);
    uniforms.uScale.value =
      camera.projectionMatrix.elements[5] * viewport.y * 0.5;
  };
  return {
    points,
    update(
      time: number,
      fade: number,
      activity: number,
      reducedMotion: boolean,
    ) {
      for (let i = 0; i < count; i++) {
        const alpha = cometGrain(
          i,
          seed,
          reducedMotion ? 0 : time,
          radius,
          tailLength,
          scratch,
        );
        positions.setXYZ(i, scratch.x, scratch.y, scratch.z);
        alphas.setX(i, alpha);
      }
      positions.needsUpdate = alphas.needsUpdate = true;
      uniforms.uFade.value = fade * Math.sqrt(activity);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      points.removeFromParent();
    },
  };
}

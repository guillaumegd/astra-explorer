import * as THREE from 'three';
import type { BodyIdentity } from '../catalogue/types.ts';

/** Two broad, smooth beam passages; no threshold or flash. */
export function pulsarIntensity(alignment: number, reducedMotion = false) {
  if (reducedMotion) return 0.5;
  const t = THREE.MathUtils.smoothstep(Math.abs(alignment), 0.72, 1);
  return t * t;
}

/** Local, bounded geometry; rotation uses the engine's shared simulation clock. */
export function createPulsar(body: BodyIdentity) {
  const p = body.pulsar!;
  const group = new THREE.Group();
  group.rotation.z = p.axisTilt;
  const rotor = new THREE.Group();
  const magnetic = new THREE.Group();
  magnetic.rotation.z = p.magneticTilt;
  group.add(rotor);
  rotor.add(magnetic);
  const uniforms = { uFade: { value: 0 }, uPulse: { value: 0.5 } };
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(body.radius, 32, 16),
    new THREE.ShaderMaterial({
      transparent: true,
      uniforms,
      vertexShader: `varying vec3 vNormal,vEye;
        void main(){vec4 p=modelViewMatrix*vec4(position,1.);
        vNormal=normalize(normalMatrix*normal);vEye=-p.xyz;
        gl_Position=projectionMatrix*p;}`,
      fragmentShader: `varying vec3 vNormal,vEye;uniform float uFade,uPulse;
        void main(){float facing=max(0.,dot(normalize(vNormal),normalize(vEye)));
        vec3 color=mix(vec3(.38,.65,.96),vec3(.94,.97,1.),pow(facing,.45));
        gl_FragColor=vec4(color*(.82+.18*uPulse),uFade);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        }`,
    }),
  );
  core.userData.bodyId = body.id;
  group.add(core);
  const beamMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms,
    vertexShader: `varying vec2 vUv;varying vec3 vNormal,vEye;
      void main(){vUv=uv;vec4 p=modelViewMatrix*vec4(position,1.);
      vNormal=normalize(normalMatrix*normal);vEye=-p.xyz;
      gl_Position=projectionMatrix*p;}`,
    fragmentShader: `varying vec2 vUv;varying vec3 vNormal,vEye;uniform float uFade,uPulse;
      void main(){
        float edge=sin(vUv.y*3.14159265);
        float filament=.8+.2*cos(vUv.x*37.6991118);
        float softEdge=pow(abs(dot(normalize(vNormal),normalize(vEye))),.7);
        float alpha=edge*edge*filament*softEdge*uFade*(.18+.04*uPulse);
        gl_FragColor=vec4(.36,.65,1.,alpha);
      }`,
  });
  // A narrow end at the source, a broad end fading before the envelope.
  const beamGeometry = new THREE.CylinderGeometry(
    body.radius * 2.1,
    body.radius * 0.32,
    body.radius * 8,
    32,
    1,
    true,
  );
  for (const sign of [-1, 1]) {
    const beam = new THREE.Mesh(beamGeometry, beamMaterial);
    beam.position.y = sign * body.radius * 5;
    beam.rotation.z = sign < 0 ? Math.PI : 0;
    magnetic.add(beam);
  }
  const haloMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms,
    vertexShader: `varying vec3 vNormal,vEye;
      void main(){vec4 p=modelViewMatrix*vec4(position,1.);
      vNormal=normalize(normalMatrix*normal);vEye=-p.xyz;
      gl_Position=projectionMatrix*p;}`,
    fragmentShader: `varying vec3 vNormal,vEye;uniform float uFade,uPulse;
      void main(){float facing=max(0.,dot(normalize(vNormal),normalize(vEye)));
      gl_FragColor=vec4(.35,.6,1.,pow(facing,3.)*uFade*(.1+.04*uPulse));}`,
  });
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(body.radius * 2.6, 32, 16),
    haloMaterial,
  );
  group.add(halo);
  let reduced = false;
  let intensity = 0.5;
  let opacity = 0;
  const eye = new THREE.Vector3();
  const inverse = new THREE.Matrix4();
  const observe: THREE.Mesh['onBeforeRender'] = (_renderer, _scene, camera) => {
    inverse.copy(magnetic.matrixWorld).invert();
    eye
      .setFromMatrixPosition(camera.matrixWorld)
      .applyMatrix4(inverse)
      .normalize();
    intensity = pulsarIntensity(eye.y, reduced);
    uniforms.uPulse.value = intensity;
  };
  // Transparent sorting changes with the viewpoint. Update before every part so
  // all parts use the same camera/phase, including the first frame after pause.
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) object.onBeforeRender = observe;
  });
  return {
    group,
    update(time: number, fade: number, reducedMotion = false) {
      reduced = reducedMotion;
      rotor.rotation.y =
        p.phase + (reduced ? 0 : (time * Math.PI * 2) / p.period);
      opacity = fade;
      uniforms.uFade.value = fade;

      core.material.depthWrite = fade > 0.99;
      group.visible = fade > 0.002;
      if (reduced) intensity = uniforms.uPulse.value = 0.5;
    },
    pulse() {
      return intensity;
    },
    pick(raycaster: THREE.Raycaster) {
      if (opacity < 0.1) return null;
      return raycaster.intersectObject(core, false)[0] ?? null;
    },
    dispose() {
      core.geometry.dispose();
      core.material.dispose();
      beamGeometry.dispose();
      beamMaterial.dispose();
      halo.geometry.dispose();
      haloMaterial.dispose();
      group.removeFromParent();
    },
  };
}

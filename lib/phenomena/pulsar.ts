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
  const uniforms = {
    uFade: { value: 0 },
    uPulse: { value: 0.5 },
    uTime: { value: 0 },
  };
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
        float along=vUv.y;
        float envelope=smoothstep(0.,.09,along)*(1.-smoothstep(.45,1.,along));
        float softEdge=pow(abs(dot(normalize(vNormal),normalize(vEye))),.65);
        float alpha=envelope*softEdge*uFade*(.09+.045*uPulse)/(1.+along*2.);
        vec3 tint=mix(vec3(.64,.81,1.),vec3(.24,.46,.86),along);
        gl_FragColor=vec4(tint,alpha);
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
  // A young pulsar wind nebula: equatorial termination-shock wisps and
  // polar outflows follow the spin axis, not the sweeping magnetic cones.
  const windEye = { value: new THREE.Vector3() };
  const windInverse = new THREE.Matrix4();
  const haloMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    uniforms: { ...uniforms, uEye: windEye, uRadius: { value: body.radius } },
    vertexShader: `varying vec3 vLocal;void main(){vLocal=position;
      gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `varying vec3 vLocal;uniform vec3 uEye;
      uniform float uRadius,uTime,uFade,uPulse;
      void main(){
        vec3 eye=uEye/uRadius, rd=normalize(vLocal-uEye);
        float b=dot(eye,rd), h=b*b-dot(eye,eye)+81.;
        if(h<=0.)discard;
        float start=max(0.,-b-sqrt(h)), end=-b+sqrt(h);
        // The opaque star occludes the far side, but not emission in front.
        float coreHit=b*b-dot(eye,eye)+1.;
        if(coreHit>0. && -b-sqrt(coreHit)>0.)end=min(end,-b-sqrt(coreHit));
        float ds=max(0.,end-start)/32.; vec3 light=vec3(0.);
        for(int i=0;i<32;i++){
          vec3 q=eye+rd*(start+(float(i)+.5)*ds);
          float r=length(q.xz), a=atan(q.z,q.x);
          float bend=.12*sin(a*3.+uTime*.09);
          float torus=exp(-pow((r-3.2-bend)/.65,2.)-pow(q.y/.62,2.));
          float wisp=exp(-pow((r-4.7-bend)/.42,2.)-pow(q.y/.36,2.))*.32;
          float nearSide=.65+.35*dot(normalize(vec3(q.x,0.,q.z)+vec3(.0001)),normalize(vec3(eye.x,0.,eye.z)+vec3(.0001)));
          float height=abs(q.y), width=.24+.055*height;
          float jet=exp(-r*r/(width*width))*smoothstep(.9,1.8,height)*(1.-smoothstep(5.,8.8,height));
          float coreGlow=exp(-dot(q,q)/2.8)*(.8+.12*uPulse);
          light+=(vec3(.38,.68,1.)*(torus+wisp)*nearSide*.5
            +vec3(.42,.76,1.)*jet*.65+vec3(.72,.86,1.)*coreGlow*.45)*ds;
        }
        gl_FragColor=vec4(light,uFade);
      }`,
  });
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(body.radius * 9, 32, 16),
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
    if (object instanceof THREE.Mesh)
      object.onBeforeRender = (
        renderer,
        scene,
        camera,
        geometry,
        material,
        renderGroup,
      ) => {
        observe(renderer, scene, camera, geometry, material, renderGroup);
        if (object === halo) {
          windInverse.copy(halo.matrixWorld).invert();
          windEye.value
            .setFromMatrixPosition(camera.matrixWorld)
            .applyMatrix4(windInverse);
        }
      };
  });
  return {
    group,
    update(time: number, fade: number, reducedMotion = false) {
      reduced = reducedMotion;
      uniforms.uTime.value = reduced ? 0 : time;
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

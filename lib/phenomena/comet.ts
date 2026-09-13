import * as THREE from 'three';
import { createCometGrains } from './comet-grains.ts';
import type { BodyIdentity } from '../catalogue/types.ts';
import { catalogue } from '../catalogue/runtime.ts';
import { compileOrbitChain, orbitalOffset } from '../orbits.ts';
import { sculptAsteroid } from '../asteroid-shape.ts';

export function cometActivity(distance: number, periapsis: number) {
  return Math.min(
    1,
    Math.max(0.025, (periapsis / Math.max(distance, periapsis)) ** 2),
  );
}

/** The ion tail points away from the primary star, never opposite velocity. */
export function createComet(body: BodyIdentity) {
  const p = body.comet!;
  const group = new THREE.Group();
  const base = new THREE.SphereGeometry(1, 32, 16);
  const nucleusGeometry = sculptAsteroid(base, body.seed);
  base.dispose();
  nucleusGeometry.scale(
    body.radius * 1.15,
    body.radius * 0.8,
    body.radius * 0.9,
  );
  const sunlight = { value: new THREE.Vector3(0, 1, 0) };
  const nucleusFade = { value: 0 };
  const nucleus = new THREE.Mesh(
    nucleusGeometry,
    new THREE.ShaderMaterial({
      transparent: true,
      uniforms: { uSun: sunlight, uFade: nucleusFade },
      vertexShader: `varying vec3 vNormal; void main(){
        vNormal=normal;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `varying vec3 vNormal;uniform vec3 uSun;uniform float uFade;
        void main(){float light=max(0.,dot(normalize(vNormal),normalize(uSun)));
        gl_FragColor=vec4(vec3(.12,.105,.09)*(.12+.88*light),uFade);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    }),
  );
  nucleus.userData.bodyId = body.id;
  group.add(nucleus);
  const uniforms = { uFade: { value: 0 }, uActivity: { value: 0 } };
  const comaEye = { value: new THREE.Vector3() };
  const comaInverse = new THREE.Matrix4();
  const coma = new THREE.Mesh(
    new THREE.SphereGeometry(body.radius * 8, 32, 16),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        ...uniforms,
        uEye: comaEye,
        uRadius: { value: body.radius * 8 },
      },
      vertexShader: `varying vec3 vLocal;void main(){vLocal=position;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `varying vec3 vLocal;uniform vec3 uEye;
        uniform float uRadius,uFade,uActivity;
        void main(){
          vec3 eye=uEye/uRadius, rd=normalize(vLocal-uEye);
          float b=dot(eye,rd), h=b*b-dot(eye,eye)+1.;
          if(h<=0.)discard;
          float start=max(0.,-b-sqrt(h)), end=-b+sqrt(h);
          float ds=max(0.,end-start)/16., column=0.;
          for(int i=0;i<16;i++){
            float r=length(eye+rd*(start+(float(i)+.5)*ds));
            column+=exp(-r*4.5)*(1.-smoothstep(.7,1.,r))*ds;
          }
          float alpha=(1.-exp(-column*2.8))*uFade*sqrt(uActivity);
          gl_FragColor=vec4(.43,.83,.79,alpha);
        }`,
    }),
  );
  coma.onBeforeRender = (_renderer, _scene, camera) => {
    comaInverse.copy(coma.matrixWorld).invert();
    comaEye.value
      .setFromMatrixPosition(camera.matrixWorld)
      .applyMatrix4(comaInverse);
  };
  group.add(coma);
  const tails = new THREE.Group();
  group.add(tails);
  const grains = createCometGrains(body.radius, p.tailLength, body.seed);
  tails.add(grains.points);
  const geometry = new THREE.CylinderGeometry(
    body.radius * 5,
    body.radius * 1.5,
    p.tailLength,
    20,
    12,
    true,
  );
  geometry.translate(0, p.tailLength / 2, 0);
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms,
    vertexShader: `varying vec2 vUv;varying vec3 vNormal,vEye;void main(){vUv=uv;vec4 p=modelViewMatrix*vec4(position,1.);vNormal=normalMatrix*normal;vEye=-p.xyz;gl_Position=projectionMatrix*p;}`,
    fragmentShader: `varying vec2 vUv;varying vec3 vNormal,vEye;uniform float uFade,uActivity;
      void main(){float t=vUv.y;
        float edge=pow(abs(dot(normalize(vNormal),normalize(vEye))),.65);
        float strands=.82+.18*cos(vUv.x*37.6991118+t*3.);
        float f=smoothstep(0.,.035,t)*exp(-t*3.)*(1.-smoothstep(.65,1.,t));
        gl_FragColor=vec4(.28,.55,1.,f*edge*strands*.32*uActivity*uFade);}`,
  });
  tails.add(new THREE.Mesh(geometry, material));
  const dustGeometry = geometry.clone();
  const positions = dustGeometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const t = positions.getY(i) / p.tailLength;
    positions.setX(i, positions.getX(i) * 2 + p.tailLength * 0.22 * t * t);
    positions.setY(i, positions.getY(i) * 0.7);
  }
  dustGeometry.computeVertexNormals();
  dustGeometry.computeBoundingSphere();
  const dustMaterial = material.clone();
  dustMaterial.uniforms = uniforms;
  dustMaterial.fragmentShader = material.fragmentShader.replace(
    '.28,.55,1.',
    '.88,.79,.62',
  );
  tails.add(new THREE.Mesh(dustGeometry, dustMaterial));
  const chain = compileOrbitChain(body.id, (id) => catalogue.getBody(id));
  const sourceChain = compileOrbitChain(body.rootId, (id) =>
    catalogue.getBody(id),
  );
  const offset = new THREE.Vector3(),
    source = new THREE.Vector3(),
    axis = new THREE.Vector3(0, 1, 0);
  const previous = new THREE.Vector3(),
    previousSource = new THREE.Vector3();
  const backward = new THREE.Vector3(),
    normal = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  let opacity = 0;
  return {
    group,
    update(time: number, fade: number, reducedMotion = false, orbitTime = 0) {
      orbitalOffset(chain, 0, orbitTime, offset.set(0, 0, 0));
      orbitalOffset(sourceChain, 0, orbitTime, source.set(0, 0, 0));
      offset.sub(source);
      const activity = cometActivity(offset.length(), p.periapsis);
      // A short orbital difference defines the trailing direction in the orbital
      // plane, including a moving primary in a binary. No history: pause and seek
      // produce exactly the same orientation as continuous playback.
      orbitalOffset(chain, 0, orbitTime - 0.01, previous.set(0, 0, 0));
      orbitalOffset(
        sourceChain,
        0,
        orbitTime - 0.01,
        previousSource.set(0, 0, 0),
      );
      backward.copy(previous).sub(previousSource).sub(offset);
      axis.copy(offset).normalize();
      sunlight.value.copy(axis).negate();
      backward.addScaledVector(axis, -backward.dot(axis));
      if (backward.lengthSq() < 1e-20) {
        backward.set(
          Math.abs(axis.x) < 0.9 ? 1 : 0,
          Math.abs(axis.x) < 0.9 ? 0 : 1,
          0,
        );
        backward.addScaledVector(axis, -backward.dot(axis));
      }
      backward.normalize();
      normal.crossVectors(backward, axis).normalize();
      basis.makeBasis(backward, axis, normal);
      tails.quaternion.setFromRotationMatrix(basis);
      tails.scale.setScalar(0.2 + 0.8 * activity);
      grains.update(time, fade, activity, reducedMotion);
      uniforms.uActivity.value = activity;
      uniforms.uFade.value = opacity = fade;
      nucleusFade.value = fade;
      nucleus.material.depthWrite = fade > 0.99;
      group.visible = fade > 0.002;
    },
    pick(raycaster: THREE.Raycaster) {
      return opacity >= 0.1
        ? (raycaster.intersectObject(nucleus, false)[0] ?? null)
        : null;
    },
    dispose() {
      grains.dispose();
      nucleus.geometry.dispose();
      nucleus.material.dispose();
      coma.geometry.dispose();
      coma.material.dispose();
      geometry.dispose();
      material.dispose();
      dustGeometry.dispose();
      dustMaterial.dispose();
      group.removeFromParent();
    },
  };
}

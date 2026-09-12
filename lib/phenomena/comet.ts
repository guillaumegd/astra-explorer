import * as THREE from 'three';
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
  nucleusGeometry.scale(body.radius, body.radius, body.radius);
  const nucleus = new THREE.Mesh(
    nucleusGeometry,
    new THREE.MeshBasicMaterial({ color: '#89959b', transparent: true }),
  );
  nucleus.userData.bodyId = body.id;
  group.add(nucleus);
  const uniforms = { uFade: { value: 0 }, uActivity: { value: 0 } };
  const coma = new THREE.Mesh(
    new THREE.SphereGeometry(body.radius * 8, 24, 12),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms,
      vertexShader: `varying vec3 n,v;void main(){vec4 p=modelViewMatrix*vec4(position,1.);n=normalMatrix*normal;v=-p.xyz;gl_Position=projectionMatrix*p;}`,
      fragmentShader: `varying vec3 n,v;uniform float uFade,uActivity;void main(){float f=max(0.,dot(normalize(n),normalize(v)));gl_FragColor=vec4(.35,.8,.9,pow(f,3.)*.35*uActivity*uFade);}`,
    }),
  );
  group.add(coma);
  const tails = new THREE.Group();
  group.add(tails);
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
    vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `varying vec2 vUv;uniform float uFade,uActivity;void main(){float f=pow(vUv.y,1.5)*sin(vUv.y*3.14159265);gl_FragColor=vec4(.28,.55,1.,f*.35*uActivity*uFade);}`,
  });
  tails.add(new THREE.Mesh(geometry, material));
  const dustGeometry = geometry.clone();
  const positions = dustGeometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const t = positions.getY(i) / p.tailLength;
    positions.setX(i, positions.getX(i) * 2 + p.tailLength * 0.22 * t * t);
    positions.setY(i, positions.getY(i) * 0.7);
  }
  dustGeometry.computeBoundingSphere();
  const dustMaterial = material.clone();
  dustMaterial.uniforms = uniforms;
  dustMaterial.fragmentShader = material.fragmentShader.replace(
    '.28,.55,1.',
    '.9,.75,.48',
  );
  tails.add(new THREE.Mesh(dustGeometry, dustMaterial));
  const chain = compileOrbitChain(body.id, (id) => catalogue.getBody(id));
  const sourceChain = compileOrbitChain(body.rootId, (id) =>
    catalogue.getBody(id),
  );
  const offset = new THREE.Vector3(),
    source = new THREE.Vector3(),
    axis = new THREE.Vector3(0, 1, 0);
  let opacity = 0;
  return {
    group,
    update(_time: number, fade: number, _reducedMotion = false, orbitTime = 0) {
      orbitalOffset(chain, 0, orbitTime, offset.set(0, 0, 0));
      orbitalOffset(sourceChain, 0, orbitTime, source.set(0, 0, 0));
      offset.sub(source);
      const activity = cometActivity(offset.length(), p.periapsis);
      tails.quaternion.setFromUnitVectors(axis, offset.normalize());
      tails.scale.setScalar(0.2 + 0.8 * activity);
      uniforms.uActivity.value = activity;
      uniforms.uFade.value = opacity = fade;
      nucleus.material.opacity = fade;
      nucleus.material.depthWrite = fade > 0.99;
      group.visible = fade > 0.002;
    },
    pick(raycaster: THREE.Raycaster) {
      return opacity >= 0.1
        ? (raycaster.intersectObject(nucleus, false)[0] ?? null)
        : null;
    },
    dispose() {
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

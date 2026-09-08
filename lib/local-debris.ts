import * as THREE from 'three';
import type { BodyIdentity } from './stellar-lod';

export const DEBRIS_COUNT = 96;
export function hasDebris(body: BodyIdentity) {
  return (
    body.rings || body.type === 8 || (body.type !== 0 && body.seed % 1 > 0.72)
  );
}

// A single lazy instanced draw for the selected body's sparse belt.
export function createLocalDebris(parent: THREE.Group) {
  let mesh: THREE.InstancedMesh<
    THREE.IcosahedronGeometry,
    THREE.ShaderMaterial
  > | null = null;
  let selectedId = -1;
  const dummy = new THREE.Object3D();
  const release = () => {
    if (!mesh) return;
    parent.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
    mesh.dispose();
    mesh = null;
    selectedId = -1;
  };
  return {
    update(
      body: BodyIdentity | null,
      position: THREE.Vector3,
      ratio: number,
      clock: number,
    ) {
      if (!body || !hasDebris(body) || ratio > 45) {
        release();
        return;
      }
      if (!mesh) {
        const material = new THREE.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          uniforms: { uFade: { value: 0 } },
          vertexShader: `varying vec3 vNormal; void main(){vNormal=normalize(normalMatrix*mat3(instanceMatrix)*normal);gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.0);}`,
          fragmentShader: `uniform float uFade;varying vec3 vNormal;void main(){float light=max(dot(normalize(vNormal),normalize(vec3(-0.8,0.5,1))),0.0);gl_FragColor=vec4(vec3(0.42,0.37,0.31)*(0.18+light*0.82),uFade);}`,
        });
        mesh = new THREE.InstancedMesh(
          new THREE.IcosahedronGeometry(1, 0),
          material,
          DEBRIS_COUNT,
        );
        mesh.frustumCulled = false;
        parent.add(mesh);
      }
      if (selectedId !== body.id) {
        let state = body.id + 471;
        const random = () => {
          state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
          return state / 4294967296;
        };
        for (let i = 0; i < DEBRIS_COUNT; i++) {
          const angle = random() * Math.PI * 2,
            radius = 2.8 + random() * 5;
          dummy.position.set(
            Math.cos(angle) * radius,
            (random() - 0.5) * 0.6,
            Math.sin(angle) * radius,
          );
          dummy.rotation.set(random() * 6, random() * 6, random() * 6);
          const size = 0.008 + random() ** 3 * 0.035;
          dummy.scale.set(
            size,
            size * (0.5 + random() * 0.4),
            size * (0.7 + random() * 0.3),
          );
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
        selectedId = body.id;
      }
      mesh.position.copy(position);
      mesh.scale.setScalar(body.radius);
      mesh.rotation.set(0.18, clock * 0.32, 0.1);
      mesh.material.uniforms.uFade.value =
        (1 - THREE.MathUtils.smoothstep(ratio, 20, 40)) *
        THREE.MathUtils.smoothstep(ratio, 1.1, 1.6);
      mesh.visible = mesh.material.uniforms.uFade.value > 0.001;
    },
    dispose: release,
  };
}

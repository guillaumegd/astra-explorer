import * as THREE from 'three';
import type { BodyIdentity } from '../catalogue/types.ts';

/** Artistic disk in a fixed world plane; shadow remains opaque against the sky. */
export function createBlackHole(body: BodyIdentity) {
  const p = body.phenomenon!;
  const group = new THREE.Group();
  group.rotation.z = p.tilt;
  const shadow = new THREE.Mesh(
    new THREE.SphereGeometry(p.shadowRadius, 48, 24),
    new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0,
    }),
  );
  const uniforms = {
    uTime: { value: 0 },
    uFade: { value: 0 },
    uColor: { value: new THREE.Color(body.color) },
    uOuter: { value: p.diskOuter / body.radius },
    uSeed: { value: body.seed },
  };
  // A finite slab keeps emission visible edge-on. All dimensions are in R.
  const inner = p.diskInner / body.radius;
  const outer = p.diskOuter / body.radius;
  const thickness = 0.45;
  const shape = new THREE.Shape();
  const radialLimit = Math.sqrt(outer * outer - (thickness * thickness) / 4);
  shape.absarc(0, 0, radialLimit, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, inner, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const diskGeometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
    steps: 1,
    curveSegments: 96,
  });
  diskGeometry.translate(0, 0, -thickness / 2);
  const eye = { value: new THREE.Vector3() };
  const inverse = new THREE.Matrix4();
  const disk = new THREE.Mesh(
    diskGeometry,
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: { ...uniforms, uEye: eye, uInner: { value: inner } },
      vertexShader: `varying vec3 vP;varying vec3 vN;
      void main(){vP=position;vN=normal;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `
      varying vec3 vP,vN;
      uniform float uTime,uFade,uOuter,uInner,uSeed;
      uniform vec3 uColor,uEye;
      float hash(vec3 p){p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}
      float noise(vec3 p){
        vec3 i=floor(p), f=fract(p);f=f*f*(3.-2.*f);
        return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
          mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
      }
      float flowField(float angle,float r,float age){
        float phase=angle-age*.22*pow(uInner/r,1.5)+1.6*log(r/uInner);
        vec3 flow=vec3(cos(phase)*3.,sin(phase)*3.,r*.8+uSeed+uTime*.01);
        float footprint=max(length(dFdx(flow)),length(dFdy(flow)));
        return mix(noise(flow),.5,smoothstep(.15,.7,footprint))*.62
          +mix(noise(flow*2.03),.5,smoothstep(.075,.35,footprint))*.27
          +mix(noise(flow*4.07),.5,smoothstep(.04,.175,footprint))*.11;
      }
      void main(){
        float r=length(vP.xy), a=atan(vP.y,vP.x);
        // Reset each advected field while it is invisible: shear never accumulates.
        float age=mod(uTime,24.);
        float blend=.5-.5*cos(age*6.28318530718/24.);
        float cloud=mix(flowField(a,r,mod(uTime+12.,24.)),flowField(a,r,age),blend);
        float filament=smoothstep(.2,.8,cloud);
        float edge=1.-smoothstep(uOuter*.72,uOuter,r);
        float innerEdge=smoothstep(uInner,uInner+.25,r);
        float side=1.-abs(vN.z);
        // The slab's inner wall stays luminous in a profile view.
        float profile=side*(.22+.78*(1.-smoothstep(uInner+.1,uInner+.5,r)));
        profile*=exp(-2.*pow(vP.z/.225,2.))*(1.-smoothstep(.02,.25,abs(normalize(uEye).z)));
        float faceVisibility=mix(smoothstep(0.,.06,abs(normalize(uEye-vP).z)),1.,side);
        float density=max(edge*innerEdge,profile*.65)*faceVisibility;
        float heat=pow(uInner/r,.75)*pow(max(0.,1.-sqrt(uInner/r)),.25);
        heat=clamp(heat*2.3,0.,1.);
        vec3 thermal=mix(uColor*.32,vec3(1.,.89,.7),heat*heat);
        vec3 velocity=vec3(-vP.y,vP.x,0.)/max(r,.001);
        float beta=.32*sqrt(uInner/r);
        float doppler=sqrt(1.-beta*beta)/(1.-beta*dot(velocity,normalize(uEye-vP)));
        float boost=clamp(pow(doppler,3.),.35,2.4);
        vec3 emission=thermal*(.35+1.8*heat)*(.4+1.1*filament)*boost;
        emission=emission/(vec3(1.)+emission);
        gl_FragColor=vec4(emission,density*uFade*(.5+.45*filament));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    }),
  );
  disk.onBeforeRender = (_renderer, _scene, camera) => {
    inverse.copy(disk.matrixWorld).invert();
    eye.value.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(inverse);
  };
  disk.scale.setScalar(body.radius);
  disk.rotation.x = -Math.PI / 2;
  disk.userData.bodyId = shadow.userData.bodyId = body.id;
  group.add(shadow, disk);
  const jetMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms,
    vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `varying vec2 vUv;uniform float uFade,uTime;uniform vec3 uColor;void main(){float a=sin(vUv.y*3.14159)*(.7+.3*sin(vUv.y*20.-uTime*.4));gl_FragColor=vec4(mix(uColor,vec3(.6,.75,1.),.6),a*uFade*.11);}`,
  });
  const jets: THREE.Mesh[] = [];
  if (p.jets)
    for (const sign of [-1, 1]) {
      const jet = new THREE.Mesh(
        new THREE.ConeGeometry(body.radius * 2, body.radius * 32, 24, 1, true),
        jetMaterial,
      );
      jet.position.y = sign * body.radius * 20;
      jet.rotation.z = sign > 0 ? Math.PI : 0;
      jets.push(jet);
      group.add(jet);
    }
  return {
    group,
    update(time: number, fade: number) {
      uniforms.uTime.value = time;
      uniforms.uFade.value = fade;
      shadow.material.opacity = fade;
      shadow.material.depthWrite = fade > 0.99;
      group.visible = fade > 0.002;
    },
    pick(raycaster: THREE.Raycaster) {
      return raycaster.intersectObjects([shadow, disk], false)[0] ?? null;
    },
    dispose() {
      shadow.geometry.dispose();
      shadow.material.dispose();
      disk.geometry.dispose();
      disk.material.dispose();
      jets.forEach((j) => j.geometry.dispose());
      jetMaterial.dispose();
      group.removeFromParent();
    },
  };
}

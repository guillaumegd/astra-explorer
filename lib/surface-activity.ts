import * as THREE from 'three';
import { terrainNoise } from './terrain-shaders.ts';

/** Sparse seeded surface particles: sand drift, lava fountains, icy jets,
 * and occasional ballistic dust on airless bodies. No per-frame allocations. */
export function createSurfaceActivity(
  type: number,
  seed: number,
  color: string,
) {
  if (![3, 5, 6, 7, 8].includes(type)) return null;
  const data = new Float32Array(768 * 3);
  for (let i = 0; i < 768; i++) {
    data[i * 3] = (i % 48) / 48;
    data[i * 3 + 1] = Math.floor(i / 48) / 16;
    data[i * 3 + 2] = (i * 0.61803398875 + seed) % 1;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(data, 3));
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: type === 6 ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: {
      uTime: { value: 0 },
      uFade: { value: 0 },
      uPixels: { value: 0 },
      uType: { value: type },
      uSeed: { value: seed },
      uColor: { value: new THREE.Color(type === 7 ? '#bceaff' : color) },
    },
    vertexShader: `uniform float uTime,uFade,uType,uSeed,uPixels; varying float vAlpha;
      ${terrainNoise}
      void main(){
        float longitude=position.y*100.53+uSeed;
        float latitude=sin(position.y*43.+uSeed)*.85;
        vec3 axis=vec3(cos(longitude)*sqrt(1.-latitude*latitude),latitude,sin(longitude)*sqrt(1.-latitude*latitude));
        vec3 right=normalize(cross(axis,vec3(0.,1.,0.))),up=cross(right,axis);
        float t=fract(position.x+uTime*(uType==5.?.08:.16));
        float emission=1.;
        float height=terrainHeight(axis,uSeed,uType);
        if(uType==6.) emission=1.-smoothstep(-.003,-.0015,height);
        if(uType==3.||uType==8.) emission=1.-smoothstep(2.,3.,mod(uTime+position.y*37.,29.));
        if(uType==7.) emission=.5+.5*sin(uTime*.12+longitude);
        float altitude=sin(t*3.14159)*(uType==5.?.002:uType==6.?.025:.035);
        vec3 p=axis*(1.+height+altitude+.0003);
        p+=right*((position.z-.5)*.003+t*(uType==5.?.025:.005));
        p+=up*(sin(position.x*73.)*.002*t);
        vAlpha=sin(t*3.14159)*emission;
        vec4 view=modelViewMatrix*vec4(p,1.);
        gl_Position=projectionMatrix*view;
        gl_PointSize=clamp(uPixels*.003*(.5+position.z),1.,6.);
      }`,
    fragmentShader: `uniform vec3 uColor; uniform float uFade,uType; varying float vAlpha;
      void main(){float d=length(gl_PointCoord-.5)*2.;if(d>1.)discard;
        gl_FragColor=vec4(uColor*(uType==6.?1.4:.85),(1.-smoothstep(.1,1.,d))*uFade*vAlpha*.65);}`,
  });
  const mesh = new THREE.Points(geometry, material);
  mesh.frustumCulled = false;
  return {
    mesh,
    update(time: number, fade: number, pixels: number) {
      material.uniforms.uTime.value = time;
      material.uniforms.uFade.value =
        fade * THREE.MathUtils.smoothstep(pixels, 150, 500);
      material.uniforms.uPixels.value = pixels;
      mesh.visible = material.uniforms.uFade.value > 0.001;
    },
    fadeOut(dt: number) {
      material.uniforms.uFade.value *= Math.exp(-dt / 0.18);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

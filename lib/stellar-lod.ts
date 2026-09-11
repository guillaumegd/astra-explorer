import * as THREE from 'three';
import { lightInView } from './body-lighting.ts';
import { sculptAsteroid } from './asteroid-shape.ts';
import { createSurfaceActivity } from './surface-activity.ts';
import { planetWeather } from './planet-weather.ts';
import { createStellarActivity } from './stellar-activity.ts';
import { compileOrbitChain, orbitalOffset } from './orbits.ts';
import { terrainNoise, terrainVertex } from './terrain-shaders.ts';

import { describeBody } from './catalogue/runtime.ts';
import type { BodyIdentity } from './catalogue/types.ts';
export { describeBody } from './catalogue/runtime.ts';
export type { BodyIdentity, BodyKind } from './catalogue/types.ts';

// CSS pixels + physical distance: identical behaviour on Retina and low-resolution screens.
export function surfaceVisibility(
  pixels: number,
  distanceInRadii: number,
): number {
  return (
    THREE.MathUtils.smoothstep(pixels, 18, 100) *
    (1 - THREE.MathUtils.smoothstep(distanceInRadii, 12, 48))
  );
}

export function surfaceLevel(ratio: number, current = 2): number {
  if (ratio < 1.04 || (current >= 5 && ratio < 1.06)) return 5;
  if (ratio < 1.18 || (current >= 4 && ratio < 1.24)) return 4;
  if (ratio < 1.8 || (current >= 3 && ratio < 2.0)) return 3;
  return 2;
}

export function minimumOrbitRatio(body: BodyIdentity): number {
  if (body.pulsar) return body.pulsar.exclusion / body.radius;
  if (body.phenomenon) return body.phenomenon.exclusion / body.radius;
  return body.type === 8
    ? 1.12
    : body.type === 0 || body.type === 2
      ? 1.08
      : 1.018;
}

export function selectStellarLevel(pixels: number, current: number): number {
  if (current === 2 && pixels > 155) return 2;
  if (pixels > 190) return 2;
  if (current >= 1 && pixels > 60) return 1;
  return pixels > 80 ? 1 : 0;
}

const vertexShader = `
 varying vec3 vPosition;
 varying vec3 vNormal;
 varying vec3 vView;
 void main() {
   vPosition = position;
   vNormal = normalize(normalMatrix * normal);
   vec4 vp = modelViewMatrix * vec4(position, 1.0);
   vView = -vp.xyz;
   gl_Position = projectionMatrix * vp;
 }
`;
const fragmentShader = `
 uniform float uTime, uDetail, uFade, uSeed, uType;
 uniform vec3 uColor,uLightDirection;
 uniform float uRelief,uIsPatch,uPatchAngle,uPatchEnabled,uSurfaceDetail;
 uniform vec3 uPatchAxis;
 uniform mat3 normalMatrix;
 ${terrainNoise}
 varying vec3 vPosition, vNormal, vView;
 float hash(vec3 p) { return fract(sin(dot(p,vec3(127.1,311.7,74.7))) * 43758.5453); }
 float noise(vec3 p) {
   vec3 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
   return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
     mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
 }
 float fbm(vec3 p) {
   float value=0.0,amp=0.5,total=0.0;
   for(int i=0;i<9;i++) {
     float weight=clamp(uDetail+3.0-float(i),0.0,1.0);
     if(weight<=0.0) break;
     value+=noise(p)*amp*weight; total+=amp*weight; p=p*2.07+3.1; amp*=0.5;
   }
   return value/total;
 }
 ${planetWeather}
 void main() {
   vec3 p=normalize(vPosition), offset=vec3(uSeed, uSeed*0.37, uSeed*0.71);
   float cap=dot(p,uPatchAxis)-cos(uPatchAngle);
   if(uPatchEnabled>0.5 && ((uIsPatch<0.5 && dot(p,uPatchAxis)>cos(uPatchAngle*0.82))||(uIsPatch>0.5 && cap<=0.0))) discard;
   float land=terrainLand(p,uSeed);
   vec3 shadingNormal=normalize(vNormal);
   if(uRelief>0.001 && uType>0.5 && uType!=2.0) {
     vec3 t=normalize(cross(p,abs(p.y)>0.95?vec3(1,0,0):vec3(0,1,0)));
     vec3 b=cross(p,t);
     float stepSize=max(0.001,length(fwidth(p))*2.0);
     float dx=(terrainHeight(normalize(p+t*stepSize),uSeed,uType)-terrainHeight(normalize(p-t*stepSize),uSeed,uType))/(2.0*stepSize);
     float dy=(terrainHeight(normalize(p+b*stepSize),uSeed,uType)-terrainHeight(normalize(p-b*stepSize),uSeed,uType))/(2.0*stepSize);
     shadingNormal=normalize(normalMatrix*normalize(p-(t*dx+b*dy)*uRelief));
   }
   float facing=max(dot(shadingNormal,normalize(vView)),0.0);
   float light=max(dot(shadingNormal,normalize(uLightDirection)),0.0);
   vec3 color;
   if(uType<0.5) {
     vec3 drift=vec3(uTime*0.022,-uTime*0.013,uTime*0.009);
     vec3 convection=vec3(noise(p*9.0+offset+drift),noise(p*9.0+offset-drift+17.0),noise(p*9.0+offset+drift+31.0))-.5;
     float plasma=fbm(p*12.0+offset+convection*1.7+drift);
     float cells=noise(p*65.0+offset+convection*2.5+drift*.7);
     plasma=mix(plasma,plasma*.75+cells*.25,smoothstep(0.,1.,uDetail));
     float spotField=noise(p*7.0+offset+vec3(uTime*.008,0.,uTime*.005));
     float spots=smoothstep(0.67,0.80,spotField);
     color=mix(uColor*0.25,mix(uColor,vec3(1.0),0.45),smoothstep(0.3,0.72,plasma));
     float stream=pow(.5+.5*sin(p.y*160.+convection.x*16.+noise(p*20.+offset)*9.-uTime*.8),9.);
     color+=uColor*stream*.22*smoothstep(0.,2.,uDetail);
     color*=(1.0-spots*0.7)*(0.5+0.7*pow(facing,0.35));
   } else if(uType<1.5) {
     float coast=smoothstep(0.485,0.495,land);
     vec3 ocean=mix(vec3(0.018,0.045,0.12),vec3(0.04,0.23,0.4),land*1.3);
     vec3 terrain=mix(uColor*0.38,uColor*1.3,smoothstep(0.50,0.72,land));
     color=mix(ocean,terrain,coast);
     float ice=smoothstep(0.82,0.98,abs(p.y)+land*0.12);
     color=mix(color,vec3(0.82,0.91,0.94),ice);

     color*=0.06+0.94*light;
     color+=vec3(0.12,0.35,0.6)*pow(1.0-facing,3.0)*light*0.6;
   } else if(uType<2.5) {
     color=gasWeather(p,offset,uColor,uTime)*(0.12+0.88*light);
     color+=vec3(.65,.75,1.)*weatherLightning(p)*1.6;
   } else if(uType>3.5 && uType<7.5) {
     if(uType<4.5) {
       float depth=fbm(p*8.0+offset);
       color=mix(uColor*0.12,uColor,depth);
       float islands=smoothstep(0.555,0.565,land);
       color=mix(color,vec3(0.22,0.35,0.18),islands);

     } else if(uType<5.5) {
       float dunes=duneField(p,uSeed);
       color=uColor*(0.45+land*0.75+dunes*0.12);
       color=mix(color,uColor*1.1,driftingVeil(p,.45)*.18);
     } else if(uType<6.5) {
       float fissures=1.0-smoothstep(-0.003,-0.0015,terrainHeight(p,uSeed,uType));
       color=vec3(0.085,0.065,0.055)*(0.6+land)*(0.08+light)+uColor*fissures*(0.65+0.3*sin(uTime*.7+land*35.+noise(p*90.+offset)*5.));
     } else {
       float cracks=iceField(p,uSeed);
       color=mix(uColor*(0.6+land*0.55),uColor*vec3(0.23,0.4,0.5),cracks*0.7);
       float glint=pow(max(dot(reflect(-normalize(uLightDirection),shadingNormal),normalize(vView)),0.),55.);
       color+=vec3(.7,.9,1.)*glint*noise(p*900.+offset)*.65;
     }
     if(uType<5.5 || uType>6.5) color*=0.07+0.93*light;
   } else {
     float rock=fbm(p*16.0+offset);
     vec2 crater=craterField(p,uSeed);
     float pit=crater.x, rim=crater.y;
     color=uColor*(0.28+rock*0.8-pit*0.22+rim*0.2)*(0.045+0.955*light);
   }

   if(uType==1.0 || uType==4.0) {
     float shore=uType==4.0?0.56:0.49;
     float aa=max(fwidth(land)*1.5,0.0006);
     float dry=smoothstep(-0.00002,0.00002,terrainHeight(p,uSeed,uType));
     float height=terrainHeight(p,uSeed,uType);
     float mountains=mountainRange(p,uSeed);
     float moisture=terrainNoise(p*18.0+offset+8.0);
     vec3 ground=mix(vec3(0.36,0.29,0.12),vec3(0.055,0.19,0.065),smoothstep(0.25,0.65,moisture));
     ground=mix(ground,vec3(0.27,0.24,0.20),smoothstep(0.10,0.38,mountains));
     float snow=smoothstep(0.008,0.013,height+abs(p.y)*0.004);
     ground=mix(ground,vec3(0.85,0.89,0.9),snow);
     float beach=(1.0-smoothstep(0.001,0.012,abs(land-shore)))*dry;
     ground=mix(ground,vec3(0.65,0.56,0.34),beach);
     float fine=terrainNoise(p*1800.0+offset);
     float strata=terrainNoise(p*420.0+offset);
     float grit=terrainNoise(p*7200.0+offset);
     ground*=0.64+strata*0.36+fine*0.28+grit*0.16;
     // Lighting uses the displaced mesh normal, without a second noisy slope mask.
     ground*=0.22+0.78*light;
     float shelf=smoothstep(shore-0.075,shore,land);
     vec3 ocean=mix(vec3(0.009,0.035,0.105),vec3(0.025,0.34,0.38),pow(shelf,3.0));
     ocean*=0.25+0.75*light;
     float spec=pow(max(dot(reflect(-normalize(uLightDirection),normalize(vNormal)),normalize(vView)),0.0),90.0);
     ocean+=vec3(0.5,0.6,0.65)*spec*0.35;
     color=mix(ocean,ground,dry);
   }
   if(uSurfaceDetail>0.001 && uType>1.5 && uType!=4.0) {
     float regional=noise(p*180.0+offset);
     float fine=noise(p*1200.0+offset);
     float micro=noise(p*6500.0+offset);
     float texture=0.7+regional*0.3+fine*0.22+micro*0.08;
     if(uType==2.0) {
       float turbulence=sin(p.y*260.0+regional*9.0+fine*2.0+uTime*0.02);
       texture=0.88+0.12*turbulence;
     }
     color*=mix(1.0,texture,uSurfaceDetail);
   }
   gl_FragColor=vec4(color,uFade);
 }
`;

const oceanFragment = `
 uniform float uSeed,uType,uFade,uTime;
 uniform vec3 uLightDirection;
 varying vec3 vPosition,vNormal,vView;
 ${terrainNoise}
 void main(){
   vec3 p=normalize(vPosition);
   float floorHeight=terrainHeight(p,uSeed,uType);
   if(floorHeight>=0.0)discard;
   float shelf=1.0-smoothstep(0.0,0.003,-floorHeight);
   vec3 color=mix(vec3(0.009,0.035,0.105),vec3(0.025,0.34,0.38),pow(shelf,2.0));
   vec3 n=normalize(vNormal),l=normalize(uLightDirection);
   vec3 waves=vec3(sin(p.x*850.+uTime*.7+p.z*160.),cos(p.y*710.-uTime*.6+p.x*180.),sin(p.z*790.+uTime*.5));
   n=normalize(n+waves*.055);
   color*=0.25+0.75*max(dot(n,l),0.0);
   float foam=(1.-smoothstep(0.,.0006,-floorHeight))*(.5+.5*sin(p.x*1600.+p.z*1300.-uTime*1.2));
   color=mix(color,vec3(.7,.85,.85),foam*.45);
   color+=vec3(0.4,0.5,0.6)*pow(max(dot(reflect(-l,n),normalize(vView)),0.0),90.0)*0.3;
   gl_FragColor=vec4(color,0.92*uFade);
 }
`;

export function atmosphereFor(body: BodyIdentity) {
  if (body.type === 1 || body.type === 4)
    return { color: '#78baff', clouds: 1.25, haze: 0.7, altitude: 1.045 };
  if (body.type === 2)
    return { color: body.color, clouds: 0.48, haze: 0.3, altitude: 1.018 };
  if (body.type === 5 && body.seed % 1 > 0.45)
    return { color: '#e9bb83', clouds: 0.16, haze: 0.22, altitude: 1.018 };
  return null;
}

// One raised shell supplies limb haze and drifting clouds. Noise stays attached
// to the shell, so camera motion reveals actual separation from the surface.
const atmosphereFragment =
  fragmentShader.split(' void main()')[0] +
  `

 uniform float uClouds, uHaze;
 uniform vec3 uLocalCamera,uLocalLight;
 float cloudDensity(vec3 p) {
   vec3 drift=vec3(uTime*0.018,0.0,uTime*0.011);
   vec3 q=p*12.0+vec3(uSeed,uSeed*0.37,uSeed*0.71)+drift;
   vec3 curl=vec3(sin(q.y*0.7+uTime*0.04),sin(q.z*0.7-uTime*0.03),sin(q.x*0.7))*0.65;
   float broad=noise(q*0.38);
   float billow=noise(q+curl)*0.58+noise(q*2.1+curl)*0.28+noise(q*4.2)*0.14;
   return smoothstep(0.43,0.66,billow)*smoothstep(0.35,0.6,broad);
 }
 void main() {
   vec3 p=normalize(vPosition);
   vec3 ray=normalize(p-uLocalCamera);
   float facing=max(dot(normalize(vNormal),normalize(vView)),0.0);
   float light=max(dot(normalize(vNormal),normalize(uLightDirection)),0.0);
   float transmittance=1.0; vec3 scattering=vec3(0.0);
   // Six samples through a thin shell: genuine depth-dependent accumulation,
   // with advected billows and self-shading, no full-screen volume pass.
   float stride=0.006;
   for(int i=0;i<6;i++) {
     vec3 samplePoint=p+ray*(float(i)+0.5)*stride;
     float radius=length(samplePoint);
     float envelope=smoothstep(0.952,0.966,radius)*(1.0-smoothstep(0.991,1.0,radius));
     float density=cloudDensity(samplePoint)*envelope;
     float shade=cloudDensity(samplePoint+uLocalLight*.015);
     float opacity=1.0-exp(-density*uClouds*0.9);
     vec3 tint=mix(vec3(0.97,0.98,1.0),uColor,uType==5.0?0.7:0.08);
     vec3 lit=tint*(0.28+0.72*light)*(1.0-shade*0.6);
     scattering+=transmittance*opacity*lit;
     transmittance*=1.0-opacity;
   }
   scattering+=vec3(.7,.8,1.)*weatherLightning(p)*uClouds*.5;
   float haze=pow(1.0-facing,2.8)*uHaze*(0.25+0.75*light);
   float alpha=1.0-transmittance;
   vec3 cloudColor=scattering/max(alpha,0.001);
   vec3 color=mix(cloudColor,uColor,haze/max(alpha+haze,0.001));
   gl_FragColor=vec4(color,clamp(alpha+haze,0.0,0.92)*uFade*smoothstep(0.0,0.055,facing));
 }

`;

export type BodyCandidate = {
  identity: BodyIdentity;
  position: THREE.Vector3;
  pixels: number;
  distanceInRadii?: number;
  cameraPosition?: THREE.Vector3;
  lightDirection?: THREE.Vector3;
};
type Entry = {
  group: THREE.Group;
  lightDirection: THREE.Vector3;
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  activity?: ReturnType<typeof createStellarActivity>;
  surfaceActivity?: ReturnType<typeof createSurfaceActivity>;
  asteroidGeometries?: Map<number, THREE.SphereGeometry>;
  level: number;
  lastSeen: number;
  fade: number;
  ocean?: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  patch?: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  surfaceLevel?: number;
  patchAnchored?: boolean;
  atmosphere?: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  ring?: THREE.Mesh<THREE.RingGeometry, THREE.ShaderMaterial>;
};
export const MAX_DETAILED_BODIES = 12; // Eight active meshes plus four fading/cached bodies.
export const MAX_ACTIVE_BODIES = 8;

export function createBodyLOD(
  parent: THREE.Group,
  cacheLimit = MAX_DETAILED_BODIES,
) {
  const geometries = new Map<number, THREE.SphereGeometry>();
  const entries = new Map<number, Entry>();
  const patchGeometries = new Map<number, THREE.PlaneGeometry>();
  const patchFor = (level: number) => {
    const segments = level >= 5 ? 128 : level >= 4 ? 64 : 32;
    if (!patchGeometries.has(segments))
      patchGeometries.set(
        segments,
        new THREE.PlaneGeometry(2, 2, segments, segments),
      );
    return patchGeometries.get(segments)!;
  };
  let previousTime: number | null = null;
  const geometryFor = (level: number) => {
    let geometry = geometries.get(level);
    if (!geometry) {
      const segments = [20, 48, 96, 192][level];
      geometry = new THREE.SphereGeometry(1, segments, segments / 2);
      geometries.set(level, geometry);
    }
    return geometry;
  };
  const release = (id: number, entry: Entry) => {
    parent.remove(entry.group);
    entry.mesh.material.dispose();
    entry.asteroidGeometries?.forEach((geometry) => geometry.dispose());
    entry.activity?.dispose();
    entry.surfaceActivity?.dispose();
    entry.ocean?.material.dispose();
    entry.atmosphere?.material.dispose();
    entry.patch?.material.dispose();
    entry.ring?.geometry.dispose();
    entry.ring?.material.dispose();
    entries.delete(id);
  };
  return {
    update(
      candidates: BodyCandidate[],
      time: number,
      spin: number,
      activityTime = time,
    ) {
      const dt =
        previousTime === null
          ? 0
          : Math.max(0, Math.min(time - previousTime, 0.1));
      previousTime = time;
      const active = candidates
        .filter(
          (c) =>
            c.identity.capabilities.renderClass === 'ordinary' &&
            surfaceVisibility(c.pixels, c.distanceInRadii ?? 0) > 0,
        )
        .slice(0, MAX_ACTIVE_BODIES);
      const ids = new Set(active.map((c) => c.identity.id));
      const fades: { id: number; fade: number }[] = [];
      for (const [id, entry] of entries) {
        if (ids.has(id)) continue;
        const candidate = candidates.find((c) => c.identity.id === id);
        if (candidate) entry.group.position.copy(candidate.position);
        entry.fade *= Math.exp(-dt / 0.18);
        entry.activity?.fadeOut(activityTime, dt);
        entry.surfaceActivity?.fadeOut(dt);
        entry.mesh.material.uniforms.uFade.value = entry.fade;
        entry.mesh.material.depthWrite = false;
        if (entry.atmosphere)
          entry.atmosphere.material.uniforms.uFade.value = entry.fade;
        if (entry.ring) entry.ring.material.uniforms.uFade.value = entry.fade;
        entry.group.visible = entry.fade > 0.002;
        if (entry.group.visible) fades.push({ id, fade: entry.fade });
        if (time - entry.lastSeen > 4) release(id, entry);
      }
      for (const candidate of active) {
        const { identity: body, position, pixels } = candidate;
        let entry = entries.get(body.id);
        const isNew = !entry;
        if (!entry) {
          if (entries.size >= cacheLimit) {
            const stale = [...entries].find(([id]) => !ids.has(id));
            if (stale) release(stale[0], stale[1]);
          }
          const material = new THREE.ShaderMaterial({
            vertexShader: terrainVertex,
            fragmentShader,
            polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1,
            transparent: true,
            depthWrite: true,
            uniforms: {
              uLightDirection: { value: new THREE.Vector3(1, 0, 0) },
              uRelief: { value: body.type === 8 ? 1 : 0 },
              uNormalStep: { value: 0.03 },
              uSurfaceDetail: { value: 0 },
              uIsPatch: { value: 0 },
              uPatchEnabled: { value: 0 },
              uPatchAngle: { value: 0.3 },
              uPatchAxis: { value: new THREE.Vector3(0, 0, 1) },
              uPatchRight: { value: new THREE.Vector3(1, 0, 0) },
              uPatchUp: { value: new THREE.Vector3(0, 1, 0) },
              uTime: { value: 0 },
              uDetail: { value: 0 },
              uFade: { value: 0 },
              uSeed: { value: body.seed },
              uType: { value: body.type },
              uColor: { value: new THREE.Color(body.color) },
            },
          });
          const group = new THREE.Group();
          group.scale.setScalar(body.radius);
          const mesh = new THREE.Mesh(geometryFor(0), material);
          mesh.userData.bodyId = body.id;
          group.add(mesh);
          parent.add(group);
          entry = {
            group,
            mesh,
            lightDirection: new THREE.Vector3(1, 0, 0),
            level: 0,
            lastSeen: time,
            fade: 0,
          };
          const lightingEntry = entry;
          const viewLight = material.uniforms.uLightDirection;
          const updateLight = (
            _renderer: THREE.WebGLRenderer,
            _scene: THREE.Scene,
            camera: THREE.Camera,
          ) => {
            lightInView(
              lightingEntry.lightDirection,
              parent.matrixWorld,
              camera.matrixWorldInverse,
              viewLight.value,
            );
          };
          mesh.onBeforeRender = updateLight;
          entry.surfaceActivity = createSurfaceActivity(
            body.type,
            body.seed,
            body.color,
          );
          if (entry.surfaceActivity) group.add(entry.surfaceActivity.mesh);
          if (body.type === 0) {
            entry.activity = createStellarActivity(
              body.seed,
              body.color,
              body.kind,
            );
            group.add(entry.activity.group);
          }
          if (body.type === 1 || body.type === 4) {
            const oceanMaterial = new THREE.ShaderMaterial({
              vertexShader,
              fragmentShader: oceanFragment,
              transparent: true,
              depthWrite: false,
              uniforms: {
                uSeed: { value: body.seed },
                uType: { value: body.type },
                uTime: material.uniforms.uTime,
                uLightDirection: material.uniforms.uLightDirection,
                uFade: material.uniforms.uFade,
              },
            });
            entry.ocean = new THREE.Mesh(geometryFor(3), oceanMaterial);
            entry.ocean.onBeforeRender = updateLight;
            group.add(entry.ocean);
          }
          const air = atmosphereFor(body);
          if (air) {
            const airMaterial = new THREE.ShaderMaterial({
              vertexShader,
              fragmentShader: atmosphereFragment,
              transparent: true,
              depthWrite: false,
              uniforms: {
                uTime: { value: 0 },
                uDetail: { value: 0 },
                uFade: { value: 0 },
                uSeed: { value: body.seed },
                uType: { value: body.type },
                uColor: { value: new THREE.Color(air.color) },
                uLightDirection: material.uniforms.uLightDirection,
                uLocalLight: { value: new THREE.Vector3(1, 0, 0) },
                uLocalCamera: { value: new THREE.Vector3(0, 0, 4) },
                uClouds: { value: air.clouds },
                uHaze: { value: air.haze },
              },
            });
            entry.atmosphere = new THREE.Mesh(geometryFor(0), airMaterial);
            entry.atmosphere.scale.setScalar(air.altitude);
            entry.atmosphere.onBeforeRender = (renderer, scene, camera) => {
              updateLight(renderer, scene, camera);
              const worldLight = lightingEntry.lightDirection
                .clone()
                .transformDirection(parent.matrixWorld);
              airMaterial.uniforms.uLocalLight.value
                .copy(worldLight)
                .transformDirection(
                  lightingEntry.atmosphere!.matrixWorld.clone().invert(),
                );
            };
            group.add(entry.atmosphere);
          }
          if (body.rings) {
            const ringMaterial = new THREE.ShaderMaterial({
              transparent: true,
              side: THREE.DoubleSide,
              depthWrite: false,
              uniforms: {
                uColor: { value: new THREE.Color(body.color) },
                uFade: { value: 0 },
              },
              vertexShader:
                'varying vec3 vP; void main(){vP=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
              fragmentShader:
                'uniform vec3 uColor;uniform float uFade;varying vec3 vP;void main(){float r=length(vP.xy);float bands=0.3+0.4*pow(sin(r*95.0),2.0);gl_FragColor=vec4(uColor*0.7,bands*uFade);}',
            });
            entry.ring = new THREE.Mesh(
              new THREE.RingGeometry(1.35, 2.1, 72),
              ringMaterial,
            );
            entry.ring.rotation.x = -1.05;
            group.add(entry.ring);
          }
          entries.set(body.id, entry);
        }
        if (candidate.lightDirection)
          entry.lightDirection.copy(candidate.lightDirection);
        entry.lastSeen = time;
        entry.group.visible = true;
        entry.group.position.copy(position);
        entry.level = selectStellarLevel(pixels, entry.level);
        if (body.type === 8) {
          entry.asteroidGeometries ??= new Map();
          if (!entry.asteroidGeometries.has(entry.level))
            entry.asteroidGeometries.set(
              entry.level,
              sculptAsteroid(geometryFor(entry.level), body.seed),
            );
          entry.mesh.geometry = entry.asteroidGeometries.get(entry.level)!;
        } else entry.mesh.geometry = geometryFor(entry.level);
        entry.mesh.material.uniforms.uNormalStep.value =
          Math.PI / [20, 48, 96][entry.level];
        entry.mesh.rotation.set(
          0.12,
          spin * (0.2 + body.seed * 0.004),
          body.seed * 0.01,
        );
        if (entry.ocean) entry.ocean.rotation.copy(entry.mesh.rotation);
        const target = surfaceVisibility(
          pixels,
          candidate.distanceInRadii ?? 0,
        );
        entry.fade +=
          (target - entry.fade) * (1 - Math.exp(-(isNew ? 0 : dt) / 0.28));
        const fade = entry.fade;
        if (entry.surfaceActivity) {
          entry.surfaceActivity.mesh.rotation.copy(entry.mesh.rotation);
          entry.surfaceActivity.update(activityTime, fade, pixels);
        }
        if (entry.activity) {
          entry.activity.group.rotation.copy(entry.mesh.rotation);
          entry.activity.update(
            activityTime,
            fade,
            pixels,
            candidate.cameraPosition,
          );
        }
        entry.mesh.material.uniforms.uTime.value = activityTime;

        entry.mesh.material.uniforms.uFade.value = fade;
        const ratio = candidate.distanceInRadii ?? 50;
        const detailRatio = body.type === 2 ? 1 + (ratio - 1) * 0.35 : ratio;
        entry.surfaceLevel = surfaceLevel(detailRatio, entry.surfaceLevel);
        const solid = body.type !== 0 && body.type !== 2;
        const close =
          body.type !== 0 && ratio < 2 && !!candidate.cameraPosition;
        const surfaceUniforms = entry.mesh.material.uniforms;
        surfaceUniforms.uRelief.value +=
          ((solid ? 1 : 0) - surfaceUniforms.uRelief.value) *
          (1 - Math.exp(-dt * 4));
        const detail =
          body.type !== 0
            ? 1 - THREE.MathUtils.smoothstep(detailRatio, 1.04, 1.8)
            : 0;
        const detailLevel = close
          ? Math.max(entry.level, entry.surfaceLevel)
          : entry.level;
        surfaceUniforms.uDetail.value +=
          (detailLevel - surfaceUniforms.uDetail.value) *
          (1 - Math.exp(-dt / 0.4));
        surfaceUniforms.uSurfaceDetail.value +=
          (detail - surfaceUniforms.uSurfaceDetail.value) *
          (1 - Math.exp(-dt * 4));
        surfaceUniforms.uPatchEnabled.value = close ? 1 : 0;
        if (close) {
          if (!entry.patch) {
            const patchMaterial = new THREE.ShaderMaterial({
              vertexShader: terrainVertex,
              fragmentShader,
              transparent: true,
              depthWrite: true,
              uniforms: {
                ...surfaceUniforms,
                uIsPatch: { value: 1 },
                uNormalStep: { value: 0.001 },
              },
            });
            entry.patch = new THREE.Mesh(
              patchFor(entry.surfaceLevel),
              patchMaterial,
            );
            entry.patch.onBeforeRender = (...args) =>
              entry!.mesh.onBeforeRender(...args);
            entry.patch.frustumCulled = false;
            entry.group.add(entry.patch);
          }
          entry.group.updateWorldMatrix(true, false);
          const axis = surfaceUniforms.uPatchAxis.value as THREE.Vector3;
          const nextAxis = candidate.cameraPosition!.clone();
          entry.group.worldToLocal(nextAxis);
          nextAxis
            .applyQuaternion(entry.mesh.quaternion.clone().invert())
            .normalize();
          // Anchor a generously sized tile in body coordinates. Tiny camera/spin
          // changes no longer resample the entire grid every frame.
          const desiredAngle =
            entry.surfaceLevel >= 5
              ? 0.06
              : entry.surfaceLevel >= 4
                ? 0.5
                : 0.95;
          if (
            !entry.patchAnchored ||
            surfaceUniforms.uPatchAngle.value !== desiredAngle ||
            axis.angleTo(nextAxis) > desiredAngle * 0.35
          ) {
            axis.copy(nextAxis);
            const right = surfaceUniforms.uPatchRight.value as THREE.Vector3;
            right
              .set(
                Math.abs(axis.y) > 0.95 ? 1 : 0,
                Math.abs(axis.y) > 0.95 ? 0 : 1,
                0,
              )
              .cross(axis)
              .normalize();
            (surfaceUniforms.uPatchUp.value as THREE.Vector3)
              .crossVectors(axis, right)
              .normalize();
            surfaceUniforms.uPatchAngle.value = desiredAngle;
            entry.patchAnchored = true;
          }
          entry.patch.geometry = patchFor(entry.surfaceLevel);
          entry.patch.material.uniforms.uNormalStep.value = Math.max(
            0.0005,
            (2 * Math.tan(surfaceUniforms.uPatchAngle.value)) /
              entry.patch.geometry.parameters.widthSegments,
          );
          entry.patch.rotation.copy(entry.mesh.rotation);
          entry.patch.visible = true;
          entry.patch.material.depthWrite = fade > 0.995;
        } else if (entry.patch) entry.patch.visible = false;

        if (entry.atmosphere) {
          const air = entry.atmosphere;
          air.geometry = geometryFor(
            body.type === 2 && ratio < 1.3 ? 3 : Math.min(entry.level, 1),
          );
          air.rotation.copy(entry.mesh.rotation);
          air.rotation.y += activityTime * (0.012 + (body.seed % 1) * 0.012);
          if (candidate.cameraPosition) {
            entry.group.updateWorldMatrix(true, false);
            const eye = air.material.uniforms.uLocalCamera
              .value as THREE.Vector3;
            eye.copy(candidate.cameraPosition);
            entry.group.worldToLocal(eye);
            eye
              .applyQuaternion(air.quaternion.clone().invert())
              .divideScalar(air.scale.x);
          }
          air.material.uniforms.uTime.value = activityTime;
          air.material.uniforms.uDetail.value = Math.min(
            1,
            entry.mesh.material.uniforms.uDetail.value,
          );
          air.material.uniforms.uFade.value =
            fade * THREE.MathUtils.smoothstep(ratio, 1.025, 1.09);
        }
        // Avoid an invisible sphere occluding the original point at the start of the transition.
        entry.mesh.material.depthWrite = fade > 0.995;
        if (entry.ring) entry.ring.material.uniforms.uFade.value = fade;
        fades.push({ id: body.id, fade });
      }
      if (entries.size === 0) {
        geometries.forEach((g) => g.dispose());
        geometries.clear();
        patchGeometries.forEach((g) => g.dispose());
        patchGeometries.clear();
      }
      return fades;
    },
    pickHit(raycaster: THREE.Raycaster) {
      return (
        raycaster.intersectObjects(
          [...entries.values()]
            .filter((e) => e.group.visible)
            .map((e) => e.mesh),
          false,
        )[0] ?? null
      );
    },
    pick(raycaster: THREE.Raycaster): number | null {
      const meshes = [...entries.values()]
        .filter((e) => e.group.visible)
        .map((e) => e.mesh);
      return (
        raycaster.intersectObjects(meshes, false)[0]?.object.userData.bodyId ??
        null
      );
    },
    stats() {
      return {
        cached: entries.size,
        visible: [...entries.values()].filter((e) => e.group.visible).length,
        geometries: geometries.size,
        patches: [...entries.values()].filter(
          (e) => e.patch?.visible && e.group.visible,
        ).length,
        surfaceLevel: Math.max(
          0,
          ...[...entries.values()]
            .filter((e) => e.patch?.visible)
            .map((e) => e.surfaceLevel ?? 0),
        ),
      };
    },
    dispose() {
      for (const [id, entry] of entries) release(id, entry);
      geometries.forEach((g) => g.dispose());
      geometries.clear();
      patchGeometries.forEach((g) => g.dispose());
      patchGeometries.clear();
    },
  };
}

/** Initial orbital position; animation uses the same compiled hierarchy. */
export function systemOffset(id: number): [number, number, number] {
  const out = orbitalOffset(compileOrbitChain(id, describeBody), 0, 0, {
    x: 0,
    y: 0,
    z: 0,
  });
  return [out.x, out.y, out.z];
}

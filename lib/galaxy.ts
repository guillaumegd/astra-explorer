import { createLensing } from './phenomena/lensing';
import { createPhenomenaManager } from './phenomena/manager';
import {
  createRegionManager,
  type RegionCandidate,
} from './phenomena/region-manager';
import { catalogue } from './catalogue/runtime';
import { asteroidRadius } from './asteroid-shape';
import { sampleBodyTravel } from './body-travel';
import { desiredSurfaceTilt, surfaceCameraPose } from './surface-camera';
import {
  systemBounds,
  framingDistance,
  localSystemRoot,
} from './system-framing';
import * as THREE from 'three';
import {
  compileOrbitChain,
  orbitalGLSL,
  orbitFor,
  ORBIT_STRIDE,
  ORBIT_DEPTH,
} from './orbits';
import { createLocalDebris } from './local-debris';
import { regionPresence, zoomProximity } from './ambience-parameters';
import {
  createBodyLOD,
  describeBody,
  minimumOrbitRatio,
  type BodyIdentity,
  type BodyCandidate,
  type BodyKind,
} from './stellar-lod';
import {
  galacticShear,
  galacticUnshear,
  particlePosition,
} from './particle-motion';
import {
  createLocalLights,
  mixLocalLights,
  type LocalLight,
} from './body-lighting';
import { REGION_DETAIL_LIMIT, STELLAR_LUMINOSITY } from './catalogue/config';
import type { RegionDefinition } from './catalogue/types';

export type GalaxySettings = {
  density: number;
  speed: number;
  tilt: number | null;
  paused: boolean;
  palette: number;
};
// Localized strings the engine needs for text it renders itself (canvas
// aria-label, error messages, system-marker labels), decoupled from React so
// a locale change can be pushed in via setMessages() without recreating it.
export type GalaxyMessages = {
  canvasHint: string;
  contextLost: string;
  bodyKindLabel: (kind: BodyKind) => string;
  exploreBodyAria: (name: string, kindLabel: string) => string;
  regionLabel: (type: 'nebula' | 'remnant') => string;
};
export type SystemView = {
  root: BodyIdentity;
  members: BodyIdentity[];
  barycentric: boolean;
};
// Where the camera currently sits relative to the galactic centre, expressed
// the way a sky survey would: right ascension and declination, in radians.
export type CameraView =
  | 'overview'
  | 'selected'
  | 'approaching'
  | 'close'
  | 'system';
export type SkyPointing = { ra: number; dec: number };
/**
 * A region rides alongside the selected body rather than replacing it: the
 * camera can sit inside a nebula while a planet is selected, and the guide
 * requires the ambience to mix in that case.
 */
export type RegionView = {
  region: RegionDefinition;
  framed: boolean;
  inside: number;
};
export type GalaxyEngine = {
  inspectBody: (id: number) => void;
  catalogue: typeof catalogue;
  frameSystem: (scope: 'stellar' | 'local') => void;
  frameRegion: (regionId: string) => void;
  configure: (settings: GalaxySettings) => void;
  setMessages: (messages: GalaxyMessages) => void;
  setViewportInset: (pixels: number) => void;
  setOpeningProgress: (progress: number | null) => void;
  zoom: (factor: number) => void;
  approach: () => void;
  overview: () => void;
  nextBody: (direction: number) => void;
  reset: () => void;
  dispose: () => void;
};

const vertexShader = `
  attribute vec4 aOrbit0;
  attribute vec4 aOrbit1;
  attribute vec4 aOrbit2;
  ${orbitalGLSL}
  attribute float aSize;
  attribute float aSeed;
  attribute float aId;
  attribute float aSystemRoot;
  attribute float aPhenomenon;
  varying float vPhenomenon;
  attribute float aBodyRadius;
  attribute float aBodyType;
  attribute vec3 aBodyColor;
  uniform float uProjectionScale;
  uniform float uContextRoot,uContextSelected,uContextStrength;
  uniform float uMaxPointSize;
  varying float vSurface;
  varying float vDiscScale;
  varying float vBodyType;
  varying vec3 vBodyColor;
  varying vec3 vLightDirection;
  uniform vec2 uReplacements[12];
  varying float vFade;
  varying float vId;
  uniform float uTime;
  uniform float uRotation;
  uniform float uPixelRatio;
  varying float vRadius;
  varying float vSeed;
  void main() {
    vec3 p = position;
    float radius = length(p.xz);
    float angle = uRotation * (0.35 + 0.65 / (radius * 0.15 + 1.0));
    p.xz = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * p.xz;
    p.y += sin(uTime * 0.25 + radius * 1.3 + aSeed * 12.0) * 0.035;
    vec3 orbitalDelta=orbitPosition(aOrbit0,uRotation)+orbitPosition(aOrbit1,uRotation)+orbitPosition(aOrbit2,uRotation);
    p += orbitalDelta;
    vLightDirection=mat3(modelViewMatrix)*(length(orbitalDelta)>0.?-orbitalDelta:vec3(1.,0.,0.));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float physicalRadius = aBodyRadius * uProjectionScale / max(-mv.z, 0.0000001);
    // Keep the parent system readable in close-up without moving its bodies.
    // The selected body retains its physical size and its normal mesh transition.
    float companion=(abs(aSystemRoot-uContextRoot)<.1 && abs(aId-uContextSelected)>.1 && aBodyRadius>0.)?uContextStrength:0.;
    physicalRadius=max(physicalRadius,companion*(aBodyType<.5?6.:1.8));
    vSurface = max(smoothstep(2.0, 10.0, physicalRadius),companion);
    float glowSize = clamp(aSize * uPixelRatio * (95.0 / -mv.z), 0.65, aBodyRadius > 0.0 ? (aBodyType < 0.5 ? 16.0 : 3.0) * uPixelRatio : 40.0);
    float diameter=physicalRadius*2.0*uPixelRatio;
    gl_PointSize = clamp(max(glowSize*(1.0-vSurface),diameter),0.65,uMaxPointSize);
    vDiscScale=min(1.0,diameter/gl_PointSize);
    vBodyType=aBodyType;vBodyColor=aBodyColor;
    vPhenomenon=aPhenomenon;
    vId = aId;
    vFade = 1.0;
    for(int i=0;i<12;i++) { if(abs(uReplacements[i].x-aId)<0.1) vFade = 1.0-uReplacements[i].y; }
    vRadius = radius;
    vSeed = aSeed;
  }
`;
const fragmentShader = `
  varying float vSurface;
  varying float vFade;
  uniform vec3 uInner;
  uniform vec3 uOuter;
  uniform float uTime;
  uniform float uOpacity;
  varying float vRadius;
  varying float vSeed;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float glow = exp(-d * d * 5.0) * 0.42 + exp(-d * d * 35.0) * 0.58;
    glow *= smoothstep(1.0, 0.65, d);
    vec3 color = mix(uInner, uOuter, smoothstep(0.2, 8.5, vRadius));
    color = mix(color, vec3(0.76, 0.86, 1.0), vSeed * 0.38);
    float shimmer = 0.84 + 0.16 * sin(uTime * (0.5 + vSeed) + vSeed * 80.0);
    gl_FragColor = vec4(color, glow * shimmer * uOpacity * vFade * (1.0-vSurface));
  }
`;

// A sphere impostor costs a single GPU point, not a mesh or a procedural noise stack.
const impostorFragment = `
 varying float vSurface,vFade,vBodyType,vSeed,vDiscScale,vPhenomenon;
 varying vec3 vBodyColor,vLightDirection;
 void main(){
   if(vSurface<0.001 || vFade<0.001) discard;
   vec2 p=(gl_PointCoord-0.5)*2.0/max(vDiscScale,0.001); float r=dot(p,p); if(r>1.0)discard;
   if(vPhenomenon>1.5){
     float core=1.-smoothstep(.006,.018,r);
     float halo=exp(-r*32.)*.24;
     gl_FragColor=vec4(mix(vBodyColor,vec3(1.),core*.35),
       max(core,halo)*vSurface*vFade);return;
   }
   if(vPhenomenon>.5){
     float ring=smoothstep(.05,.12,r)*(1.-smoothstep(.5,1.,r));
     gl_FragColor=vec4(vBodyColor*ring*.8,vSurface*vFade);return;
   }
   vec3 n=vec3(p.x,-p.y,sqrt(1.0-r));
   float light=max(dot(n,normalize(vLightDirection)),0.0);
   float bands=0.82+0.18*sin(n.y*20.0+vSeed*15.0);
   vec3 base=vBodyType<0.5?mix(vBodyColor,vec3(1.0),0.3):vBodyColor;
   vec3 color=base*(vBodyType<0.5 ? 0.35+0.4*n.z : 0.04+light*0.65);
   if(vBodyType>1.5 && vBodyType<2.5)color*=bands;
   gl_FragColor=vec4(color,vSurface*vFade*smoothstep(1.0,0.98,r));
 }
`;

export function createGalaxy(
  host: HTMLDivElement,
  initialMessages: GalaxyMessages,
  onError: (error: string) => void,
  onSelection: (body: BodyIdentity | null) => void,
  onProximity: (
    value: number,
    kind: BodyIdentity['kind'] | null,
    pulse: number,
    binaryAngle: number | null,
    region: { presence: number; type: 'nebula' | 'remnant' } | null,
  ) => void,
  onSystemView: (view: SystemView | null) => void = () => {},
  onPointing: (pointing: SkyPointing) => void = () => {},
  onFirstFrame: () => void = () => {},
  onCameraView: (view: CameraView) => void = () => {},
  onRegion: (view: RegionView | null) => void = () => {},
): GalaxyEngine {
  let messages = initialMessages;
  let firstFrameRendered = false;
  let openingProgress: number | null = null;
  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    alpha: false,
    powerPreference: 'default',
  });
  renderer.setClearColor(0x04060b);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  host.appendChild(renderer.domElement);
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute('role', 'button');
  renderer.domElement.setAttribute('aria-label', messages.canvasHint);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 180);
  const group = new THREE.Group();
  group.rotation.z = -0.18;
  scene.add(group);
  const max = catalogue.activeCount(120000);
  let seed = 91724;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const positions = new Float32Array(max * 3);
  const sizes = new Float32Array(max);
  const seeds = new Float32Array(max);
  const orbits = new Float32Array(max * ORBIT_STRIDE);
  const roots = new Float32Array(max);
  for (let id = 0; id < max; id++) {
    const body = catalogue.getBody(id);
    const system = catalogue.getSystem(body.systemId);
    positions.set(system.anchor, id * 3);
    seeds[id] = system.motionSeed;
    roots[id] = system.rootId;
    sizes[id] =
      (0.22 + (body.seed % 1) ** 5 * 1.15) *
      (body.role === 'central' ? 1 : 0.12);
    orbits.set(compileOrbitChain(id, describeBody), id * ORBIT_STRIDE);
  }
  const bodyRadii = new Float32Array(max),
    bodyTypes = new Float32Array(max),
    bodyColors = new Float32Array(max * 3);
  const scratchColor = new THREE.Color();
  for (let id = 0; id < max; id++) {
    const body = describeBody(id);
    bodyRadii[id] =
      body.phenomenon?.envelope ?? body.pulsar?.envelope ?? body.radius;
    bodyTypes[id] = body.type;
    scratchColor.set(body.color).toArray(bodyColors, id * 3);
  }
  const ids = Float32Array.from({ length: max }, (_, i) => i);
  const geometry = new THREE.BufferGeometry();
  const orbitalBuffer = new THREE.InterleavedBuffer(orbits, ORBIT_STRIDE);
  for (let level = 0; level < ORBIT_DEPTH; level++)
    geometry.setAttribute(
      `aOrbit${level}`,
      new THREE.InterleavedBufferAttribute(orbitalBuffer, 4, level * 4),
    );
  geometry.setAttribute('aBodyRadius', new THREE.BufferAttribute(bodyRadii, 1));
  geometry.setAttribute('aBodyType', new THREE.BufferAttribute(bodyTypes, 1));
  geometry.setAttribute('aBodyColor', new THREE.BufferAttribute(bodyColors, 3));
  geometry.setAttribute(
    'aPhenomenon',
    new THREE.BufferAttribute(
      Float32Array.from({ length: max }, (_, id) =>
        catalogue.getBody(id).pulsar
          ? 2
          : catalogue.getBody(id).phenomenon
            ? 1
            : 0,
      ),
      1,
    ),
  );
  geometry.setAttribute('aSystemRoot', new THREE.BufferAttribute(roots, 1));
  geometry.setAttribute('aId', new THREE.BufferAttribute(ids, 1));
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  geometry.setDrawRange(0, catalogue.activeCount(65000));
  const replacements = Array.from(
    { length: 12 },
    () => new THREE.Vector2(-1, 0),
  );
  const uniforms = {
    uContextRoot: { value: -8 },
    uContextSelected: { value: -1 },
    uContextStrength: { value: 0 },
    uProjectionScale: { value: 1 },
    uMaxPointSize: {
      value: renderer
        .getContext()
        .getParameter(renderer.getContext().ALIASED_POINT_SIZE_RANGE)[1],
    },
    uReplacements: { value: replacements },
    uTime: { value: 0 },
    uRotation: { value: 0 },
    uPixelRatio: { value: renderer.getPixelRatio() },
    uInner: { value: new THREE.Color('#ffbd85') },
    uOuter: { value: new THREE.Color('#7d9eff') },
    uOpacity: { value: 0.86 },
  };
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const stars = new THREE.Points(geometry, material);
  stars.frustumCulled = false;
  group.add(stars);
  const impostorMaterial = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader: impostorFragment,
    uniforms,
    transparent: true,
    depthWrite: false,
  });
  const impostors = new THREE.Points(geometry, impostorMaterial);
  impostors.frustumCulled = false;
  group.add(impostors);
  // A second, sparse particle layer provides soft nebular light without a costly fullscreen bloom pass.
  const dustGeometry = new THREE.BufferGeometry();
  const dustCount = 5500;
  for (let level = 0; level < ORBIT_DEPTH; level++)
    dustGeometry.setAttribute(
      `aOrbit${level}`,
      new THREE.BufferAttribute(new Float32Array(dustCount * 4), 4),
    );
  const dustPositions = new Float32Array(dustCount * 3);
  const dustSizes = new Float32Array(dustCount);
  for (let i = 0; i < dustCount; i++) {
    dustPositions.set(positions.subarray(i * 3, i * 3 + 3), i * 3);
    dustSizes[i] = 3 + random() * 7;
  }
  dustGeometry.setAttribute(
    'aBodyRadius',
    new THREE.BufferAttribute(new Float32Array(dustCount), 1),
  );
  dustGeometry.setAttribute(
    'aBodyType',
    new THREE.BufferAttribute(new Float32Array(dustCount), 1),
  );
  dustGeometry.setAttribute(
    'aBodyColor',
    new THREE.BufferAttribute(new Float32Array(dustCount * 3), 3),
  );
  dustGeometry.setAttribute(
    'aId',
    new THREE.BufferAttribute(new Float32Array(dustCount).fill(-2), 1),
  );
  dustGeometry.setAttribute(
    'position',
    new THREE.BufferAttribute(dustPositions, 3),
  );
  dustGeometry.setAttribute('aSize', new THREE.BufferAttribute(dustSizes, 1));
  dustGeometry.setAttribute(
    'aSeed',
    new THREE.BufferAttribute(seeds.slice(0, dustCount), 1),
  );
  const dustMaterial = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: { ...uniforms, uOpacity: { value: 0.065 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  group.add(new THREE.Points(dustGeometry, dustMaterial));
  // Radial sprite adds an extended photographic halo around the central cluster.
  const haloCanvas = document.createElement('canvas');
  haloCanvas.width = haloCanvas.height = 128;
  const context = haloCanvas.getContext('2d')!;
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,237,211,0.9)');
  gradient.addColorStop(0.08, 'rgba(255,215,174,0.65)');
  gradient.addColorStop(0.24, 'rgba(239,168,118,0.17)');
  gradient.addColorStop(0.55, 'rgba(130,133,211,0.04)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  const haloTexture = new THREE.CanvasTexture(haloCanvas);
  const haloMaterial = new THREE.SpriteMaterial({
    map: haloTexture,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    opacity: 0.8,
  });
  const halo = new THREE.Sprite(haloMaterial);
  halo.scale.set(9, 6, 1);
  group.add(halo);
  let settings: GalaxySettings = {
    density: catalogue.activeCount(65000),
    speed: 1,
    tilt: null,
    paused: false,
    palette: 0,
  };
  const bodyLOD = createBodyLOD(group, 8);
  const phenomena = createPhenomenaManager(group);
  const regions = createRegionManager(group);
  const lensing = createLensing();
  // The all-sky catalogue uses the same geometry, motion, colours and active range.
  // Local detailed bodies are composited using depth, never baked into infinity.
  const skyScene = new THREE.Scene(),
    skyGroup = new THREE.Group();
  skyScene.add(skyGroup);
  for (const object of [
    stars,
    impostors,
    ...group.children.filter(
      (o) => o instanceof THREE.Points && o !== stars && o !== impostors,
    ),
    halo,
  ]) {
    const copy = object.clone();
    copy.frustumCulled = false;
    skyGroup.add(copy);
  }
  const captureSky = (cube: THREE.CubeCamera) => {
    skyGroup.matrixAutoUpdate = false;
    skyGroup.matrix.copy(group.matrixWorld);
    const projection = uniforms.uProjectionScale.value,
      ratio = uniforms.uPixelRatio.value;
    const strength = uniforms.uContextStrength.value;
    uniforms.uProjectionScale.value = 256;
    uniforms.uPixelRatio.value = cube.renderTarget.width / 512;
    uniforms.uContextStrength.value = 0;
    try {
      cube.update(renderer, skyScene);
    } finally {
      uniforms.uProjectionScale.value = projection;
      uniforms.uPixelRatio.value = ratio;
      uniforms.uContextStrength.value = strength;
    }
  };
  const pointDepthMaterial = new THREE.ShaderMaterial({
    vertexShader,
    uniforms,
    fragmentShader: `varying float vSurface,vFade,vDiscScale,vPhenomenon;
      void main(){if((vPhenomenon>.5 && vPhenomenon<1.5) || vSurface<.5 || vFade<.5 ||
        length((gl_PointCoord-.5)*2.)>vDiscScale*(vPhenomenon>1.5?.098:.98))discard;gl_FragColor=vec4(0.);}`,
    colorWrite: false,
    depthWrite: true,
    depthTest: true,
  });
  const pointDepthScene = new THREE.Scene(),
    pointDepthGroup = new THREE.Group();
  const pointDepth = new THREE.Points(geometry, pointDepthMaterial);
  pointDepth.frustumCulled = false;
  pointDepthGroup.add(pointDepth);
  pointDepthScene.add(pointDepthGroup);
  pointDepthGroup.matrixAutoUpdate = false;
  const renderPointDepth = () => {
    pointDepthGroup.matrix.copy(group.matrixWorld);
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    try {
      renderer.render(pointDepthScene, camera);
    } finally {
      renderer.autoClear = autoClear;
    }
  };
  const debris = createLocalDebris(group);
  let scanCursor = 0;
  const detailShortlist = new Map<number, { pixels: number; seen: number }>();
  const candidatePosition = new THREE.Vector3();
  const viewPosition = new THREE.Vector3();
  let selected: BodyIdentity | null = null;
  // Regions ride alongside the selection: only framing is exclusive.
  let regionFocus: RegionDefinition | null = null;
  let insideRegion: RegionDefinition | null = null;
  let insidePresence = 0;
  let reportedRegion: string | null = null;
  const nearbyRegions: RegionDefinition[] = [];
  const regionPool: RegionCandidate[] = [];
  const regionCandidates: RegionCandidate[] = [];
  const markedRegions: RegionCandidate[] = [];
  const regionMarkers = new Map<string, HTMLButtonElement>();
  const cameraBase = new THREE.Vector3();
  const regionPoint = new THREE.Vector3();
  let distance = 29.4,
    targetDistance = 29.4;
  let azimuth = 0,
    elevation = 0.62;
  const focus = new THREE.Vector3();
  const focusOffset = new THREE.Vector3();
  const localFocus = new THREE.Vector3();
  const worldFocus = new THREE.Vector3();
  const projected = new THREE.Vector3();
  const localPosition = new THREE.Vector3();
  const marker = document.createElement('span');
  marker.className = 'body-marker';
  marker.setAttribute('aria-hidden', 'true');
  host.appendChild(marker);
  const pickScene = new THREE.Scene();
  const pickGroup = new THREE.Group();
  pickGroup.matrixAutoUpdate = false;
  pickScene.add(pickGroup);
  const pickMaterial = new THREE.ShaderMaterial({
    vertexShader: vertexShader.replace(
      'vId = aId;',
      'gl_PointSize = max(aPhenomenon>1.5 ? min(diameter*.1,uMaxPointSize) : gl_PointSize, (aPhenomenon>.5 ? 12.0 : 7.0) * uPixelRatio); vId = aId;',
    ),
    fragmentShader: `
    varying float vId;
    void main(){if(length(gl_PointCoord-0.5)>0.5)discard;float id=vId+1.0;
    gl_FragColor=vec4(mod(id,256.0),mod(floor(id/256.0),256.0),floor(id/65536.0),255.0)/255.0;}
  `,
    uniforms,
    depthTest: true,
    depthWrite: true,
    blending: THREE.NoBlending,
  });
  // Match visible sky sprite footprints; the ordinary 7px selection enlargement
  // would select invisible neighbours in highly magnified secondary images.
  const opticalPickMaterial = new THREE.ShaderMaterial({
    vertexShader,
    uniforms,
    fragmentShader: `varying float vId,vFade,vSurface,vDiscScale,vPhenomenon;
      void main(){float d=length(gl_PointCoord-.5)*2.;
        if(vFade<.01 || d>1.)discard;
        float alpha=vSurface>.5 ? (d<vDiscScale?1.:0.) : exp(-d*d*5.)*.42+exp(-d*d*35.)*.58;
        if(vPhenomenon>1.5 && vSurface>.5){
          float r=pow(d/max(vDiscScale,.001),2.);
          alpha=max(1.-smoothstep(.006,.018,r),exp(-r*32.)*.24)*vSurface;
        }
        if(alpha*vFade<.08)discard;
        float id=vId+1.;gl_FragColor=vec4(mod(id,256.),mod(floor(id/256.),256.),floor(id/65536.),255.)/255.;}`,
    depthTest: true,
    depthWrite: true,
    blending: THREE.NoBlending,
  });
  const pickPoints = new THREE.Points(geometry, pickMaterial);
  pickPoints.frustumCulled = false;
  pickGroup.add(pickPoints);
  let pickTarget: THREE.WebGLRenderTarget | null = null;
  const pickPixels = new Uint8Array(9 * 9 * 4);
  const pickAt = (clientX: number, clientY: number): number | null => {
    const bounds = host.getBoundingClientRect();
    const x = clientX - bounds.left,
      y = clientY - bounds.top;
    camera.updateMatrixWorld();
    group.updateMatrixWorld(true);
    raycaster.setFromCamera(
      new THREE.Vector2(
        (x / bounds.width) * 2 - 1,
        (-y / bounds.height) * 2 + 1,
      ),
      camera,
    );
    const ordinaryHit = bodyLOD.pickHit(raycaster);
    const optical = lensing.trace(raycaster.ray);
    if (optical && ordinaryHit && ordinaryHit.distance < optical.distance)
      return ordinaryHit.object.userData.bodyId;
    if (optical) {
      // Point impostors also write foreground depth. Mirror their physical cores
      // here before selecting a captured ray (meshes were handled above).
      let foregroundId: number | null = null,
        foregroundDistance = optical.distance;
      const point = new THREE.Vector3();
      for (let id = 0; id < settings.density; id++) {
        if (id === optical.body.id || catalogue.getBody(id).phenomenon)
          continue;
        particlePosition(
          positions,
          seeds,
          id,
          uniforms.uRotation.value,
          uniforms.uTime.value,
          point,
          undefined,
          orbits,
        );
        point.applyMatrix4(group.matrixWorld);
        const along = point
          .clone()
          .sub(raycaster.ray.origin)
          .dot(raycaster.ray.direction);
        if (along <= 0 || along >= foregroundDistance) continue;
        if (
          raycaster.ray.distanceSqToPoint(point) <
          (catalogue.getBody(id).pulsar
            ? catalogue.getBody(id).radius
            : bodyRadii[id]) **
            2
        ) {
          foregroundId = id;
          foregroundDistance = along;
        }
      }
      if (foregroundId !== null) return foregroundId;
      if (optical.disk || optical.captured) return optical.body.id;
    }
    const specialHit = optical ? null : phenomena.pick(raycaster);
    const hit =
      ordinaryHit && specialHit
        ? ordinaryHit.distance < specialHit.distance
          ? ordinaryHit
          : specialHit
        : (ordinaryHit ?? specialHit);
    if (!optical && hit) return hit.object.userData.bodyId;
    // Escaping rays pick the same directional catalogue used by the cube, including
    // images whose source lies outside the user's camera frustum.
    const pickCamera = optical
      ? new THREE.PerspectiveCamera(
          90,
          1,
          optical.body.phenomenon!.diskOuter * 4,
          180,
        )
      : camera;
    if (optical) {
      pickCamera.position.copy(optical.origin);
      pickCamera.lookAt(optical.origin.clone().add(optical.direction));
      pickCamera.updateMatrixWorld();
    }
    const width = optical ? lensing.skyResolution() : Math.floor(bounds.width),
      height = optical ? lensing.skyResolution() : Math.floor(bounds.height);
    if (!pickTarget)
      pickTarget = new THREE.WebGLRenderTarget(width, height, {
        depthBuffer: true,
      });
    else if (pickTarget.width !== width || pickTarget.height !== height)
      pickTarget.setSize(width, height);
    pickGroup.matrix.copy(group.matrixWorld);
    const sx = THREE.MathUtils.clamp(
        Math.floor(optical ? width / 2 : x) - 4,
        0,
        width - 9,
      ),
      sy = THREE.MathUtils.clamp(
        height - Math.floor(optical ? height / 2 : y) - 4,
        0,
        height - 9,
      );
    const clear = renderer.getClearColor(new THREE.Color());
    pickTarget.scissor.set(sx, sy, 9, 9);
    pickTarget.scissorTest = true;
    renderer.setRenderTarget(pickTarget);
    renderer.setClearColor(0);
    renderer.clear();
    const projection = uniforms.uProjectionScale.value,
      ratio = uniforms.uPixelRatio.value;
    const strength = uniforms.uContextStrength.value;
    if (optical) {
      uniforms.uProjectionScale.value = 256;
      uniforms.uPixelRatio.value = width / 512;
      uniforms.uContextStrength.value = 0;
    }
    const savedPickMaterial = pickPoints.material;
    if (optical) pickPoints.material = opticalPickMaterial;
    try {
      renderer.render(pickScene, pickCamera);
    } finally {
      pickPoints.material = savedPickMaterial;
    }
    uniforms.uProjectionScale.value = projection;
    uniforms.uPixelRatio.value = ratio;
    uniforms.uContextStrength.value = strength;
    renderer.readRenderTargetPixels(pickTarget, sx, sy, 9, 9, pickPixels);
    renderer.setRenderTarget(null);
    renderer.setClearColor(clear);
    let best = -1,
      score = Infinity;
    for (let i = 0; i < 81; i++) {
      const value =
        pickPixels[i * 4] +
        pickPixels[i * 4 + 1] * 256 +
        pickPixels[i * 4 + 2] * 65536 -
        1;
      const d = ((i % 9) - 4) ** 2 + (Math.floor(i / 9) - 4) ** 2;
      if (
        value >= 0 &&
        value < settings.density &&
        d < score &&
        (!optical || d <= 4)
      ) {
        best = value;
        score = d;
      }
    }
    return best >= 0 ? best : null;
  };
  let framed: {
    radius: number;
    members: BodyIdentity[];
    focus: number | null;
  } | null = null;
  const orbitGuides = new THREE.Group();
  group.add(orbitGuides);
  const guideParents: (number | null)[] = [];
  const systemMarkers: HTMLButtonElement[] = [];
  const clearFrame = () => {
    framed = null;
    for (const line of [...orbitGuides.children] as THREE.LineLoop<
      THREE.BufferGeometry,
      THREE.LineBasicMaterial
    >[]) {
      line.geometry.dispose();
      line.material.dispose();
      orbitGuides.remove(line);
    }
    guideParents.length = 0;
    systemMarkers.forEach((marker) => marker.remove());
    systemMarkers.length = 0;
    onSystemView(null);
  };
  let travel: {
    time: number;
    origin: THREE.Vector3;
    startDistance: number;
    cruiseDistance: number;
    startPosition: THREE.Vector3;
    startUp: THREE.Vector3;
    startTarget: THREE.Vector3;
  } | null = null;
  const startTravel = (
    origin: THREE.Vector3,
    previous: BodyIdentity | null,
  ) => {
    if (!selected) return;
    targetDistance =
      (selected.phenomenon ?? selected.pulsar)
        ? framingDistance(
            (selected.phenomenon ?? selected.pulsar)!.envelope,
            camera.aspect,
          )
        : selected.radius * 4.2;
    travel = {
      time: 0,
      origin,
      startDistance: distance,
      cruiseDistance: Math.max(
        distance,
        origin.distanceTo(worldFocus) * 1.5,
        (previous?.radius ?? 0) * 8,
        selected.radius * 8,
      ),
      startPosition: camera.position.clone(),
      startUp: camera.up.clone(),
      startTarget: camera.position
        .clone()
        .addScaledVector(
          camera.getWorldDirection(new THREE.Vector3()),
          Math.max(selected.radius, distance),
        ),
    };
  };
  /**
   * Every member shares the system anchor, so the base position with no orbital
   * offset is exactly the invisible barycentre.
   */
  const barycentre = (systemId: number, out: THREE.Vector3) =>
    particlePosition(
      positions,
      seeds,
      catalogue.getSystem(systemId).rootId,
      rotation,
      elapsed,
      out,
    );
  const commitFocus = () => {
    group.updateMatrixWorld();
    worldFocus.copy(localFocus).applyMatrix4(group.matrixWorld);
    focusOffset.copy(focus).sub(worldFocus);
  };
  const select = (id: number) => {
    const previous = selected;
    const switching = previous !== null && previous.id !== id;
    const origin = focus.clone();
    // Preserve the current heading when leaving a rotating surface anchor.
    if (surfaceAnchor) {
      azimuth = Math.atan2(cameraDirection.x, cameraDirection.z);
      elevation = Math.asin(THREE.MathUtils.clamp(cameraDirection.y, -1, 1));
    }
    clearFrame();
    surfaceAnchor = null;
    regionFocus = null;
    selected = describeBody(id);
    if (selected.phenomenon || selected.pulsar) {
      elevation = (25 * Math.PI) / 180;
      azimuth = 0.6;
    }
    particlePosition(
      positions,
      seeds,
      id,
      rotation,
      elapsed,
      localFocus,
      undefined,
      orbits,
    );
    commitFocus();
    targetDistance = Math.max(
      targetDistance,
      selected.radius * minimumOrbitRatio(selected),
    );
    if (switching) startTravel(origin, previous);
    onSelection(selected);
  };
  const overview = () => {
    travel = null;
    clearFrame();
    regionFocus = null;
    selected = null;
    targetDistance = mobile ? 40 : 29.4;
    onSelection(null);
  };
  const approach = () => {
    clearFrame();
    if (!selected) select(0);
    targetDistance =
      (selected!.phenomenon ?? selected!.pulsar)
        ? framingDistance(
            (selected!.phenomenon ?? selected!.pulsar)!.envelope,
            camera.aspect,
          )
        : selected!.radius * 4.2;
    if (!travel && distance > targetDistance * 1.1)
      startTravel(focus.clone(), selected);
    if (selected!.phenomenon || selected!.pulsar) {
      elevation = (25 * Math.PI) / 180;
      azimuth = 0.6;
    }
  };

  /**
   * Framing a region is exclusive: it drops the selected body the way overview
   * does, so no surface control can survive. There is no camera exclusion —
   * entering the cloud is the point.
   */
  const frameRegion = (regionId: string) => {
    const region = catalogue.resolveRegion(regionId, settings.density);
    if (!region) return;
    travel = null;
    clearFrame();
    surfaceAnchor = null;
    selected = null;
    regionFocus = region;
    galacticShear(
      region.center[0],
      region.center[1],
      region.center[2],
      rotation,
      localFocus,
    );
    commitFocus();
    targetDistance = framingDistance(region.envelope, camera.aspect);
    onSelection(null);
  };

  const frameSystem = (scope: 'stellar' | 'local') => {
    const body = selected ?? describeBody(0);
    const start = body.rootId;
    const membersInSystem = catalogue.getSystemMembers(body.systemId);
    // A binary turns around a barycentre that is no body: frame that instead.
    const barycentric =
      scope === 'stellar' &&
      catalogue.getSystem(body.systemId).architecture === 'binary';
    const root = barycentric
      ? null
      : scope === 'stellar'
        ? start
        : (localSystemRoot(body, membersInSystem) ?? start);
    const bounds = systemBounds(root, membersInSystem);
    // Selecting a component keeps following that component.
    select(barycentric && body.binary ? body.id : (root ?? start));
    const members = membersInSystem.filter((b) =>
      bounds.members.includes(b.id),
    );
    framed = { radius: bounds.radius, members, focus: root };
    targetDistance = framingDistance(bounds.radius, camera.aspect);
    if (barycentric) {
      barycentre(body.systemId, localFocus);
      commitFocus();
    }
    onSystemView({ root: describeBody(start), members, barycentric });
    for (const member of members) {
      const marker = document.createElement('button');
      const kindLabel = messages.bodyKindLabel(member.kind);
      marker.className = 'system-marker';
      marker.dataset.label = member.name;
      marker.dataset.central = String(member.id === root);
      marker.title = kindLabel;
      marker.setAttribute(
        'aria-label',
        messages.exploreBodyAria(member.name, kindLabel),
      );
      marker.addEventListener('click', (event) => {
        event.stopPropagation();
        select(member.id);
        approach();
      });
      host.appendChild(marker);
      systemMarkers.push(marker);
      if (member.id === root || !member.orbit) continue;
      const orbit = orbitFor(
        member,
        member.parentId === null ? null : describeBody(member.parentId),
      );
      const points = Array.from({ length: 96 }, (_, i) => {
        const a = (i / 96) * Math.PI * 2;
        return new THREE.Vector3(
          Math.cos(a) * orbit.radius,
          Math.sin(a) * orbit.radius * Math.sin(orbit.inclination),
          Math.sin(a) * orbit.radius * Math.cos(orbit.inclination),
        );
      });
      const line = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({
          color: 0x8cb6dc,
          transparent: true,
          opacity: 0.25,
          depthWrite: false,
        }),
      );
      orbitGuides.add(line);
      guideParents.push(member.parentId);
    }
  };

  // Reused across frames: the render loop must not allocate.
  const lightSlots = [0, 1].map(() => ({
    position: new THREE.Vector3(),
    power: 1,
    color: new THREE.Color(),
  }));
  const soleSource = lightSlots.slice(0, 1);
  const lightPool: [LocalLight, LocalLight][] = [];
  const lightsFor = (index: number) =>
    (lightPool[index] ??= createLocalLights());
  let renderHeight = 1;
  let reservedBottom = 0;
  let currentReservedBottom = 0;
  let insetWidth = 0;
  let insetHeight = 0;
  const cameraTarget = new THREE.Vector3();
  const cameraDirection = new THREE.Vector3();
  let surfaceTilt = 0;
  let activityTime = 0;
  let surfaceAnchor: THREE.Vector3 | null = null;
  const surfaceOrientation = new THREE.Quaternion();
  const surfaceEuler = new THREE.Euler();
  let slowFrames = 0;
  let qualityCheck = 0;
  let lastFrame = performance.now();
  let lastPointingReport = 0;
  let reportedCameraView: CameraView = 'overview';
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let wallTime = 0;
  let elapsed = 0,
    rotation = 0,
    frame = 0,
    previous = performance.now();
  let lost = false;
  const pointer = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  const palettes = [
    ['#ffbd85', '#7d9eff'],
    ['#ffceaa', '#d379ef'],
    ['#e7e4af', '#4bcab7'],
  ];
  const targetInner = new THREE.Color(palettes[0][0]),
    targetOuter = new THREE.Color(palettes[0][1]);
  let mobile = false;
  const resize = () => {
    const { width, height } = host.getBoundingClientRect();
    if (width <= 0 || height <= 0) return;
    const previousAspect = camera.aspect;
    mobile = width < 600;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderHeight = height;
    if (framed) targetDistance = framingDistance(framed.radius, camera.aspect);
    else if (selected && (selected.phenomenon || selected.pulsar)) {
      const scale =
        framingDistance(1, camera.aspect) / framingDistance(1, previousAspect);
      targetDistance = Math.max(
        (selected.phenomenon ?? selected.pulsar)!.exclusion,
        targetDistance * scale,
      );
    }
  };
  const changeZoom = (factor: number) => {
    if (factor > 1 && !selected) {
      const rect = host.getBoundingClientRect();
      select(
        pickAt(rect.left + rect.width / 2, rect.top + rect.height / 2) ?? 0,
      );
    }
    targetDistance = THREE.MathUtils.clamp(
      selected
        ? selected.radius + (targetDistance - selected.radius) / factor
        : targetDistance / factor,
      selected ? selected.radius * minimumOrbitRatio(selected) : 2,
      65,
    );
  };
  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    const delta =
      e.deltaY *
      (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? host.clientHeight : 1);
    if (delta < 0 && !selected) {
      const id = pickAt(e.clientX, e.clientY);
      if (id !== null) select(id);
    }
    changeZoom(Math.exp(-THREE.MathUtils.clamp(delta, -150, 150) * 0.0025));
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();
  const move = (e: PointerEvent) => {
    pointer.set(
      (e.clientX / window.innerWidth) * 2 - 1,
      -((e.clientY / window.innerHeight) * 2 - 1),
    );
  };
  let lastTap = -1000,
    lastTapX = 0,
    lastTapY = 0;
  const click = (e: PointerEvent) => {
    // Keep the first selected ID while its camera starts moving during a double-click.
    if (
      e.timeStamp - lastTap < 350 &&
      Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY) < 6
    )
      return;
    lastTap = e.timeStamp;
    lastTapX = e.clientX;
    lastTapY = e.clientY;
    const id = pickAt(e.clientX, e.clientY);
    if (id !== null) select(id);
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      changeZoom(1.3);
    }
    if (e.key === '-') {
      e.preventDefault();
      changeZoom(1 / 1.3);
    }
    if (e.key === 'Home') {
      e.preventDefault();
      overview();
    }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      select(
        ((selected?.id ?? 0) +
          (e.key === 'ArrowRight' ? 1 : -1) +
          settings.density) %
          settings.density,
      );
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      approach();
    }
  };
  const doubleClick = () => {
    if (selected) approach();
  };
  const contextLost = (e: Event) => {
    e.preventDefault();
    lost = true;
    cancelAnimationFrame(frame);
    onError(messages.contextLost);
  };
  const contextRestored = () => {
    lensing.invalidate();
    lost = false;
    onError('');
    previous = lastFrame = performance.now();
    frame = requestAnimationFrame(animate);
  };
  // A tap selects only on release; a pinch must never trigger an accidental selection.
  const touches = new Map<number, THREE.Vector2>();
  let pinchDistance = 0;
  let gesture = false;
  let startX = 0,
    startY = 0;
  const down = (e: PointerEvent) => {
    if (e.button !== 0) return;
    if (touches.size === 0) {
      gesture = false;
      startX = e.clientX;
      startY = e.clientY;
    }
    lastDragX = e.clientX;
    lastDragY = e.clientY;
    touches.set(e.pointerId, new THREE.Vector2(e.clientX, e.clientY));
    renderer.domElement.setPointerCapture(e.pointerId);
    if (touches.size === 2) {
      gesture = true;
      const [a, b] = [...touches.values()];
      pinchDistance = a.distanceTo(b);
    }
  };
  let lastDragX = 0,
    lastDragY = 0;
  const drag = (e: PointerEvent) => {
    if (!touches.has(e.pointerId)) return;
    touches.get(e.pointerId)!.set(e.clientX, e.clientY);
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > 8) gesture = true;
    if (touches.size === 1 && gesture) {
      if (surfaceAnchor) {
        azimuth = Math.atan2(cameraDirection.x, cameraDirection.z);
        elevation = Math.asin(THREE.MathUtils.clamp(cameraDirection.y, -1, 1));
        surfaceAnchor = null;
      }
      const surfaceDrag = selected
        ? Math.min(1, Math.max(0.008, distance / selected.radius - 1))
        : 1;
      azimuth -= (e.clientX - lastDragX) * 0.005 * surfaceDrag;
      elevation = THREE.MathUtils.clamp(
        elevation + (e.clientY - lastDragY) * 0.005 * surfaceDrag,
        -1.3,
        1.3,
      );
    }
    lastDragX = e.clientX;
    lastDragY = e.clientY;
    if (touches.size === 2) {
      const [a, b] = [...touches.values()];
      const distance = a.distanceTo(b);
      if (pinchDistance > 0) changeZoom(distance / pinchDistance);
      pinchDistance = distance;
    }
  };
  const up = (e: PointerEvent) => {
    if (!touches.has(e.pointerId)) return;
    if (!gesture && touches.size === 1 && e.type === 'pointerup') click(e);
    touches.delete(e.pointerId);
    if (renderer.domElement.hasPointerCapture(e.pointerId))
      renderer.domElement.releasePointerCapture(e.pointerId);
    if (touches.size < 2) pinchDistance = 0;
  };
  window.addEventListener('pointermove', move);
  renderer.domElement.addEventListener('dblclick', doubleClick);
  renderer.domElement.addEventListener('wheel', wheel, { passive: false });
  renderer.domElement.addEventListener('pointerdown', down);
  renderer.domElement.addEventListener('pointermove', drag);
  renderer.domElement.addEventListener('pointerup', up);
  renderer.domElement.addEventListener('pointercancel', up);
  renderer.domElement.addEventListener('keydown', key);
  renderer.domElement.addEventListener('webglcontextlost', contextLost);
  renderer.domElement.addEventListener('webglcontextrestored', contextRestored);
  const animate = (now: number) => {
    if (lost) return;
    frame = requestAnimationFrame(animate);
    if (document.hidden) {
      previous = now;
      lastFrame = now;
      return;
    }
    // Cap rendering at 45 fps, even on 120/144 Hz displays.
    if (now - previous < 1000 / 45 - 1) return;
    const frameTime = now - lastFrame;
    lastFrame = now;
    const dt = Math.min((now - previous) / 1000, 0.1);
    previous = now;
    slowFrames += frameTime > 38 ? 1 : 0;
    qualityCheck++;
    if (qualityCheck >= 90) {
      // Target resolution first, volumetric samples only once it bottoms out.
      if (slowFrames > 45) {
        if (renderer.getPixelRatio() > 0.8) {
          renderer.setPixelRatio(Math.max(0.8, renderer.getPixelRatio() - 0.2));
          uniforms.uPixelRatio.value = renderer.getPixelRatio();
        } else regions.setSteps(regions.steps() > 8 ? 8 : 4);
      } else if (slowFrames < 9 && regions.steps() < 16)
        regions.setSteps(regions.steps() < 8 ? 8 : 16);
      slowFrames = 0;
      qualityCheck = 0;
    }
    wallTime += dt;
    if (!settings.paused) {
      elapsed += dt * settings.speed;
      activityTime += dt * settings.speed * (reduced.matches ? 0.12 : 1);
    }
    if (!settings.paused)
      rotation += dt * settings.speed * (reduced.matches ? 0.012 : 0.065);
    uniforms.uTime.value = elapsed;
    uniforms.uRotation.value = rotation;
    const damping = 1 - Math.exp(-dt * 2);
    if (!selected) {
      group.rotation.x +=
        ((reduced.matches ? 0 : pointer.y * 0.07) - group.rotation.x) * damping;
      group.rotation.y +=
        ((reduced.matches ? 0 : pointer.x * 0.1) - group.rotation.y) * damping;
    }
    uniforms.uInner.value.lerp(targetInner, damping);
    uniforms.uOuter.value.lerp(targetOuter, damping);
    group.updateMatrixWorld(true);
    // Keep the subject framed in the visible space above a mobile sheet.
    const insetDelta = reservedBottom - currentReservedBottom;
    if (
      Math.abs(insetDelta) > 0.1 ||
      (reservedBottom === 0 && currentReservedBottom !== 0) ||
      (currentReservedBottom > 0 &&
        (insetWidth !== host.clientWidth || insetHeight !== host.clientHeight))
    ) {
      currentReservedBottom =
        Math.abs(insetDelta) < 0.5
          ? reservedBottom
          : currentReservedBottom +
            insetDelta * (reduced.matches ? 1 : 1 - Math.exp(-dt * 10));
      const width = host.clientWidth;
      const height = host.clientHeight;
      insetWidth = width;
      insetHeight = height;
      if (currentReservedBottom > 0) {
        camera.setViewOffset(
          width,
          Math.max(height * 0.35, height - currentReservedBottom),
          0,
          0,
          width,
          height,
        );
      } else {
        camera.clearViewOffset();
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      }
    }
    const baseDistance = mobile ? 40 : 29.4;
    if (!travel)
      distance += (targetDistance - distance) * (1 - Math.exp(-dt * 4));
    if (selected) {
      if (framed && framed.focus === null)
        barycentre(selected.systemId, localFocus);
      else
        particlePosition(
          positions,
          seeds,
          selected.id,
          rotation,
          elapsed,
          localFocus,
          undefined,
          orbits,
        );
      worldFocus.copy(localFocus).applyMatrix4(group.matrixWorld);
      if (travel) {
        travel.time += reduced.matches ? dt * (5 / 0.35) : dt;
        const flight = sampleBodyTravel(
          travel.time / 5,
          travel.startDistance,
          travel.cruiseDistance,
          targetDistance,
        );
        distance = flight.distance;
        focus.lerpVectors(travel.origin, worldFocus, flight.progress);
        focusOffset.copy(focus).sub(worldFocus);
        if (travel.time >= 5) travel = null;
      } else {
        focusOffset.multiplyScalar(Math.exp(-dt * 4));
        focus.copy(worldFocus).add(focusOffset);
      }
    } else if (regionFocus) {
      // The cloud shears with its stars, so the focus has to follow it.
      galacticShear(
        regionFocus.center[0],
        regionFocus.center[1],
        regionFocus.center[2],
        rotation,
        localFocus,
      );
      worldFocus.copy(localFocus).applyMatrix4(group.matrixWorld);
      focusOffset.multiplyScalar(Math.exp(-dt * 4));
      focus.copy(worldFocus).add(focusOffset);
    } else focus.lerp(new THREE.Vector3(), 1 - Math.exp(-dt * 4));
    cameraDirection.set(
      Math.sin(azimuth) * Math.cos(elevation),
      Math.sin(elevation),
      Math.cos(azimuth) * Math.cos(elevation),
    );
    const ratio = selected ? distance / selected.radius : 100;
    uniforms.uContextRoot.value = selected ? selected.rootId : -1;
    uniforms.uContextSelected.value = selected?.id ?? -1;
    uniforms.uContextStrength.value = selected
      ? framed
        ? 1
        : 1 - THREE.MathUtils.smoothstep(ratio, 20, 160)
      : 0;
    const terrainView =
      !!selected &&
      selected.capabilities.renderClass === 'ordinary' &&
      !framed &&
      !travel;
    const desired =
      terrainView && selected
        ? desiredSurfaceTilt(ratio, settings.tilt, minimumOrbitRatio(selected))
        : 0;
    surfaceTilt += (desired - surfaceTilt) * (1 - Math.exp(-dt * 4));
    if (selected && terrainView && ratio < 1.8) {
      surfaceEuler.set(
        0.12,
        rotation * (0.2 + selected.seed * 0.004),
        selected.seed * 0.01,
      );
      group.getWorldQuaternion(surfaceOrientation);
      surfaceOrientation.multiply(
        new THREE.Quaternion().setFromEuler(surfaceEuler),
      );
      surfaceAnchor ??= cameraDirection
        .clone()
        .applyQuaternion(surfaceOrientation.clone().invert());
      cameraDirection
        .copy(surfaceAnchor)
        .applyQuaternion(surfaceOrientation)
        .normalize();
    } else if (surfaceAnchor) {
      cameraDirection
        .copy(surfaceAnchor)
        .applyQuaternion(surfaceOrientation)
        .normalize();
      azimuth = Math.atan2(cameraDirection.x, cameraDirection.z);
      elevation = Math.asin(THREE.MathUtils.clamp(cameraDirection.y, -1, 1));
      surfaceAnchor = null;
    }
    camera.position.copy(focus).addScaledVector(cameraDirection, distance);
    cameraTarget.copy(focus);
    camera.up.set(0, 1, 0);
    if (travel && travel.time < 1.25) {
      const blend = THREE.MathUtils.smoothstep(travel.time, 0, 1.25);
      camera.position.lerpVectors(
        travel.startPosition,
        camera.position.clone(),
        blend,
      );
      camera.up
        .lerpVectors(travel.startUp, new THREE.Vector3(0, 1, 0), blend)
        .normalize();
      cameraTarget.lerpVectors(travel.startTarget, focus, blend);
    }
    host.dataset.travelPhase = travel
      ? travel.time < 1.25
        ? 'retreat'
        : travel.time < 2.25
          ? 'transfer'
          : 'approach'
      : 'idle';
    if (selected && terrainView && surfaceTilt > 0.001) {
      const pose = surfaceCameraPose(
        focus,
        cameraDirection,
        selected.radius,
        distance,
        surfaceTilt,
        selected.type === 8 && surfaceAnchor
          ? asteroidRadius(
              surfaceAnchor.x,
              surfaceAnchor.y,
              surfaceAnchor.z,
              selected.seed,
            ) + 0.012
          : selected.type === 0 || selected.type === 2
            ? 1.025
            : 1.016,
      );
      if (selected.type === 8) {
        const localEye = pose.position
          .clone()
          .sub(focus)
          .applyQuaternion(surfaceOrientation.clone().invert());
        const eyeRadius = localEye.length();
        localEye.normalize();
        const safeRadius =
          selected.radius *
          (asteroidRadius(localEye.x, localEye.y, localEye.z, selected.seed) +
            0.02);
        if (eyeRadius < safeRadius)
          pose.position
            .sub(focus)
            .multiplyScalar(safeRadius / eyeRadius)
            .add(focus);
      }
      camera.position.copy(pose.position);
      cameraTarget.copy(pose.pivot);
      camera.up.copy(pose.up);
    }
    host.dataset.surfaceTilt = surfaceTilt.toFixed(2);
    // Galaxy-view composition only. A framed region has no selected body but is
    // very much a subject, and this offset would push it out of frame.
    if (!selected && !regionFocus) {
      cameraTarget.x += mobile ? 0 : 1.4;
      cameraTarget.y += mobile ? -6 : 0;
    }
    camera.near = Math.max(
      0.0000000001,
      Math.min(
        0.1,
        (selected ? distance - selected.radius * 1.004 : distance) / 100,
      ),
    );
    const openingFov =
      openingProgress !== null && !selected && !reduced.matches
        ? 45 + openingProgress * 3
        : 48;
    camera.fov +=
      (openingFov - camera.fov) *
      (reduced.matches ? 1 : 1 - Math.exp(-dt * 12));
    camera.updateProjectionMatrix();
    camera.lookAt(cameraTarget);
    camera.updateMatrixWorld();
    if (now - lastPointingReport > 200) {
      lastPointingReport = now;
      const r = camera.position.length();
      onPointing({
        ra: Math.atan2(camera.position.x, camera.position.z),
        dec:
          r > 1e-6
            ? Math.asin(THREE.MathUtils.clamp(camera.position.y / r, -1, 1))
            : 0,
      });
    }
    if (framed) {
      const position = new THREE.Vector3();
      guideParents.forEach((id, i) => {
        if (id === null) barycentre(framed!.members[0].systemId, position);
        else
          particlePosition(
            positions,
            seeds,
            id,
            rotation,
            elapsed,
            position,
            undefined,
            orbits,
          );
        orbitGuides.children[i].position.copy(position);
      });
      framed.members.forEach((member, i) => {
        particlePosition(
          positions,
          seeds,
          member.id,
          rotation,
          elapsed,
          position,
          undefined,
          orbits,
        );
        position.applyMatrix4(group.matrixWorld).project(camera);
        const marker = systemMarkers[i];
        marker.style.display =
          position.z > -1 &&
          position.z < 1 &&
          Math.abs(position.x) < 1 &&
          Math.abs(position.y) < 1
            ? 'block'
            : 'none';
        marker.style.left = `${(position.x * 0.5 + 0.5) * host.clientWidth}px`;
        marker.style.top = `${(-position.y * 0.5 + 0.5) * renderHeight}px`;
      });
    }
    const galaxyFade = THREE.MathUtils.smoothstep(
      distance,
      0.15,
      baseDistance * 0.4,
    );
    material.uniforms.uOpacity.value = 0.32 + 0.54 * galaxyFade;
    dustMaterial.uniforms.uOpacity.value = 0.065 * galaxyFade;
    haloMaterial.opacity = 0.8 * galaxyFade;
    const candidates: BodyCandidate[] = [];
    const projectionScale =
      renderHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    uniforms.uProjectionScale.value = projectionScale;
    // Bounded rolling scan: all active IDs are considered, including moving neighbours.
    // Their impostors grow immediately; mesh promotion can wait for this inexpensive scan.
    const measure = (id: number) => {
      particlePosition(
        positions,
        seeds,
        id,
        rotation,
        elapsed,
        localPosition,
        undefined,
        orbits,
      );
      projected.copy(localPosition).applyMatrix4(group.matrixWorld);
      const d = projected.distanceTo(camera.position);
      viewPosition.copy(projected).applyMatrix4(camera.matrixWorldInverse);
      const depth = -viewPosition.z;
      projected.project(camera);
      const pixels =
        (bodyRadii[id] * projectionScale) / Math.max(depth, 0.000001);
      return {
        d,
        pixels,
        visible:
          depth > camera.near &&
          Math.abs(projected.x) < 1.2 &&
          Math.abs(projected.y) < 1.2 &&
          projected.z < 1,
      };
    };
    if (distance < 3) {
      for (let i = 0; i < 2048; i++) {
        const id = scanCursor % settings.density;
        scanCursor = (scanCursor + 1) % settings.density;
        const m = measure(id);
        if (
          m.visible &&
          m.pixels >=
            (catalogue.getBody(id).capabilities.renderClass !== 'ordinary'
              ? phenomena.detailThreshold(id)
              : 18)
        )
          detailShortlist.set(id, { pixels: m.pixels, seen: elapsed });
        else detailShortlist.delete(id);
      }
    } else detailShortlist.clear();
    for (const [id, value] of detailShortlist)
      if (id >= settings.density || elapsed - value.seen > 5)
        detailShortlist.delete(id);
    const shortlist = [...detailShortlist]
      .sort((a, b) => b[1].pixels - a[1].pixels)
      .slice(0, 32)
      .map(([id]) => id);
    if (selected) {
      for (const { id } of catalogue.getSystemMembers(selected.systemId))
        if (!shortlist.includes(id)) shortlist.push(id);
      if (!shortlist.includes(selected.id)) shortlist.unshift(selected.id);
    }
    for (const id of shortlist) {
      const m = measure(id);
      if (
        (m.visible || id === selected?.id) &&
        m.pixels >=
          (catalogue.getBody(id).capabilities.renderClass !== 'ordinary'
            ? phenomena.detailThreshold(id)
            : 18)
      ) {
        candidatePosition.copy(localPosition);
        // One source for a lone star, two for a binary, in catalogue order.
        const stars = catalogue
          .getSystem(catalogue.getBody(id).systemId)
          .bodies.filter((b) => b.role === 'central');
        let sources = 0;
        for (const star of stars) {
          if (sources >= lightSlots.length) break;
          const slot = lightSlots[sources++];
          particlePosition(
            positions,
            seeds,
            star.id,
            rotation,
            elapsed,
            slot.position,
            undefined,
            orbits,
          );
          slot.power =
            star.radius ** 2 *
            (STELLAR_LUMINOSITY[star.kind as keyof typeof STELLAR_LUMINOSITY] ??
              1);
          slot.color.set(star.color);
        }
        candidates.push({
          lights: mixLocalLights(
            candidatePosition,
            sources > 1 ? lightSlots : soleSource,
            lightsFor(candidates.length),
          ),
          identity: selected?.id === id ? selected : describeBody(id),
          position: candidatePosition.clone(),
          pixels: m.pixels,
          distanceInRadii: m.d / bodyRadii[id],
          cameraPosition:
            id === selected?.id || catalogue.getBody(id).capabilities.emitsLight
              ? camera.position.clone()
              : undefined,
        });
      }
    }
    candidates.sort(
      (a, b) =>
        (b.identity.id === selected?.id ? 1 : 0) -
          (a.identity.id === selected?.id ? 1 : 0) || b.pixels - a.pixels,
    );
    let pixelBudget = host.clientWidth * renderHeight * 1.5;
    const visibleCandidates = candidates.filter((c) => {
      const area = Math.PI * c.pixels * c.pixels;
      if (c.identity.id === selected?.id || area < pixelBudget) {
        pixelBudget -= area;
        return true;
      }
      return false;
    });
    debris.update(
      selected,
      localFocus,
      selected ? distance / selected.radius : 100,
      rotation,
    );
    const fades = bodyLOD.update(
      visibleCandidates
        .slice(0, 8)
        .filter((c) => c.identity.capabilities.renderClass === 'ordinary'),
      wallTime,
      rotation,
      activityTime,
    );
    const specialFades = phenomena.update(
      visibleCandidates.slice(0, 8),
      wallTime,
      reduced.matches ? 0 : activityTime,
      reduced.matches,
    );
    fades.push(...specialFades);
    // Regions are queried in base space, where their volumes are defined, then
    // each centre is sheared back for rendering. Nothing here touches picking.
    regionPoint.copy(camera.position);
    group.worldToLocal(regionPoint);
    galacticUnshear(
      regionPoint.x,
      regionPoint.y,
      regionPoint.z,
      rotation,
      cameraBase,
    );
    catalogue.regionsNear(
      cameraBase.x,
      cameraBase.y,
      cameraBase.z,
      distance * 1.5 + 4,
      settings.density,
      nearbyRegions,
    );
    regionCandidates.length = 0;
    insideRegion = null;
    insidePresence = 0;
    for (const region of nearbyRegions) {
      const candidate = (regionPool[regionCandidates.length] ??= {
        region,
        position: new THREE.Vector3(),
        pixels: 0,
        inside: 0,
        focused: false,
      });
      candidate.region = region;
      candidate.focused = region === regionFocus;
      galacticShear(
        region.center[0],
        region.center[1],
        region.center[2],
        rotation,
        candidate.position,
      );
      projected.copy(candidate.position).applyMatrix4(group.matrixWorld);
      viewPosition.copy(projected).applyMatrix4(camera.matrixWorldInverse);
      const depth = -viewPosition.z;
      candidate.pixels =
        depth > camera.near ? (region.envelope * projectionScale) / depth : 0;
      candidate.inside = regionPresence(
        Math.hypot(
          cameraBase.x - region.center[0],
          cameraBase.y - region.center[1],
          cameraBase.z - region.center[2],
        ),
        region.radius,
      );
      regionCandidates.push(candidate);
      if (candidate.inside > insidePresence) {
        insidePresence = candidate.inside;
        insideRegion = region;
      }
    }
    regions.update(
      regionCandidates,
      wallTime,
      reduced.matches ? 0 : activityTime,
      rotation,
      reduced.matches,
    );
    host.dataset.regions = String(regions.stats().cached);
    // Reached by marker or by the menu, never by ray: a transparent volume must
    // not steal a click from the stars behind it.
    markedRegions.length = 0;
    for (const candidate of regionCandidates)
      if (candidate.inside === 0 && candidate.pixels > 8)
        markedRegions.push(candidate);
    markedRegions.sort((a, b) => b.pixels - a.pixels);
    markedRegions.length = Math.min(markedRegions.length, REGION_DETAIL_LIMIT);
    for (const [id, node] of regionMarkers)
      if (!markedRegions.some((c) => c.region.regionId === id)) {
        node.remove();
        regionMarkers.delete(id);
      }
    for (const candidate of markedRegions) {
      const region = candidate.region;
      let node = regionMarkers.get(region.regionId);
      if (!node) {
        node = document.createElement('button');
        node.className = 'system-marker';
        node.dataset.label = region.name;
        node.dataset.central = 'false';
        const label = messages.regionLabel(region.type);
        node.title = label;
        node.setAttribute(
          'aria-label',
          messages.exploreBodyAria(region.name, label),
        );
        node.addEventListener('click', (event) => {
          event.stopPropagation();
          frameRegion(region.regionId);
        });
        host.appendChild(node);
        regionMarkers.set(region.regionId, node);
      }
      projected
        .copy(candidate.position)
        .applyMatrix4(group.matrixWorld)
        .project(camera);
      node.style.display =
        projected.z > -1 &&
        projected.z < 1 &&
        Math.abs(projected.x) < 1 &&
        Math.abs(projected.y) < 1
          ? 'block'
          : 'none';
      node.style.left = `${(projected.x * 0.5 + 0.5) * host.clientWidth}px`;
      node.style.top = `${(-projected.y * 0.5 + 0.5) * renderHeight}px`;
    }
    const activeRegion = regionFocus ?? insideRegion;
    if ((activeRegion?.regionId ?? null) !== reportedRegion) {
      reportedRegion = activeRegion?.regionId ?? null;
      onRegion(
        activeRegion
          ? {
              region: activeRegion,
              framed: activeRegion === regionFocus,
              inside: insidePresence,
            }
          : null,
      );
    }
    host.dataset.phenomena = String(phenomena.stats().cached);
    host.dataset.catalogueVersion = 'v2';
    host.dataset.activeBodies = String(settings.density);
    host.dataset.selectedBody = selected?.bodyId ?? '';
    host.dataset.surfaceLevel = String(bodyLOD.stats().surfaceLevel);
    host.dataset.surfacePatches = String(bodyLOD.stats().patches);
    host.dataset.altitudeRatio = selected
      ? String(distance / selected.radius - 1)
      : '';
    replacements.forEach((v, i) => {
      const f = fades[i];
      v.set(f?.id ?? -1, f?.fade ?? 0);
    });
    marker.style.display =
      selected &&
      !framed &&
      distance >
        (selected.phenomenon?.envelope ??
          selected.pulsar?.envelope ??
          selected.radius) *
          20
        ? 'block'
        : 'none';
    if (selected) {
      projected.copy(worldFocus).project(camera);
      marker.style.left = `${(projected.x * 0.5 + 0.5) * host.clientWidth}px`;
      marker.style.top = `${(-projected.y * 0.5 + 0.5) * host.clientHeight}px`;
    }
    // Read-only diagnostics for the local development preview.
    if (process.env.NODE_ENV !== 'production') {
      host.dataset.selectedId = String(selected?.id ?? -1);
      host.dataset.detailCount = String(bodyLOD.stats().visible);
      host.dataset.distance = distance.toFixed(4);
    }
    // Report discrete UI changes only, including wheel and keyboard navigation.
    const viewRadius =
      selected && (selected.phenomenon ?? selected.pulsar)
        ? framingDistance(
            (selected.phenomenon ?? selected.pulsar)!.envelope,
            camera.aspect,
          ) / 4.2
        : (selected?.radius ?? 1);
    const cameraView: CameraView = !selected
      ? 'overview'
      : framed
        ? 'system'
        : travel ||
            (targetDistance / viewRadius <= 4.3 && distance / viewRadius > 4.6)
          ? 'approaching'
          : distance / viewRadius <= 6
            ? 'close'
            : 'selected';
    if (cameraView !== reportedCameraView) {
      reportedCameraView = cameraView;
      onCameraView(cameraView);
    }
    lensing.render(
      renderer,
      scene,
      camera,
      phenomena.lensSubject(),
      wallTime,
      reduced.matches ? 0 : activityTime,
      captureSky,
      renderPointDepth,
      activityTime,
    );
    const selectedBinary = selected
      ? catalogue.getSystem(selected.systemId).binary
      : undefined;
    onProximity(
      zoomProximity(
        distance,
        selected?.phenomenon?.diskOuter ??
          selected?.pulsar?.envelope ??
          selected?.radius ??
          null,
      ),
      selected?.kind ?? null,
      selected?.pulsar ? phenomena.pulse(selected.id) : 0.5,
      selectedBinary
        ? selectedBinary.phase + rotation * selectedBinary.speed
        : null,
      insideRegion
        ? { presence: insidePresence, type: insideRegion.type }
        : null,
    );
    if (process.env.NODE_ENV !== 'production') {
      host.dataset.lenses = String(lensing.stats().active);
      host.dataset.lensTargets = String(lensing.stats().targets);
      host.dataset.skyCaptureMs = lensing.captureStats().costMs.toFixed(2);
      host.dataset.skyCaptureTiming = lensing.captureStats().source;
      host.dataset.skyResolution = String(lensing.skyResolution());
      host.dataset.skyCaptures = String(lensing.captureStats().captures);
    }
    if (!firstFrameRendered) {
      firstFrameRendered = true;
      onFirstFrame();
    }
  };
  frame = requestAnimationFrame(animate);
  return {
    catalogue,
    configure(next) {
      const densityChanged = settings.density !== next.density;
      settings = { ...next, density: catalogue.activeCount(next.density) };
      if (selected && densityChanged) {
        if (selected.id >= settings.density) overview();
        else if (framed) frameSystem('local');
      }
      geometry.setDrawRange(0, settings.density);
      lensing.invalidate();
      dustGeometry.setDrawRange(
        0,
        Math.round(dustCount * Math.min(1, next.density / 65000)),
      );
      targetInner.set(palettes[next.palette][0]);
      targetOuter.set(palettes[next.palette][1]);
    },
    setOpeningProgress(progress) {
      openingProgress = progress;
    },
    setViewportInset(pixels) {
      reservedBottom = Math.max(0, Math.min(pixels, host.clientHeight * 0.65));
    },
    setMessages(next) {
      messages = next;
      renderer.domElement.setAttribute('aria-label', messages.canvasHint);
      // Markers already on screen are re-labelled in place; frameSystem()
      // will use the new messages for any it creates from here on.
      framed?.members.forEach((member, i) => {
        const marker = systemMarkers[i];
        if (!marker) return;
        const kindLabel = messages.bodyKindLabel(member.kind);
        marker.title = kindLabel;
        marker.setAttribute(
          'aria-label',
          messages.exploreBodyAria(member.name, kindLabel),
        );
      });
    },
    zoom: changeZoom,
    approach,
    frameSystem,
    frameRegion,
    inspectBody(id) {
      if (id >= 0 && id < settings.density) {
        select(id);
        approach();
      }
    },
    overview,
    nextBody(direction) {
      select(
        ((selected?.id ?? -1) + direction + settings.density) %
          settings.density,
      );
    },
    reset() {
      overview();
      azimuth = 0;
      elevation = 0.62;
      rotation = 0;
      pointer.set(0, 0);
    },
    dispose() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('pointermove', move);
      renderer.domElement.removeEventListener('wheel', wheel);
      renderer.domElement.removeEventListener('pointerdown', down);
      renderer.domElement.removeEventListener('pointermove', drag);
      renderer.domElement.removeEventListener('pointerup', up);
      renderer.domElement.removeEventListener('pointercancel', up);
      clearFrame();
      bodyLOD.dispose();
      phenomena.dispose();
      regions.dispose();
      regionMarkers.forEach((marker) => marker.remove());
      regionMarkers.clear();
      lensing.dispose();
      pointDepthMaterial.dispose();
      debris.dispose();
      marker.remove();
      pickMaterial.dispose();
      opticalPickMaterial.dispose();
      pickTarget?.dispose();
      renderer.domElement.removeEventListener('dblclick', doubleClick);
      renderer.domElement.removeEventListener('keydown', key);
      renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      renderer.domElement.removeEventListener(
        'webglcontextrestored',
        contextRestored,
      );
      geometry.dispose();
      material.dispose();
      impostorMaterial.dispose();
      dustGeometry.dispose();
      dustMaterial.dispose();
      haloTexture.dispose();
      haloMaterial.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

import { REFERENCE_SCENES, referencePose, summarize } from './reference-replay';
import { createGpuDiagnostics } from './gpu-diagnostics';
import { estimateBufferBytes, estimateTargetBytes } from './performance-memory';
import { diagnosticControls } from './diagnostic-controls';
import { createDiagnostics } from './performance-diagnostics';
import { createLensing } from './phenomena/lensing';
import { createPhenomenaManager } from './phenomena/manager';
import {
  createRegionManager,
  type RegionCandidate,
} from './phenomena/region-manager';
import { catalogue } from './catalogue/runtime';
import { generateChunk } from './catalogue/generate';
import { MAX_BODIES } from './catalogue/config';
import type { SystemDefinition } from './catalogue/types';
import {
  animatedRegionCenter,
  regionZoomDistance,
  resizeRegionDistance,
} from './region-navigation';
import {
  createQualityController,
  effectivePixelRatio,
  type QualityMode,
  type QualityPreset,
} from './quality-policy';
import { createFrameScheduler } from './frame-scheduler';
import { asteroidRadius } from './asteroid-shape';
import { sampleBodyTravel } from './body-travel';
import { closeupBudget, createCloseupVisitTracker } from './closeup-policy';
import { desiredSurfaceTilt, surfaceCameraPose } from './surface-camera';
import {
  systemBounds,
  framingDistance,
  localSystemRoot,
  zoomSelection,
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
import { galacticUnshear, particlePosition } from './particle-motion';
import { frameReach, withinFrame } from './frame-reach';
import {
  createSystemSpatialIndex,
  type IndexedSystem,
} from './system-spatial-index';
import {
  createLocalPrecision,
  localPrecisionGLSL,
  LOCAL_REACH,
  selectLocalSystems,
} from './local-precision';
import {
  createLocalLights,
  mixLocalLights,
  type LocalLight,
} from './body-lighting';
import { STELLAR_LUMINOSITY } from './catalogue/config';
import type { RegionDefinition } from './catalogue/types';

export type GalaxySettings = {
  density: number;
  speed: number;
  tilt: number | null;
  paused: boolean;
  palette: number;
  /** Automatic adapts on its own; all named profiles are pinned. */
  quality: QualityMode;
};
export type QualityReport = {
  mode: QualityMode;
  preset: QualityPreset;
  targetFps: number;
  label: string;
  reason: string;
};
// Localized strings the engine needs for text it renders itself (canvas
// aria-label, error messages, system-marker labels), decoupled from React so
// a locale change can be pushed in via setMessages() without recreating it.
export type GalaxyMessages = {
  canvasHint: string;
  contextLost: string;
  bodyKindLabel: (kind: BodyKind) => string;
  exploreBodyAria: (name: string, kindLabel: string) => string;
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
  occupied: RegionDefinition | null;
};
export type GalaxyEngine = {
  inspectBody: (id: number) => void;
  catalogue: typeof catalogue;
  frameSystem: (scope: 'stellar' | 'local') => void;
  frameRegion: (regionId: string) => void;
  configure: (settings: GalaxySettings) => void;
  setMessages: (messages: GalaxyMessages) => void;
  setViewportInset: (pixels: number) => void;
  recordAudioGesture: (startedAt: number, readyAt: number | null) => void;
  setOpeningProgress: (progress: number | null) => void;
  zoom: (factor: number) => void;
  approach: () => void;
  overview: () => void;
  nextBody: (direction: number) => void;
  reset: () => void;
  dispose: () => void;
};

const vertexShader = `
  attribute vec3 aEccentricity;
  attribute vec4 aOrbit0;
  attribute vec4 aOrbit1;
  attribute vec4 aOrbit2;
  ${orbitalGLSL}
  ${localPrecisionGLSL}
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
    vec3 orbitalDelta=orbitPosition(aOrbit0,uRotation,aEccentricity.x)+orbitPosition(aOrbit1,uRotation,aEccentricity.y)+orbitPosition(aOrbit2,uRotation,aEccentricity.z);
    p += orbitalDelta;
    vLightDirection=mat3(modelViewMatrix)*(length(orbitalDelta)>0.?-orbitalDelta:vec3(1.,0.,0.));
    // Camera-relative from here on: see lib/local-precision.ts.
    p = anchorToCamera(aId, p);
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
   if(vPhenomenon>1.5 && vPhenomenon<2.5){
     float core=1.-smoothstep(.006,.018,r);
     float halo=exp(-r*32.)*.24;
     gl_FragColor=vec4(mix(vBodyColor,vec3(1.),core*.35),
       max(core,halo)*vSurface*vFade);return;
   }
   if(vPhenomenon>.5 && vPhenomenon<1.5){
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
  /** Fires as the background catalogue growth advances what's drawable. */
  onGrowth: (filled: number, capacity: number) => void = () => {},
  /** The common quality controller also owns the optional audio profile. */
  onAudioEconomy: (economy: boolean) => void = () => {},
  /** Exposes the actual budget so Auto's changes are never invisible. */
  onQuality: (report: QualityReport) => void = () => {},
): GalaxyEngine {
  const diagnosticStart = performance.now();
  const searchParams = new URLSearchParams(window.location.search);
  const diagnostics =
    searchParams.get('diagnostics') === '1' ? createDiagnostics() : null;
  // Diagnostics only: replays the reference scenes at a degraded volume tier,
  // so the Auto ladder can be captured as well as the full-detail contract.
  const replayVolumeSteps = diagnostics
    ? Number(searchParams.get('volumeSteps')) || 16
    : 16;
  let lastRendered: number | null = null;
  let messages = initialMessages;
  let firstFrameRendered = false;
  // One calendar and one budget for the whole engine: the scheduler owns the
  // cadence, the controller owns every knob the cadence alone cannot fix.
  const quality = createQualityController('auto', diagnosticStart);
  const scheduler = createFrameScheduler(quality.budget.targetFps);
  let openingProgress: number | null = null;
  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    alpha: false,
    powerPreference: 'default',
  });
  let replayGpuSamples: number[] = [];
  let replayFirstFrame = Infinity;
  const gpuDiagnostics = diagnostics
    ? createGpuDiagnostics(
        renderer.getContext() as WebGL2RenderingContext,
        (kind, at, values) => {
          diagnostics.record(kind, at, values);
          if (
            kind === 'gpu-frame' &&
            values.complete &&
            typeof values.gpuMs === 'number'
          )
            quality.acceptGpu(values.gpuMs, at);
          if (
            kind === 'gpu-frame' &&
            values.complete &&
            typeof values.frameId === 'number' &&
            values.frameId >= replayFirstFrame + 60 &&
            typeof values.gpuMs === 'number'
          )
            replayGpuSamples.push(values.gpuMs);
        },
      )
    : null;
  let diagnosticFrame = 0;
  let runReference: (mode: 'short' | 'endurance' | 'stop') => void = () => {};
  let replayStatus: Record<string, unknown> = { active: false };
  const replayResults: Record<string, unknown>[] = [];
  let lastMemorySample = -Infinity;
  let restoreTimer: ReturnType<typeof setTimeout> | undefined;
  const removeDiagnosticControls = diagnostics
    ? diagnosticControls(
        () => ({
          ...diagnostics.snapshot(),
          gpu: gpuDiagnostics?.status(),
          replay: { ...replayStatus, results: replayResults },
          userAgent: navigator.userAgent,
          viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
            dpr: window.devicePixelRatio,
          },
        }),
        () => {
          const extension = renderer
            .getContext()
            .getExtension('WEBGL_lose_context');
          if (!extension) {
            diagnostics.record(
              'context-test-unavailable',
              performance.now(),
              {},
            );
            return;
          }
          extension.loseContext();
          restoreTimer = setTimeout(() => extension.restoreContext(), 1000);
        },
        (mode) => runReference(mode),
      )
    : null;
  const diagnosticObservers: PerformanceObserver[] = [];
  if (diagnostics && typeof PerformanceObserver !== 'undefined') {
    for (const type of ['longtask', 'event', 'first-input']) {
      if (!PerformanceObserver.supportedEntryTypes.includes(type)) continue;
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          diagnostics.record(type, entry.startTime, {
            name: entry.name,
            durationMs: entry.duration,
          });
      });
      observer.observe({
        type,
        buffered: true,
        durationThreshold: 16,
      } as PerformanceObserverInit);
      diagnosticObservers.push(observer);
    }
  }
  if (diagnostics) renderer.info.autoReset = false;
  renderer.setClearColor(0x04060b);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.budget.dpr));
  host.appendChild(renderer.domElement);
  // Dataset and style assignments are observable DOM work. Avoid queuing the
  // same mutation every frame, and keep moving overlays on the compositor.
  const setHostData = (name: string, value: string) => {
    if (host.dataset[name] !== value) host.dataset[name] = value;
  };
  const setStyle = (node: HTMLElement, name: string, value: string) => {
    if (node.style.getPropertyValue(name) !== value)
      node.style.setProperty(name, value);
  };
  const setMarkerPosition = (node: HTMLElement, x: number, y: number) => {
    setStyle(node, '--marker-x', `${x.toFixed(2)}px`);
    setStyle(node, '--marker-y', `${y.toFixed(2)}px`);
  };
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute('role', 'button');
  renderer.domElement.setAttribute('aria-label', messages.canvasHint);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 180);
  const group = new THREE.Group();
  group.rotation.z = -0.18;
  scene.add(group);
  let seed = 91724;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  // Buffers are sized once for the full catalogue capacity and never
  // reallocated; only the leading `filled` ids ever hold real data. The
  // rest of the catalogue grows into them in the background (see below).
  const positions = new Float32Array(MAX_BODIES * 3);
  const sizes = new Float32Array(MAX_BODIES);
  const seeds = new Float32Array(MAX_BODIES);
  const orbits = new Float32Array(MAX_BODIES * ORBIT_STRIDE);
  const roots = new Float32Array(MAX_BODIES);
  const bodyRadii = new Float32Array(MAX_BODIES),
    bodyTypes = new Float32Array(MAX_BODIES),
    bodyColors = new Float32Array(MAX_BODIES * 3),
    phenomenonFlags = new Float32Array(MAX_BODIES);
  const scratchColor = new THREE.Color();
  const ids = Float32Array.from({ length: MAX_BODIES }, (_, i) => i);
  const geometry = new THREE.BufferGeometry();
  const orbitalBuffer = new THREE.InterleavedBuffer(orbits, ORBIT_STRIDE);
  for (let level = 0; level < ORBIT_DEPTH; level++)
    geometry.setAttribute(
      `aOrbit${level}`,
      new THREE.InterleavedBufferAttribute(orbitalBuffer, 4, level * 4),
    );
  geometry.setAttribute(
    'aEccentricity',
    new THREE.InterleavedBufferAttribute(orbitalBuffer, 3, ORBIT_DEPTH * 4),
  );
  const bodyRadiusAttribute = new THREE.BufferAttribute(bodyRadii, 1);
  const bodyTypeAttribute = new THREE.BufferAttribute(bodyTypes, 1);
  const bodyColorAttribute = new THREE.BufferAttribute(bodyColors, 3);
  const phenomenonAttribute = new THREE.BufferAttribute(phenomenonFlags, 1);
  const rootAttribute = new THREE.BufferAttribute(roots, 1);
  const positionAttribute = new THREE.BufferAttribute(positions, 3);
  const sizeAttribute = new THREE.BufferAttribute(sizes, 1);
  const seedAttribute = new THREE.BufferAttribute(seeds, 1);
  geometry.setAttribute('aBodyRadius', bodyRadiusAttribute);
  geometry.setAttribute('aBodyType', bodyTypeAttribute);
  geometry.setAttribute('aBodyColor', bodyColorAttribute);
  geometry.setAttribute('aPhenomenon', phenomenonAttribute);
  geometry.setAttribute('aSystemRoot', rootAttribute);
  geometry.setAttribute('aId', new THREE.BufferAttribute(ids, 1));
  geometry.setAttribute('position', positionAttribute);
  geometry.setAttribute('aSize', sizeAttribute);
  geometry.setAttribute('aSeed', seedAttribute);
  /** Writes the compact GPU attributes for [start, end) — never generates. */
  function fillRange(start: number, end: number) {
    for (let id = start; id < end; id++) {
      const body = catalogue.getBody(id);
      const system = catalogue.getSystem(body.systemId);
      positions.set(system.anchor, id * 3);
      seeds[id] = system.motionSeed;
      roots[id] = system.rootId;
      sizes[id] =
        (0.22 + (body.seed % 1) ** 5 * 1.15) *
        (body.role === 'central' ? 1 : 0.12);
      orbits.set(compileOrbitChain(id, describeBody), id * ORBIT_STRIDE);
      bodyRadii[id] =
        body.phenomenon?.envelope ?? body.pulsar?.envelope ?? body.radius;
      bodyTypes[id] = body.type;
      scratchColor.set(body.color).toArray(bodyColors, id * 3);
      phenomenonFlags[id] = body.comet ? 3 : body.pulsar ? 2 : body.phenomenon ? 1 : 0;
    }
  }
  function markFilledAttributesDirty() {
    orbitalBuffer.needsUpdate = true;
    bodyRadiusAttribute.needsUpdate = true;
    bodyTypeAttribute.needsUpdate = true;
    bodyColorAttribute.needsUpdate = true;
    phenomenonAttribute.needsUpdate = true;
    rootAttribute.needsUpdate = true;
    positionAttribute.needsUpdate = true;
    sizeAttribute.needsUpdate = true;
    seedAttribute.needsUpdate = true;
  }
  // First light: only what the current quality tier needs for an initial
  // render, never the full catalogue (that used to force generating and
  // compiling orbits for all of MAX_BODIES before the first frame).
  let filled = Math.min(quality.budget.population, MAX_BODIES);
  catalogue.ensure(filled);
  // A system always completes whole, so bodies.length can overshoot
  // MAX_BODIES by up to one system's worth — never trust it unclamped as a
  // fill/buffer bound (the buffers themselves are sized to MAX_BODIES).
  filled = Math.min(catalogue.bodies.length, MAX_BODIES);
  fillRange(0, filled);
  geometry.setDrawRange(0, filled);
  // Systems are static in base space; query with the camera unsheared below.
  // Their envelopes cover the orbital motion, so this never needs a frame-wide
  // rebuild while stars are moving.
  const systemIndex = createSystemSpatialIndex();
  systemIndex.sync(catalogue.systems);
  const nearbySystemIds: number[] = [];
  const unshearedCamera = new THREE.Vector3();
  const localPrecision = createLocalPrecision();
  const localOrigin = new THREE.Vector3(),
    unshearedOrigin = new THREE.Vector3(),
    localCandidates: IndexedSystem[] = [],
    localSystems: IndexedSystem[] = [];
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
    ...localPrecision.uniforms,
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
  dustGeometry.setAttribute(
    'aEccentricity',
    new THREE.BufferAttribute(new Float32Array(dustCount * 3), 3),
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
  const dust = new THREE.Points(dustGeometry, dustMaterial);
  group.add(dust);
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
  // The initial draw range is exactly what first light generated: never
  // more than what's already filled into the GPU buffers.
  let requestedDensity = filled;
  let settings: GalaxySettings = {
    density: filled,
    speed: 1,
    tilt: null,
    paused: false,
    palette: 0,
    quality: 'auto',
  };
  // The global controller keeps the desktop/manual profile intact. Surfaces
  // consult this narrow, transient view of it when a compact device approaches
  // a body, so nearby resource creation cannot starve the camera/input frame.
  const surfaceQuality = {
    get budget() {
      return closeupBudget(
        quality.budget,
        constrainedDevice,
        selected ? distance / selected.radius : null,
        quality.mode === 'auto',
      );
    },
  };
  const bodyLOD = createBodyLOD(group, 8, surfaceQuality);
  const closeupVisits = createCloseupVisitTracker();
  const phenomena = createPhenomenaManager(group, surfaceQuality, (id, out) =>
    particlePosition(
      positions,
      seeds,
      id,
      rotation,
      elapsed,
      out,
      undefined,
      orbits,
    ),
  );
  const regions = createRegionManager(group, surfaceQuality);
  group.add(regions.impostorPoints);
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
    // The sky copies stay at the group origin; directional capture does not
    // need the camera-relative path.
    const restorePrecision = localPrecision.suspend();
    try {
      regions.captureSky(skyGroup, () => cube.update(renderer, skyScene));
    } finally {
      restorePrecision();
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
        length((gl_PointCoord-.5)*2.)>vDiscScale*(vPhenomenon>1.5 && vPhenomenon<2.5?.098:.98))discard;gl_FragColor=vec4(0.);}`,
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
  let reportedRegion = '';
  const regionFrustum = new THREE.Frustum();
  const regionProjection = new THREE.Matrix4();
  const regionSphere = new THREE.Sphere();
  const nearbyRegions: RegionDefinition[] = [];
  const regionPool: RegionCandidate[] = [];
  const regionCandidates: RegionCandidate[] = [];
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
      'gl_PointSize = max(aPhenomenon>1.5 && aPhenomenon<2.5 ? min(diameter*.1,uMaxPointSize) : gl_PointSize, (aPhenomenon>.5 ? 12.0 : 7.0) * uPixelRatio); vId = aId;',
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
        if(vPhenomenon>1.5 && vPhenomenon<2.5 && vSurface>.5){
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
  // Every points object drawn with the shared vertex shader, the sky copies
  // excepted, sits at the camera-relative origin of lib/local-precision.ts.
  const cameraAnchored = [stars, impostors, dust, pointDepth, pickPoints];
  let pickTarget: THREE.WebGLRenderTarget | null = null;
  // The projection is cropped to this target. A scissor on a full-window
  // target saves fragments but still allocates and clears the whole texture.
  const PICK_SIZE = 9;
  const pickPixels = new Uint8Array(PICK_SIZE * PICK_SIZE * 4);
  let asyncPickBusy = false;
  let latestQueuedPick: { x: number; y: number; request: number } | null =
    null;
  let pickRequest = 0;
  const pickAt = (clientX: number, clientY: number): number | null => {
    const request = ++pickRequest;
    // An asynchronous read owns the target until its promise settles. Coalesce
    // subsequent gestures instead of issuing competing reads against it.
    if (asyncPickBusy) {
      latestQueuedPick = { x: clientX, y: clientY, request };
      return null;
    }
    if (!diagnostics) return performPick(clientX, clientY, request);
    const started = performance.now();
    renderer.info.reset();
    try {
      return performPick(clientX, clientY, request);
    } finally {
      diagnostics.record('picking', started, {
        cpuMs: performance.now() - started,
        ...renderer.info.render,
      });
    }
  };
  const performPick = (
    clientX: number,
    clientY: number,
    request: number,
  ): number | null => {
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
    const sourceWidth = optical
      ? lensing.skyResolution()
      : Math.max(PICK_SIZE, Math.floor(bounds.width));
    const sourceHeight = optical
      ? lensing.skyResolution()
      : Math.max(PICK_SIZE, Math.floor(bounds.height));
    const sx = THREE.MathUtils.clamp(
        Math.floor(optical ? sourceWidth / 2 : x) - 4,
        0,
        sourceWidth - PICK_SIZE,
      ),
      sy = THREE.MathUtils.clamp(
        sourceHeight - Math.floor(optical ? sourceHeight / 2 : y) - 4,
        0,
        sourceHeight - PICK_SIZE,
      );
    const pickCamera = optical
      ? new THREE.PerspectiveCamera(
          90,
          1,
          optical.body.phenomenon!.diskOuter * 4,
          180,
        )
      : camera.clone();
    if (optical) {
      pickCamera.position.copy(optical.origin);
      pickCamera.lookAt(optical.origin.clone().add(optical.direction));
      pickCamera.updateMatrixWorld();
    }
    // `setViewOffset` turns the 9×9 target into the exact screen tile that
    // was clicked; all vertices retain their normal clipping/projection.
    pickCamera.setViewOffset(
      sourceWidth,
      sourceHeight,
      sx,
      sourceHeight - sy - PICK_SIZE,
      PICK_SIZE,
      PICK_SIZE,
    );
    pickCamera.updateProjectionMatrix();
    if (!pickTarget)
      pickTarget = new THREE.WebGLRenderTarget(PICK_SIZE, PICK_SIZE, {
        depthBuffer: true,
      });
    pickGroup.matrix.copy(group.matrixWorld);
    const clear = renderer.getClearColor(new THREE.Color());
    renderer.setRenderTarget(pickTarget);
    renderer.setClearColor(0);
    renderer.clear();
    const projection = uniforms.uProjectionScale.value,
      ratio = uniforms.uPixelRatio.value;
    const strength = uniforms.uContextStrength.value;
    if (optical) {
      uniforms.uProjectionScale.value = 256;
      uniforms.uPixelRatio.value = sourceWidth / 512;
      uniforms.uContextStrength.value = 0;
    }
    const savedPickMaterial = pickPoints.material;
    if (optical) pickPoints.material = opticalPickMaterial;
    try {
      if (gpuDiagnostics)
        gpuDiagnostics.measure('picking', () =>
          renderer.render(pickScene, pickCamera),
        );
      else renderer.render(pickScene, pickCamera);
    } finally {
      pickPoints.material = savedPickMaterial;
    }
    uniforms.uProjectionScale.value = projection;
    uniforms.uPixelRatio.value = ratio;
    uniforms.uContextStrength.value = strength;
    renderer.setRenderTarget(null);
    renderer.setClearColor(clear);
    const decode = () => {
      let best = -1,
        score = Infinity;
      for (let i = 0; i < PICK_SIZE * PICK_SIZE; i++) {
        const value =
          pickPixels[i * 4] +
          pickPixels[i * 4 + 1] * 256 +
          pickPixels[i * 4 + 2] * 65536 -
          1;
        const d =
          ((i % PICK_SIZE) - 4) ** 2 +
          (Math.floor(i / PICK_SIZE) - 4) ** 2;
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
    if (typeof renderer.readRenderTargetPixelsAsync !== 'function') {
      setHostData('pickReadback', 'sync');
      renderer.readRenderTargetPixels(
        pickTarget,
        0,
        0,
        PICK_SIZE,
        PICK_SIZE,
        pickPixels,
      );
      return decode();
    }
    setHostData('pickReadback', 'async');
    asyncPickBusy = true;
    const densityAtRequest = settings.density;
    const cameraAtRequest = camera.position.clone();
    void renderer
      .readRenderTargetPixelsAsync(
        pickTarget,
        0,
        0,
        PICK_SIZE,
        PICK_SIZE,
        pickPixels,
      )
      .then(() => {
        // A density change, camera move or newer gesture makes a GPU answer
        // obsolete. Immediate CPU/mesh hits above still respond synchronously.
        if (
          request === pickRequest &&
          densityAtRequest === settings.density &&
          camera.position.distanceToSquared(cameraAtRequest) < 1e-10
        ) {
          const id = decode();
          if (id !== null) select(id);
        }
      })
      .catch(() => {
        setHostData('pickReadback', 'sync-fallback');
      })
      .finally(() => {
        asyncPickBusy = false;
        const next = latestQueuedPick;
        latestQueuedPick = null;
        if (next) performPick(next.x, next.y, next.request);
      });
    return null;
  };
  let framed: {
    radius: number;
    members: BodyIdentity[];
    focus: number | null;
    scope: 'stellar' | 'local';
  } | null = null;
  const orbitGuides = new THREE.Group();
  group.add(orbitGuides);
  const guideParents: (number | null)[] = [];
  const systemMarkers: HTMLButtonElement[] = [];
  // A paused scene runs only long enough to settle camera/fade work. Every
  // meaningful input extends this window and wakes the loop when needed.
  const DEMAND_SETTLE_MS = 1500;
  let demandRenderUntil = 0;
  const invalidateRender = (reason: string) => {
    demandRenderUntil = Math.max(
      demandRenderUntil,
      performance.now() + DEMAND_SETTLE_MS,
    );
    diagnostics?.record('render-invalidated', performance.now(), { reason });
    startLoop();
  };
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
      (selected.phenomenon ?? selected.pulsar ?? selected.comet)
        ? framingDistance(
            (selected.phenomenon ?? selected.pulsar ?? selected.comet)!
              .envelope,
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
    invalidateRender('selection');
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
    const previousVisit = closeupVisits.begin(id, performance.now());
    if (previousVisit)
      diagnostics?.record('closeup-visit', performance.now(), previousVisit);
    diagnostics?.record('closeup-visit-start', performance.now(), {
      bodyId: id,
      firstVisit: closeupVisits.snapshot()?.firstVisit ?? true,
    });
    if (selected.phenomenon || selected.pulsar || selected.comet) {
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
    invalidateRender('overview');
    travel = null;
    clearFrame();
    regionFocus = null;
    const completedVisit = closeupVisits.end(performance.now());
    if (completedVisit)
      diagnostics?.record('closeup-visit', performance.now(), completedVisit);
    selected = null;
    targetDistance = mobile ? 40 : 29.4;
    onSelection(null);
  };
  const approach = () => {
    invalidateRender('approach');
    clearFrame();
    if (!selected) select(0);
    targetDistance =
      (selected!.phenomenon ?? selected!.pulsar ?? selected!.comet)
        ? framingDistance(
            (selected!.phenomenon ?? selected!.pulsar ?? selected!.comet)!
              .envelope,
            camera.aspect,
          )
        : selected!.radius * 4.2;
    if (!travel && distance > targetDistance * 1.1)
      startTravel(focus.clone(), selected);
    if (selected!.phenomenon || selected!.pulsar || selected!.comet) {
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
    invalidateRender('region');
    travel = null;
    clearFrame();
    surfaceAnchor = null;
    const completedVisit = closeupVisits.end(performance.now());
    if (completedVisit)
      diagnostics?.record('closeup-visit', performance.now(), completedVisit);
    selected = null;
    regionFocus = region;
    animatedRegionCenter(
      region,
      positions,
      seeds,
      rotation,
      elapsed,
      localFocus,
    );
    commitFocus();
    targetDistance = framingDistance(region.envelope, camera.aspect);
    onSelection(null);
  };

  const frameSystem = (scope: 'stellar' | 'local') => {
    invalidateRender('system');
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
    framed = { radius: bounds.radius, members, focus: root, scope };
    targetDistance = framingDistance(bounds.radius, camera.aspect);
    if (barycentric) {
      barycentre(body.systemId, localFocus);
      commitFocus();
    }
    onSystemView({ root: describeBody(root ?? start), members, barycentric });
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
          (Math.cos(a) - (orbit.eccentricity ?? 0)) * orbit.radius,
          Math.sin(a) *
            orbit.radius *
            Math.sqrt(1 - (orbit.eccentricity ?? 0) ** 2) *
            Math.sin(orbit.inclination),
          Math.sin(a) *
            orbit.radius *
            Math.sqrt(1 - (orbit.eccentricity ?? 0) ** 2) *
            Math.cos(orbit.inclination),
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
  // Pixels are billed on the drawing buffer, so the ratio is recomputed on
  // every resize as well as on every budget change.
  const applyPixelRatio = () => {
    const ratio = effectivePixelRatio(
      quality.budget,
      sizedWidth || window.innerWidth,
      sizedHeight || window.innerHeight,
      window.devicePixelRatio,
    );
    if (renderer.getPixelRatio() !== ratio) renderer.setPixelRatio(ratio);
    uniforms.uPixelRatio.value = ratio;
    setHostData('pixelRatio', String(ratio));
  };
  const applyBudget = (reason: string) => {
    const budget = quality.budget;
    scheduler.setTarget(budget.targetFps);
    applyPixelRatio();
    regions.setProfile(budget.volumeSteps, budget.referenceVolumes);
    setHostData('volumeSteps', String(budget.volumeSteps));
    setHostData('qualityTier', budget.label);
    setHostData('qualityMode', quality.stats().mode);
    setHostData('targetFps', String(budget.targetFps));
    const economy = budget.label.startsWith('economy') || budget.label === 'rescue';
    if (economy !== reportedAudioEconomy) {
      reportedAudioEconomy = economy;
      onAudioEconomy(economy);
    }
    diagnostics?.record('quality', performance.now(), {
      trigger: reason,
      ...budget,
      ...quality.stats(),
      pixelRatio: renderer.getPixelRatio(),
      refreshHz: scheduler.stats().refreshHz,
    });
    const status = quality.stats();
    onQuality({
      mode: status.mode,
      preset: status.preset,
      targetFps: status.targetFps,
      label: status.label,
      reason: status.reason,
    });
  };
  let lastPointingReport = 0;
  let lastPointingKey = '';
  let reportedAudioEconomy: boolean | null = null;
  let reportedCameraView: CameraView = 'overview';
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let wallTime = 0;
  let elapsed = 0,
    rotation = 0,
    frame = 0;
  let running = false;
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
  let constrainedDevice = false;
  let sizedWidth = 0,
    sizedHeight = 0;
  const resize = () => {
    const { width, height } = host.getBoundingClientRect();
    if (width <= 0 || height <= 0) return;
    const previousAspect = camera.aspect;
    mobile = width < 600;
    // Width alone misses landscape tablets. This remains opt-in to touch-like
    // devices, so a narrow desktop window never loses its manual Ultra tier.
    constrainedDevice =
      mobile ||
      (window.matchMedia('(pointer: coarse)').matches &&
        Math.min(width, height) <= 1024);
    renderer.setSize(width, height);
    // Mobile browsers fire this while scrolling; only a real size change
    // invalidates the pixel ceiling and the measurement windows.
    if (width !== sizedWidth || height !== sizedHeight) {
      sizedWidth = width;
      sizedHeight = height;
      applyPixelRatio();
      quality.reset(performance.now(), 'resize');
      invalidateRender('resize');
    }
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderHeight = height;
    if (framed) targetDistance = framingDistance(framed.radius, camera.aspect);
    else if (regionFocus && targetDistance > regionFocus.envelope) {
      targetDistance = resizeRegionDistance(
        targetDistance,
        regionFocus.envelope,
        previousAspect,
        camera.aspect,
      );
    } else if (
      selected &&
      (selected.phenomenon || selected.pulsar || selected.comet)
    ) {
      const scale =
        framingDistance(1, camera.aspect) / framingDistance(1, previousAspect);
      targetDistance = Math.max(
        (selected.phenomenon ?? selected.pulsar ?? selected.comet)!.exclusion,
        targetDistance * scale,
      );
    }
  };
  const changeZoom = (factor: number) => {
    invalidateRender('zoom');
    // Empty sky is not a destination. Falling back to body 0 sent anyone who
    // zoomed with a clear centre — five of the nine framed nebulae — to the
    // reference black hole at the other end of the galaxy. The wheel already
    // only selects what it actually hit.
    const target = zoomSelection(factor, !!selected || !!regionFocus, () => {
      const rect = host.getBoundingClientRect();
      return pickAt(rect.left + rect.width / 2, rect.top + rect.height / 2);
    });
    if (target !== null) select(target);
    if (regionFocus) {
      targetDistance = regionZoomDistance(
        targetDistance,
        factor,
        regionFocus.envelope,
      );
      return;
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
      (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? renderHeight : 1);
    if (delta < 0 && !selected && !regionFocus) {
      const id = pickAt(e.clientX, e.clientY);
      if (id !== null) select(id);
    }
    changeZoom(Math.exp(-THREE.MathUtils.clamp(delta, -150, 150) * 0.0025));
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();
  const move = (e: PointerEvent) => {
    const x = (e.clientX / window.innerWidth) * 2 - 1;
    const y = -((e.clientY / window.innerHeight) * 2 - 1);
    if (Math.abs(pointer.x - x) > 0.0001 || Math.abs(pointer.y - y) > 0.0001) {
      pointer.set(x, y);
      invalidateRender('pointer');
    }
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
    lastRendered = null;
    gpuDiagnostics?.reset();
    diagnostics?.record('context-lost', performance.now(), {});
    stopLoop();
    onError(messages.contextLost);
  };
  const contextRestored = () => {
    gpuDiagnostics?.reset();
    diagnostics?.record('context-restored', performance.now(), {});
    lensing.invalidate();
    systemIndex.sync(catalogue.systems);
    lost = false;
    onError('');
    quality.reset(performance.now(), 'context-restored');
    invalidateRender('context-restored');
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
  let replay: {
    mode: 'short' | 'endurance';
    slot: number;
    tick: number;
    start: number;
    cpu: number[];
    intervals: number[];
    saved: GalaxySettings;
  } | null = null;
  let replayMemory: Record<string, unknown> = {};
  let replayWarmup: number[] = [];
  const applyReferenceScene = () => {
    if (!replay) return;
    const definition = REFERENCE_SCENES[replay.slot % REFERENCE_SCENES.length];
    overview();
    surfaceAnchor = null;
    surfaceTilt = 0;
    pointer.set(0, 0);
    focus.set(0, 0, 0);
    focusOffset.set(0, 0, 0);
    settings = {
      ...settings,
      density: catalogue.activeCount(definition.density),
      paused: true,
      tilt: null,
    };
    requestedDensity = settings.density;
    if (definition.bodyId) {
      const body = catalogue.resolveReference(definition.bodyId);
      if (!body) throw new Error(`Missing reference body ${definition.bodyId}`);
      select(body.id);
    } else if (definition.regionId) frameRegion(definition.regionId);
    // Reference scenes are diagnostics-only and need exact reproducibility:
    // catch the GPU buffers up to whatever the catalogue now holds,
    // synchronously, instead of waiting for the background growth to do it.
    if (catalogue.bodies.length > filled) {
      const target = Math.min(catalogue.bodies.length, MAX_BODIES);
      fillRange(filled, target);
      filled = target;
      markFilledAttributesDirty();
    }
    systemIndex.sync(catalogue.systems);
    geometry.setDrawRange(0, settings.density);
    dustGeometry.setDrawRange(
      0,
      Math.round(dustCount * Math.min(1, definition.density / 65000)),
    );
    travel = null;
    focusOffset.set(0, 0, 0);
    quality.freeze({
      dpr: 1,
      pixelCap: Infinity,
      targetFps: 60,
      volumeSteps: replayVolumeSteps,
      opticalResolution: 512,
      opticalSteps: 320,
    });
    applyBudget('replay');
    lensing.invalidate();
    detailShortlist.clear();
    scanCursor = 0;
    replayWarmup = [];
    replayGpuSamples = [];
    replayFirstFrame = diagnosticFrame + 1;
    replay.cpu = [];
    replay.intervals = [];
    replayStatus = {
      active: true,
      mode: replay.mode,
      slot: replay.slot,
      scene: definition.name,
      repeat: Math.floor(replay.slot / REFERENCE_SCENES.length) + 1,
      warmupFrames: 60,
      sampleFrames: 120,
      dpr: 1,
      volumeSteps: replayVolumeSteps,
      seed: catalogue.seed,
    };
    diagnostics?.record('replay-scene', performance.now(), {
      ...replayStatus,
      definition,
    });
  };
  const finishReplay = (reason: string) => {
    if (!replay) return;
    settings = replay.saved;
    geometry.setDrawRange(0, settings.density);
    dustGeometry.setDrawRange(
      0,
      Math.round(dustCount * Math.min(1, settings.density / 65000)),
    );
    replayStatus = {
      ...replayStatus,
      active: false,
      reason,
      elapsedMs: performance.now() - replay.start,
    };
    diagnostics?.record('replay-end', performance.now(), replayStatus);
    quality.release(performance.now());
    applyBudget('replay-end');
    replay = null;
    replayFirstFrame = Infinity;
    overview();
  };
  runReference = (mode) => {
    finishReplay('stopped');
    if (mode === 'stop') return;
    replayResults.length = 0;
    replay = {
      mode,
      slot: 0,
      tick: 0,
      start: performance.now(),
      cpu: [],
      intervals: [],
      saved: { ...settings },
    };
    applyReferenceScene();
  };

  const visibility = () => {
    // rAF may stop entirely in a hidden tab, so act on the event itself.
    if (document.hidden) stopLoop();
    else invalidateRender('visibility');
    quality.reset(performance.now(), 'visibility');
    diagnostics?.record('visibility', performance.now(), {
      hidden: document.hidden,
      renderedFrames: diagnostics.snapshot().renderedFrames,
      simulationTime: elapsed,
    });
  };
  document.addEventListener('visibilitychange', visibility);
  // resize() can invalidate the first frame before this portion of the factory
  // is evaluated. A declaration is therefore required here: startLoop() must
  // be able to schedule it without touching a temporal-dead-zone binding.
  function animate(now: number) {
    if (lost || document.hidden) {
      stopLoop();
      return;
    }
    frame = requestAnimationFrame(animate);
    const tick = scheduler.frame(now);
    diagnostics?.record('raf', now, { intervalMs: tick.rafIntervalMs });
    if (!tick.render) return;
    gpuDiagnostics?.poll();
    gpuDiagnostics?.startFrame(++diagnosticFrame);
    const cpuStart = performance.now();
    if (diagnostics) renderer.info.reset();
    const frameTime = tick.renderIntervalMs ?? tick.scheduledMs;
    const dt = tick.deltaSeconds;
    setHostData('renderedFrames', String(scheduler.renderedFrames()));
    wallTime += dt;
    if (!settings.paused) {
      elapsed += dt * settings.speed;
      activityTime += dt * settings.speed * (reduced.matches ? 0.12 : 1);
    }
    if (!settings.paused)
      rotation += dt * settings.speed * (reduced.matches ? 0.012 : 0.065);
    if (replay) {
      const definition =
        REFERENCE_SCENES[replay.slot % REFERENCE_SCENES.length];
      const pose = referencePose(definition, replay.tick);
      elapsed = pose.simulationTime;
      rotation = pose.rotation;
      activityTime = elapsed;
      azimuth = pose.azimuth;
      elevation = pose.elevation;
      distance = targetDistance = selected
        ? selected.radius *
          Math.max(pose.distanceRatio, minimumOrbitRatio(selected))
        : regionFocus
          ? regionFocus.envelope * pose.distanceRatio
          : pose.distanceRatio;
      group.rotation.set(0, 0, -0.18);
      focusOffset.set(0, 0, 0);
      surfaceAnchor = null;
    }
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
        (insetWidth !== sizedWidth || insetHeight !== renderHeight))
    ) {
      currentReservedBottom =
        Math.abs(insetDelta) < 0.5
          ? reservedBottom
          : currentReservedBottom +
            insetDelta * (reduced.matches ? 1 : 1 - Math.exp(-dt * 10));
      const width = sizedWidth;
      const height = renderHeight;
      insetWidth = width;
      insetHeight = height;
      const oldAspect = camera.aspect;
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
      if (regionFocus && targetDistance > regionFocus.envelope) {
        targetDistance = resizeRegionDistance(
          targetDistance,
          regionFocus.envelope,
          oldAspect,
          camera.aspect,
        );
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
      animatedRegionCenter(
        regionFocus,
        positions,
        seeds,
        rotation,
        elapsed,
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
        selected.binary ? -(selected.orbit?.inclination ?? 0) : 0.12,
        rotation * (0.2 + selected.seed * 0.004),
        selected.binary ? 0 : selected.seed * 0.01,
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
    setHostData('travelPhase', travel
      ? travel.time < 1.25
        ? 'retreat'
        : travel.time < 2.25
          ? 'transfer'
          : 'approach'
      : 'idle');
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
    setHostData('surfaceTilt', surfaceTilt.toFixed(2));
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
    localOrigin.copy(camera.position);
    group.worldToLocal(localOrigin);
    for (const points of cameraAnchored) points.position.copy(localOrigin);
    galacticUnshear(
      localOrigin.x,
      localOrigin.y,
      localOrigin.z,
      rotation,
      unshearedOrigin,
    );
    selectLocalSystems(
      systemIndex.systemsNear(
        unshearedOrigin.x,
        unshearedOrigin.y,
        unshearedOrigin.z,
        LOCAL_REACH,
        localCandidates,
      ),
      unshearedOrigin.x,
      unshearedOrigin.y,
      unshearedOrigin.z,
      settings.density,
      selected?.rootId ?? null,
      localSystems,
    );
    localPrecision.update(
      localSystems,
      localOrigin,
      settings.density,
      (id, out) =>
        particlePosition(
          positions,
          seeds,
          id,
          rotation,
          elapsed,
          out,
          undefined,
          orbits,
        ),
    );
    if (now - lastPointingReport > (diagnostics ? 200 : 500)) {
      lastPointingReport = now;
      const r = camera.position.length();
      const ra = Math.atan2(camera.position.x, camera.position.z);
      const dec =
        r > 1e-6
          ? Math.asin(THREE.MathUtils.clamp(camera.position.y / r, -1, 1))
          : 0;
      const key = `${Math.round((ra * 12 * 3600) / Math.PI)}:${Math.round((dec * 180 * 3600) / Math.PI)}`;
      if (key !== lastPointingKey) {
        lastPointingKey = key;
        onPointing({ ra, dec });
      }
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
        setStyle(marker, 'display',
          position.z > -1 &&
          position.z < 1 &&
          Math.abs(position.x) < 1 &&
          Math.abs(position.y) < 1
            ? 'block'
            : 'none');
        setMarkerPosition(
          marker,
          (position.x * 0.5 + 0.5) * sizedWidth,
          (-position.y * 0.5 + 0.5) * renderHeight,
        );
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
    const searchStart = diagnostics ? performance.now() : 0;
    diagnostics?.record('cpu-phase', now, {
      phase: 'camera-and-ui',
      cpuMs: searchStart - cpuStart,
      frameId: diagnosticFrame,
    });
    const candidates: BodyCandidate[] = [];
    const projectionScale =
      renderHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    uniforms.uProjectionScale.value = projectionScale;
    // Candidates first come from conservative system bounds around the camera.
    // A tiny rolling sweep remains as a slow-path for bodies that move beyond
    // their nominal envelope, but it is capped by wall time rather than a
    // fixed 2,048-ID allocation every frame.
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
      const body = catalogue.getBody(id);
      const pixels =
        ((body.comet?.envelope ?? bodyRadii[id]) * projectionScale) /
        Math.max(depth, 0.000001);
      return {
        d,
        pixels,
        visible: withinFrame(
          projected,
          depth,
          d,
          frameReach(body, bodyRadii[id]),
          camera.near,
          camera.projectionMatrix.elements,
        ),
      };
    };
    if (distance < 3) {
      unshearedCamera.copy(camera.position);
      group.worldToLocal(unshearedCamera);
      galacticUnshear(
        unshearedCamera.x,
        unshearedCamera.y,
        unshearedCamera.z,
        rotation,
        unshearedCamera,
      );
      const neighbourReach = Math.min(3, Math.max(0.4, distance * 0.35 + 0.3));
      systemIndex.near(
        unshearedCamera.x,
        unshearedCamera.y,
        unshearedCamera.z,
        neighbourReach,
        settings.density,
        nearbySystemIds,
      );
      for (const id of nearbySystemIds) {
        const m = measure(id);
        if (
          m.visible &&
          m.pixels >=
            (catalogue.getBody(id).capabilities.renderClass !== 'ordinary'
              ? phenomena.detailThreshold(id)
              : 18)
        )
          detailShortlist.set(id, { pixels: m.pixels, seen: elapsed });
      }
      const quotaMs = settings.quality === 'economy' ? 1.5 : 2;
      const deadline = performance.now() + quotaMs;
      for (let i = 0; i < 2048 && performance.now() < deadline; i++) {
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
    let pixelBudget = sizedWidth * renderHeight * 1.5;
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
    const detailsStart = diagnostics ? performance.now() : 0;
    diagnostics?.record('cpu-phase', now, {
      phase: 'neighbours',
      cpuMs: detailsStart - searchStart,
      frameId: diagnosticFrame,
    });
    // How many bodies may hold a full surface at once is a budget decision.
    const detailBodies = surfaceQuality.budget.detailBodies;
    const fades = bodyLOD.update(
      visibleCandidates
        .slice(0, detailBodies)
        .filter((c) => c.identity.capabilities.renderClass === 'ordinary'),
      wallTime,
      rotation,
      activityTime,
      renderer,
      camera,
    );
    const lodStats = bodyLOD.stats();
    if (selected && distance / selected.radius < 3 && closeupVisits.warm(now))
      diagnostics?.record('closeup-warm', now, closeupVisits.snapshot() ?? {});
    if (lodStats.patches > 0 && closeupVisits.ready(now))
      diagnostics?.record('closeup-ready', now, closeupVisits.snapshot() ?? {});
    const specialFades = phenomena.update(
      visibleCandidates.slice(0, detailBodies),
      wallTime,
      reduced.matches ? 0 : activityTime,
      reduced.matches,
      rotation,
      renderer,
      camera,
    );
    fades.push(...specialFades);
    // A small sweep is exact for rigid moving regions; differential unshear is not.
    regionPoint.copy(camera.position);
    group.worldToLocal(regionPoint);
    nearbyRegions.length = 0;
    nearbyRegions.push(
      ...catalogue.listNebulae(),
      ...catalogue.getRemnants(settings.density),
    );
    regionFrustum.setFromProjectionMatrix(
      regionProjection.multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse,
      ),
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
      candidate.focused = region.regionId === regionFocus?.regionId;
      animatedRegionCenter(
        region,
        positions,
        seeds,
        rotation,
        elapsed,
        candidate.position,
      );
      projected.copy(candidate.position).applyMatrix4(group.matrixWorld);
      viewPosition.copy(projected).applyMatrix4(camera.matrixWorldInverse);
      const depth = -viewPosition.z;
      regionSphere.set(projected, region.envelope);
      candidate.inside = regionPresence(
        regionPoint.distanceTo(candidate.position),
        region.radius,
      );
      candidate.pixels = regionFrustum.intersectsSphere(regionSphere)
        ? (region.envelope * projectionScale) / Math.max(camera.near, depth)
        : 0;
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
      renderer,
      camera,
    );
    closeupVisits.recordCreations(
      lodStats.created + phenomena.stats().created + regions.stats().created,
    );
    setHostData('regions', String(
      regions.stats().cached + regions.stats().persistent,
    ));
    // A framed region answers in the scene itself: its volume brightens and
    // its filaments sharpen (uFocus, lib/phenomena/volume-shader.ts). Nothing
    // is drawn over it — a dashed ring could only ever trace the integration
    // envelope, which is neither the cloud's extent nor its centre of light.
    const activeRegion = regionFocus ?? insideRegion;
    const focusedPresence =
      regionCandidates.find((c) => c.region.regionId === regionFocus?.regionId)
        ?.inside ?? 0;
    const activePresence = regionFocus ? focusedPresence : insidePresence;
    // Quantized reports include framing and occupancy; no React update per frame.
    const regionReport = `${activeRegion?.regionId ?? ''}:${!!regionFocus}:${insideRegion?.regionId ?? ''}:${Math.ceil(activePresence * 20)}`;
    if (regionReport !== reportedRegion) {
      reportedRegion = regionReport;
      onRegion(
        activeRegion
          ? {
              region: activeRegion,
              framed: !!regionFocus,
              inside: Math.ceil(activePresence * 20) / 20,
              occupied: insideRegion,
            }
          : null,
      );
    }
    setHostData('phenomena', String(phenomena.stats().cached));
    setHostData('catalogueVersion', 'v2');
    setHostData('activeBodies', String(settings.density));
    setHostData('selectedBody', selected?.bodyId ?? '');
    setHostData('surfaceLevel', String(lodStats.surfaceLevel));
    setHostData('surfacePatches', String(lodStats.patches));
    setHostData('altitudeRatio', selected
      ? String(distance / selected.radius - 1)
      : '');
    replacements.forEach((v, i) => {
      const f = fades[i];
      v.set(f?.id ?? -1, f?.fade ?? 0);
    });
    setStyle(marker, 'display',
      selected &&
      !framed &&
      distance >
        (selected.phenomenon?.envelope ??
          selected.pulsar?.envelope ??
          selected.radius) *
          20
        ? 'block'
        : 'none');
    if (selected) {
      projected.copy(worldFocus).project(camera);
      setMarkerPosition(
        marker,
        (projected.x * 0.5 + 0.5) * sizedWidth,
        (-projected.y * 0.5 + 0.5) * renderHeight,
      );
    }
    // Read-only diagnostics for the local development preview.
    if (process.env.NODE_ENV !== 'production') {
      setHostData('selectedId', String(selected?.id ?? -1));
      setHostData('detailCount', String(bodyLOD.stats().visible));
      setHostData('distance', distance.toFixed(4));
    }
    // Report discrete UI changes only, including wheel and keyboard navigation.
    const viewRadius =
      selected && (selected.phenomenon ?? selected.pulsar ?? selected.comet)
        ? framingDistance(
            (selected.phenomenon ?? selected.pulsar ?? selected.comet)!
              .envelope,
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
    const renderStart = diagnostics ? performance.now() : 0;
    diagnostics?.record('cpu-phase', now, {
      phase: 'details-regions-dom',
      cpuMs: renderStart - detailsStart,
      frameId: diagnosticFrame,
    });
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
      gpuDiagnostics ?? undefined,
      // The budget is a ceiling over the lens's own measured adaptation.
      replay
        ? 512
        : Math.min(
            quality.budget.opticalResolution,
            lensing.captureStats().resolution,
          ),
      replay ? 320 : quality.budget.opticalSteps,
    );
    gpuDiagnostics?.endFrame();
    const renderEnd = diagnostics ? performance.now() : 0;
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
      setHostData('lenses', String(lensing.stats().active));
      setHostData('lensTargets', String(lensing.stats().targets));
      setHostData('skyCaptureMs', lensing.captureStats().costMs.toFixed(2));
      setHostData('skyCaptureTiming', lensing.captureStats().source);
      setHostData('skyResolution', String(lensing.skyResolution()));
      setHostData('skyCaptures', String(lensing.captureStats().captures));
    }
    if (diagnostics && now - lastMemorySample >= 1000) {
      lastMemorySample = now;
      replayMemory = {
        ...estimateBufferBytes([scene, skyScene, pointDepthScene, pickScene]),
        targetBytes:
          lensing.estimatedTargetBytes() +
          (pickTarget
            ? estimateTargetBytes(pickTarget.width, pickTarget.height)
            : 0),
        heapBytes:
          (performance as Performance & { memory?: { usedJSHeapSize: number } })
            .memory?.usedJSHeapSize ?? null,
        scope:
          'known scene buffers and owned targets; excludes driver overhead, framebuffer, detached caches and non-target textures',
      };
      diagnostics.record('memory', now, replayMemory);
    }
    if (diagnostics) {
      diagnostics.record('frame', now, {
        frameId: diagnosticFrame,
        intervalMs: lastRendered === null ? null : now - lastRendered,
        cpuMs: performance.now() - cpuStart,
        updateCpuMs: renderStart - cpuStart,
        renderSubmissionCpuMs: renderEnd - renderStart,
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        points: renderer.info.render.points,
        lines: renderer.info.render.lines,
        programs: renderer.info.programs?.length ?? 0,
        // Newly-created detailed entries this frame, throttled by
        // quality.budget.creationsPerFrame: the basis for measuring creation
        // spikes at first approach and after a cache expiry.
        creations:
          lodStats.created +
          phenomena.stats().created +
          regions.stats().created,
        ...renderer.info.memory,
        pixels: renderer.domElement.width * renderer.domElement.height,
        density: settings.density,
        selectedId: selected?.bodyId ?? null,
        camera: camera.position.toArray(),
        simulationTime: elapsed,
        rotation,
        skyCapture: { ...lensing.captureStats() },
      });
      lastRendered = now;
    }
    if (replay) {
      if (replay.tick < 60) replayWarmup.push(performance.now() - cpuStart);
      if (replay.tick >= 60) {
        replay.cpu.push(performance.now() - cpuStart);
        replay.intervals.push(frameTime);
      }
      replay.tick++;
      replayStatus.tick = replay.tick;
      if (replay.tick >= 180) {
        const summary = {
          ...replayStatus,
          cpuMs: summarize(replay.cpu),
          warmupCpuMs: summarize(replayWarmup),
          camera: camera.position.toArray(),
          frameId: diagnosticFrame,
          gpuMs: summarize(replayGpuSamples),
          intervalMs: summarize(replay.intervals),
          memory: replayMemory,
          firstApproach: replay.slot < REFERENCE_SCENES.length,
        };
        replayResults.push(summary);
        if (replayResults.length > 240) replayResults.shift();
        diagnostics?.record('replay-result', now, summary);
        const done =
          replay.mode === 'short'
            ? replay.slot + 1 >= REFERENCE_SCENES.length * 3
            : performance.now() - replay.start >= 900000;
        if (done) finishReplay('complete');
        else {
          replay.slot++;
          replay.tick = 0;
          applyReferenceScene();
        }
      }
    }
    // Judged on the whole engine frame, not only the render passes.
    const cpuEnd = performance.now();
    if (
      quality.sample({
        now: cpuEnd,
        cpuMs: cpuEnd - cpuStart,
        scheduledMs: tick.scheduledMs,
      })
    )
      applyBudget(quality.stats().reason);
    if (!firstFrameRendered) {
      diagnostics?.record('first-frame', performance.now(), {
        engineStartupMs: performance.now() - diagnosticStart,
      });
      firstFrameRendered = true;
      onFirstFrame();
    }
    const cameraSettled =
      !travel &&
      Math.abs(targetDistance - distance) <=
        Math.max(0.002, targetDistance * 0.001) &&
      Math.abs(reservedBottom - currentReservedBottom) <= 0.5;
    if (
      settings.paused &&
      !replay &&
      cameraSettled &&
      performance.now() >= demandRenderUntil
    )
      stopLoop();
  }
  function startLoop() {
    if (running || lost || document.hidden) return;
    running = true;
    // Nothing is owed for the time spent stopped: the world resumes where it
    // was, without a burst of catch-up frames.
    scheduler.resume();
    lastRendered = null;
    frame = requestAnimationFrame(animate);
  }
  function stopLoop() {
    if (!running) return;
    running = false;
    cancelAnimationFrame(frame);
    scheduler.suspend();
    lastRendered = null;
  }
  // Background growth: walks the catalogue from `filled` up to MAX_BODIES
  // in chunks, off the critical first-render path. A worker does the pure
  // generation work when available; otherwise the same chunking runs on the
  // main thread in short, idle-scheduled slices — either way, no single
  // step is a long task.
  const WORKER_CHUNK_BODIES = 6000;
  const IDLE_CHUNK_BODIES = 1500;
  let growthDisposed = false;
  let idleHandle: number | null = null;
  const cancelIdle =
    typeof cancelIdleCallback === 'function' ? cancelIdleCallback : clearTimeout;
  const scheduleIdle =
    typeof requestIdleCallback === 'function'
      ? requestIdleCallback
      : (fn: () => void) => setTimeout(fn, 0);
  function advanceDensity() {
    const nextDensity = Math.min(
      catalogue.activeCountWithin(requestedDensity),
      filled,
    );
    if (nextDensity !== settings.density) {
      settings = { ...settings, density: nextDensity };
      geometry.setDrawRange(0, settings.density);
    }
    onGrowth(filled, MAX_BODIES);
  }
  // A chunk in flight (worker or idle-scheduled) can be made stale by a
  // synchronous forcing call elsewhere (only `applyReferenceScene` does
  // this, for diagnostics reproducibility) advancing the catalogue in the
  // meantime. adoptChunk() checks contiguity itself and just resyncs by
  // requesting the next chunk from wherever the catalogue actually is,
  // rather than adopting a now-out-of-order chunk.
  function adoptChunk(systems: SystemDefinition[]) {
    if (growthDisposed) return;
    if (systems.length && systems[0].index === catalogue.systems.length) {
      catalogue.adopt(systems);
      systemIndex.sync(catalogue.systems);
      // A chunk's last system can overshoot MAX_BODIES (systems are never
      // split), so clamp before touching the MAX_BODIES-sized GPU buffers.
      const target = Math.min(catalogue.bodies.length, MAX_BODIES);
      fillRange(filled, target);
      filled = target;
      markFilledAttributesDirty();
      advanceDensity();
    }
    growNext();
  }
  let worker: Worker | null = null;
  try {
    if (typeof Worker !== 'undefined')
      worker = new Worker(
        new URL('./catalogue/generate.worker.ts', import.meta.url),
        { type: 'module' },
      );
  } catch {
    worker = null;
  }
  function growNext() {
    if (growthDisposed || catalogue.bodies.length >= MAX_BODIES) return;
    const fromSystem = catalogue.systems.length;
    const firstParticle = catalogue.bodies.length;
    if (worker) {
      const minBodies = Math.min(
        WORKER_CHUNK_BODIES,
        MAX_BODIES - firstParticle,
      );
      worker.postMessage({
        fromSystem,
        firstParticle,
        minBodies,
        seed: catalogue.seed,
      });
    } else {
      idleHandle = scheduleIdle(() => {
        idleHandle = null;
        const minBodies = Math.min(
          IDLE_CHUNK_BODIES,
          MAX_BODIES - firstParticle,
        );
        const chunk = generateChunk(
          fromSystem,
          firstParticle,
          minBodies,
          catalogue.seed,
        );
        adoptChunk(chunk.systems);
      }) as unknown as number;
    }
  }
  if (worker)
    worker.onmessage = (event: MessageEvent<{ systems: SystemDefinition[] }>) => {
      adoptChunk(event.data.systems);
    };
  applyBudget('start');
  startLoop();
  growNext();
  return {
    catalogue,
    configure(next) {
      // Never forces generation past what background growth has already
      // filled into the GPU buffers: a slider jump only picks a new target,
      // it does not itself trigger a blocking catalogue burst.
      const configurationChanged =
        settings.paused !== next.paused ||
        settings.speed !== next.speed ||
        settings.tilt !== next.tilt ||
        settings.palette !== next.palette ||
        settings.quality !== next.quality ||
        settings.density !== next.density;
      requestedDensity = next.density;
      const densityChanged =
        settings.density !==
        Math.min(catalogue.activeCountWithin(next.density), filled);
      settings = {
        ...next,
        density: Math.min(catalogue.activeCountWithin(next.density), filled),
      };
      if (quality.setMode(settings.quality, performance.now()))
        applyBudget(`mode:${settings.quality}`);
      if (selected && densityChanged) {
        if (selected.id >= settings.density) overview();
        else if (framed) frameSystem(framed.scope);
      }
      if (regionFocus && densityChanged) {
        regionFocus = catalogue.resolveRegion(
          regionFocus.regionId,
          settings.density,
        );
        if (!regionFocus) overview();
      }
      geometry.setDrawRange(0, settings.density);
      lensing.invalidate();
      dustGeometry.setDrawRange(
        0,
        Math.round(dustCount * Math.min(1, next.density / 65000)),
      );
      targetInner.set(palettes[next.palette][0]);
      targetOuter.set(palettes[next.palette][1]);
      if (configurationChanged) invalidateRender('configuration');
    },
    setOpeningProgress(progress) {
      openingProgress = progress;
      invalidateRender('opening');
    },
    setViewportInset(pixels) {
      const next = Math.max(0, Math.min(pixels, renderHeight * 0.65));
      if (next !== reservedBottom) {
        reservedBottom = next;
        invalidateRender('viewport-inset');
      }
    },
    recordAudioGesture(startedAt, readyAt) {
      diagnostics?.record('audio-first-gesture', readyAt ?? startedAt, {
        latencyMs: readyAt === null ? null : Math.max(0, readyAt - startedAt),
      });
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
      invalidateRender('language');
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
      growthDisposed = true;
      worker?.terminate();
      if (idleHandle !== null) cancelIdle(idleHandle);
      document.removeEventListener('visibilitychange', visibility);
      for (const observer of diagnosticObservers) observer.disconnect();
      gpuDiagnostics?.dispose();
      removeDiagnosticControls?.();
      clearTimeout(restoreTimer);
      stopLoop();
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
      lensing.dispose();
      pointDepthMaterial.dispose();
      localPrecision.dispose();
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

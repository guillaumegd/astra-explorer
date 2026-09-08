import { asteroidRadius } from './asteroid-shape';
import { sampleBodyTravel } from './body-travel';
import { desiredSurfaceTilt, surfaceCameraPose } from './surface-camera';
import { systemBounds, framingDistance } from './system-framing';
import * as THREE from 'three';
import { compileOrbitChain, orbitalGLSL, orbitFor } from './orbits';
import { createLocalDebris } from './local-debris';
import { zoomProximity } from './ambience-parameters';
import {
  createBodyLOD,
  describeBody,
  minimumOrbitRatio,
  type BodyIdentity,
  type BodyCandidate,
} from './stellar-lod';
import { particlePosition } from './particle-motion';

export type GalaxySettings = {
  density: number;
  speed: number;
  tilt: number | null;
  paused: boolean;
  palette: number;
};
export type SystemView = { root: BodyIdentity; members: BodyIdentity[] };
export type GalaxyEngine = {
  inspectBody: (id: number) => void;
  frameSystem: (scope: 'stellar' | 'local') => void;
  configure: (settings: GalaxySettings) => void;
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
    float companion=(abs(floor(aId/8.)*8.-uContextRoot)<.1 && abs(aId-uContextSelected)>.1 && aBodyRadius>0.)?uContextStrength:0.;
    physicalRadius=max(physicalRadius,companion*(aBodyType<.5?6.:1.8));
    vSurface = max(smoothstep(2.0, 10.0, physicalRadius),companion);
    float glowSize = clamp(aSize * uPixelRatio * (95.0 / -mv.z), 0.65, aBodyRadius > 0.0 ? (aBodyType < 0.5 ? 16.0 : 3.0) * uPixelRatio : 40.0);
    float diameter=physicalRadius*2.0*uPixelRatio;
    gl_PointSize = clamp(max(glowSize*(1.0-vSurface),diameter),0.65,uMaxPointSize);
    vDiscScale=min(1.0,diameter/gl_PointSize);
    vBodyType=aBodyType;vBodyColor=aBodyColor;
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
 varying float vSurface,vFade,vBodyType,vSeed,vDiscScale;
 varying vec3 vBodyColor,vLightDirection;
 void main(){
   if(vSurface<0.001 || vFade<0.001) discard;
   vec2 p=(gl_PointCoord-0.5)*2.0/max(vDiscScale,0.001); float r=dot(p,p); if(r>1.0)discard;
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
  onError: (error: string) => void,
  onSelection: (body: BodyIdentity | null) => void,
  onProximity: (value: number, kind: BodyIdentity['kind'] | null) => void,
  onSystemView: (view: SystemView | null) => void = () => {},
): GalaxyEngine {
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
  renderer.domElement.setAttribute(
    'aria-label',
    'Sélectionner un astre. Double-clic ou Entrée pour approcher. Plus et moins pour zoomer, flèches pour changer d’astre.',
  );
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 180);
  const group = new THREE.Group();
  group.rotation.z = -0.18;
  scene.add(group);
  const max = 120000;
  let seed = 91724;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const gaussian = () =>
    Math.sqrt(-2 * Math.log(Math.max(random(), 0.0001))) *
    Math.cos(random() * Math.PI * 2);
  const positions = new Float32Array(max * 3);
  const sizes = new Float32Array(max);
  const seeds = new Float32Array(max);
  for (let i = 0; i < max; i++) {
    const core = random() < 0.23;
    const r = core
      ? Math.pow(random(), 1.4) * 2.9
      : 0.65 + Math.pow(random(), 0.72) * 12;
    const branch = (Math.floor(random() * 4) * Math.PI) / 2;
    const angle =
      branch + r * 0.38 + gaussian() * (core ? 2 : 0.15 + r * 0.006);
    const spread = core ? 0.18 : 0.12 + r * 0.025;
    positions[i * 3] = Math.cos(angle) * r + gaussian() * spread;
    positions[i * 3 + 1] = gaussian() * (core ? 0.36 : 0.1 + r * 0.017);
    positions[i * 3 + 2] = Math.sin(angle) * r + gaussian() * spread;
    // Distant halo bodies belong to the same selectable catalogue as the spiral.
    if (i % 45 === 0) {
      const a = random() * Math.PI * 2,
        r = 18 + random() * 35;
      positions[i * 3] = Math.cos(a) * r;
      positions[i * 3 + 1] = (random() - 0.5) * 30;
      positions[i * 3 + 2] = Math.sin(a) * r;
    }
    sizes[i] = (0.22 + Math.pow(random(), 5) * 1.15) * (core ? 1.12 : 1);
    seeds[i] = random();
  }
  const orbits = new Float32Array(max * 12);
  for (let id = 0; id < max; id++) {
    const anchor = id - (id % 8);
    positions.copyWithin(id * 3, anchor * 3, anchor * 3 + 3);
    seeds[id] = seeds[anchor];
    orbits.set(compileOrbitChain(id, describeBody), id * 12);
    // Unresolved companions must not stack eight bright halos over one star.
    if (id % 8 !== 0) sizes[id] *= 0.12;
  }
  const bodyRadii = new Float32Array(max),
    bodyTypes = new Float32Array(max),
    bodyColors = new Float32Array(max * 3);
  const scratchColor = new THREE.Color();
  for (let id = 0; id < max; id++) {
    const body = describeBody(id);
    bodyRadii[id] = body.radius;
    bodyTypes[id] = body.type;
    scratchColor.set(body.color).toArray(bodyColors, id * 3);
  }
  const ids = Float32Array.from({ length: max }, (_, i) => i);
  const geometry = new THREE.BufferGeometry();
  const orbitalBuffer = new THREE.InterleavedBuffer(orbits, 12);
  for (let level = 0; level < 3; level++)
    geometry.setAttribute(
      `aOrbit${level}`,
      new THREE.InterleavedBufferAttribute(orbitalBuffer, 4, level * 4),
    );
  geometry.setAttribute('aBodyRadius', new THREE.BufferAttribute(bodyRadii, 1));
  geometry.setAttribute('aBodyType', new THREE.BufferAttribute(bodyTypes, 1));
  geometry.setAttribute('aBodyColor', new THREE.BufferAttribute(bodyColors, 3));
  geometry.setAttribute('aId', new THREE.BufferAttribute(ids, 1));
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  geometry.setDrawRange(0, 65000);
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
  for (let level = 0; level < 3; level++)
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
    density: 65000,
    speed: 1,
    tilt: null,
    paused: false,
    palette: 0,
  };
  const bodyLOD = createBodyLOD(group);
  const debris = createLocalDebris(group);
  let scanCursor = 0;
  const detailShortlist = new Map<number, { pixels: number; seen: number }>();
  const candidatePosition = new THREE.Vector3();
  const viewPosition = new THREE.Vector3();
  let selected: BodyIdentity | null = null;
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
      'gl_PointSize = max(gl_PointSize, 7.0 * uPixelRatio); vId = aId;',
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
    const meshId = bodyLOD.pick(raycaster);
    if (meshId !== null) return meshId;
    const width = Math.floor(bounds.width),
      height = Math.floor(bounds.height);
    if (!pickTarget)
      pickTarget = new THREE.WebGLRenderTarget(width, height, {
        depthBuffer: true,
      });
    else if (pickTarget.width !== width || pickTarget.height !== height)
      pickTarget.setSize(width, height);
    pickGroup.matrix.copy(group.matrixWorld);
    const sx = THREE.MathUtils.clamp(Math.floor(x) - 4, 0, width - 9),
      sy = THREE.MathUtils.clamp(height - Math.floor(y) - 4, 0, height - 9);
    const clear = renderer.getClearColor(new THREE.Color());
    pickTarget.scissor.set(sx, sy, 9, 9);
    pickTarget.scissorTest = true;
    renderer.setRenderTarget(pickTarget);
    renderer.setClearColor(0);
    renderer.clear();
    renderer.render(pickScene, camera);
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
      if (value >= 0 && value < settings.density && d < score) {
        best = value;
        score = d;
      }
    }
    return best >= 0 ? best : null;
  };
  let framed: { radius: number; members: BodyIdentity[] } | null = null;
  const orbitGuides = new THREE.Group();
  group.add(orbitGuides);
  const guideParents: number[] = [];
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
    selected = describeBody(id);
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
    group.updateMatrixWorld();
    worldFocus.copy(localFocus).applyMatrix4(group.matrixWorld);
    focusOffset.copy(focus).sub(worldFocus);
    targetDistance = Math.max(
      targetDistance,
      selected.radius * minimumOrbitRatio(selected),
    );
    if (switching) {
      targetDistance = selected.radius * 4.2;
      travel = {
        time: 0,
        origin,
        startDistance: distance,
        cruiseDistance: Math.max(
          distance,
          origin.distanceTo(worldFocus) * 1.5,
          previous.radius * 8,
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
    }
    onSelection(selected);
  };
  const overview = () => {
    travel = null;
    clearFrame();
    selected = null;
    targetDistance = mobile ? 40 : 29.4;
    onSelection(null);
  };
  const approach = () => {
    clearFrame();
    if (!selected) select(0);
    targetDistance = selected!.radius * 4.2;
  };

  const frameSystem = (scope: 'stellar' | 'local') => {
    const body = selected ?? describeBody(0);
    const start = body.systemId * 8;
    const catalogue = Array.from(
      { length: Math.min(8, settings.density - start) },
      (_, i) => describeBody(start + i),
    );
    let root = scope === 'stellar' ? start : body.id;
    if (
      scope === 'local' &&
      !catalogue.some((b) => b.parentId === root) &&
      body.parentId !== null
    )
      root = body.parentId;
    const bounds = systemBounds(root, catalogue);
    select(root);
    const members = catalogue.filter((b) => bounds.members.includes(b.id));
    framed = { radius: bounds.radius, members };
    targetDistance = framingDistance(bounds.radius, camera.aspect);
    onSystemView({ root: describeBody(root), members });
    for (const member of members) {
      const marker = document.createElement('button');
      marker.className = 'system-marker';
      marker.dataset.label = member.name;
      marker.dataset.central = String(member.id === root);
      marker.title = member.kind;
      marker.setAttribute(
        'aria-label',
        `Explorer ${member.name}, ${member.kind}`,
      );
      marker.addEventListener('click', (event) => {
        event.stopPropagation();
        select(member.id);
        approach();
      });
      host.appendChild(marker);
      systemMarkers.push(marker);
      if (member.id === root || member.parentId === null) continue;
      const orbit = orbitFor(member, describeBody(member.parentId));
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

  let renderHeight = 1;
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
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
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
    mobile = width < 600;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderHeight = height;
    if (framed) targetDistance = framingDistance(framed.radius, camera.aspect);
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
    onError(
      'La connexion à la carte graphique a été interrompue. Rechargez la page pour reprendre.',
    );
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
      if (slowFrames > 45 && renderer.getPixelRatio() > 0.8) {
        renderer.setPixelRatio(Math.max(0.8, renderer.getPixelRatio() - 0.2));
        uniforms.uPixelRatio.value = renderer.getPixelRatio();
      }
      slowFrames = 0;
      qualityCheck = 0;
    }
    elapsed += dt;
    activityTime += dt * (reduced.matches ? 0.12 : 1);
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
    const baseDistance = mobile ? 40 : 29.4;
    if (!travel)
      distance += (targetDistance - distance) * (1 - Math.exp(-dt * 4));
    if (selected) {
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
        travel.time += dt;
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
    } else focus.lerp(new THREE.Vector3(), 1 - Math.exp(-dt * 4));
    cameraDirection.set(
      Math.sin(azimuth) * Math.cos(elevation),
      Math.sin(elevation),
      Math.cos(azimuth) * Math.cos(elevation),
    );
    const ratio = selected ? distance / selected.radius : 100;
    uniforms.uContextRoot.value = selected ? selected.systemId * 8 : -8;
    uniforms.uContextSelected.value = selected?.id ?? -1;
    uniforms.uContextStrength.value = selected
      ? framed
        ? 1
        : 1 - THREE.MathUtils.smoothstep(ratio, 20, 160)
      : 0;
    const terrainView = !!selected && !framed && !travel;
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
    if (!selected) {
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
    camera.updateProjectionMatrix();
    camera.lookAt(cameraTarget);
    camera.updateMatrixWorld();
    if (framed) {
      const position = new THREE.Vector3();
      guideParents.forEach((id, i) => {
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
        if (m.visible && m.pixels >= 18)
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
      const start = selected.systemId * 8;
      for (let id = start; id < Math.min(start + 8, settings.density); id++)
        if (!shortlist.includes(id)) shortlist.push(id);
      if (!shortlist.includes(selected.id)) shortlist.unshift(selected.id);
    }
    for (const id of shortlist) {
      const m = measure(id);
      if ((m.visible || id === selected?.id) && m.pixels >= 18) {
        candidatePosition.copy(localPosition);
        const stellarPosition = new THREE.Vector3();
        particlePosition(
          positions,
          seeds,
          Math.floor(id / 8) * 8,
          rotation,
          elapsed,
          stellarPosition,
          undefined,
          orbits,
        );
        const lightDirection = stellarPosition.sub(candidatePosition);
        if (lightDirection.lengthSq() === 0) lightDirection.set(1, 0, 0);
        candidates.push({
          lightDirection: lightDirection.normalize(),
          identity: selected?.id === id ? selected : describeBody(id),
          position: candidatePosition.clone(),
          pixels: m.pixels,
          distanceInRadii: m.d / bodyRadii[id],
          cameraPosition:
            id === selected?.id || id % 8 === 0
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
      visibleCandidates,
      elapsed,
      rotation,
      activityTime,
    );
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
      selected && distance > selected.radius * 20 ? 'block' : 'none';
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
    onProximity(
      zoomProximity(distance, selected?.radius ?? null),
      selected?.kind ?? null,
    );
    renderer.render(scene, camera);
  };
  frame = requestAnimationFrame(animate);
  return {
    configure(next) {
      const densityChanged = settings.density !== next.density;
      settings = next;
      if (selected && densityChanged) {
        if (selected.id >= next.density) overview();
        else if (framed) frameSystem('local');
      }
      geometry.setDrawRange(0, next.density);
      dustGeometry.setDrawRange(
        0,
        Math.round(dustCount * Math.min(1, next.density / 65000)),
      );
      targetInner.set(palettes[next.palette][0]);
      targetOuter.set(palettes[next.palette][1]);
    },
    zoom: changeZoom,
    approach,
    frameSystem,
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
      debris.dispose();
      marker.remove();
      pickMaterial.dispose();
      pickTarget?.dispose();
      renderer.domElement.removeEventListener('dblclick', doubleClick);
      renderer.domElement.removeEventListener('keydown', key);
      renderer.domElement.removeEventListener('webglcontextlost', contextLost);
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

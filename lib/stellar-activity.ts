import * as THREE from 'three';

/**
 * Stellar activity close to a star: a filamentary corona whose streamers carry
 * the wind, and eruptions that follow a solar flare's sequence — a prominence
 * rises, flashes at its footpoints and on two surface ribbons, stretches and
 * tears while a bubble-shaped ejection expands to about three radii, then rain
 * drains back down the legs over a post-flare arcade. Everything is expressed
 * in star radii, in the star's rotating frame, and derives from the body seed
 * and simulation time so an evicted and recreated star replays the same sky.
 */

type FlareProfile = {
  /** Cycle length of one site; three sites share the star. */
  period: number;
  duration: number;
  strength: number;
  /** Prominence size relative to a red dwarf's. */
  scale: number;
};

/** Mean spacing between visible eruptions is period / SITES. */
const PROFILES: Record<string, FlareProfile> = {
  'red-dwarf': { period: 36, duration: 7, strength: 1, scale: 1 },
  'giant-star': { period: 66, duration: 14, strength: 0.9, scale: 1.35 },
  'blue-star': { period: 90, duration: 8, strength: 0.85, scale: 0.9 },
  'white-dwarf': { period: 180, duration: 6, strength: 0.4, scale: 0.7 },
};
const SITES = 3;
/** Active latitudes, as on the Sun: eruptions avoid the poles. */
const ACTIVE_LATITUDE = 0.61;

export type EruptionState = {
  /** Seconds since the event began; outside [0, duration] nothing erupts. */
  age: number;
  duration: number;
  /** 0.55–1 for the most active stars, scaled down for quieter ones. */
  strength: number;
  /** Half angular distance between the footpoints, in radians. */
  span: number;
  /** Prominence apex height before eruption, in radii. */
  height: number;
  /** Unit site direction and the arch's in-surface orientation. */
  axis: [number, number, number];
  tangent: [number, number, number];
};

export const flareProfile = (kind: string) =>
  PROFILES[kind] ?? PROFILES['giant-star'];

export function eruptionState(
  time: number,
  seed: number,
  site: number,
  kind = 'red-dwarf',
  out: EruptionState = {
    age: 0,
    duration: 0,
    strength: 0,
    span: 0,
    height: 0,
    axis: [0, 1, 0],
    tangent: [1, 0, 0],
  },
): EruptionState {
  const profile = flareProfile(kind);
  const period = profile.period * (1 + site * 0.13);
  const clock = time + seed * 3 + site * 13;
  const cycle = Math.floor(clock / period);
  const random = (salt: number) => {
    const n =
      Math.sin(seed * 12.9898 + cycle * 78.233 + site * 37.719 + salt) *
      43758.5453;
    return n - Math.floor(n);
  };
  out.duration = profile.duration * (0.85 + random(5) * 0.3);
  out.age = clock - cycle * period - random(0) * (period - out.duration - 1);
  out.strength = profile.strength * (0.55 + random(19) * 0.45);
  out.span = (0.16 + random(23) * 0.1) * profile.scale;
  out.height = (0.13 + random(29) * 0.09) * profile.scale;
  const latitude = (random(31) * 2 - 1) * ACTIVE_LATITUDE;
  const longitude = random(37) * Math.PI * 2;
  const orientation = random(41) * Math.PI;
  const cl = Math.cos(latitude),
    sl = Math.sin(latitude);
  const co = Math.cos(longitude),
    so = Math.sin(longitude);
  out.axis[0] = cl * co;
  out.axis[1] = sl;
  out.axis[2] = cl * so;
  // East and north on the unit sphere, mixed by the arch orientation.
  const c = Math.cos(orientation),
    s = Math.sin(orientation);
  out.tangent[0] = -so * c - sl * co * s;
  out.tangent[1] = cl * s;
  out.tangent[2] = co * c - sl * so * s;
  return out;
}

/** What each quality level keeps; level 3 is the full effect. */
export const FLARE_DETAIL = [
  { strands: 2, loops: 3, rain: 0, octaves: 1, wind: 0, filaments: 0 },
  { strands: 4, loops: 4, rain: 24, octaves: 1, wind: 1, filaments: 1 },
  { strands: 6, loops: 6, rain: 48, octaves: 2, wind: 1, filaments: 1 },
  { strands: 8, loops: 7, rain: 72, octaves: 3, wind: 1, filaments: 2 },
] as const;
const MAX_DETAIL = FLARE_DETAIL[FLARE_DETAIL.length - 1];
const STRAND_SEGMENTS = 40;

const band = THREE.MathUtils.smoothstep;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

const noiseGLSL = `
float flareHash(vec3 p){p=fract(p*.3183099+.1);p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float flareNoise(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);
  return mix(mix(mix(flareHash(i),flareHash(i+vec3(1,0,0)),f.x),mix(flareHash(i+vec3(0,1,0)),flareHash(i+vec3(1,1,0)),f.x),f.y),
    mix(mix(flareHash(i+vec3(0,0,1)),flareHash(i+vec3(1,0,1)),f.x),mix(flareHash(i+vec3(0,1,1)),flareHash(i+vec3(1,1,1)),f.x),f.y),f.z);}
float flareNoise1(float x){float i=floor(x),f=fract(x);f=f*f*(3.-2.*f);
  return mix(fract(sin(i*127.1)*43758.5453),fract(sin((i+1.)*127.1)*43758.5453),f);}
`;

/** Event frame and arch shape shared by the prominence, arcade and rain. */
const archGLSL = `
uniform vec3 uAxis,uTangent,uSide;
uniform float uSpan,uHeight,uLift,uRise,uDecay,uTime,uEventSeed,uLoops,uDetach;
float strandHash(float k){return fract(sin(k*12.9898+uEventSeed*.731)*43758.5453);}
vec3 archPoint(float s,float k,float lift){
  float h=strandHash(k);
  float angle=(s-.5)*2.*uSpan;
  vec3 base=uAxis*cos(angle)+uTangent*sin(angle);
  float arch=sin(3.14159265*s);
  // The rope rises as a rounded loop whose apex sits in the ejection's core.
  float height=pow(arch,.8)*uHeight*(.55+.45*uRise)*(.8+.4*h)+arch*arch*lift;
  // A twisted flux rope: each strand winds around the arch's core.
  float twist=s*6.2831853*(.6+.8*h)+k*2.39996+uTime*(.15+.2*h);
  float spread=(.25+.75*arch)*uSpan*.22*(1.+lift*.8);
  vec3 offset=(uSide*cos(twist)+base*sin(twist)*.6+uTangent*sin(twist*.7)*.3)*spread;
  return base*(.996+height)+offset;
}
vec3 arcadePoint(float s,float k){
  float h=strandHash(k+11.);
  float along=((k+.5)/uLoops-.5)*1.8*uSpan;
  vec3 center=uAxis*cos(along)+uTangent*sin(along);
  // Loops straddle the neutral line; their feet follow the separating ribbons.
  float halfWidth=uSpan*(.3+.35*uDecay);
  vec3 base=normalize(center+uSide*(s-.5)*2.*halfWidth);
  return base*(.997+sin(3.14159265*s)*halfWidth*(.9+.4*h));
}
`;

const strandVertex = `
${archGLSL}
uniform vec3 uEye; uniform float uMode,uWidth,uPixelWorld;
varying float vS,vSide,vK,vArch,vCover;
vec3 curve(float s,float k){
  // Once torn, the legs relax back towards the surface.
  return uMode<.5?archPoint(s,k,uLift*(1.-.6*uDetach)):arcadePoint(s,k);
}
void main(){
  float s=position.x,k=position.y;
  vec3 p=curve(s,k);
  vec3 along=curve(min(s+.01,1.),k)-curve(max(s-.01,0.),k);
  vec3 across=normalize(cross(along,normalize(uEye-p))+vec3(1e-6));
  float arch=sin(3.14159265*s);
  float width=uWidth*uSpan*(.45+.55*sqrt(arch))*(.7+.6*strandHash(k))
    *(1.+uLift*.8*arch*arch);
  // Never thinner than a pixel: a sub-pixel ribbon would shimmer, so it is
  // widened and dimmed by the same ratio instead.
  float minimum=distance(uEye,p)*uPixelWorld*.8;
  vCover=min(1.,width/minimum);
  p+=across*position.z*max(width,minimum);
  vS=s; vSide=position.z; vK=k; vArch=arch;
  gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);
}`;

const strandFragment = `
${noiseGLSL}
uniform vec3 uColor;
uniform float uFade,uDetailFade,uTime,uMode,uFlash,uLift,uDetach,uArch,uArcade;
varying float vS,vSide,vK,vArch,vCover;
void main(){
  float core=1.-vSide*vSide; core*=core;
  float direction=mod(vK,2.)<.5?1.:-1.;
  // Plasma flows along the field lines in bright, uneven knots.
  float flow=.35+.65*flareNoise1(vS*22.-uTime*1.4*direction+vK*17.3);
  float knots=.6+.8*flareNoise1(vS*57.+vK*5.1-uTime*.7*direction);
  float feet=exp(-min(vS,1.-vS)*16.);
  float intensity;
  vec3 color;
  if(uMode<.5){
    float stretched=1./(1.+uLift*2.5*vArch*vArch);
    float torn=1.-uDetach*smoothstep(.36,.12,abs(vS-.5));
    intensity=uArch*stretched*torn*flow*knots*(1.+uFlash*.4)+feet*uFlash*.8;
    color=mix(uColor,vec3(1.,.95,.88),.15+.35*uFlash);
  }else{
    intensity=uArcade*.45*flow*(.7+.3*knots)*(.3+.7*vArch);
    color=mix(uColor,vec3(1.,.97,.92),.45);
  }
  gl_FragColor=vec4(color,core*intensity*vCover*uFade*uDetailFade*.5);
}`;

const ribbonVertex = `
uniform vec3 uAxis,uTangent,uSide; uniform float uSpan;
varying vec2 vQ;
void main(){
  vQ=position.xy;
  vec3 dir=normalize(uAxis+uTangent*position.x*uSpan*1.5+uSide*position.y*uSpan*1.1);
  gl_Position=projectionMatrix*modelViewMatrix*vec4(dir*1.003,1.);
}`;

const ribbonFragment = `
${noiseGLSL}
uniform vec3 uColor; uniform float uFade,uDetailFade,uFlash,uRibbon,uDecay,uEventSeed,uFilaments;
varying vec2 vQ;
void main(){
  float separation=.18+.42*uDecay;
  float wobble=.07*sin(vQ.x*3.7+uEventSeed);
  float extent=1.-smoothstep(.45,.95,abs(vQ.x));
  float r1=exp(-pow((vQ.y-separation-wobble)/.075,2.));
  float r2=exp(-pow((vQ.y+separation-wobble*.6)/.065,2.));
  float broken=uFilaments>.5?.35+.9*flareNoise(vec3(vQ*vec2(8.,3.),uEventSeed)):1.;
  float glow=exp(-dot(vQ,vQ)*2.6);
  float intensity=(r1+r2)*extent*broken*uRibbon+glow*uFlash*.9;
  gl_FragColor=vec4(mix(uColor,vec3(1.),.6),intensity*uFade*uDetailFade);
}`;

const shellVertex = `
uniform vec3 uAxis; uniform float uFront,uBubble;
varying vec3 vPoint;
void main(){
  vPoint=uAxis*(uFront-uBubble)+position*uBubble*1.4;
  gl_Position=projectionMatrix*modelViewMatrix*vec4(vPoint,1.);
}`;

const shellFragment = `
${noiseGLSL}
uniform vec3 uColor,uEye,uAxis,uTangent,uSide;
uniform float uFade,uDetailFade,uShell,uCore,uFilaments,uEventSeed,uEject,uFront,uBubble;
varying vec3 vPoint;
void main(){
  // A thick, optically thin shell integrated along the view ray: the front is
  // limb-brightened side-on and a soft halo face-on, with no hard outline.
  vec3 ray=normalize(vPoint-uEye);
  vec3 offset=uEye-uAxis*(uFront-uBubble);
  vec3 closest=(offset-ray*min(0.,dot(offset,ray)))/uBubble;
  float b=length(closest);
  // Direction from the centre, kept continuous where rays pass through it.
  vec3 dir=closest/max(b,.6);
  vec3 local=vec3(dot(dir,uTangent),dot(dir,uAxis),dot(dir,uSide));
  float outer=1.08*(.9+.2*flareNoise(local*1.7+uEventSeed));
  float inner=outer*.72;
  float column=sqrt(max(outer*outer-b*b,0.))-sqrt(max(inner*inner-b*b,0.));
  // Brighter ahead, open towards the star like a lightbulb.
  float leading=smoothstep(-.75,.7,local.y);
  float filaments=1.;
  if(uFilaments>.5){
    // Sheets follow the front (radius), broken up across it (direction).
    vec3 q=vec3(local.x*2.5+b*1.5,b*7.-uEject*2.,local.z*2.5)+uEventSeed;
    filaments=.5+.9*flareNoise(q);
    if(uFilaments>1.5) filaments*=.75+.5*flareNoise(local*4.+vec3(0.,b*9.,0.)+13.1);
  }
  // The erupted prominence: a bright, elongated core trailing in the cavity.
  vec3 toCore=uEye-uAxis*(uFront-uBubble*1.3);
  vec3 coreOffset=(toCore-ray*min(0.,dot(toCore,ray)))/uBubble;
  float along=dot(coreOffset,uAxis);
  float core=exp(-(dot(coreOffset,coreOffset)-along*along*.6)*24.);
  if(uFilaments>.5) core*=.6+.7*flareNoise(coreOffset*5.+uEventSeed-vec3(uEject*3.));
  // Faint plasma reads warmer: dim pale yellow would otherwise turn olive.
  vec3 color=uColor*vec3(1.35,1.15,1.05);
  vec3 hot=mix(uColor,vec3(1.,.95,.88),.2)*1.25;
  float front=column*leading*filaments*uShell;
  float glow=core*uCore;
  // Seen against the photosphere, the thin plasma barely adds any light.
  float onDisc=1.-smoothstep(.97,1.03,length(cross(uEye,ray)));
  float light=(front+glow)*(1.-.7*onDisc*step(0.,-dot(uEye,ray)));
  gl_FragColor=vec4((color*front+hot*glow)/max(front+glow,1e-4),light*uFade*uDetailFade);
}`;

const rainVertex = `
${archGLSL}
uniform float uRain,uRainAlpha,uStrands,uMaxPoint;
varying float vAlpha,vHeat;
void main(){
  // Coronal rain drains from high on a strand to the nearest footpoint.
  float a=position.x,b=position.y,c=position.z;
  float k=floor(a*uStrands);
  float start=.5+(b-.5)*.55;
  float t=clamp((uRain-c*.45)/.55,0.,1.);
  vec3 p=archPoint(mix(start,step(.5,start),t*t),k,uLift*.25);
  vAlpha=sin(t*3.14159265)*uRainAlpha;
  vHeat=.35*(1.-t);
  vec4 view=modelViewMatrix*vec4(p,1.);
  gl_Position=projectionMatrix*view;
  float radius=length(modelViewMatrix[0].xyz);
  gl_PointSize=clamp(radius/max(.000001,-view.z)*70.*(.6+.8*fract(a*7.13)),1.,uMaxPoint);
}`;

const rainFragment = `
uniform vec3 uColor; uniform float uFade,uDetailFade;
varying float vAlpha,vHeat;
void main(){
  float d=length(gl_PointCoord-.5)*2.;
  if(d>1.) discard;
  // Cooling plasma: the star's colour fading to a dim deep red.
  vec3 ember=uColor*vec3(1.,.45,.3)*.7;
  gl_FragColor=vec4(mix(ember,uColor,smoothstep(0.,.35,vHeat)),exp(-d*d*3.5)*vAlpha*uFade*uDetailFade);
}`;

const coronaFragment = `
${noiseGLSL}
uniform float uTime,uFade,uSeed,uActivity,uOctaves,uWind; uniform vec3 uColor;
uniform vec4 uSites[${SITES}];
varying vec3 vP,vEye;
void main(){
  vec3 ray=normalize(vP-vEye);
  vec3 closest=vEye+ray*max(0.,-dot(vEye,ray));
  float impact=length(closest);
  // The star's polygonal silhouette sits inside the unit sphere; start just
  // below it and let the star's depth hide what lies behind the disc.
  if(impact<.955) discard;
  float height=max(0.,impact-1.);
  vec3 dir=closest/impact;
  // Streamers depend on direction only, so they stay radial; frequencies are
  // low enough for the 1.55 R shell and the finest octave fades when it would alias.
  float streamers=0.,amplitude=.6,frequency=2.3,total=0.;
  float footprint=length(fwidth(dir));
  for(int i=0;i<3;i++){
    if(float(i)>=uOctaves) break;
    float resolved=1.-smoothstep(.08,.25,footprint*frequency);
    streamers+=flareNoise(dir*frequency+uSeed*.37)*amplitude*resolved+.5*amplitude*(1.-resolved);
    total+=amplitude; amplitude*=.5; frequency*=2.3;
  }
  streamers=smoothstep(.38,.68,streamers/total);
  // The wind: density condensations slowly leaving along the streamers.
  float wind=uWind>.5?.7+.6*flareNoise(dir*4.+vec3(height*7.-uTime*.3)+uSeed):1.;
  float structure=mix(1.,(.15+1.7*streamers)*wind,smoothstep(0.,.14,height));
  float glow=exp(-height*9.)*(1.-smoothstep(.3,.55,height))*smoothstep(.955,1.,impact)*.75;
  float erupting=0.;
  for(int i=0;i<${SITES};i++)
    erupting+=uSites[i].w*exp(-(1.-dot(dir,uSites[i].xyz))*28.)*exp(-height*5.);
  gl_FragColor=vec4(mix(uColor,vec3(1.),.2*min(erupting,1.)),glow*structure*uFade*(.45+.2*uActivity)+erupting*uFade*.6);
}`;

function strandGeometry(count: number) {
  const geometry = new THREE.BufferGeometry();
  const rows = STRAND_SEGMENTS + 1;
  const data = new Float32Array(count * rows * 2 * 3);
  const index: number[] = [];
  for (let k = 0; k < count; k++)
    for (let j = 0; j < rows; j++) {
      for (let side = 0; side < 2; side++) {
        const i = ((k * rows + j) * 2 + side) * 3;
        data[i] = j / STRAND_SEGMENTS;
        data[i + 1] = k;
        data[i + 2] = side * 2 - 1;
      }
      if (j < STRAND_SEGMENTS) {
        const a = (k * rows + j) * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  geometry.setAttribute('position', new THREE.BufferAttribute(data, 3));
  geometry.setIndex(index);
  return geometry;
}

// All phases derive from the body seed and simulation time, including after LOD eviction.
export function createStellarActivity(
  seed: number,
  color: string,
  kind: string,
  detail = FLARE_DETAIL.length - 1,
) {
  const group = new THREE.Group();
  const eye = new THREE.Vector3(0, 0, 4);
  const sites = Array.from(
    { length: SITES },
    () => new THREE.Vector4(0, 1, 0, 0),
  );
  const uniforms = {
    uTime: { value: 0 },
    uFade: { value: 0 },
    uDetailFade: { value: 0 },
    uSeed: { value: seed },
    uColor: { value: new THREE.Color(color) },
    uEye: { value: eye },
    uPixelWorld: { value: 0.01 },
    uActivity: {
      value: kind === 'red-dwarf' ? 1.0 : kind === 'white-dwarf' ? 0.35 : 0.7,
    },
    uOctaves: { value: 3 },
    uWind: { value: 1 },
    uFilaments: { value: 2 },
    uStrands: { value: MAX_DETAIL.strands },
    uLoops: { value: MAX_DETAIL.loops },
    uMaxPoint: { value: 12 },
  };
  const coronaMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    uniforms: { ...uniforms, uSites: { value: sites } },
    vertexShader: `uniform vec3 uEye; varying vec3 vP; varying vec3 vEye;
      void main(){vP=position;vEye=uEye;
      gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: coronaFragment,
  });
  const corona = new THREE.Mesh(
    new THREE.SphereGeometry(1.55, 40, 24),
    coronaMaterial,
  );
  group.add(corona);

  // Geometry is built once at full detail and shared by the three sites; a
  // quality change only moves draw ranges.
  const archGeometry = strandGeometry(MAX_DETAIL.strands);
  const arcadeGeometry = strandGeometry(MAX_DETAIL.loops);
  const ribbonGeometry = new THREE.PlaneGeometry(2, 2, 12, 8);
  const shellGeometry = new THREE.SphereGeometry(1, 24, 12);
  const rainGeometry = new THREE.BufferGeometry();
  const rainData = new Float32Array(MAX_DETAIL.rain * 3);
  const fraction = (x: number) => x - Math.floor(x);
  for (let i = 0; i < MAX_DETAIL.rain; i++) {
    rainData[i * 3] = fraction(i * 0.6180339887 + seed * 0.013);
    rainData[i * 3 + 1] = fraction(i * 0.7548776662 + seed * 0.029);
    rainData[i * 3 + 2] = fraction(i * 0.569840291 + seed * 0.047);
  }
  rainGeometry.setAttribute('position', new THREE.BufferAttribute(rainData, 3));

  const additive = {
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  };
  const events = Array.from({ length: SITES }, (_, site) => {
    const state = eruptionState(0, seed, site, kind);
    const event = {
      uAxis: { value: new THREE.Vector3(0, 1, 0) },
      uTangent: { value: new THREE.Vector3(1, 0, 0) },
      uSide: { value: new THREE.Vector3(0, 0, 1) },
      uEventSeed: { value: 0 },
      uSpan: { value: 0.15 },
      uHeight: { value: 0.2 },
      uLift: { value: 0 },
      uRise: { value: 0 },
      uFlash: { value: 0 },
      uDetach: { value: 0 },
      uDecay: { value: 0 },
      uFront: { value: 1 },
      uBubble: { value: 0.1 },
      uEject: { value: 0 },
      uRain: { value: 0 },
      uArch: { value: 0 },
      uArcade: { value: 0 },
      uRibbon: { value: 0 },
      uShell: { value: 0 },
      uCore: { value: 0 },
      uRainAlpha: { value: 0 },
    };
    const shared = { ...uniforms, ...event };
    const arch = new THREE.Mesh(
      archGeometry,
      new THREE.ShaderMaterial({
        ...additive,
        side: THREE.DoubleSide,
        uniforms: { ...shared, uMode: { value: 0 }, uWidth: { value: 0.09 } },
        vertexShader: strandVertex,
        fragmentShader: strandFragment,
      }),
    );
    const arcade = new THREE.Mesh(
      arcadeGeometry,
      new THREE.ShaderMaterial({
        ...additive,
        side: THREE.DoubleSide,
        uniforms: { ...shared, uMode: { value: 1 }, uWidth: { value: 0.07 } },
        vertexShader: strandVertex,
        fragmentShader: strandFragment,
      }),
    );
    const ribbons = new THREE.Mesh(
      ribbonGeometry,
      new THREE.ShaderMaterial({
        ...additive,
        uniforms: shared,
        vertexShader: ribbonVertex,
        fragmentShader: ribbonFragment,
      }),
    );
    const shell = new THREE.Mesh(
      shellGeometry,
      new THREE.ShaderMaterial({
        ...additive,
        // Back faces: one fragment per pixel, even from inside the bubble.
        side: THREE.BackSide,
        uniforms: shared,
        vertexShader: shellVertex,
        fragmentShader: shellFragment,
      }),
    );
    const rain = new THREE.Points(
      rainGeometry,
      new THREE.ShaderMaterial({
        ...additive,
        uniforms: shared,
        vertexShader: rainVertex,
        fragmentShader: rainFragment,
      }),
    );
    const meshes = [arch, arcade, ribbons, shell, rain];
    for (const mesh of meshes) {
      // Every vertex is displaced in the shader, far outside the static bounds.
      mesh.frustumCulled = false;
      mesh.visible = false;
      group.add(mesh);
    }
    return {
      site,
      state,
      event,
      arch,
      arcade,
      ribbons,
      shell,
      rain,
      meshes,
    };
  });

  let level = -1;
  const setDetail = (next: number) => {
    const clamped = Math.max(
      0,
      Math.min(FLARE_DETAIL.length - 1, Math.round(next)),
    );
    if (clamped === level) return;
    level = clamped;
    const d = FLARE_DETAIL[level];
    archGeometry.setDrawRange(0, d.strands * STRAND_SEGMENTS * 6);
    arcadeGeometry.setDrawRange(0, d.loops * STRAND_SEGMENTS * 6);
    rainGeometry.setDrawRange(0, d.rain);
    uniforms.uStrands.value = d.strands;
    uniforms.uLoops.value = d.loops;
    uniforms.uOctaves.value = d.octaves;
    uniforms.uWind.value = d.wind;
    uniforms.uFilaments.value = d.filaments;
    uniforms.uMaxPoint.value = d.rain ? 6 : 0;
  };
  setDetail(detail);

  const animate = (time: number) => {
    uniforms.uTime.value = time;
    for (const slot of events) {
      const { site, state, event } = slot;
      eruptionState(time, seed, site, kind, state);
      const u = state.age / state.duration;
      const active = u >= 0 && u <= 1;
      const strength = state.strength;
      if (active) {
        event.uAxis.value.fromArray(state.axis);
        event.uTangent.value.fromArray(state.tangent);
        event.uSide.value.crossVectors(event.uAxis.value, event.uTangent.value);
        event.uEventSeed.value = (state.axis[0] + state.axis[2]) * 31.7;
        event.uSpan.value = state.span;
        event.uHeight.value = state.height * (0.7 + 0.3 * strength);
      }
      // Rise, impulsive flash, ejection and decay, as fractions of the event.
      const on = active ? 1 : 0;
      const rise = on * band(u, 0, 0.25);
      const flash = on * Math.exp(-(((u - 0.3) / 0.045) ** 2)) * strength;
      const eject = clamp01((u - 0.27) / 0.73);
      const expansion = 1 - (1 - eject) ** 2.2;
      const front = 1.15 + expansion * (1.2 + 0.7 * strength);
      const bubble = (front - 1) * 0.45 + 0.04;
      const arcadeLight = on * band(u, 0.3, 0.42) * (1 - band(u, 0.72, 1));
      const ejection = on * band(u, 0.27, 0.38) * (1 - band(u, 0.62, 1));
      event.uRise.value = rise;
      event.uFlash.value = flash;
      // The rope's apex rides with the ejection's core until it tears.
      event.uLift.value =
        band(u, 0.24, 0.45) *
        Math.max(0, front - bubble * 1.25 - 1 - event.uHeight.value);
      event.uDetach.value = band(u, 0.38, 0.55);
      event.uDecay.value = band(u, 0.32, 0.95);
      event.uFront.value = front;
      event.uBubble.value = bubble;
      event.uEject.value = eject;
      event.uRain.value = clamp01((u - 0.42) / 0.55);
      event.uArch.value =
        rise * (1 - band(u, 0.5, 0.8)) * (0.6 + 0.4 * strength);
      event.uArcade.value = arcadeLight * strength;
      event.uRibbon.value = flash * 2.2 + arcadeLight * 0.6 * strength;
      // Spread over a growing area: the front dims as it travels.
      event.uShell.value = (ejection * strength * 2.2) / front;
      event.uCore.value = ejection * strength * 1.1;
      event.uRainAlpha.value = arcadeLight * strength * 0.9;
      slot.arch.visible = event.uArch.value > 0.002 || flash > 0.002;
      slot.arcade.visible = event.uArcade.value > 0.002;
      slot.ribbons.visible = event.uRibbon.value > 0.002;
      slot.shell.visible = ejection > 0.002;
      slot.rain.visible =
        FLARE_DETAIL[level].rain > 0 && event.uRainAlpha.value > 0.002;
      sites[site].set(
        event.uAxis.value.x,
        event.uAxis.value.y,
        event.uAxis.value.z,
        on * (rise * 0.25 + flash * 1.2),
      );
    }
  };
  return {
    group,
    setDetail,
    update(time: number, fade: number, pixels: number, camera?: THREE.Vector3) {
      animate(time);
      uniforms.uFade.value = fade * THREE.MathUtils.smoothstep(pixels, 35, 110);
      group.visible = uniforms.uFade.value > 0.001 && !!camera;
      if (camera) {
        group.updateWorldMatrix(true, false);
        eye.copy(camera);
        group.worldToLocal(eye);
        // One pixel at unit distance, in radii: pixels is the star's apparent radius.
        uniforms.uPixelWorld.value = 1 / Math.max(1, pixels * eye.length());
      }
      uniforms.uDetailFade.value = THREE.MathUtils.smoothstep(pixels, 45, 110);
    },
    fadeOut(time: number, dt: number) {
      animate(time);
      uniforms.uFade.value *= Math.exp(-dt / 0.18);
      group.visible = uniforms.uFade.value > 0.001;
    },
    dispose() {
      for (const geometry of [
        corona.geometry,
        archGeometry,
        arcadeGeometry,
        ribbonGeometry,
        shellGeometry,
        rainGeometry,
      ])
        geometry.dispose();
      coronaMaterial.dispose();
      for (const { meshes } of events)
        for (const mesh of meshes) mesh.material.dispose();
    },
  };
}

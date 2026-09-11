import { RAY_STEP, RAY_STEPS } from './geodesic.ts';

export const lensingFragment = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uScene,uDepth;
uniform samplerCube uSky;
uniform mat4 uInverseProjection,uCameraWorld,uLocal,uWorld;
uniform vec3 uEye,uTint;
uniform float uRadius,uInner,uOuter,uFade,uTime,uSeed,uJets;
uniform vec2 uResolution;
uniform float uSkySize;
float skyFootprint;
vec2 advance(vec2 q,float h){
  vec2 a=vec2(q.y,1.5*q.x*q.x-q.x);
  vec2 t=q+.5*h*a;vec2 b=vec2(t.y,1.5*t.x*t.x-t.x);
  t=q+.5*h*b;vec2 c=vec2(t.y,1.5*t.x*t.x-t.x);
  t=q+h*c;vec2 d=vec2(t.y,1.5*t.x*t.x-t.x);
  return q+h*(a+2.*b+2.*c+d)/6.;
}
float hash(vec3 p){p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}
float noise(vec3 p){
  vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
    mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float flow(float a,float r,float age){
  float phase=a-age*.22*pow(uInner/r,1.5)+1.6*log(r/uInner);
  vec3 p=vec3(cos(phase)*3.,sin(phase)*3.,r*.6+uSeed+uTime*.01);
  return .64*noise(p)+.26*noise(p*2.03)+.1*noise(p*4.07);
}
vec3 diskLight(vec3 p,vec3 direction,float observerU){
  float r=length(p),a=atan(p.z,p.x),age=mod(uTime,24.);
  float cloud=mix(flow(a,r,mod(uTime+12.,24.)),flow(a,r,age),.5-.5*cos(age*6.28318530718/24.));
  float temperature=pow(uInner/r,.75)*pow(max(0.,1.-sqrt(uInner/r)),.25)*2.3;
  vec3 tangent=normalize(vec3(-p.z,0.,p.x));
  // Circular Schwarzschild orbit measured by a local static observer.
  float beta=sqrt(1./(2.*(r-1.)));
  float g=sqrt((1.-1./r)/(1.-observerU))*sqrt(1.-beta*beta)/(1.-beta*dot(tangent,-direction));
  vec3 thermal=mix(uTint*.45,vec3(1.,.9,.73),clamp(temperature*g,0.,1.));
  vec3 emission=thermal*(.5+2.*temperature)*(.35+1.25*cloud)*pow(g,4.);
  return emission/(vec3(1.)+emission);
}
vec3 lens(vec2 uv,vec3 original){
  vec4 cameraRay=uInverseProjection*vec4(uv*2.-1.,1.,1.);
  vec3 worldDirection=normalize(mat3(uCameraWorld)*cameraRay.xyz);
  vec3 d=normalize(mat3(uLocal)*worldDirection),o=uEye;
  float radius=length(o),forward=-dot(o,d);
  float impact=length(cross(o,d));
  float zone=max(uOuter*2.,uJets*40.);
  if(forward<=0. || impact>=zone || radius<=1.)return original;
  float weight=1.-smoothstep(uOuter*1.25,uOuter*2.,impact);
  vec3 er=o/radius;float cosine=dot(d,er);
  vec3 et=d-cosine*er;float sine=length(et);
  float observerU=1./radius;
  vec2 q=vec2(observerU,-cosine*observerU*sqrt(1.-observerU)/max(sine,1e-7));
  et/=max(sine,1e-7);
  float phi=0.,transmission=1.,hitDistance=forward;
  vec3 light=vec3(0.),escape=d;
  bool escaped=false,firstHit=true;
  if(sine>1e-7){
    for(int i=0;i<${RAY_STEPS};i++){
      float h=min(${RAY_STEP.toFixed(2)},.08/max(1.,abs(q.y)));
      vec2 next=advance(q,h);
      // Intersect each curved segment with the finite emitting slab. This also
      // resolves the direct image when the observer is exactly in the disc plane.
      if(next.x>0.){
        vec3 start=(er*cos(phi)+et*sin(phi))/q.x;
        vec3 end=(er*cos(phi+h)+et*sin(phi+h))/next.x;
        float dy=end.y-start.y;
        float lo=0.,hi=1.;
        if(abs(dy)>1e-7){
          float a=(-.18-start.y)/dy,b=(.18-start.y)/dy;
          lo=max(0.,min(a,b));hi=min(1.,max(a,b));
        }else if(abs(start.y)>.18){hi=-1.;}
        if(hi>lo){
          float fraction=(lo+hi)*.5,angle=phi+h*fraction;
          vec2 at=advance(q,h*fraction);
          vec3 radial=er*cos(angle)+et*sin(angle);
          vec3 tangent=-er*sin(angle)+et*cos(angle);
          vec3 p=radial/at.x;float r=length(p.xz);
          if(r>=uInner && r<=uOuter){
            vec3 direction=normalize(-at.y*radial+at.x*sqrt(max(0.,1.-at.x))*tangent);
            float density=smoothstep(uInner,uInner+.3,r)*(1.-smoothstep(uOuter*.8,uOuter,r));
            float opacity=1.-exp(-8.*length(end-start)*(hi-lo)*density);
            light+=transmission*opacity*diskLight(p,direction,observerU);
            transmission*=1.-opacity;
            if(firstHit && opacity>.01){hitDistance=length(p-o);firstHit=false;}
          }
        }
      }
      if(transmission<.005)break;
      if(next.x>=1.)break;
      if(next.x<=0.){
        float angle=phi+h*q.x/(q.x-next.x);
        escape=er*cos(angle)+et*sin(angle);escaped=true;break;
      }
      q=next;phi+=h;
    }
  }
  if(escaped){
    vec3 skyDirection=normalize(mat3(uWorld)*normalize(mix(d,escape,weight)));
    // The cube stores the actual all-sky catalogue, with mip filtering for thin images.
    // Explicit LOD: implicit derivatives are undefined after divergent ray loops
    // and at the 1/2/4-sample branch, which produced a dark aliased circle.
    float critical=max(abs(impact-2.598),.08);
    float magnification=mix(1.,max(1.,radius/critical),1.-smoothstep(3.,8.,impact));
    float lod=max(0.,log2(max(1.,skyFootprint*magnification)));
    light+=transmission*textureCubeLodEXT(uSky,skyDirection,lod).rgb;
  }
  // Reconstruct linear distance from scene depth. Foreground meshes and point cores
  // were rendered into this target before composition, independently of the lens.
  float depth=texture2D(uDepth,uv).r;
  vec4 surface=uInverseProjection*vec4(uv*2.-1.,depth*2.-1.,1.);
  float surfaceDistance=length(surface.xyz/surface.w)/uRadius;
  if(depth<.999999 && surfaceDistance<hitDistance)return original;
  // Finite-distance local background bodies retain their direct image when no
  // disc/capture occludes them; only the distant catalogue is treated as infinity.
  if(depth<.999999 && escaped && firstHit && surfaceDistance<radius+uOuter*4.)light=original;
  if(uJets>.5){
    float span=sqrt(max(0.,1600.-impact*impact));
    float ds=2.*span/16.;
    vec3 jetColor=mix(uTint,vec3(.45,.65,1.),.7);
    for(int j=0;j<16;j++){
      float distance=max(0.,forward-span)+(float(j)+.5)*ds;
      vec3 p=o+d*distance;float height=abs(p.y);
      if(height>8. && height<36. && (depth>=.999999 || distance<surfaceDistance)){
        float width=.06*height;
        float density=exp(-dot(p.xz,p.xz)/(width*width))*sin((height-8.)/28.*3.14159265);
        light+=jetColor*density*ds*.025;
      }
    }
  }
  return mix(original,light,(1.-smoothstep(zone*.9,zone,impact))*uFade);
}
void main(){
  vec3 original=texture2D(uScene,vUv).rgb;
  vec4 ray=uInverseProjection*vec4(vUv*2.-1.,1.,1.);
  vec3 d=normalize(mat3(uLocal)*mat3(uCameraWorld)*ray.xyz);
  skyFootprint=max(length(dFdx(d)),length(dFdy(d)))*uSkySize*.5;
  float impact=length(cross(uEye,d));
  vec2 px=.25/uResolution;
  vec3 color;
  if(impact>uOuter*1.1){color=lens(vUv,original);}
  else {
    color=(lens(vUv-px,original)+lens(vUv+px,original))*.5;
    // Spend four samples around the critical silhouette, two across the disc.
    if(abs(impact-2.598)<.25)
      color=color*.5+(lens(vUv+vec2(px.x,-px.y),original)
        +lens(vUv+vec2(-px.x,px.y),original))*.25;
  }
  gl_FragColor=vec4(color,1.);
  #include <colorspace_fragment>
}`;

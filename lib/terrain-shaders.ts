import { asteroidShapeGLSL } from './asteroid-shape.ts';

// Shared by the surface and the local patch: identical coordinates prevent LOD seams.
export const terrainNoise = `
 ${asteroidShapeGLSL}
 float terrainHash(vec3 p) {
   p=fract(p*0.1031);p+=dot(p,p.yzx+33.33);
   return fract((p.x+p.y)*p.z);
 }
 float terrainNoise(vec3 p) {
   vec3 i=floor(p), f=fract(p); f=f*f*f*(f*(f*6.0-15.0)+10.0);
   return mix(mix(mix(terrainHash(i),terrainHash(i+vec3(1,0,0)),f.x),mix(terrainHash(i+vec3(0,1,0)),terrainHash(i+vec3(1,1,0)),f.x),f.y),
   mix(mix(terrainHash(i+vec3(0,0,1)),terrainHash(i+vec3(1,0,1)),f.x),mix(terrainHash(i+vec3(0,1,1)),terrainHash(i+vec3(1,1,1)),f.x),f.y),f.z);
 }

 float terrainLand(vec3 p, float seed) {
   vec3 o=vec3(seed,seed*0.37,seed*0.71);
   vec3 warp=vec3(terrainNoise(p*3.0+o),terrainNoise(p*3.0+o+17.0),terrainNoise(p*3.0+o-13.0))-0.5;
   vec3 q=p*3.6+o+warp*0.9;
   float sum=0.0,amp=0.5;
   for(int i=0;i<7;i++){sum+=terrainNoise(q)*amp;q=q*2.03+3.1;amp*=0.5;}
   return sum/0.9921875;
 }
 float mountainRange(vec3 p,float seed) {
   vec3 q=p*36.0+seed;
   q+=vec3(terrainNoise(q*0.4),terrainNoise(q*0.4+19.0),terrainNoise(q*0.4-7.0))*2.4;
   float belt=smoothstep(0.43,0.7,terrainNoise(p*11.0+seed+8.0));
   float ridges=0.0,amp=0.55;
   for(int i=0;i<4;i++){
     float ridge=1.0-abs(terrainNoise(q)*2.0-1.0);
     ridges+=pow(ridge,3.0)*amp;q=mat3(0.0,0.8,0.6,-0.8,0.36,-0.48,-0.6,-0.48,0.64)*q*2.1+4.0;amp*=0.48;
   }
   return belt*ridges;
 }

 // Shared semantic masks: every material boundary comes from these same fields.
 vec2 craterField(vec3 p,float seed) {
   vec3 cell=floor(p*16.0);float pit=0.0,rim=0.0;
   for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++)for(int z=-1;z<=1;z++) {
     vec3 c=cell+vec3(float(x),float(y),float(z))+0.5;
     float h=terrainHash(c+seed);
     if(h<0.72 || abs(length(c)-16.0)>0.85)continue;
     float radius=mix(0.022,0.045,terrainHash(c+seed+7.0));
     float d=length(p-normalize(c))/radius;
     pit=max(pit,(1.0-smoothstep(0.15,0.95,d)));
     rim=max(rim,exp(-pow((d-1.0)*8.0,2.0)));
   }
   return vec2(pit,rim);
 }
 float lavaField(vec3 p,float seed) {
   float channel=abs(terrainNoise(p*22.0+seed)-0.5);
   return 1.0-smoothstep(0.012,0.055,channel);
 }
 float iceField(vec3 p,float seed) {
   return 1.0-smoothstep(0.008,0.045,abs(terrainNoise(p*45.0+seed)-0.5));
 }
 float duneField(vec3 p,float seed) {
   return sin(p.y*650.0+terrainNoise(p*90.0+seed)*12.0)*0.5+0.5;
 }
 float terrainHeight(vec3 p,float seed,float type) {
   if(type==0.0 || type==2.0)return 0.0;
   if(type==3.0 || type==8.0) {
     vec2 crater=craterField(p,seed);
     return (type==8.0?asteroidRadius(p,seed)-1.0:0.0)+0.0007*terrainNoise(p*60.0+seed)-0.006*crater.x+0.0025*crater.y;
   }
   float mountains=mountainRange(p,seed);
   float regional=mountainRange(p*5.0,seed);
   float height=0.0008+0.012*mountains+0.0015*regional;
   if(type==1.0 || type==4.0) {
     float elevation=terrainLand(p,seed)-(type==4.0?0.56:0.49);
     float inland=smoothstep(0.0,0.04,elevation);
     return clamp(elevation*0.025+inland*height,-0.012,0.016);
   }
   if(type==6.0) return mix(min(height+0.002,0.016),-0.003,lavaField(p,seed));
   if(type==5.0) return min(0.0005+0.009*mountains+0.0019*duneField(p,seed),0.016);
   if(type==7.0) return clamp(height-0.005*iceField(p,seed),-0.005,0.016);
   return min(height,0.016);
 }


`;

export const terrainVertex = `
 uniform float uSeed,uType,uRelief,uIsPatch,uPatchAngle,uNormalStep;
 uniform vec3 uPatchAxis,uPatchRight,uPatchUp;
 varying vec3 vPosition,vNormal,vView;
 ${terrainNoise}
 void main(){
   vec3 p=position;
   if(uIsPatch>0.5) p=normalize(uPatchAxis+tan(uPatchAngle)*(position.x*uPatchRight+position.y*uPatchUp));
   vPosition=p;
   p=normalize(p);
   float height=terrainHeight(p,uSeed,uType)*(uType==8.0?1.0:uRelief);
   vec3 displaced=p*(1.0+height);
   vec3 terrainNormal=p;
   vNormal=normalize(normalMatrix*terrainNormal);
   vec4 vp=modelViewMatrix*vec4(displaced,1.0);
   vView=-vp.xyz;
   gl_Position=projectionMatrix*vp;
 }
`;

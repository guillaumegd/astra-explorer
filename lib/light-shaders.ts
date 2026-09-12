// Two local sources for a circumbinary world. A lone star sends the mix (1,0)
// with a neutral tint, which reproduces the single-source result exactly, so
// the 95% of systems that are not binaries render bit-identically.
export const localLighting = `
 uniform vec3 uLightDirection2,uLightColor1,uLightColor2;
 uniform vec2 uLightMix;
 vec2 localShares(vec3 n){
   return vec2(max(dot(n,normalize(uLightDirection)),0.0)*uLightMix.x,
               max(dot(n,normalize(uLightDirection2)),0.0)*uLightMix.y);
 }
 float localSpecular(vec3 n, vec3 view, float exponent){
   return pow(max(dot(reflect(-normalize(uLightDirection),n),view),0.0),exponent)*uLightMix.x
     + pow(max(dot(reflect(-normalize(uLightDirection2),n),view),0.0),exponent)*uLightMix.y;
 }
 float localLight(vec3 n){ vec2 s=localShares(n); return s.x+s.y; }
 vec3 localTint(vec3 n){
   vec2 s=localShares(n); float sum=s.x+s.y;
   return sum>1e-4 ? (uLightColor1*s.x+uLightColor2*s.y)/sum : vec3(1.0);
 }
`;

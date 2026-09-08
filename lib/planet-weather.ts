// Procedural weather remains anchored to each body's seeded coordinates.
export const planetWeather = `
 vec3 gasWeather(vec3 p, vec3 offset, vec3 base, float time) {
   float latitude=p.y;
   float drift=time*(.014+.009*sin(latitude*19.));
   vec3 q=vec3(p.x*cos(drift)-p.z*sin(drift),p.y,p.x*sin(drift)+p.z*cos(drift));
   float turbulence=noise(q*24.+offset+vec3(0.,time*.008,0.));
   float bands=sin(latitude*65.+noise(q*7.+offset)*7.+turbulence*1.5);
   vec3 color=mix(base*.38,mix(base,vec3(1.),.42),smoothstep(-.8,.8,bands));
   for(int i=0;i<3;i++) {
     float phase=uSeed*.31+float(i)*2.399;
     vec3 axis=normalize(vec3(cos(phase),sin(phase*1.7)*.55,sin(phase)));
     vec3 right=normalize(cross(axis,vec3(0.,1.,0.))),up=cross(right,axis);
     vec2 uv=vec2(dot(q,right),dot(q,up)*1.8);
     float r=length(uv);
     float mask=(1.-smoothstep(.07,.22,r))*smoothstep(.85,.98,dot(q,axis));
     float spiral=sin(atan(uv.y,uv.x)*3.+r*85.-time*.3+noise(q*40.+offset)*2.);
     vec3 storm=mix(base*.35,base*1.35,.5+.5*spiral);
     color=mix(color,storm,mask*.85);
   }
   return color;
 }
 float weatherLightning(vec3 p) {
   float cycle=floor(uTime/9.);
   vec3 origin=normalize(vec3(sin(uSeed+cycle*4.1),sin(uSeed*.3+cycle*1.7)*.65,cos(uSeed+cycle*4.1)));
   float age=mod(uTime,9.);
   float pulse=exp(-pow((age-2.)/.13,2.))+0.5*exp(-pow((age-2.4)/.08,2.));
   return exp(-length(p-origin)*65.)*pulse;
 }
 float driftingVeil(vec3 p, float speed) {
   vec3 q=p*70.+vec3(uTime*speed,0.,uTime*speed*.3)+uSeed;
   return smoothstep(.52,.76,noise(q+vec3(noise(q*.12)*4.)));
 }
`;

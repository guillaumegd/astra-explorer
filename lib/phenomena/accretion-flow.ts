/** Bounded, slowly infalling emissive knots; shared by direct and lensed disks. */
export const accretionFlow = `
float accretionInflow(float radius, float angle, float inner, float outer, float time, float seed) {
  float light = 0.;
  for (int i=0; i<6; i++) {
    float key = float(i)+seed*.017;
    float age = fract(time/(28.+float(i)*2.7)+fract(key*.618034));
    float r = mix(outer*.94, inner*1.06, age);
    float phase = key*2.39996 + time*.12 + 5.*log(outer/max(r,inner));
    float arc = atan(sin(angle-phase),cos(angle-phase));
    float radial = (radius-r)/max(.18,r*.035);
    float angular = arc/.16;
    float envelope = smoothstep(0.,.12,age)*(1.-smoothstep(.8,1.,age));
    light += exp(-radial*radial-angular*angular)*envelope;
  }
  return light;
}
`;

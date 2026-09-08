import * as THREE from 'three';

/** Intersect radial rays with seeded fracture planes, then excavate two impacts.
 * The matching shader field also drives close-up patches and dust emitters. */
export function asteroidRadius(x: number, y: number, z: number, seed: number) {
  let radius = 1;
  for (let i = 0; i < 16; i++) {
    const angle = seed * 0.13 + i * 2.399963;
    const latitude = Math.sin(i * 1.73 + seed * 0.07) * 0.9;
    const belt = Math.sqrt(1 - latitude * latitude);
    const projection =
      x * Math.cos(angle) * belt + y * latitude + z * Math.sin(angle) * belt;
    const depth = 0.61 + 0.22 * (0.5 + 0.5 * Math.sin(i * 3.17 + seed * 0.19));
    if (projection > 0) radius = Math.min(radius, depth / projection);
  }
  for (let i = 0; i < 2; i++) {
    const a = seed * 0.21 + i * 2.7;
    const axis = new THREE.Vector3(
      Math.cos(a),
      0.3 * Math.sin(a * 2),
      Math.sin(a),
    ).normalize();
    const d = Math.hypot(x - axis.x, y - axis.y, z - axis.z);
    const t = THREE.MathUtils.smoothstep(d, 0.04, 0.34);
    radius -= 0.11 * (1 - t);
  }
  return radius;
}

export function sculptAsteroid(source: THREE.SphereGeometry, seed: number) {
  const geometry = source.clone();
  const positions = geometry.attributes.position;
  const direction = new THREE.Vector3();
  for (let i = 0; i < positions.count; i++) {
    direction.fromBufferAttribute(positions, i).normalize();
    const radius = asteroidRadius(direction.x, direction.y, direction.z, seed);
    positions.setXYZ(
      i,
      direction.x * radius,
      direction.y * radius,
      direction.z * radius,
    );
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export const asteroidShapeGLSL = `
 float asteroidRadius(vec3 p,float seed) {
   float radius=1.;
   for(int i=0;i<16;i++) {
     float angle=seed*.13+float(i)*2.399963;
     float latitude=sin(float(i)*1.73+seed*.07)*.9;
     float belt=sqrt(1.-latitude*latitude);
     vec3 axis=vec3(cos(angle)*belt,latitude,sin(angle)*belt);
     float projection=dot(p,axis);
     float depth=.61+.22*(.5+.5*sin(float(i)*3.17+seed*.19));
     if(projection>0.) radius=min(radius,depth/projection);
   }
   for(int i=0;i<2;i++) {
     float a=seed*.21+float(i)*2.7;
     vec3 axis=normalize(vec3(cos(a),.3*sin(a*2.),sin(a)));
     radius-=.11*(1.-smoothstep(.04,.34,length(p-axis)));
   }
   return radius;
 }
`;

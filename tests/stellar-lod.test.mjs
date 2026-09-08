import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  createBodyLOD,
  describeBody,
  systemOffset,
  atmosphereFor,
  surfaceLevel,
  minimumOrbitRatio,
  MAX_DETAILED_BODIES,
  MAX_ACTIVE_BODIES,
  selectStellarLevel,
  surfaceVisibility,
} from '../lib/stellar-lod.ts';

test('LOD uses hysteresis in both directions', () => {
  assert.equal(selectStellarLevel(79, 0), 0);
  assert.equal(selectStellarLevel(81, 0), 1);
  assert.equal(selectStellarLevel(70, 1), 1);
  assert.equal(selectStellarLevel(59, 1), 0);
  assert.equal(selectStellarLevel(191, 1), 2);
  assert.equal(selectStellarLevel(160, 2), 2);
  assert.equal(selectStellarLevel(154, 2), 1);
});

test('every particle has a stable and varied identity independent of generation order', () => {
  const original = describeBody(51923);
  for (let i = 0; i < 300; i++) describeBody(i);
  assert.deepEqual(describeBody(51923), original);
  assert.equal(
    new Set(Array.from({ length: 1000 }, (_, i) => describeBody(i).kind)).size,
    12,
  );
  assert.equal(
    new Set(Array.from({ length: 100 }, (_, i) => describeBody(i).seed)).size,
    100,
  );
  assert.ok(original.radius > 0);
});

test('surface stays a point at distance and fades over a broad interval', () => {
  assert.equal(surfaceVisibility(3, 20), 0);
  assert.equal(surfaceVisibility(17, 20), 0);
  assert.equal(surfaceVisibility(200, 49), 0);
  assert.ok(surfaceVisibility(40, 25) > 0 && surfaceVisibility(40, 25) < 0.25);
  assert.equal(surfaceVisibility(100, 12), 1);
});

test('nearby bodies promote together within the budget while retaining smooth transitions', () => {
  const parent = new THREE.Group(),
    lod = createBodyLOD(parent);
  const candidate = (id, pixels = 200, ratio = 5) => ({
    identity: describeBody(id),
    position: new THREE.Vector3(id, 0, 0),
    pixels,
    distanceInRadii: ratio,
  });
  lod.update([candidate(9, 9)], 0, 0);
  assert.equal(parent.children.length, 0);
  lod.update(
    Array.from({ length: 40 }, (_, i) => candidate(i)),
    0.016,
    0,
  );
  assert.equal(lod.stats().visible, MAX_ACTIVE_BODIES);
  const mesh = parent.children[0].children[0];
  assert.equal(mesh.material.uniforms.uFade.value, 0);
  lod.update(
    Array.from({ length: 40 }, (_, i) => candidate(i)),
    0.032,
    0,
  );
  assert.ok(
    mesh.material.uniforms.uFade.value > 0 &&
      mesh.material.uniforms.uFade.value < 0.1,
  );
  for (let i = 3; i <= 120; i++) lod.update([candidate(0)], i * 0.016, 0);
  assert.ok(mesh.material.uniforms.uFade.value > 0.99);
  const before = mesh.material.uniforms.uFade.value;
  lod.update([candidate(0, 10)], 1.936, 0);
  assert.ok(
    mesh.material.uniforms.uFade.value > 0 &&
      mesh.material.uniforms.uFade.value < before,
  );
  lod.update([candidate(60)], 1.952, 0);
  assert.ok(lod.stats().visible <= 2);
  assert.equal(
    parent.children[0].children[0].geometry,
    parent.children[1].children[0].geometry,
  );
  for (let i = 1; i < 20; i++) lod.update([candidate(i)], 2 + i * 0.016, 0);
  assert.ok(lod.stats().cached <= MAX_DETAILED_BODIES);
  lod.update([], 8, 0);
  assert.equal(lod.stats().cached, 0);
  assert.equal(lod.stats().geometries, 0);
  lod.dispose();
  assert.equal(parent.children.length, 0);
});

test('size distribution spans small asteroids to giant stars reproducibly', () => {
  const bodies = Array.from({ length: 1000 }, (_, i) => describeBody(i));
  const sizes = bodies.map((b) => b.radius);
  assert.ok(Math.max(...sizes) / Math.min(...sizes) > 80);
  for (const kind of new Set(bodies.map((b) => b.kind))) {
    const group = bodies.filter((b) => b.kind === kind).map((b) => b.radius);
    assert.ok(Math.max(...group) / Math.min(...group) > 1.8);
  }
});

test('systems have a central star, consistent parents and well separated bodies', () => {
  for (let system = 0; system < 125; system++) {
    const bodies = Array.from({ length: 8 }, (_, slot) =>
      describeBody(system * 8 + slot),
    );
    assert.equal(bodies[0].type, 0);
    assert.equal(bodies[0].parentId, null);
    assert.equal(bodies[6].parentId, bodies[5].id);
    for (let a = 0; a < 8; a++) {
      assert.equal(bodies[a].systemId, system);
      assert.ok(bodies[a].radius <= (a === 0 ? 0.00075 : 0.000094));
      const position = new THREE.Vector3(...systemOffset(bodies[a].id));
      for (let b = a + 1; b < 8; b++) {
        const distance = position.distanceTo(
          new THREE.Vector3(...systemOffset(bodies[b].id)),
        );
        assert.ok(distance > 25 * (bodies[a].radius + bodies[b].radius));
      }
    }
  }
});

test('atmospheric shells are selective, elevated, animated and released with LOD', () => {
  const bodies = Array.from({ length: 100 }, (_, id) => describeBody(id));
  for (const body of bodies.filter((b) => [0, 3, 8].includes(b.type)))
    assert.equal(atmosphereFor(body), null);
  const body = bodies.find((b) => b.type === 4);
  const parent = new THREE.Group(),
    lod = createBodyLOD(parent);
  const candidate = {
    identity: body,
    position: new THREE.Vector3(),
    pixels: 200,
    distanceInRadii: 5,
  };
  lod.update([candidate], 0, 0);
  const surface = parent.children[0].children[0];
  const air = parent.children[0].children.find(c=>c.material?.uniforms.uClouds);
  assert.ok(air.scale.x > 1 && air.scale.x < 1.06);
  assert.equal(air.material.depthWrite, false);
  let disposed = false;
  air.material.addEventListener('dispose', () => {
    disposed = true;
  });
  lod.update([candidate], 0.1, 0);
  assert.notEqual(air.rotation.y, surface.rotation.y);
  assert.equal(
    air.material.uniforms.uFade.value,
    surface.material.uniforms.uFade.value,
  );
  lod.update([], 0.2, 0);
  assert.equal(
    air.material.uniforms.uFade.value,
    surface.material.uniforms.uFade.value,
  );
  lod.update([], 5, 0);
  assert.equal(disposed, true);
  assert.equal(parent.children.length, 0);
});

test('surface LOD refines only a camera-local patch and releases it on exit', () => {
  const body = describeBody(4),
    parent = new THREE.Group(),
    lod = createBodyLOD(parent);
  const candidate = (ratio) => ({
    identity: body,
    position: new THREE.Vector3(),
    pixels: 1000,
    distanceInRadii: ratio,
    cameraPosition: new THREE.Vector3(0, 0, body.radius * ratio),
  });
  lod.update([candidate(4)], 0, 0);
  assert.equal(lod.stats().patches, 0);
  for (const [time, ratio, level, segments] of [
    [0.1, 1.5, 3, 32],
    [0.2, 1.1, 4, 64],
    [0.3, 1.02, 5, 128],
  ]) {
    lod.update([candidate(ratio)], time, 0);
    assert.equal(lod.stats().patches, 1);
    assert.equal(lod.stats().surfaceLevel, level);
    const patch = parent.children[0].children.find(
      (c) => c.geometry?.type === 'PlaneGeometry',
    );
    assert.equal(patch.geometry.parameters.widthSegments, segments);
    assert.ok(patch.geometry.index.count <= 128 * 128 * 6);
    assert.equal(patch.material.uniforms.uSeed.value, body.seed);
    assert.equal(
      patch.material.uniforms.uRelief,
      parent.children[0].children[0].material.uniforms.uRelief,
    );
  }
  assert.equal(surfaceLevel(1.05, 5), 5);
  assert.equal(surfaceLevel(1.07, 5), 4);
  assert.equal(surfaceLevel(1.9, 3), 3);
  assert.equal(surfaceLevel(2.1, 3), 2);
  assert.ok(minimumOrbitRatio(body) > 1.0038);
  lod.update([candidate(4)], 0.4, 0);
  assert.equal(lod.stats().patches, 0);
  lod.update([], 5, 0);
  assert.equal(lod.stats().cached, 0);
  lod.dispose();
});

test('every planet family increases local geometry and shader detail when approaching',()=>{
  const catalogue=Array.from({length:300},(_,i)=>describeBody(i));
  for(const type of [1,2,4,5,6,7]) {
    const body=catalogue.find(b=>b.type===type), parent=new THREE.Group(), lod=createBodyLOD(parent);
    const ratios=type===2?[1.9,1.3,1.08]:[1.5,1.1,1.02];
    let previousDetail=-1;
    ratios.forEach((ratio,index)=>{
      const candidate={identity:body,position:new THREE.Vector3(),pixels:1000,distanceInRadii:ratio,cameraPosition:new THREE.Vector3(0,0,body.radius*ratio)};
      for(let frame=0;frame<20;frame++)lod.update([candidate],index*2+frame*0.1,0);
      const patch=parent.children[0].children.find(c=>c.geometry?.type==='PlaneGeometry');
      assert.equal(patch.geometry.parameters.widthSegments,[32,64,128][index]);
      const detail=patch.material.uniforms.uDetail.value;
      assert.ok(detail>previousDetail);previousDetail=detail;
      if(type===2) assert.equal(patch.material.uniforms.uRelief.value,0);
    });
    lod.dispose();
  }
});

test('small camera motion leaves the terrain sampling grid anchored to the planet',()=>{
 const body=describeBody(4), parent=new THREE.Group(),lod=createBodyLOD(parent);
 const candidate={identity:body,position:new THREE.Vector3(),pixels:1000,distanceInRadii:1.02,cameraPosition:new THREE.Vector3(0,0,body.radius*1.02)};
 lod.update([candidate],0,0);
 const mesh=parent.children[0].children[0];
 const before=mesh.material.uniforms.uPatchAxis.value.clone();
 const angle=mesh.material.uniforms.uPatchAngle.value;
 for(let i=1;i<30;i++){
   candidate.cameraPosition.x=body.radius*0.0001*i;
   lod.update([candidate],i/60,0);
   assert.ok(before.equals(mesh.material.uniforms.uPatchAxis.value));
   assert.equal(mesh.material.uniforms.uPatchAngle.value,angle);
 }
 lod.dispose();
});

test('ocean is a separate sea-level surface sharing rotation and fade with its terrain',()=>{
 const body=describeBody(4),parent=new THREE.Group(),lod=createBodyLOD(parent);
 const c={identity:body,position:new THREE.Vector3(),pixels:500,distanceInRadii:3};
 lod.update([c],0,0);lod.update([c],0.1,1);
 const terrain=parent.children[0].children[0];
 const ocean=parent.children[0].children.find(m=>m!==terrain && m.material?.fragmentShader.includes('floorHeight'));
 assert.ok(ocean);
 assert.equal(ocean.scale.x,1);
 assert.deepEqual(ocean.rotation.toArray(),terrain.rotation.toArray());
 assert.equal(ocean.material.uniforms.uFade,terrain.material.uniforms.uFade);
 let disposed=false;ocean.material.addEventListener('dispose',()=>{disposed=true});
 lod.update([],6,1);assert.ok(disposed);lod.dispose();
});

import * as THREE from 'three';
import type { BodyIdentity } from '../catalogue/types.ts';
import { createCaptureBudget } from './capture-budget.ts';
import { traceGeodesic } from './geodesic.ts';
import { lensingFragment } from './lensing-shader.ts';

export type LensSubject = {
  body: BodyIdentity;
  group: THREE.Group;
  fade: number;
  seen?: number;
};
/** One detailed optical field, two additional targets (scene/depth and all-sky cube). */
export function createLensing() {
  let source: THREE.WebGLRenderTarget | null = null;
  let sky: THREE.WebGLCubeRenderTarget | null = null;
  let cube: THREE.CubeCamera | null = null;
  let active: LensSubject | null = null;
  let lastSeen = -Infinity,
    lastId = -1;
  const captureBudget = createCaptureBudget();
  const capturedWorld = new THREE.Matrix4();
  const size = new THREE.Vector2(),
    center = new THREE.Vector3();
  const uniforms = {
    uScene: { value: null as THREE.Texture | null },
    uDepth: { value: null as THREE.Texture | null },
    uSky: { value: null as THREE.CubeTexture | null },
    uInverseProjection: { value: new THREE.Matrix4() },
    uCameraWorld: { value: new THREE.Matrix4() },
    uLocal: { value: new THREE.Matrix4() },
    uWorld: { value: new THREE.Matrix4() },
    uEye: { value: new THREE.Vector3() },
    uTint: { value: new THREE.Color() },
    uRadius: { value: 1 },
    uInner: { value: 3 },
    uOuter: { value: 20 },
    uJets: { value: 0 },
    uTime: { value: 0 },
    uSeed: { value: 0 },
    uFade: { value: 0 },
    uResolution: { value: size },
    uSkySize: { value: 512 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    depthTest: false,
    depthWrite: false,
    vertexShader:
      'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader: lensingFragment,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const composite = new THREE.Scene();
  composite.add(quad);
  const release = () => {
    source?.dispose();
    sky?.dispose();
    source = null;
    sky = null;
    cube = null;
    uniforms.uScene.value = uniforms.uDepth.value = uniforms.uSky.value = null;
    lastId = -1;
    captureBudget.reset();
  };
  return {
    render(
      renderer: THREE.WebGLRenderer,
      scene: THREE.Scene,
      camera: THREE.PerspectiveCamera,
      subject: LensSubject | null,
      wallTime: number,
      simulationTime: number,
      capture: (cube: THREE.CubeCamera) => void,
      depth: () => void = () => {},
      skySimulationTime = simulationTime,
    ) {
      active = subject && subject.fade > 0.002 ? subject : null;
      if (!active) {
        if (wallTime - lastSeen > 4) release();
        renderer.render(scene, camera);
        return;
      }
      lastSeen = active.seen ?? wallTime;
      renderer.getDrawingBufferSize(size);
      if (!source) {
        source = new THREE.WebGLRenderTarget(size.x, size.y);
        source.texture.colorSpace = THREE.SRGBColorSpace;
        source.depthTexture = new THREE.DepthTexture(
          size.x,
          size.y,
          THREE.UnsignedIntType,
        );
        sky = new THREE.WebGLCubeRenderTarget(512, {
          generateMipmaps: true,
          minFilter: THREE.LinearMipmapLinearFilter,
        });
        cube = new THREE.CubeCamera(0.01, 180, sky);
        uniforms.uScene.value = source.texture;
        uniforms.uDepth.value = source.depthTexture;
        uniforms.uSky.value = sky.texture;
      }
      if (source.width !== size.x || source.height !== size.y)
        source.setSize(size.x, size.y);
      scene.updateMatrixWorld(true);
      camera.updateMatrixWorld();
      const { body, group, fade } = active,
        p = body.phenomenon!;
      group.getWorldPosition(center);
      uniforms.uWorld.value.copy(group.matrixWorld);
      uniforms.uLocal.value.copy(group.matrixWorld).invert();
      uniforms.uEye.value
        .copy(camera.position)
        .applyMatrix4(uniforms.uLocal.value)
        .divideScalar(body.radius);
      uniforms.uInverseProjection.value.copy(camera.projectionMatrixInverse);
      uniforms.uCameraWorld.value.copy(camera.matrixWorld);
      uniforms.uRadius.value = body.radius;
      uniforms.uInner.value = p.diskInner / body.radius;
      uniforms.uOuter.value = p.diskOuter / body.radius;
      uniforms.uTint.value.set(body.color);
      uniforms.uSeed.value = body.seed;
      uniforms.uJets.value = p.jets ? 1 : 0;
      uniforms.uTime.value = simulationTime;
      uniforms.uFade.value = fade;
      // Keep sky and scene on the same cadence. Capture cost adjusts resolution
      // with hysteresis; pausing an unchanged world still reuses the last capture.
      captureBudget.poll(renderer.getContext?.());
      const changedWorld = !capturedWorld.equals(group.matrixWorld);
      if (
        captureBudget.due(
          wallTime,
          skySimulationTime,
          body.id !== lastId,
          changedWorld,
        )
      ) {
        const resolution = captureBudget.stats().resolution;
        if (sky!.width !== resolution) sky!.setSize(resolution, resolution);
        uniforms.uSkySize.value = resolution;
        cube!.position.copy(center);
        for (const child of cube!.children) {
          const c = child as THREE.PerspectiveCamera;
          c.near = p.diskOuter * 4;
          c.updateProjectionMatrix();
        }
        const started = performance.now(),
          query = captureBudget.begin();
        try {
          capture(cube!);
        } finally {
          captureBudget.end(
            query,
            wallTime,
            skySimulationTime,
            performance.now() - started,
          );
        }
        lastId = body.id;
        capturedWorld.copy(group.matrixWorld);
      }
      const visible = group.visible;
      group.visible = false;
      try {
        renderer.setRenderTarget(source);
        renderer.render(scene, camera);
        depth();
      } finally {
        group.visible = visible;
        renderer.setRenderTarget(null);
      }
      renderer.render(composite, camera);
    },
    trace(ray: THREE.Ray) {
      if (!active || active.fade < 0.5) return null;
      const { body, group } = active;
      const inverse = group.matrixWorld.clone().invert();
      const origin = ray.origin
        .clone()
        .applyMatrix4(inverse)
        .divideScalar(body.radius);
      const direction = ray.direction.clone().transformDirection(inverse);
      const impact = origin.clone().cross(direction).length();
      if (
        origin.dot(direction) >= 0 ||
        impact >= (body.phenomenon!.diskOuter / body.radius) * 2
      )
        return null;
      const result = traceGeodesic(
        origin,
        direction,
        body.phenomenon!.diskInner / body.radius,
        body.phenomenon!.diskOuter / body.radius,
      );
      const zone = body.phenomenon!.diskOuter / body.radius;
      const weight =
        1 - THREE.MathUtils.smoothstep(impact, zone * 1.25, zone * 2);
      result.direction
        .lerpVectors(direction, result.direction, weight)
        .normalize();
      const first = result.intersections.find((hit) => hit.opacity > 0.01);
      const transmission = result.intersections.reduce(
        (remaining, hit) => remaining * (1 - hit.opacity),
        1,
      );
      return {
        body,
        captured: result.captured,
        disk: transmission <= 0.5,
        transmission,
        distance:
          (first ? first.point.distanceTo(origin) : -origin.dot(direction)) *
          body.radius,
        origin: group.getWorldPosition(new THREE.Vector3()),
        direction: result.direction.transformDirection(group.matrixWorld),
      };
    },
    stats() {
      return { active: active ? 1 : 0, targets: source ? 2 : 0 };
    },
    skyResolution() {
      return sky?.width ?? 512;
    },
    captureStats() {
      return captureBudget.stats();
    },
    invalidate() {
      lastId = -1;
      captureBudget.reset();
    },
    dispose() {
      active = null;
      release();
      quad.geometry.dispose();
      material.dispose();
    },
  };
}

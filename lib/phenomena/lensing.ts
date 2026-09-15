import type { PassProbe } from '../gpu-diagnostics.ts';
import { estimateTargetBytes } from '../performance-memory.ts';
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

/** Clamp a circular lens influence to the drawing buffer without dropping its
 * clipped edge. The extent must be derived from both clamped endpoints: using
 * a clamped origin with an unclamped diameter leaves a rectangular hole when a
 * lens overlaps a viewport edge. */
export function lensingScissorBounds(
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  radius: number,
) {
  const left = Math.max(0, Math.floor(centerX - radius));
  const bottom = Math.max(0, Math.floor(centerY - radius));
  const right = Math.min(width, Math.ceil(centerX + radius));
  const top = Math.min(height, Math.ceil(centerY + radius));
  return { x: left, y: bottom, width: right - left, height: top - bottom };
}

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
    uIntegratorSteps: { value: 320 },
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
  // The source target contains the entire scene. Render it before restricting
  // the expensive optical pass, otherwise pixels outside the scissor retain
  // the renderer clear colour (the black rectangle reported during close-up).
  const sourceUniforms = { uSource: { value: null as THREE.Texture | null } };
  const sourceMaterial = new THREE.ShaderMaterial({
    uniforms: sourceUniforms,
    depthTest: false,
    depthWrite: false,
    vertexShader:
      'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader:
      'varying vec2 vUv;uniform sampler2D uSource;void main(){gl_FragColor=texture2D(uSource,vUv);#include <colorspace_fragment>}',
  });
  const sourceQuad = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    sourceMaterial,
  );
  sourceQuad.frustumCulled = false;
  const sourceComposite = new THREE.Scene();
  sourceComposite.add(sourceQuad);
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
      probe?: PassProbe,
      fixedSkyResolution?: number,
      integratorSteps = 320,
    ) {
      active = subject && subject.fade > 0.002 ? subject : null;
      if (!active) {
        if (wallTime - lastSeen > 4) release();
        if (probe) probe.measure('scene', () => renderer.render(scene, camera));
        else renderer.render(scene, camera);
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
        sourceUniforms.uSource.value = source.texture;
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
      uniforms.uIntegratorSteps.value = THREE.MathUtils.clamp(
        Math.floor(integratorSteps),
        32,
        320,
      );
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
        const resolution =
          fixedSkyResolution ?? captureBudget.stats().resolution;
        if (sky!.width !== resolution) sky!.setSize(resolution, resolution);
        uniforms.uSkySize.value = resolution;
        cube!.position.copy(center);
        for (const child of cube!.children) {
          const c = child as THREE.PerspectiveCamera;
          c.near = p.diskOuter * 4;
          c.updateProjectionMatrix();
        }
        const started = performance.now(),
          query = probe ? null : captureBudget.begin();
        try {
          if (probe)
            probe.measure(
              'sky-six-faces',
              () => capture(cube!),
              (ms) => captureBudget.acceptGpu(ms),
            );
          else capture(cube!);
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
        if (probe) {
          probe.measure('scene-color-depth', () =>
            renderer.render(scene, camera),
          );
          probe.measure('point-depth', depth);
        } else {
          renderer.render(scene, camera);
          depth();
        }
      } finally {
        group.visible = visible;
        renderer.setRenderTarget(null);
      }
      const renderComposite = () => {
        renderer.render(sourceComposite, camera);
        const renderOverlay = () => {
          // This is an overlay over sourceComposite, never a fresh frame.
          // Keeping autoClear enabled here lets WebGL clear pixels outside the
          // scissor on some drivers, recreating the rectangular black canvas.
          const autoClear = renderer.autoClear;
          renderer.autoClear = false;
          try {
            renderer.render(composite, camera);
          } finally {
            renderer.autoClear = autoClear;
          }
        };
        // The shader has an early-out outside this sphere. Scissoring avoids
        // submitting its 320-step path over pixels that cannot be influenced.
        // Keep the full target when the camera is inside/behind the bound.
        const influence = Math.max(
          p.diskOuter * 2,
          p.jets ? body.radius * 40 : 0,
        );
        const view = center.clone().applyMatrix4(camera.matrixWorldInverse);
        const depth = -view.z;
        const radius =
          (influence * size.y) /
          Math.max(0.000001, 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * depth);
        if (
          depth <= camera.near ||
          radius >= Math.max(size.x, size.y) ||
          !renderer.setScissorTest
        ) {
          renderOverlay();
          return;
        }
        const projectedCenter = center.clone().project(camera);
        const bounds = lensingScissorBounds(
          size.x,
          size.y,
          (projectedCenter.x * 0.5 + 0.5) * size.x,
          (projectedCenter.y * 0.5 + 0.5) * size.y,
          radius,
        );
        if (bounds.width <= 0 || bounds.height <= 0) return;
        renderer.setScissorTest(true);
        renderer.setScissor(bounds.x, bounds.y, bounds.width, bounds.height);
        try {
          renderOverlay();
        } finally {
          renderer.setScissorTest(false);
        }
      };
      if (probe) probe.measure('lensing-composite', renderComposite);
      else renderComposite();
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
    estimatedTargetBytes() {
      return (
        (source ? estimateTargetBytes(source.width, source.height) : 0) +
        (sky ? estimateTargetBytes(sky.width, sky.height, 6, true) : 0)
      );
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
      sourceQuad.geometry.dispose();
      sourceMaterial.dispose();
    },
  };
}

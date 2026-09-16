/** Manual WebGL fixture. In the local preview console:
 * const lab = (await import('/tests/fixtures/lensing-lab.ts')).createLensingLab();
 * lab.view(0); lab.foreground(true); await lab.benchmark(); lab.dispose();
 */
import * as THREE from 'three';
import { createLensing } from '../../lib/phenomena/lensing.ts';
import { catalogue } from '../../lib/catalogue/runtime.ts';
import { createBodyLOD } from '../../lib/stellar-lod.ts';
import { createLocalLights, mixLocalLights } from '../../lib/body-lighting.ts';

export function createLensingLab(host: HTMLElement = document.body) {
  const body = catalogue.getBody(0);
  const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x04060b);
  const camera = new THREE.PerspectiveCamera(
    48,
    window.innerWidth / window.innerHeight,
    0.000001,
    180,
  );
  const scene = new THREE.Scene(),
    skyScene = new THREE.Scene();
  const group = new THREE.Group();
  group.rotation.z = body.phenomenon!.tilt;
  scene.add(group);
  const geometry = new THREE.SphereGeometry(50, 32, 16);
  const backgroundUniforms = {
    uBackground: { value: 0 },
    uStar: { value: new THREE.Vector3(0.2, 0.3, -1).normalize() },
  };
  const material = new THREE.ShaderMaterial({
    uniforms: backgroundUniforms,
    side: THREE.BackSide,
    vertexShader:
      'varying vec3 vP;void main(){vP=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `varying vec3 vP;uniform float uBackground;uniform vec3 uStar;
    void main(){vec3 d=normalize(vP);
      if(uBackground>.5){
        float star=uBackground>1.5?exp(-pow(length(d-uStar)/.007,2.)):0.;
        gl_FragColor=vec4(vec3(.08)+star*vec3(.9,.6,.2),1.);return;
      }
      vec2 uv=vec2(atan(d.z,d.x),asin(d.y))*12.;
      vec2 f=abs(fract(uv-.5)-.5)/max(fwidth(uv),vec2(.001));
      float line=1.-smoothstep(.6,1.5,min(f.x,f.y));
      gl_FragColor=vec4(mix(vec3(.012,.02,.04),vec3(.10,.27,.40),line),1.);}`,
  });
  const grid = new THREE.Mesh(geometry, material);
  skyScene.add(grid);
  scene.add(grid.clone());
  const foreground = new THREE.Mesh(
    new THREE.SphereGeometry(body.radius, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0x44ff88 }),
  );
  foreground.visible = false;
  scene.add(foreground);
  // An observed body, lit by one star, exactly as the engine lights it: a
  // terminator and a night side are what the composite must leave alone.
  const observedGroup = new THREE.Group();
  scene.add(observedGroup);
  const observed = createBodyLOD(observedGroup, 1);
  const observedBody = catalogue.resolveReference('v2:system:000001:body:006')!;
  const observedPosition = new THREE.Vector3();
  const lens = createLensing();
  let time = 10,
    wall = 0;
  const distance =
    (body.phenomenon!.diskOuter * 3.4) / Math.min(1, camera.aspect);
  renderer.domElement.style.cssText =
    'position:fixed;inset:0;z-index:100000;pointer-events:none';
  host.appendChild(renderer.domElement);
  /** `withLens` false is the frame with no black hole on screen at all. */
  const draw = (withLens = true) =>
    lens.render(
      renderer,
      scene,
      camera,
      withLens ? { body, group, fade: 1 } : null,
      (wall += 0.016),
      time,
      (c) => c.update(renderer, skyScene),
    );
  const lab = {
    renderer,
    camera,
    lens,
    body,
    group,
    draw,
    background(mode: 'grid' | 'flat' | 'star', direction?: THREE.Vector3) {
      backgroundUniforms.uBackground.value =
        mode === 'grid' ? 0 : mode === 'flat' ? 1 : 2;
      if (direction) backgroundUniforms.uStar.value.copy(direction).normalize();
      lens.invalidate();
      draw();
    },
    view(angle: number) {
      camera.position
        .set(0, Math.sin(angle) * distance, Math.cos(angle) * distance)
        .applyAxisAngle(new THREE.Vector3(0, 0, 1), body.phenomenon!.tilt);
      camera.lookAt(0, 0, 0);
      draw();
      return lens.stats();
    },
    time(value: number) {
      time = value;
      draw();
    },
    foreground(visible: boolean) {
      foreground.visible = visible;
      foreground.position.copy(camera.position).multiplyScalar(0.65);
      draw();
    },
    /**
     * Puts a catalogue planet in the frame beside the black hole, at the
     * distance and lighting the engine would give it: `offset` is how far from
     * the axis it sits, in radians, and the star sits off to one side so a
     * terminator crosses the disc. Settling the fade takes a few updates.
     */
    observe(visible: boolean, offset = 0.38) {
      observedGroup.visible = visible;
      if (!visible) {
        draw();
        return null;
      }
      const toHole = camera.position.clone().negate().normalize();
      const side = new THREE.Vector3(0, 1, 0).cross(toHole).normalize();
      const up = toHole.clone().cross(side).normalize();
      const aim = toHole
        .clone()
        .multiplyScalar(Math.cos(offset))
        .addScaledVector(side, Math.sin(offset));
      observedPosition
        .copy(camera.position)
        .addScaledVector(aim, observedBody.radius * 3.2);
      const lights = mixLocalLights(
        observedPosition,
        [
          {
            // Grazing light: half the disc is day, half is night.
            position: observedPosition
              .clone()
              .addScaledVector(up, observedBody.radius * 900)
              .addScaledVector(side, observedBody.radius * 900),
            power: 1,
            color: new THREE.Color(1, 0.96, 0.9),
          },
        ],
        createLocalLights(),
      );
      for (let step = 0; step < 24; step++)
        observed.update(
          [
            {
              identity: observedBody,
              position: observedPosition,
              pixels: 320,
              distanceInRadii: 3.2,
              cameraPosition: camera.position.clone(),
              lights,
            },
          ],
          time + step * 0.1,
          0.2,
        );
      draw();
      return observedPosition.clone().project(camera);
    },
    pixels() {
      const gl = renderer.getContext();
      const pixels = new Uint8Array(
        gl.drawingBufferWidth * gl.drawingBufferHeight * 4,
      );
      gl.readPixels(
        0,
        0,
        gl.drawingBufferWidth,
        gl.drawingBufferHeight,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixels,
      );
      return pixels;
    },
    /**
     * The same frame twice, with and without the optical field in it: outside
     * the field's influence the composite must hand back the canvas it was
     * given, byte for byte. Anything else means the black hole is repainting
     * the rest of the scene — the night side of a body included.
     *
     * `pullBack` moves the camera away so the influence stays a small central
     * disc; `keepOut` is the radius of the disc left out of the comparison,
     * as a fraction of the frame height.
     */
    neutrality({ pullBack = 6, keepOut = 0.25 } = {}) {
      const saved = camera.position.clone();
      camera.position.multiplyScalar(pullBack);
      // The observed body follows the camera, so re-place it from here.
      if (observedGroup.visible) lab.observe(true);
      const frame = (subject: Parameters<typeof lens.render>[3]) => {
        lens.render(
          renderer,
          scene,
          camera,
          subject,
          (wall += 0.016),
          time,
          (c) => c.update(renderer, skyScene),
        );
        return lab.pixels();
      };
      const plain = frame(null);
      const lensed = frame({ body, group, fade: 1 });
      camera.position.copy(saved);
      if (observedGroup.visible) lab.observe(true);
      draw();
      const gl = renderer.getContext();
      const width = gl.drawingBufferWidth,
        height = gl.drawingBufferHeight;
      const excluded = (keepOut * height) ** 2;
      let sampled = 0,
        changed = 0,
        worst = 0,
        total = 0;
      let at: Record<string, unknown> | null = null;
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const dx = x - width / 2,
            dy = y - height / 2;
          if (dx * dx + dy * dy <= excluded) continue;
          const i = (y * width + x) * 4;
          const delta = Math.max(
            Math.abs(plain[i] - lensed[i]),
            Math.abs(plain[i + 1] - lensed[i + 1]),
            Math.abs(plain[i + 2] - lensed[i + 2]),
          );
          sampled++;
          total += delta;
          if (delta > 0) changed++;
          if (delta > worst) {
            worst = delta;
            at = {
              x,
              y,
              plain: [plain[i], plain[i + 1], plain[i + 2]],
              lensed: [lensed[i], lensed[i + 1], lensed[i + 2]],
            };
          }
        }
      return { sampled, changed, worst, mean: total / sampled, at };
    },
    async benchmark(count = 20) {
      const gl = renderer.getContext();
      const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      const times: number[] = [];
      if (!ext || !(gl instanceof WebGL2RenderingContext))
        return { supported: false, times };
      for (let i = 0; i < count; i++) {
        const query = gl.createQuery()!;
        gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
        draw();
        gl.endQuery(ext.TIME_ELAPSED_EXT);
        // Availability is asynchronous; never substitute CPU duration for GPU time.
        for (let wait = 0; wait < 50; wait++) {
          await new Promise((resolve) => setTimeout(resolve, 20));
          if (gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) break;
        }
        if (
          gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE) &&
          !gl.getParameter(ext.GPU_DISJOINT_EXT)
        )
          times.push(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
        gl.deleteQuery(query);
      }
      return {
        supported: true,
        times,
        width: renderer.domElement.width,
        height: renderer.domElement.height,
      };
    },
    dispose() {
      lens.dispose();
      observed.dispose();
      geometry.dispose();
      material.dispose();
      foreground.geometry.dispose();
      foreground.material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
  lab.view(Math.PI / 7.2);
  return lab;
}

/** Manual WebGL fixture. In the local preview console:
 * const lab = (await import('/tests/fixtures/lensing-lab.ts')).createLensingLab();
 * lab.view(0); lab.foreground(true); await lab.benchmark(); lab.dispose();
 */
import * as THREE from 'three';
import { createLensing } from '../../lib/phenomena/lensing.ts';
import { catalogue } from '../../lib/catalogue/runtime.ts';

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
  const lens = createLensing();
  let time = 10,
    wall = 0;
  const distance =
    (body.phenomenon!.diskOuter * 3.4) / Math.min(1, camera.aspect);
  renderer.domElement.style.cssText =
    'position:fixed;inset:0;z-index:100000;pointer-events:none';
  host.appendChild(renderer.domElement);
  const draw = () =>
    lens.render(
      renderer,
      scene,
      camera,
      { body, group, fade: 1 },
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

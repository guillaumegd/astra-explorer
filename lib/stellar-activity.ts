import * as THREE from 'three';

export function eruptionState(time: number, seed: number, loop: number) {
  const period = 32 + loop * 7;
  const clock = time + seed * 3 + loop * 13;
  const cycle = Math.floor(clock / period);
  const random = (salt: number) => {
    const n =
      Math.sin(seed * 12.9898 + cycle * 78.233 + loop * 37.719 + salt) *
      43758.5453;
    return n - Math.floor(n);
  };
  return {
    age: clock - cycle * period - 3 - random(0) * 12,
    strength: 0.55 + random(19) * 0.45,
  };
}

// All phases derive from the body seed and simulation time, including after LOD eviction.
export function createStellarActivity(
  seed: number,
  color: string,
  kind: string,
) {
  const group = new THREE.Group();
  const uniforms = {
    uTime: { value: 0 },
    uFade: { value: 0 },
    uDetailFade: { value: 0 },
    uSeed: { value: seed },
    uColor: { value: new THREE.Color(color) },
    uActivity: {
      value:
        kind === 'red-dwarf' ? 1.0 : kind === 'white-dwarf' ? 0.35 : 0.7,
    },
  };
  const coronaMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    uniforms,
    vertexShader: `uniform vec3 uEye; varying vec3 vP; varying vec3 vEye;
      void main(){vP=position;vEye=uEye;
      gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `uniform float uTime,uFade,uSeed,uActivity; uniform vec3 uColor;
      varying vec3 vP,vEye;
      void main(){
        vec3 ray=normalize(vP-vEye);
        float impact=length(cross(vEye,ray));
        if(impact<1.0) discard;
        vec3 p=normalize(vP);
        float filaments=0.65+0.2*sin(p.x*37.+p.y*29.+sin(p.z*19.+uTime*.23)+uSeed)
          +0.15*sin(p.y*71.-p.z*43.-uTime*.32);
        float height=impact-1.;
        float glow=exp(-height*(12.-4.*filaments))*(1.-smoothstep(.18,.52,height));
        gl_FragColor=vec4(uColor,glow*filaments*uFade*(.45+.2*uActivity));
      }`,
  });
  coronaMaterial.uniforms.uEye = { value: new THREE.Vector3(0, 0, 4) };
  const corona = new THREE.Mesh(
    new THREE.SphereGeometry(1.55, 40, 24),
    coronaMaterial,
  );
  group.add(corona);

  const windGeometry = new THREE.BufferGeometry();
  const windData = new Float32Array(320 * 2 * 3);
  for (let j = 0; j < 320; j++) {
    for (let end = 0; end < 2; end++) {
      const index = (j * 2 + end) * 3;
      windData[index] = j / 320;
      windData[index + 1] = j * 2.399963;
      windData[index + 2] = end;
    }
  }
  windGeometry.setAttribute('position', new THREE.BufferAttribute(windData, 3));
  const windMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms,
    vertexShader: `uniform float uTime,uSeed,uActivity; varying float vAlpha;
      void main(){
        float phase=fract(position.x*17.13+uTime*(.045+.025*uActivity));
        float t=phase+position.z*.035;
        float latitude=position.x*2.-1.;
        float angle=position.y+uSeed+t*.24;
        vec3 axis=vec3(sqrt(1.-latitude*latitude)*cos(angle),latitude,sqrt(1.-latitude*latitude)*sin(angle));
        vec3 p=axis*(1.015+t*t*1.5);
        vAlpha=sin(clamp(phase,0.,1.)*3.14159)*(.3+.7*uActivity);
        gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);
      }`,
    fragmentShader: `uniform vec3 uColor; uniform float uFade,uDetailFade; varying float vAlpha;
      void main(){gl_FragColor=vec4(uColor,vAlpha*uFade*uDetailFade*.28);}`,
  });
  const wind = new THREE.LineSegments(windGeometry, windMaterial);
  wind.frustumCulled = false;
  group.add(wind);

  const ejecta: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>[] = [];
  const loops: THREE.Mesh<THREE.TubeGeometry, THREE.ShaderMaterial>[] = [];
  for (let i = 0; i < 4; i++) {
    const phase = seed * 0.73 + i * 2.39996;
    const axis = new THREE.Vector3(
      Math.cos(phase),
      Math.sin(phase * 1.7) * 0.65,
      Math.sin(phase),
    ).normalize();
    const tangent = new THREE.Vector3()
      .crossVectors(axis, new THREE.Vector3(0, 1, 0))
      .normalize();
    const points = Array.from({ length: 33 }, (_, j) => {
      const t = j / 32;
      const angle = (t - 0.5) * (0.38 + i * 0.045);
      return axis
        .clone()
        .multiplyScalar(Math.cos(angle))
        .addScaledVector(tangent, Math.sin(angle))
        .multiplyScalar(0.985 + Math.sin(Math.PI * t) * (0.18 + i * 0.035));
    });
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        ...uniforms,
        uLoop: { value: i },
        uAge: { value: 0 },
        uStrength: { value: 1 },
      },
      vertexShader: `uniform float uTime,uSeed,uLoop,uActivity,uAge,uStrength; varying vec2 vUv; varying float vBurst;
        void main(){vUv=uv;
          vBurst=smoothstep(0.,1.8,uAge)*(1.-smoothstep(3.,8.,uAge))*uStrength;
          vec3 p=position+normalize(position)*sin(uv.x*3.14159265)*vBurst*.22*uActivity;
          gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);
        }`,
      fragmentShader: `uniform vec3 uColor; uniform float uFade,uDetailFade,uTime,uSeed,uLoop,uAge;
        varying vec2 vUv; varying float vBurst;
        void main(){
          float flash=exp(-pow((uAge-1.6)/.28,2.));
          float flow=.7+.3*sin(vUv.x*42.-uTime*2.+uSeed+uLoop);
          float edge=.35+.65*pow(abs(sin(vUv.y*6.2831853)),2.);
          vec3 color=mix(uColor,vec3(1.,.94,.8),.25+vBurst*.35);
          gl_FragColor=vec4(color,edge*flow*uFade*uDetailFade*(.38+vBurst*.6+flash*.8));
        }`,
    });
    const mesh = new THREE.Mesh(
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3(points),
        48,
        0.009 + i * 0.0015,
        6,
        false,
      ),
      material,
    );
    // Vertex displacement extends beyond the static geometry bounds.
    mesh.frustumCulled = false;
    loops.push(mesh);
    group.add(mesh);
    const particleGeometry = new THREE.BufferGeometry();
    const attributes = new Float32Array(128 * 3);
    for (let j = 0; j < 128; j++) {
      attributes[j * 3] = j / 128;
      attributes[j * 3 + 1] = Math.sin(j * 127.1 + seed) * 0.5 + 0.5;
      attributes[j * 3 + 2] = Math.sin(j * 311.7 + seed * 0.3) * 0.5 + 0.5;
    }
    particleGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(attributes, 3),
    );
    const particleMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        ...material.uniforms,
        uAxis: { value: axis },
        uTangent: { value: tangent },
      },
      vertexShader: `uniform float uAge,uActivity,uStrength; uniform vec3 uAxis,uTangent;
        varying float vAlpha;
        void main(){
          float age=uAge-1.6-position.x*.8;
          float life=clamp(age/6.,0.,1.);
          vAlpha=smoothstep(0.,.4,age)*(1.-smoothstep(.25,1.,life))*uStrength;
          vec3 side=cross(uAxis,uTangent);
          vec3 p=uAxis*(1.18+log(1.+max(age,0.)*1.8)*(.26+position.y*.3)*uActivity)
            +uTangent*((position.y-.5)*(.08+life*life*.85))
            +side*((position.z-.5)*(.06+life*life*.65));
          vec4 view=modelViewMatrix*vec4(p,1.);
          gl_Position=projectionMatrix*view;
          float radius=length(modelViewMatrix[0].xyz);
          gl_PointSize=clamp(radius/max(.000001,-view.z)*220.*(1.-life*.7),1.,12.);
        }`,
      fragmentShader: `uniform vec3 uColor; uniform float uFade,uDetailFade; varying float vAlpha;
        void main(){float d=length(gl_PointCoord-.5)*2.;
          if(d>1.) discard;
          gl_FragColor=vec4(mix(uColor,vec3(1.),.25),exp(-d*d*4.)*(1.-smoothstep(.6,1.,d))*vAlpha*uFade*uDetailFade*.85);
        }`,
    });
    const particles = new THREE.Points(particleGeometry, particleMaterial);
    particles.frustumCulled = false;
    ejecta.push(particles);
    group.add(particles);
  }
  const eye = coronaMaterial.uniforms.uEye.value as THREE.Vector3;
  const animate = (time: number) => {
    uniforms.uTime.value = time;
    loops.forEach((loop, i) => {
      const event = eruptionState(time, seed, i);
      loop.material.uniforms.uAge.value = event.age;
      loop.material.uniforms.uStrength.value = event.strength;
      ejecta[i].visible = event.age > 1.6 && event.age < 8.4;
    });
  };
  return {
    group,
    update(time: number, fade: number, pixels: number, camera?: THREE.Vector3) {
      animate(time);
      uniforms.uFade.value = fade * THREE.MathUtils.smoothstep(pixels, 35, 110);
      group.visible = uniforms.uFade.value > 0.001 && !!camera;
      if (camera) {
        group.updateWorldMatrix(true, false);
        eye.copy(camera);
        group.worldToLocal(eye);
      }
      uniforms.uDetailFade.value = THREE.MathUtils.smoothstep(pixels, 65, 150);
    },
    fadeOut(time: number, dt: number) {
      animate(time);
      uniforms.uFade.value *= Math.exp(-dt / 0.18);
      group.visible = uniforms.uFade.value > 0.001;
    },
    dispose() {
      windGeometry.dispose();
      windMaterial.dispose();
      corona.geometry.dispose();
      coronaMaterial.dispose();
      for (const loop of [...loops, ...ejecta]) {
        loop.geometry.dispose();
        loop.material.dispose();
      }
    },
  };
}

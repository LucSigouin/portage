// Sky dome, dusk lighting and drifting mist banks.
import * as THREE from 'three';
import { ATMOSPHERE_GLSL, SUN_DIR, canvasTexture } from './palette.js';
import { mulberry32 } from './util.js';

const NOISE_GLSL = /* glsl */ `
float bhHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float bhNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(bhHash(i), bhHash(i + vec2(1.0, 0.0)), u.x), mix(bhHash(i + vec2(0.0, 1.0)), bhHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float bhFbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += bhNoise(p) * a; p = p * 2.07 + 13.1; a *= 0.5; }
  return s;
}`;

export function createSky(scene) {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
        gl_Position = vec4(p.xy, p.w * 0.99999, p.w); // pinned to the far plane, whatever the projection (mirror camera is oblique)
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vDir;
      ${ATMOSPHERE_GLSL}
      ${NOISE_GLSL}
      void main() {
        vec3 d = normalize(vDir);
        vec3 col = bhSky(d);
        float az = bhSunward(d);
        float y = d.y;

        // long dusk cloud bars, ember-lit from below on the sun side
        float ang = atan(d.x, -d.z);
        float bars = bhFbm(vec2(ang * 4.2 + uTime * 0.003, y * 46.0 + 3.0));
        float band = smoothstep(0.015, 0.07, y) * smoothstep(0.36, 0.1, y);
        float cloud = smoothstep(0.5, 0.74, bars) * band;
        float lit = pow(max(az, 0.0), 3.0);
        vec3 cloudCol = mix(BH_HIGH * 0.7, BH_ROSE * 0.9 + BH_EMBER * 0.55 * lit, pow(max(az, 0.0), 2.5) * exp(-y * 4.0));
        col = mix(col, cloudCol, cloud * 0.7);

        // stars come out overhead, away from the glow
        vec2 sp = vec2(ang, asin(clamp(y, -1.0, 1.0))) * 70.0;
        vec2 cell = floor(sp);
        float h = bhHash(cell);
        vec2 jitter = vec2(bhHash(cell + 7.3), bhHash(cell + 19.1)) - 0.5;
        float star = step(0.975, h) * smoothstep(0.11, 0.0, length(fract(sp) - 0.5 - jitter * 0.6));
        star *= smoothstep(0.14, 0.5, y) * (1.0 - cloud) * (0.55 + 0.45 * sin(uTime * (0.8 + h * 2.5) + h * 60.0));
        col += vec3(0.75, 0.84, 1.0) * star * 1.1;

        // thin crescent on the cold side
        vec3 moonDir = normalize(vec3(0.62, 0.42, -0.2));
        float md = distance(d, moonDir);
        float disc = smoothstep(0.022, 0.019, md);
        float bite = smoothstep(0.022, 0.019, distance(d, normalize(moonDir + vec3(-0.011, 0.006, 0.0))));
        col += vec3(0.9, 0.95, 1.1) * max(disc - bite, 0.0) * 1.6 + vec3(0.25, 0.32, 0.6) * exp(-md * 26.0) * 0.12;

        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), material);
  dome.renderOrder = 2.5; // after the opaque world and the water: early-z skips every covered sky pixel
  dome.frustumCulled = false;
  scene.add(dome);
  return { dome, update: (time) => { material.uniforms.uTime.value = time; } };
}

export function createLights(scene) {
  const hemi = new THREE.HemisphereLight('#6480dc', '#10142e', 1.75);
  const ember = new THREE.DirectionalLight('#ff8440', 1.5); // the last of the sun, grazing in from the glow
  ember.position.copy(SUN_DIR).multiplyScalar(100).setY(16);
  const cool = new THREE.DirectionalLight('#86a2ff', 1.7); // sky dome fill from the cold side
  cool.position.set(-SUN_DIR.x * 60 + 30, 90, -SUN_DIR.z * 60);
  scene.add(hemi, ember, ember.target, cool, cool.target);

  // Three warm points, always present so toggling canoes never recompiles a shader.
  const points = [0, 1, 2].map(() => {
    const light = new THREE.PointLight('#ffb062', 0, 18, 1.7);
    scene.add(light);
    return light;
  });
  return { hemi, ember, cool, points };
}

/** Low mist banks: camera-facing strips that pick up the horizon colour behind them. */
export function createMist(scene) {
  const random = mulberry32(41);
  const texture = canvasTexture(256, 64, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < 46; i++) {
      const x = random() * w, y = h * (0.5 + random() * 0.32), r = 14 + random() * 30;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.22)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      if (x < r) ctx.fillRect(x + w - r, y - r, r * 2, r * 2); // wrap so the strip tiles
    }
  }, { repeat: true });
  texture.colorSpace = THREE.NoColorSpace;

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uMap: { value: texture }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute vec4 aBank; // xyz centre, w = opacity
      attribute vec3 aSize; // width, height, drift phase
      uniform float uTime;
      varying vec2 vUv; varying float vAlpha; varying vec3 vOff; varying float vEnds;
      void main() {
        vec3 c = aBank.xyz;
        vEnds = uv.x;
        c.x += sin(uTime * 0.02 + aSize.z) * 9.0;
        vec3 toCam = cameraPosition - c;
        vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x));
        vec3 p = c + right * position.x * aSize.x + vec3(0.0, (position.y + 0.42) * aSize.y, 0.0);
        vUv = uv + vec2(uTime * 0.0015 + aSize.z, 0.0);
        float d = length(toCam);
        vAlpha = aBank.w * smoothstep(14.0, 60.0, d);
        vOff = p - cameraPosition;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      varying vec2 vUv; varying float vAlpha; varying vec3 vOff; varying float vEnds;
      ${ATMOSPHERE_GLSL}
      void main() {
        float ends = smoothstep(0.0, 0.25, vEnds) * smoothstep(1.0, 0.75, vEnds);
        float a = texture2D(uMap, vUv).a * smoothstep(0.0, 0.2, vUv.y) * ends;
        gl_FragColor = vec4(bhHorizon(vOff) * 1.12, a * vAlpha);
      }`,
  });

  const banks = [];
  const add = (x, z, width, height, opacity) => banks.push([x, z, width, height, opacity]);
  for (let i = 0; i < 26; i++) {
    const angle = random() * Math.PI * 2;
    const radius = 70 + random() * 420;
    add(Math.sin(angle) * radius, -60 + Math.cos(angle) * radius, 90 + random() * 220, 5 + random() * 12, 0.3 + random() * 0.4);
  }
  add(-30, -92, 120, 7, 0.5); // behind the knoll: lifts the pine silhouettes
  add(40, -104, 150, 9, 0.5);
  add(-80, -200, 260, 14, 0.6); // foot of the steeple

  const geometry = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1));
  const bank = new Float32Array(banks.length * 4), size = new Float32Array(banks.length * 3);
  banks.forEach(([x, z, width, height, opacity], i) => {
    bank.set([x, 0, z, opacity], i * 4);
    size.set([width, height, random() * 6.28], i * 3);
  });
  geometry.setAttribute('aBank', new THREE.InstancedBufferAttribute(bank, 4));
  geometry.setAttribute('aSize', new THREE.InstancedBufferAttribute(size, 3));
  geometry.instanceCount = banks.length;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  scene.add(mesh);
  return { mesh, update: (time) => { material.uniforms.uTime.value = time; } };
}

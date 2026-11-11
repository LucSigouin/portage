// Cutbank water: faceted swell, hard depth bands, crisp foam at every shoreline and hull, ribbon wake.
import * as THREE from 'three';
import { PAL, glowMat } from './palette.js';

export const WAVE_AMP = 0.17;
const CELL = 1.6;
const HALF = 76; // cells from centre to edge of the detailed patch
const EDGE = HALF * CELL;

// Same swell on CPU (canoe bob, foam placement) and GPU.
export function waveHeight(x, z, t) {
  return WAVE_AMP * (
    0.5 * Math.sin(x * 0.3 + z * 0.18 + t * 1.05) +
    0.3 * Math.sin(-x * 0.22 + z * 0.52 + t * 1.5 + 1.3) +
    0.2 * Math.sin(x * 0.75 - z * 0.62 + t * 2.2 + 4.0));
}

const GLSL_COMMON = /* glsl */`
float waveH(vec2 p, float t) {
  return ${WAVE_AMP.toFixed(3)} * (
    0.5 * sin(p.x * 0.3 + p.y * 0.18 + t * 1.05) +
    0.3 * sin(-p.x * 0.22 + p.y * 0.52 + t * 1.5 + 1.3) +
    0.2 * sin(p.x * 0.75 - p.y * 0.62 + t * 2.2 + 4.0));
}
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

const VERT = /* glsl */`
#include <common>
#include <fog_pars_vertex>
#include <shadowmap_pars_vertex>
uniform float uTime;
uniform sampler2D uGround;
uniform vec4 uGroundRect;
varying vec3 vWorld;
flat varying float vFacet;
flat varying float vCrest;
${GLSL_COMMON}
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float r = max(abs(position.x), abs(position.z));
  float fade = 1.0 - smoothstep(${(EDGE * 0.55).toFixed(1)}, ${(EDGE * 0.94).toFixed(1)}, r);
  vec2 cell = floor(wp.xz / ${CELL.toFixed(2)} + 0.5);
  vec2 jit = (vec2(hash21(cell), hash21(cell + 17.3)) - 0.5) * ${(CELL * 0.62).toFixed(3)} * fade;
  wp.xz += jit;
  float gh = texture2D(uGround, (wp.xz - uGroundRect.xy) / uGroundRect.zw).r;
  float shoal = smoothstep(0.1, 3.0, -gh) * 0.85 + 0.15;
  float wh = waveH(wp.xz, uTime) * fade * shoal;
  wp.y += wh;
  vCrest = wh / ${WAVE_AMP.toFixed(3)};
  vWorld = wp.xyz;
  vFacet = hash21(cell + 3.1);
  vec4 worldPosition = wp;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  vec3 transformedNormal = normalMatrix * vec3(0.0, 1.0, 0.0);
  #include <shadowmap_vertex>
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */`
#include <common>
#include <packing>
#include <fog_pars_fragment>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
uniform float uTime;
uniform float uSpeed;
uniform vec3 uSunDir;
uniform vec3 cShallow, cTeal, cMid, cDeep, cAbyss, cFoam, cGlint, cSkyH, cAqua;
uniform sampler2D uGround;
uniform vec4 uGroundRect;
uniform vec4 uHull[3];
uniform vec3 uHullDim[3];
uniform vec3 uRings[8];
varying vec3 vWorld;
flat varying float vFacet;
flat varying float vCrest;
${GLSL_COMMON}
void main() {
  vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  if (N.y < 0.0) N = -N;
  vec3 V = normalize(cameraPosition - vWorld);
  vec2 toFrag = vWorld.xz - cameraPosition.xz;
  float dist = length(toFrag);
  vec2 sunXZ = normalize(uSunDir.xz);

  float depth = -texture2D(uGround, (vWorld.xz - uGroundRect.xy) / uGroundRect.zw).r;
  float n1 = vnoise(vWorld.xz * 0.35 + uTime * 0.05);
  float n2 = vnoise(vWorld.xz * 1.1 - uTime * 0.11);

  // --- depth: hard bands, teal shallows down to deep green
  float dd = depth + (n1 - 0.5) * 0.9;
  vec3 col = mix(cDeep, cAbyss, step(0.56, vnoise(vWorld.xz * 0.018 + 7.0)));
  col = mix(col, cMid, step(dd, 4.4));
  col = mix(col, cTeal, step(dd, 2.5));
  col = mix(col, cShallow, step(dd, 1.05));

  // --- banded sheen: the water steps from deep teal to aqua to the peach of the sky.
  // Far water climbs the steps with distance; near facets climb them by leaning away from the eye.
  vec3 Nx = normalize(vec3(N.x * 3.5, N.y, N.z * 3.5));
  float away = dot(Nx.xz, -normalize(V.xz + 1e-5));
  float s = pow(1.0 - max(V.y, 0.0), 14.0) + 0.2 * step(0.09, away) + 0.2 * step(0.26, away)
          + 0.17 * step(0.24, vCrest) + 0.17 * step(0.5, vCrest)
          + (vFacet - 0.5) * 0.14 + (n1 - 0.5) * 0.12;
  vec3 base = col * (1.0 - 0.1 * step(away, -0.12) - 0.11 * step(vCrest, -0.3) + (vFacet - 0.5) * 0.08);
  vec3 w1 = mix(base, cAqua, 0.24);
  vec3 w2 = mix(base, cAqua, 0.58);
  vec3 w3 = mix(cAqua, cFoam, 0.45);
  col = s < 0.3 ? base : s < 0.55 ? w1 : s < 0.78 ? w2 : s < 0.94 ? w3 : cSkyH;

  // --- sun glitter: a field of small blaze diamonds, each pulsing on its own clock, thickest in the sun lane
  float toSun = max(dot(toFrag / max(dist, 0.001), sunXZ), 0.0);
  vec3 Ng = normalize(vec3(N.x * 2.5, N.y, N.z * 2.5));
  float lobe = pow(max(dot(Ng, normalize(V + uSunDir)), 0.0), 14.0) * (1.0 - smoothstep(70.0, 110.0, dist));
  lobe = max(lobe, 0.8 * smoothstep(0.972, 0.9985, toSun) * smoothstep(12.0, 50.0, dist));
  vec2 gp = mat2(0.82, 0.57, -0.57, 0.82) * vWorld.xz * (dist < 28.0 ? 2.1 : dist < 90.0 ? 0.8 : 0.28);
  vec2 gi = floor(gp);
  float r1 = hash21(gi + 0.37), r2 = hash21(gi + 9.1);
  vec2 gf = fract(gp) - 0.5 - (vec2(r1, hash21(gi + 4.2)) - 0.5) * 0.44; // scatter inside the cell
  float pulse = sin(3.14159 * fract(r1 * 9.0 + uTime * (0.3 + r2 * 0.5)));
  float glit = step(abs(gf.x) + abs(gf.y), (0.16 + 0.2 * r1) * pulse) * step(r2, lobe * 0.9);
  col = mix(col, cGlint, glit);

  // --- foam: solid lip on every shore, travelling bands in the shallows
  float lip = 0.05 + 0.07 * n2 + 0.03 * sin(uTime * 1.2 + vWorld.x * 0.8 + vWorld.z * 0.6);
  float foam = step(depth, lip);
  float band = step(fract(depth * 1.5 + uTime * 0.16 + n1 * 0.6), 0.13);
  band *= step(depth, 1.1) * step(lip, depth) * step(0.42, n2 + (1.1 - depth) * 0.3);
  foam = max(foam, band);

  // --- hulls: cut the water out of the canoe, foam collar, bow wave
  for (int i = 0; i < 3; i++) {
    vec3 dim = uHullDim[i];
    if (dim.z < 0.0) continue;
    vec2 rel = vWorld.xz - uHull[i].xy;
    vec2 dir = uHull[i].zw;
    float lz = dot(rel, dir);
    float lx = dot(rel, vec2(-dir.y, dir.x));
    float u = clamp(lz / dim.x, -1.0, 1.0);
    float wAt = dim.y * pow(max(1.0 - pow(abs(u), 2.2), 0.0), 0.72);
    float d = max(abs(lx) - wAt, abs(lz) - dim.x);
    if (dim.z > 0.5 && d < -0.07) discard;
    float bow = smoothstep(-0.3, 1.0, u);
    foam = max(foam, step(d, 0.045 + 0.085 * n2 + uSpeed * (0.02 + 0.11 * bow)));
  }

  // --- drowned landmarks: foam ring + one loose band
  for (int i = 0; i < 8; i++) {
    vec3 rg = uRings[i];
    if (rg.z <= 0.0) continue;
    float dr = length(vWorld.xz - rg.xy) - rg.z;
    foam = max(foam, step(abs(dr - 0.2), 0.32 + 0.3 * n2));
    foam = max(foam, step(fract(dr * 0.7 - uTime * 0.2 + n1 * 0.5), 0.16) * step(dr, 3.0) * step(1.0, dr) * step(0.45, n2));
  }
  col = mix(col, cFoam, foam);

  float sh = getShadowMask();
  col *= mix(vec3(0.56, 0.7, 0.8), vec3(1.0), sh);

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

function buildGrid() {
  const n = HALF * 2 + 1;
  const pos = [];
  const idx = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) pos.push((i - HALF) * CELL, 0, (j - HALF) * CELL);
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      if ((i + j) & 1) idx.push(a, c, b, b, c, d); else idx.push(a, c, d, a, d, b);
    }
  }
  // skirt to the horizon, sharing the edge vertices so no cracks
  const FAR = 3400 / EDGE;
  const ring = [];
  for (let i = 0; i < n - 1; i++) ring.push(i);
  for (let j = 0; j < n - 1; j++) ring.push(j * n + n - 1);
  for (let i = n - 1; i > 0; i--) ring.push((n - 1) * n + i);
  for (let j = n - 1; j > 0; j--) ring.push(j * n);
  const base = pos.length / 3;
  for (const v of ring) pos.push(pos[v * 3] * FAR, 0, pos[v * 3 + 2] * FAR);
  for (let k = 0; k < ring.length; k++) {
    const a = ring[k], b = ring[(k + 1) % ring.length];
    const a2 = base + k, b2 = base + ((k + 1) % ring.length);
    idx.push(a, a2, b, b, a2, b2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

export function createWater(scene, { groundTex, groundRect, sunDir, rings }) {
  const c = (h) => new THREE.Color(h);
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.lights, THREE.UniformsLib.fog]);
  Object.assign(uniforms, {
    uTime: { value: 0 },
    uSpeed: { value: 0 },
    uSunDir: { value: sunDir.clone() },
    cShallow: { value: c(PAL.waterShallow) },
    cTeal: { value: c(PAL.waterTeal) },
    cMid: { value: c(PAL.waterMid) },
    cDeep: { value: c(PAL.waterDeep) },
    cAbyss: { value: c(PAL.waterAbyss) },
    cFoam: { value: c(PAL.foam) },
    cGlint: { value: c(PAL.glint) },
    cSkyH: { value: c(PAL.haze) },
    cAqua: { value: c(PAL.waterAqua) },
    uGround: { value: groundTex },
    uGroundRect: { value: groundRect },
    uHull: { value: [new THREE.Vector4(0, 0, 0, -1), new THREE.Vector4(0, 0, 0, -1), new THREE.Vector4(0, 0, 0, -1)] },
    uHullDim: { value: [new THREE.Vector3(2.3, 0.45, 1), new THREE.Vector3(2.4, 0.3, -1), new THREE.Vector3(2.4, 0.3, -1)] },
    uRings: { value: Array.from({ length: 8 }, (_, i) => (rings[i] ? rings[i].clone() : new THREE.Vector3(0, 0, 0))) },
  });
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, lights: true, fog: true });
  const mesh = new THREE.Mesh(buildGrid(), material);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.name = 'water';
  scene.add(mesh);

  return {
    mesh,
    uniforms,
    update(t, camera) {
      uniforms.uTime.value = t;
      mesh.position.x = Math.round(camera.position.x / CELL) * CELL;
      mesh.position.z = Math.round(camera.position.z / CELL) * CELL;
    },
  };
}

// --- Wake: two foam ribbons peeling off the stern plus chunky foam shards down the middle.
const SAMPLES = 44;
const SHARDS = 70;
export class Wake {
  constructor(scene) {
    this.samples = []; // newest first: {x, z, nx, nz, age, k}
    this.acc = 0;
    this.maxAge = 5.2;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(SAMPLES * 4 * 3);
    const colr = new Float32Array(SAMPLES * 4 * 3);
    const foam = new THREE.Color(PAL.foam);
    for (let i = 0; i < SAMPLES * 4; i++) foam.toArray(colr, i * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(colr, 3));
    const idx = [];
    for (let i = 0; i < SAMPLES - 1; i++) {
      for (let s = 0; s < 2; s++) {
        const a = i * 4 + s * 2, b = a + 1, c = a + 4, d = a + 5;
        idx.push(a, c, b, b, c, d);
      }
    }
    g.setIndex(idx);
    const mat = glowMat.clone();
    mat.side = THREE.DoubleSide;
    this.ribbon = new THREE.Mesh(g, mat);
    this.ribbon.frustumCulled = false;
    this.ribbon.renderOrder = 2;
    scene.add(this.ribbon);

    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.5, 0.36, 0, 0.05, 0, 0, 0.5, -0.36, 0, -0.05], 3));
    sg.setIndex([0, 2, 1, 0, 3, 2]);
    this.shards = new THREE.InstancedMesh(sg, new THREE.MeshBasicMaterial({ color: PAL.foam }), SHARDS);
    this.shards.frustumCulled = false;
    this.shards.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.shards);
    this.parts = Array.from({ length: SHARDS }, () => ({ x: 0, z: 0, vx: 0, vz: 0, age: 9, life: 1, rot: 0, size: 0 }));
    this.next = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
  }
  spawn(x, z, vx, vz, size, life) {
    const p = this.parts[this.next];
    this.next = (this.next + 1) % SHARDS;
    p.x = x; p.z = z; p.vx = vx; p.vz = vz; p.age = 0; p.life = life; p.size = size; p.rot = Math.random() * 6.28;
  }
  // stern: world xz of the stern; fwd: unit heading; speed: m/s; drift: world velocity applied to old foam (treadmill shots)
  update(dt, t, stern, fwd, speed, drift, heightAt) {
    const nx = -fwd.z, nz = fwd.x;
    for (const s of this.samples) { s.age += dt; s.x += drift.x * dt; s.z += drift.z * dt; }
    this.acc += dt * Math.max(Math.abs(speed), 0.0);
    if (Math.abs(speed) > 0.25 && this.acc > 0.42) {
      this.acc = 0;
      this.samples.unshift({ x: stern.x, z: stern.z, nx, nz, age: 0, k: Math.min(Math.abs(speed) / 2.6, 1), r: Math.random() });
      if (this.samples.length > SAMPLES - 1) this.samples.pop();
      const j = (Math.random() - 0.5) * 0.5;
      this.spawn(stern.x + nx * j, stern.z + nz * j, nx * j * 0.3, nz * j * 0.3, 0.32 + Math.random() * 0.4, 2.2 + Math.random() * 1.6);
    }
    while (this.samples.length && this.samples[this.samples.length - 1].age > this.maxAge) this.samples.pop();

    // ribbons: head sample is glued to the live stern so the wake never detaches
    const P = this.pos;
    let v = 0;
    for (let i = 0; i < SAMPLES; i++) {
      const live = i === 0;
      const s = live ? { x: stern.x, z: stern.z, nx, nz, age: 0, k: Math.min(Math.abs(speed) / 2.6, 1), r: 0.5 } : this.samples[Math.min(i - 1, this.samples.length - 1)];
      const dead = !s || (!live && i - 1 >= this.samples.length);
      const a = dead ? this.maxAge : s.age;
      const f = 1 - a / this.maxAge;
      const spread = 0.34 + a * 0.62;
      // each sample keeps its own width, so the ribbon breaks into foam streaks instead of rails
      const w = dead || s.r < 0.16 ? 0 : (0.03 + 0.15 * Math.sin(Math.min(a * 2.2, 1) * 1.57)) * f * s.k * (0.35 + 1.1 * s.r);
      const sx = s ? s.x : stern.x, sz = s ? s.z : stern.z, snx = s ? s.nx : nx, snz = s ? s.nz : nz;
      for (let side = -1; side <= 1; side += 2) {
        for (let e = 0; e < 2; e++) {
          const off = side * (spread + (e ? w : -w * 0.4));
          const x = sx + snx * off, z = sz + snz * off;
          P[v++] = x; P[v++] = heightAt(x, z, t) + 0.035; P[v++] = z;
        }
      }
    }
    this.ribbon.geometry.attributes.position.needsUpdate = true;

    for (let i = 0; i < SHARDS; i++) {
      const p = this.parts[i];
      p.age += dt;
      const f = p.age / p.life;
      if (f >= 1) { this._m.makeScale(0, 0, 0); this.shards.setMatrixAt(i, this._m); continue; }
      p.x += (p.vx + drift.x) * dt; p.z += (p.vz + drift.z) * dt;
      const sc = p.size * Math.sin(Math.min(f * 4, 1) * 1.57) * (1 - f * f);
      this._p.set(p.x, heightAt(p.x, p.z, t) + 0.04, p.z);
      this._q.setFromEuler(this._e.set(0, p.rot + f * 0.6, 0));
      this._m.compose(this._p, this._q, this._s.set(sc, 1, sc));
      this.shards.setMatrixAt(i, this._m);
    }
    this.shards.instanceMatrix.needsUpdate = true;
  }
}

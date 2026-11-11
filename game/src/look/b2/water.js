// Ink & Wash — water. Flat washes stepped toward the horizon, drawn ripple strokes,
// brush-broken reflections, white ink foam at the shore and in the wake.
import * as THREE from 'three';
import { GU, NOISE, glsl } from './palette.js';
import { WAVES } from './waves.js';

export const SHORE_ISLANDS = 4; // the water knows the ground of the nearest few islands

const FRAG = /* glsl */ `
precision highp float;
in vec3 vWorld;
layout(location = 0) out vec4 oColor;
uniform int uPass;
uniform sampler2D tRefl, tWake;
uniform vec2 uRes, uDrift, uView;
uniform vec3 uWakeRect;   // centre x, centre z, size
uniform vec4 uIsleA[${SHORE_ISLANDS}];   // centre x, centre z, 1 / radius x, 1 / radius z
uniform vec4 uIsleB[${SHORE_ISLANDS}];   // cos, sin of its rotation, peak height (-1: unused), reach
uniform vec4 uValley;      // half width at the camera's z, its change per metre of z, south shore z, north shore z
uniform vec4 uGround;      // seabed depth, shelf width (in radii), valley wall slope, bump height
uniform float uValleyZ, uReflect;
uniform vec3 uWaterDeep, uWaterMid, uWaterPale, uInkBlue, uFoam, uLight, uSkyTop, uSkyLow;
uniform float uTime, uFogDensity, uFine, uSc;
uniform vec3 uFogColor;
${NOISE}

// The ground under the water, worked out the way the rules engine's terrainHeight does (islands as
// domes with a shelf, the seabed, the valley walls), so the shallows and the foam sit on the real shore
// of every island. No shore map to bake per island.
float groundAt(vec2 p){
  float shore = max(abs(p.x) - (uValley.x + uValley.y * (p.y - uValleyZ)), max(p.y - uValley.z, uValley.w - p.y));
  float h = max(-uGround.x, shore * uGround.z);
  float outer = 1. + uGround.y;
  for (int i = 0; i < ${SHORE_ISLANDS}; i++) {
    vec4 a = uIsleA[i];
    vec4 b = uIsleB[i];
    vec2 o = p - a.xy;
    if (b.z < 0. || abs(o.x) > b.w || abs(o.y) > b.w) continue;
    vec2 e = vec2(o.x * b.x + o.y * b.y, -o.x * b.y + o.y * b.x) * a.zw;
    float d2 = dot(e, e);
    if (d2 >= outer * outer) continue;
    float ih;
    if (d2 <= 1.) ih = (1. - d2) * (b.z + uGround.w * sin(p.x * .21 + p.y * .13) * sin(p.y * .17 - p.x * .09));
    else { float t = clamp((sqrt(d2) - 1.) / uGround.y, 0., 1.); ih = -uGround.x * t * t * (3. - 2. * t); }
    h = max(h, ih);
  }
  return h;
}
// one white brush line, a constant few pixels wide whatever the slope of the beach
float foamLine(float d, float g, float wPx){
  return clamp(wPx - abs(d) / (g + 1e-6) + .5, 0., 1.);
}

// one layer of hand-drawn ripple marks; returns (dark stroke, white stroke)
vec2 strokes(vec2 p, float cell, float t, float pxWorld){
  vec2 cs = vec2(1.9, .56) * cell;
  // too small to draw from here, or (the big far-water marks) too close: nothing to work out
  if (pxWorld > cs.y * .42 || (cell > 1.5 && pxWorld < .021 * cell / 9.)) return vec2(0.);
  vec2 g = p / cs;
  float row = floor(g.y);
  g.x += hash12(vec2(row, 7.)) * 9. + t * .05 * (hash12(vec2(row, 3.)) - .5);
  vec2 id = vec2(floor(g.x), row);
  vec2 f = fract(g);
  float r = hash12(id);
  float r2 = hash12(id + 19.7);
  float len = .32 + .5 * r2;
  float x = (f.x - .5) / (len * .5);
  float ax = abs(x);
  // a little crest: flat arc with dipped ends
  float yc = .5 + (.2 * (1. - x * x) - .06) * (r > .5 ? 1. : .6);
  float d = abs(f.y - yc) * cs.y;
  float th = max(.021 * cell, pxWorld * .8);
  float aa = pxWorld * .9 + .0005;
  float line = (1. - smoothstep(th, th + aa, d)) * step(ax, 1.) * (1. - ax * ax * ax);
  float life = sin(t * (.35 + r * .5) + r * 40.) * .5 + .5;
  float on = step(.3, r2 + r * .3) * smoothstep(.1, .4, life);
  // strokes vanish when a cell is only a few pixels tall
  float vis = 1. - smoothstep(cs.y * .16, cs.y * .42, pxWorld);
  // the big far-water marks must not turn into fat bands up close
  if (cell > 1.5) vis *= smoothstep(.021 * cell / 9., .021 * cell / 4.5, pxWorld);
  line *= on * vis;
  return vec2(line * step(r, .72), line * step(.72, r));
}

// six directions, 30 degrees apart
const vec2 DIRS[6] = vec2[6](vec2(1., 0.), vec2(.866, .5), vec2(.5, .866), vec2(0., 1.), vec2(-.5, .866), vec2(-.866, .5));

void main(){
  // ink buffer: open water is id 0
  if (uPass == 1) { oColor = vec4(.5, .5, 0., 0.); return; }
  vec2 P = vWorld.xz + uDrift;
  float t = uTime;
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  float fres = pow(1. - max(V.y, 0.), 2.6);

  // washes: tone stepped by view angle, boundaries pushed around by slow noise
  float w1 = fbm(P * .2 + vec2(t * .045, t * .028));
  float w2 = vnoise(P * .85 + vec2(-t * .1, t * .07));
  float w = w1 * .72 + w2 * .28;
  float q = fres * 1.15 + (w - .5) * .55;
  vec3 deep = uWaterDeep;
  vec3 mid = uWaterMid;
  vec3 pale = uWaterPale;
  float s1 = smoothstep(.20, .215, q);
  float s2 = smoothstep(.44, .455, q);
  float s3 = smoothstep(.70, .715, q);
  vec3 body = mix(deep * .93, deep, s1);
  body = mix(body, mid, s2);
  body = mix(body, pale, s3);
  // wet edge on each wash boundary
  float rim = (s1 - smoothstep(.215, .26, q)) + (s2 - smoothstep(.455, .5, q)) + (s3 - smoothstep(.715, .76, q));
  body *= 1. - .05 * clamp(rim, 0., 1.);

  // reflection, dragged sideways by the ripples and broken into brush marks
  vec2 suv = gl_FragCoord.xy / uRes;
  float amp = .011 / (1. + dist * .045);
  vec4 rw = vnoise4(P * 1.7 + t * .2);
  suv.x += (rw.r - .5) * amp * 2.6 + (vnoise(P * 3.3 - t * .3) - .5) * amp * 1.4;
  suv.y += (rw.g - .5) * amp * 2.2;
  vec3 refl = uReflect > .5 ? texture(tRefl, suv).rgb : mix(uSkyLow, uSkyTop, .3);   // no mirrored pass: the water takes the sky
  float k = mix(.34, .94, smoothstep(.0, .75, fres));
  float gap = smoothstep(.6, .64, vnoise(P * 1.15 + vec2(t * .08, -t * .2)));
  k *= 1. - gap * .6;
  vec3 c = mix(body, mix(refl, body, .12), k);

  vec2 dPx = dFdx(P);
  vec2 dPy = dFdy(P);
  // shore: shallows and foam lines washing in
  float foam = 0.;
  float ground = groundAt(vWorld.xz);
  float depth = vWorld.y - ground;                      // metres of water here, under the surface as drawn
  if (depth < 2.) {                                     // within two metres of the surface: the rest is open water
    // depth per pixel, from the slope of the ground (no screen derivative: we are inside a branch)
    vec2 slope = vec2(groundAt(vWorld.xz + vec2(.25, 0.)) - ground, groundAt(vWorld.xz + vec2(0., .25)) - ground) * 4.;
    float gD = abs(dot(slope, dPx)) + abs(dot(slope, dPy)) + 1e-5;
    float nb = vnoise(P * .7 + 5.);
    float shallow = smoothstep(1.5, 1.38, depth + (nb - .5) * .7);
    c = mix(c, mix(c, ${glsl('#9fb7ae')} * uLight, .62), shallow);
    // sand showing through the last hand-depth of water
    c = mix(c, ${glsl('#c9cdb4')} * uLight, (1. - smoothstep(.0, .3, depth)) * .5);
    float lw = 1.25 * uSc;
    // the water's edge: one crisp white line that breathes in and out, a thin film behind it
    float edge = .06 + sin(t * .9 + nb * 9.) * .035;
    float lap = foamLine(depth - edge, gD, lw * 1.25) * smoothstep(.16, .34, vnoise(P * 3.1 + vec2(t * .1, 0.)));
    float film = (1. - smoothstep(-.02, .0, depth - edge)) * .5;
    // two or three lines of foam washing in behind it, broken like dry brush
    float ph = depth * 2.6 + t * .42 + (nb - .5) * 1.6;
    float dph = (fract(ph + .5) - .5) / 2.6;          // back in metres of depth, zero on each line
    float bandF = foamLine(dph, gD, lw) * (1. - smoothstep(.2, 1.25, depth)) * smoothstep(.08, .2, depth);
    bandF *= smoothstep(.34, .5, vnoise(P * 2.1 + vec2(t * .12, 0.)));
    foam = max(max(bandF, lap), film);
  }

  // wake + paddle rings, thresholded so the white breaks like dry brush
  vec2 wk = (vWorld.xz - uWakeRect.xy) / uWakeRect.z + .5;
  if (wk.x > 0. && wk.x < 1. && wk.y > 0. && wk.y < 1.) {
    float wv = texture(tWake, wk).r;
    foam = max(foam, smoothstep(.3, .38, wv * (.4 + 1.05 * vnoise(P * 2.2 + 2.)) * (.72 + .5 * vnoise(P * 8.5))));
  }

  // drawn ripple marks, three sizes so they carry to the horizon
  // (three world-anchored sets, 60 degrees apart; whichever lies across the view is drawn,
  //  so the marks stay level on the page whatever way the canoe points)
  vec2 st = vec2(0.);
  for (int k = 0; k < 6; k++) {
    vec2 along = DIRS[k];
    vec2 across = vec2(-along.y, along.x);
    float cv = abs(along.x * uView.y - along.y * uView.x);
    // the three big sets sit 60 degrees apart; the fine set near the camera has six, and only the one
    // lying squarely across the view is drawn, so the small marks never cross each other
    float wgt = mod(float(k), 2.) < .5 ? smoothstep(.6, .95, cv) : 0.;
    float fineW = smoothstep(.93, .985, cv) * uFine;
    if (wgt + fineW < .01) continue;
    vec2 Pr = vec2(dot(P, along), dot(P, across)) + float(k) * 19.3;
    float pxW = abs(dot(dPx, across)) + abs(dot(dPy, across)) + (abs(dot(dPx, along)) + abs(dot(dPy, along))) * .15;
    if (wgt > .01) st += wgt * (strokes(Pr, 1., t, pxW) + strokes(Pr + 31.7, 3.6, t * .8, pxW) + strokes(Pr + 77.1, 13., t * .6, pxW));
    if (fineW > .01) st += fineW * strokes(Pr + 11.3, .4, t * 1.1, pxW) * .7;
  }
  c = mix(c, uInkBlue, clamp(st.x, 0., 1.) * .72);
  c = mix(c, uFoam, clamp(st.y, 0., 1.) * .9);

  c = mix(c, uFoam, foam);
  // pigment granulation in the wash, drifting with the water
  c *= 1. + .05 * (vnoise(P * 6.5 + 3.) - .5) * (1. - smoothstep(12., 45., dist));

  float fog = 1. - exp(-dist * uFogDensity * 1.25);
  c = mix(c, uFogColor, fog);
  oColor = vec4(c, 1.);
}`;

const WAKE_SIZE = 56;

// The water mesh: a fine square of `cell`-metre cells round the subject (the waves live here), then
// rings that grow outward to the horizon (flat: the wave sum is faded out before the cells get coarse).
function waterGrid(cell, fineCells, rings, growth) {
  const half = [0];
  for (let i = 1; i <= fineCells; i++) half.push(i * cell);
  let step = cell;
  for (let i = 0; i < rings; i++) {
    step *= growth;
    half.push(half[half.length - 1] + step);
  }
  const offsets = [...half.slice(1).reverse().map((v) => -v), ...half];
  const n = offsets.length;
  const pos = new Float32Array(n * n * 3);
  let k = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    pos[k++] = offsets[i];
    pos[k++] = 0;
    pos[k++] = offsets[j];
  }
  const idx = [];
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i;
    idx.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

export function createWater(reflectionTexture, resolution) {
  // --- wake target: white strokes drawn top-down, sampled by the water shader ---
  const wakeRT = new THREE.WebGLRenderTarget(1024, 1024, {
    depthBuffer: false,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });
  const wakeRect = new THREE.Vector3(0, 0, WAKE_SIZE);
  const wakeScene = new THREE.Scene();
  const wakeCam = new THREE.Camera();
  const wakeMatOpts = {
    uniforms: { uRect: { value: wakeRect }, uAlpha: { value: 1 } },
    vertexShader: /* glsl */ `
      uniform vec3 uRect;
      varying float vA; varying vec2 vUv;
      void main(){
        vec4 wp = modelMatrix * vec4(position.x, 0., position.z, 1.);
        vA = position.y; vUv = uv;
        gl_Position = vec4((wp.xz - uRect.xy) / uRect.z * 2., 0., 1.);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uAlpha;
      varying float vA; varying vec2 vUv;
      void main(){
        float prof = 1. - abs(vUv.y * 2. - 1.);
        gl_FragColor = vec4(vec3(vA * uAlpha * smoothstep(0., .5, prof)), 1.);
      }`,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendEquation: THREE.MaxEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
  };

  // ribbons: 2 outer arms, 2 inner arms, 1 centre trail
  const N = 150;
  const RIBBONS = [
    { side: -1, spread: 1.0, w: 0.05, gain: 1.0 },
    { side: 1, spread: 1.0, w: 0.05, gain: 1.0 },
    { side: 0, spread: 0, w: 0.18, gain: 0.4 },
  ];
  const samples = []; // {x,z,px,pz,v,age}
  const ribbonMat = new THREE.ShaderMaterial(wakeMatOpts);
  const ribbons = RIBBONS.map((def) => {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 2 * 3);
    const uv = new Float32Array(N * 2 * 2);
    const idx = [];
    for (let i = 0; i < N - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    for (let i = 0; i < N; i++) {
      uv[i * 4 + 1] = 0;
      uv[i * 4 + 3] = 1;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, ribbonMat);
    mesh.frustumCulled = false;
    wakeScene.add(mesh);
    return { def, geo, pos };
  });

  // paddle rings, and the chevron arcs the hull leaves behind it
  const band = (inner, start, len) => {
    const g = new THREE.RingGeometry(inner, 1, 28, 1, start, len);
    g.rotateX(-Math.PI / 2);
    const uv = g.attributes.uv;
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const rr = Math.hypot(p.getX(i), p.getZ(i));
      uv.setXY(i, 0, (rr - inner) / (1 - inner)); // v across the band for the soft profile
      p.setY(i, 1); // alpha rides in y
    }
    return g;
  };
  const ringGeo = band(0.86, 0, Math.PI * 2);
  const arcGeo = band(0.9, Math.PI * 0.2, Math.PI * 0.6); // opens toward the bow, bulges astern
  const rings = [];
  for (let i = 0; i < 14; i++) {
    const mat = new THREE.ShaderMaterial({ ...wakeMatOpts, uniforms: { uRect: { value: wakeRect }, uAlpha: { value: 0 } } });
    const mesh = new THREE.Mesh(ringGeo, mat);
    mesh.frustumCulled = false;
    mesh.visible = false;
    wakeScene.add(mesh);
    rings.push({ mesh, mat, age: 99, life: 1, r0: 0.1, r1: 1 });
  }
  let ringNext = 0;
  const arcs = [];
  for (let i = 0; i < 12; i++) {
    const mat = new THREE.ShaderMaterial({ ...wakeMatOpts, uniforms: { uRect: { value: wakeRect }, uAlpha: { value: 0 } } });
    const mesh = new THREE.Mesh(arcGeo, mat);
    mesh.frustumCulled = false;
    mesh.visible = false;
    wakeScene.add(mesh);
    arcs.push({ mesh, mat, age: 99, k: 1 });
  }
  let arcNext = 0;
  let arcAcc = 0;

  const vec4s = () => Array.from({ length: SHORE_ISLANDS }, () => new THREE.Vector4(0, 0, 1, 1));
  const uniforms = {
    tRefl: { value: reflectionTexture },
    tWake: { value: wakeRT.texture },
    uRes: { value: resolution },
    uDrift: { value: new THREE.Vector2() },
    uView: { value: new THREE.Vector2(0, 1) },
    uWakeRect: { value: wakeRect },
    uIsleA: { value: vec4s() },
    uIsleB: { value: vec4s().map((v) => v.set(1, 0, -1, 0)) },
    uValley: { value: new THREE.Vector4(1e5, 0, 1e5, -1e5) },
    uValleyZ: { value: 0 },
    uGround: { value: new THREE.Vector4(6, 0.6, 0.9, 0.35) },
    uReflect: { value: 1 },
    uTime: GU.uTime,
    uPass: GU.uPass,
    uFine: GU.uFine,
    uSc: GU.uSc,
    uFogDensity: GU.uFogDensity,
    uFogColor: GU.uFogColor,
    tNoise: GU.tNoise,
    uWaterDeep: GU.uWaterDeep,
    uWaterMid: GU.uWaterMid,
    uWaterPale: GU.uWaterPale,
    uInkBlue: GU.uInkBlue,
    uFoam: GU.uFoam,
    uLight: GU.uLight,
    uSkyTop: GU.uSkyTop,
    uSkyLow: GU.uSkyLow,
    uWave: GU.uWave,
    uRegion: GU.uRegion,
    uWaveArea: GU.uWaveArea,
    uRegionBlend: GU.uRegionBlend,
    uStorm: GU.uStorm,
  };
  let cell = 1;
  const mesh = new THREE.Mesh(
    waterGrid(1, 48, 24, 1.3),
    new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms,
      // the surface is the rules engine's wave sum, so the canoe sits on the water that is drawn
      vertexShader: /* glsl */ `
        ${WAVES}
        out vec3 vWorld;
        void main(){ vec4 wp = modelMatrix * vec4(position, 1.); wp.y = waveSurface(wp.xz); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: FRAG,
    })
  );
  mesh.frustumCulled = false;
  mesh.renderOrder = 5; // after everything that floats or stands in it: no water is painted under the canoe or the island

  let emitAcc = 0;
  let emitN = 0;
  const LIFE = 5.5;

  return {
    mesh,
    uniforms,
    // cellSize: metres between vertices where the waves are drawn (the water detail setting)
    setDetail(cellSize) {
      if (cellSize === cell) return;
      cell = cellSize;
      mesh.geometry.dispose();
      mesh.geometry = waterGrid(cell, Math.round(48 / cell), 24, 1.3);
    },
    get cell() {
      return cell;
    },
    ring(x, z, strength = 1, size = 1) {
      const r = rings[ringNext++ % rings.length];
      r.age = 0;
      r.life = 2.6 * size;
      r.r0 = 0.12 * size;
      r.r1 = 0.85 * size;
      r.strength = strength;
      r.mesh.position.set(x, 0, z);
      r.mesh.visible = true;
    },
    // bow position, heading (unit fx,fz), speed; drift = treadmill velocity applied to old samples
    update(dt, bowX, bowZ, fx, fz, speed, driftX = 0, driftZ = 0, halfBeam = 0.2) {
      for (const s of samples) {
        s.age += dt;
        s.x += driftX * dt;
        s.z += driftZ * dt;
      }
      while (samples.length && samples[samples.length - 1].age > LIFE) samples.pop();
      emitAcc += dt;
      if (emitAcc > 0.05) {
        emitAcc = 0;
        samples.unshift({ x: bowX, z: bowZ, px: -fz, pz: fx, v: Math.abs(speed), age: 0, hb: halfBeam, j: Math.sin(emitN++ * 1.9) * 0.5 + Math.sin(emitN * 0.61) * 0.5, d: Math.sin(emitN * 0.31) * Math.sin(emitN * 0.113 + 1) });
        if (samples.length > N) samples.pop();
      }
      for (const rb of ribbons) {
        const { def, pos } = rb;
        const n = samples.length;
        for (let i = 0; i < N; i++) {
          // unused tail vertices collapse onto the oldest sample (zero area, zero alpha)
          const s = samples[Math.min(i, n - 1)];
          let a = 0;
          let cx = bowX;
          let cz = bowZ;
          let px = -fz;
          let pz = fx;
          let w = def.w;
          if (s) {
            const k = 1 - s.age / LIFE;
            const vk = Math.min(1, s.v / 1.4);
            a = Math.max(0, k) ** 1.1 * vk * def.gain * Math.min(1, s.age * 3 + 0.25);
            if (def.side !== 0) a *= 0.62 + 0.38 * Math.min(1, Math.max(0, s.d * def.side * 2.2 + 0.75)); // long strokes with gaps, not rails
            const off = def.side * (s.hb + s.age * (0.2 + 0.2 * s.v) * def.spread + s.j * 0.05 * Math.min(1, s.age)) * (def.spread ? 1 : 0);
            cx = s.x + s.px * off;
            cz = s.z + s.pz * off;
            px = s.px;
            pz = s.pz;
            w = def.w + s.age * (def.side === 0 ? 0.05 : 0.012);
            if (def.side === 0) a *= Math.min(1, Math.max(0, s.age - 1.5) * 0.7); // trail starts behind the stern
            if (i >= n) a = 0;
          }
          const o = i * 6;
          pos[o] = cx - px * w;
          pos[o + 1] = a;
          pos[o + 2] = cz - pz * w;
          pos[o + 3] = cx + px * w;
          pos[o + 4] = a;
          pos[o + 5] = cz + pz * w;
        }
        rb.geo.attributes.position.needsUpdate = true;
      }
      for (const r of rings) {
        if (!r.mesh.visible) continue;
        r.age += dt;
        r.mesh.position.x += driftX * dt;
        r.mesh.position.z += driftZ * dt;
        const k = r.age / r.life;
        if (k >= 1) {
          r.mesh.visible = false;
          continue;
        }
        const rad = r.r0 + (r.r1 - r.r0) * Math.sqrt(k);
        r.mesh.scale.set(rad, 1, rad);
        r.mat.uniforms.uAlpha.value = (1 - k) ** 1.2 * r.strength;
      }
      // chevrons dropped astern every half metre or so
      arcAcc += Math.abs(speed) * dt;
      if (arcAcc > 0.62 && Math.abs(speed) > 0.4) {
        arcAcc = 0;
        const a = arcs[arcNext++ % arcs.length];
        a.age = 0;
        a.k = Math.min(1, Math.abs(speed) / 1.5);
        a.mesh.position.set(bowX - fx * 5.15, 0, bowZ - fz * 5.15);
        a.mesh.rotation.y = Math.atan2(fx, fz);
        a.mesh.visible = true;
      }
      for (const a of arcs) {
        if (!a.mesh.visible) continue;
        a.age += dt;
        a.mesh.position.x += driftX * dt;
        a.mesh.position.z += driftZ * dt;
        const k = a.age / 4.2;
        if (k >= 1) {
          a.mesh.visible = false;
          continue;
        }
        const rad = 0.42 + 1.5 * Math.sqrt(k);
        a.mesh.scale.set(rad, 1, rad * 0.8);
        a.mat.uniforms.uAlpha.value = Math.sin(Math.min(1, k * 4) * Math.PI * 0.5) * (1 - k) ** 1.3 * 0.85 * a.k;
      }
      wakeRect.x = bowX;
      wakeRect.y = bowZ;
    },
    // centre the fine water on the subject, snapped to the grid so its vertices never swim
    follow(camera, x, z) {
      const ox = Math.round(x / cell) * cell;
      const oz = Math.round(z / cell) * cell;
      mesh.position.set(ox, 0, oz);
      GU.uWaveArea.value.set(ox, oz, 34, 46);
      const e = camera.matrixWorld.elements; // camera looks down its -z
      const l = Math.hypot(e[8], e[10]) || 1;
      uniforms.uView.value.set(-e[8] / l, -e[10] / l);
    },
    renderWake(renderer) {
      renderer.setRenderTarget(wakeRT);
      renderer.setClearColor(0x000000, 1);
      renderer.clear();
      renderer.render(wakeScene, wakeCam);
    },
    dispose() {
      wakeRT.dispose();
      mesh.geometry.dispose();
      mesh.material.dispose();
    },
  };
}

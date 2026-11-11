// Ink & Wash — water. Flat washes stepped toward the horizon, drawn ripple strokes,
// brush-broken reflections, white ink foam at the shore and in the wake.
import * as THREE from 'three';
import { PAL, GU, NOISE, glsl } from './palette.js';

const FRAG = /* glsl */ `
precision highp float;
in vec3 vWorld;
layout(location = 0) out vec4 oColor;
layout(location = 1) out vec4 oAux;
uniform sampler2D tRefl, tWake, tShore;
uniform vec2 uRes, uDrift, uView;
uniform vec3 uWakeRect;   // centre x, centre z, size
uniform vec4 uShoreRect;  // centre x, centre z, size x, size z
uniform float uTime, uFogDensity;
uniform vec3 uFogColor;
${NOISE}

// one layer of hand-drawn ripple marks; returns (dark stroke, white stroke)
vec2 strokes(vec2 p, float cell, float t, float pxWorld){
  vec2 cs = vec2(1.9, .56) * cell;
  if (pxWorld > cs.y * .42) return vec2(0.);
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

void main(){
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
  vec3 deep = ${glsl(PAL.waterDeep)};
  vec3 mid = ${glsl(PAL.waterMid)};
  vec3 pale = ${glsl(PAL.waterPale)};
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
  vec3 refl = texture(tRefl, suv).rgb;
  float k = mix(.34, .94, smoothstep(.0, .75, fres));
  float gap = smoothstep(.6, .64, vnoise(P * 1.15 + vec2(t * .08, -t * .2)));
  k *= 1. - gap * .6;
  vec3 c = mix(body, mix(refl, body, .12), k);

  // shore: shallows and foam lines washing in
  float foam = 0.;
  vec2 sh = (vWorld.xz - uShoreRect.xy) / uShoreRect.zw + .5;
  if (sh.x > 0. && sh.x < 1. && sh.y > 0. && sh.y < 1.) {
    float depth = 3. - texture(tShore, sh).r * 4.;   // metres below the surface
    float nb = vnoise(P * .7 + 5.);
    float shallow = smoothstep(1.5, 1.38, depth + (nb - .5) * .7);
    c = mix(c, mix(c, ${glsl('#9fb7ae')}, .62), shallow);
    float ph = depth * 2.6 + t * .42 + (nb - .5) * 1.6;
    float bandF = smoothstep(.80, .86, fract(ph)) * (1. - smoothstep(.2, 1.25, depth));
    bandF *= smoothstep(.3, .46, vnoise(P * 2.1 + vec2(t * .12, 0.)));
    float lap = 1. - smoothstep(.07, .12, depth + sin(t * .9 + nb * 9.) * .035);
    foam = max(bandF, lap);
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
  vec2 dPx = dFdx(P);
  vec2 dPy = dFdy(P);
  vec2 st = vec2(0.);
  for (int k = 0; k < 3; k++) {
    float ang = float(k) * 1.0472;
    vec2 along = vec2(cos(ang), sin(ang));
    vec2 across = vec2(-along.y, along.x);
    float wgt = smoothstep(.6, .95, abs(along.x * uView.y - along.y * uView.x));
    if (wgt < .01) continue;
    vec2 Pr = vec2(dot(P, along), dot(P, across)) + float(k) * 19.3;
    float pxW = abs(dot(dPx, across)) + abs(dot(dPy, across)) + (abs(dot(dPx, along)) + abs(dot(dPy, along))) * .15;
    st += wgt * (strokes(Pr, 1., t, pxW) + strokes(Pr + 31.7, 3.6, t * .8, pxW) + strokes(Pr + 77.1, 13., t * .6, pxW));
  }
  c = mix(c, ${glsl(PAL.inkBlue)}, clamp(st.x, 0., 1.) * .72);
  c = mix(c, ${glsl(PAL.foam)}, clamp(st.y, 0., 1.) * .9);

  c = mix(c, ${glsl(PAL.foam)}, foam);

  float fog = 1. - exp(-dist * uFogDensity * 1.25);
  c = mix(c, uFogColor, fog);
  oColor = vec4(c, 1.);
  oAux = vec4(.5, .5, 0., 0.);
}`;

const WAKE_SIZE = 56;

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

  // --- shore map placeholder (island module fills it) ---
  const shoreTex = new THREE.DataTexture(new Uint8Array([0]), 1, 1, THREE.RedFormat);
  shoreTex.needsUpdate = true;

  const uniforms = {
    tRefl: { value: reflectionTexture },
    tWake: { value: wakeRT.texture },
    tShore: { value: shoreTex },
    uRes: { value: resolution },
    uDrift: { value: new THREE.Vector2() },
    uView: { value: new THREE.Vector2(0, 1) },
    uWakeRect: { value: wakeRect },
    uShoreRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    uTime: GU.uTime,
    uFogDensity: GU.uFogDensity,
    uFogColor: GU.uFogColor,
    tNoise: GU.tNoise,
  };
  const geo = new THREE.PlaneGeometry(5000, 5000);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms,
      vertexShader: /* glsl */ `
        out vec3 vWorld;
        void main(){ vec4 wp = modelMatrix * vec4(position, 1.); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: FRAG,
    })
  );
  mesh.frustumCulled = false;

  let emitAcc = 0;
  let emitN = 0;
  const LIFE = 5.5;

  return {
    mesh,
    uniforms,
    setShore(texture, cx, cz, sx, sz) {
      uniforms.tShore.value = texture;
      uniforms.uShoreRect.value.set(cx, cz, sx, sz);
    },
    // Gentle swell the canoe rides on (the surface itself is painted flat).
    swell(x, z, t) {
      return (
        Math.sin(x * 0.55 + t * 1.1) * 0.035 +
        Math.sin(z * 0.8 - t * 1.45 + x * 0.2) * 0.03 +
        Math.sin((x + z) * 1.7 + t * 2.1) * 0.012
      );
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
    follow(camera) {
      mesh.position.set(camera.position.x, 0, camera.position.z);
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
  };
}

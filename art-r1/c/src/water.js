// Dark glossy water: swell, planar reflection, fresnel, shoreline foam, lantern glitter, ripples, wake.
import * as THREE from 'three';
import { ATMOSPHERE_GLSL, PAL } from './palette.js';
import { mulberry32 } from './util.js';

// Gentle swell. [dirX, dirZ, wavenumber, amplitude m, angular speed, phase]. JS and GLSL share this table.
const SWELL = [
  [0.85, 0.53, 0.26, 0.075, 0.95, 0.0],
  [-0.48, 0.88, 0.37, 0.05, 1.2, 1.3],
  [0.88, -0.47, 0.6, 0.028, 1.75, 4.1],
  [0.2, 0.98, 0.95, 0.014, 2.3, 2.2],
];

/** Water surface height at a world point. Matches the vertex shader near the camera. */
export function waveHeight(x, z, time) {
  let h = 0;
  for (const [dx, dz, k, amp, speed, phase] of SWELL) h += amp * Math.sin(k * (dx * x + dz * z) + speed * time + phase);
  return h;
}

const f = (n) => n.toFixed(4);
const SWELL_GLSL = `
float swellH(vec2 p, float t) {
  float h = 0.0;
${SWELL.map(([dx, dz, k, amp, speed, phase]) => `  h += ${f(amp)} * sin(dot(p, vec2(${f(dx * k)}, ${f(dz * k)})) + t * ${f(speed)} + ${f(phase)});`).join('\n')}
  return h;
}
vec2 swellGrad(vec2 p, float t) {
  vec2 g = vec2(0.0);
${SWELL.map(([dx, dz, k, amp, speed, phase]) => `  g += ${f(amp)} * cos(dot(p, vec2(${f(dx * k)}, ${f(dz * k)})) + t * ${f(speed)} + ${f(phase)}) * vec2(${f(dx * k)}, ${f(dz * k)});`).join('\n')}
  return g;
}`;

const linear = (hex) => {
  const c = new THREE.Color(hex);
  return `vec3(${c.r.toFixed(5)}, ${c.g.toFixed(5)}, ${c.b.toFixed(5)})`;
};
const FOAM_LIT = 'vec3(0.30, 0.35, 0.68)'; // white foam under blue-hour skylight

/** Tileable ripple field. RG = slope, B = height. Built from integer-frequency sines so it wraps. */
function makeRippleTexture(size = 256) {
  const random = mulberry32(7);
  const waves = [];
  for (let i = 0; i < 30; i++) {
    let kx = Math.round((random() * 2 - 1) * 9), ky = Math.round((random() * 2 - 1) * 9);
    if (!kx && !ky) kx = 2;
    const k = Math.hypot(kx, ky);
    waves.push([kx, ky, (0.5 + random()) / Math.pow(k, 1.3), random() * Math.PI * 2]);
  }
  const gx = new Float32Array(size * size), gy = new Float32Array(size * size), hh = new Float32Array(size * size);
  let gMax = 0, hMax = 0;
  const TAU = Math.PI * 2;
  for (const [kx, ky, amp, phase] of waves) {
    // each wave only needs sin/cos per row and column
    for (let y = 0; y < size; y++) {
      const py = (TAU * ky * y) / size + phase;
      for (let x = 0; x < size; x++) {
        const angle = (TAU * kx * x) / size + py;
        const c = Math.cos(angle) * amp, i = y * size + x;
        gx[i] += c * kx;
        gy[i] += c * ky;
        hh[i] += Math.sin(angle) * amp;
      }
    }
  }
  for (let i = 0; i < size * size; i++) {
    gMax = Math.max(gMax, Math.abs(gx[i]), Math.abs(gy[i]));
    hMax = Math.max(hMax, Math.abs(hh[i]));
  }
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = Math.round((gx[i] / gMax) * 127.5 + 127.5);
    data[i * 4 + 1] = Math.round((gy[i] / gMax) * 127.5 + 127.5);
    data[i * 4 + 2] = Math.round((hh[i] / hMax) * 127.5 + 127.5);
    data[i * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/** Polar grid: dense under the camera, stretching to the horizon. */
function radialGrid(rings = 112, segments = 160, inner = 0.5, outer = 4200) {
  const positions = [0, 0, 0], indices = [];
  for (let r = 0; r < rings; r++) {
    const radius = inner * Math.pow(outer / inner, r / (rings - 1));
    for (let s = 0; s < segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      positions.push(Math.cos(a) * radius, 0, Math.sin(a) * radius);
    }
  }
  for (let s = 0; s < segments; s++) indices.push(0, 1 + ((s + 1) % segments), 1 + s);
  for (let r = 0; r < rings - 1; r++) {
    for (let s = 0; s < segments; s++) {
      const a = 1 + r * segments + s, b = 1 + r * segments + ((s + 1) % segments);
      const c = a + segments, d = b + segments;
      indices.push(a, b, c, b, d, c);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

const MAX_RIPPLES = 8;

export function createWater(renderer, scene, shore) {
  const ripples = makeRippleTexture();
  const reflection = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
  const mirror = new THREE.PerspectiveCamera();
  const textureMatrix = new THREE.Matrix4();

  const uniforms = {
    uTime: { value: 0 },
    uRipple: { value: ripples },
    uRefl: { value: reflection.texture },
    uReflOn: { value: 1 },
    uTexMatrix: { value: textureMatrix },
    uShore: { value: shore.texture },
    uShoreRect: { value: new THREE.Vector3(shore.x, shore.z, shore.half) },
    uFog: { value: 1 },
    uLightPos: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
    uLightCol: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
    uRings: { value: Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4(0, 0, 0, 0)) },
    uCanoe: { value: new THREE.Vector4(0, 0, 1, 0) }, // x, z, cos(heading), sin(heading)
    uHull: { value: new THREE.Vector4(2.4, 0.47, 0, 0) }, // half length, half beam, float offset (0 = none), speed
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform mat4 uTexMatrix;
      varying vec3 vW;
      varying vec4 vRefl;
      ${SWELL_GLSL}
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        float d = distance(w.xz, cameraPosition.xz);
        w.y = swellH(w.xz, uTime) * smoothstep(700.0, 120.0, d);
        vW = w.xyz;
        vRefl = uTexMatrix * vec4(w.x, 0.0, w.z, 1.0);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uReflOn, uFog;
      uniform sampler2D uRipple, uRefl, uShore;
      uniform vec3 uShoreRect;
      uniform vec3 uLightPos[3];
      uniform vec3 uLightCol[3];
      uniform vec4 uRings[${MAX_RIPPLES}];
      uniform vec4 uCanoe, uHull;
      varying vec3 vW;
      varying vec4 vRefl;
      ${ATMOSPHERE_GLSL}
      ${SWELL_GLSL}
      const vec3 DEEP = ${linear(PAL.waterDeep)};
      const vec3 BODY = ${linear(PAL.waterBody)};
      const vec3 SHALLOW = ${linear(PAL.waterShallow)};

      float hullWash(vec2 q, vec2 halfSize, float n) {
        float e = length(q / halfSize);
        return smoothstep(1.2, 1.04, e) * smoothstep(0.86, 1.0, e) * (0.2 + n);
      }

      void main() {
        vec3 toCam = cameraPosition - vW;
        float dist = length(toCam);
        vec3 V = toCam / dist;
        vec2 P = vW.xz;
        float near = 1.0 / (1.0 + dist * 0.016);

        // --- surface slope: swell + three scrolling ripple layers, calmer in the lulls between gusts
        vec2 g = swellGrad(P, uTime);
        vec3 r1 = texture2D(uRipple, P * 0.150 + uTime * vec2(0.023, 0.014)).xyz;
        vec3 r2 = texture2D(uRipple, P * 0.046 - uTime * vec2(0.010, 0.016)).xyz;
        vec3 r3 = texture2D(uRipple, P * 0.0105 + uTime * vec2(0.003, -0.002)).xyz;
        float gust = smoothstep(0.3, 0.72, r3.z);
        g += ((r1.xy * 2.0 - 1.0) * 0.15 + (r2.xy * 2.0 - 1.0) * 0.24) * mix(0.4, 1.2, gust) * mix(0.45, 1.0, near);

        // --- expanding rings from paddle strokes (only the water near the canoe pays for these)
        vec2 rel = P - uCanoe.xy;
        float fromCanoe = dot(rel, rel);
        bool nearCanoe = fromCanoe < 600.0;
        float ringFoam = 0.0;
        if (fromCanoe < 200.0) for (int i = 0; i < ${MAX_RIPPLES}; i++) {
          vec4 ring = uRings[i];
          if (ring.w <= 0.0) continue;
          vec2 dv = P - ring.xy;
          float d = length(dv);
          float x = d - (0.2 + ring.z * 0.85);
          float env = exp(-x * x * 2.6) * ring.w * exp(-ring.z * 0.6);
          g += (dv / max(d, 1e-3)) * cos(x * 6.5) * env * 0.55;
          ringFoam += smoothstep(0.75, 1.0, cos(x * 6.5)) * env * step(ring.z, 1.4);
        }

        // --- shore: baked terrain height gives depth for foam and the shallows tint
        vec2 suv = (P - uShoreRect.xy) / (uShoreRect.z * 2.0) + 0.5;
        float inside = step(0.0, suv.x) * step(suv.x, 1.0) * step(0.0, suv.y) * step(suv.y, 1.0);
        float ground = mix(-8.0, texture2D(uShore, suv).r, inside);
        float depth = vW.y - ground;

        vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
        float ndv = max(dot(N, V), 0.0);
        float fresnel = 0.06 + 0.94 * pow(1.0 - ndv, 4.2);

        // --- planar reflection, smeared along the view direction like real glitter paths
        vec2 vd = normalize(P - cameraPosition.xz);
        float along = dot(N.xz, vd), across = dot(N.xz, vec2(-vd.y, vd.x));
        vec2 ruv = vRefl.xy / vRefl.w + vec2(across * 0.07, along * 0.3) * mix(0.3, 1.0, near);
        vec3 refl = texture2D(uRefl, ruv).rgb;
        vec3 R = reflect(-V, N);
        R.y = abs(R.y);
        refl = mix(bhSky(R), refl, uReflOn);

        vec3 body = mix(DEEP, BODY, 0.55 + 0.45 * gust);
        float shallows = smoothstep(2.6, 0.0, depth);
        body = mix(body, SHALLOW, shallows * 0.5);
        vec3 col = mix(body, refl, fresnel);

        // --- warm light pooling: glitter from each lamp plus a soft scattered pool
        vec3 warm = vec3(0.0);
        if (nearCanoe) for (int i = 0; i < 3; i++) {
          vec3 Lv = uLightPos[i] - vW;
          float dl = length(Lv);
          vec3 L = Lv / dl;
          float spec = pow(max(dot(N, normalize(L + V)), 0.0), 110.0);
          float att = 1.0 / (1.0 + dl * dl * 0.05);
          col += uLightCol[i] * (spec * 2.6 * att + 0.022 * att);
          warm += uLightCol[i] * att;
        }

        // --- foam: a bright lapping edge, drifting lines in the shallows, wash off the hull, rings
        float n1 = r1.z, n2 = r2.z;
        // a thin bright lip right at the rock, then sparse lines drifting in over the shallows
        float lap = (0.03 + 0.025 * sin(uTime * 0.9 + P.x * 0.6 + P.y * 0.4)) * (1.0 + dist * 0.07); // widens with distance so the shore still reads from the canoe
        float edge = smoothstep(lap * 2.4, lap, depth) * (0.45 + n1 * 0.95);
        float lines = smoothstep(0.9, 0.99, sin(depth * 9.0 + uTime * 1.1 + n2 * 7.0)) * smoothstep(1.1, 0.25, depth) * smoothstep(0.35, 0.7, n1);
        float foam = (edge + lines * 0.75) * inside * step(-0.2, depth);

        if (fromCanoe < 64.0) {
          vec2 q = vec2(rel.x * uCanoe.z - rel.y * uCanoe.w, rel.x * uCanoe.w + rel.y * uCanoe.z);
          float wash = hullWash(q, uHull.xy, n1);
          if (uHull.z > 0.0) {
            wash += hullWash(q - vec2(0.0, uHull.z), vec2(2.15, 0.27), n1) + hullWash(q + vec2(0.0, uHull.z), vec2(2.15, 0.27), n1);
          }
          foam += wash * (0.12 + uHull.w * 0.42) + ringFoam * 0.55;
        }
        foam = smoothstep(0.38, 0.85, foam);
        col = mix(col, ${FOAM_LIT} + warm * 0.35, foam * 0.86);

        col = mix(col, bhHorizon(-V), bhFog(cameraPosition, -toCam, uFog));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });

  const mesh = new THREE.Mesh(radialGrid(), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.layers.set(1); // never drawn into its own reflection
  scene.add(mesh);

  // --- planar reflection camera (mirror about y = 0, oblique near plane clips what is under water)
  const _camPos = new THREE.Vector3(), _look = new THREE.Vector3(), _rot = new THREE.Matrix4();
  const _plane = new THREE.Plane(), _clip = new THREE.Vector4(), _q = new THREE.Vector4();
  const UP = new THREE.Vector3(0, 1, 0);

  function renderReflection(camera) {
    _camPos.setFromMatrixPosition(camera.matrixWorld);
    _rot.extractRotation(camera.matrixWorld);
    _look.set(0, 0, -1).applyMatrix4(_rot).add(_camPos);
    mirror.position.set(_camPos.x, -_camPos.y, _camPos.z);
    mirror.up.set(0, 1, 0).applyMatrix4(_rot);
    mirror.up.y *= -1;
    mirror.lookAt(_look.x, -_look.y, _look.z);
    mirror.far = camera.far;
    mirror.near = camera.near;
    mirror.updateMatrixWorld();
    mirror.matrixWorldInverse.copy(mirror.matrixWorld).invert();
    mirror.projectionMatrix.copy(camera.projectionMatrix);

    textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    textureMatrix.multiply(mirror.projectionMatrix).multiply(mirror.matrixWorldInverse);

    _plane.setFromNormalAndCoplanarPoint(UP, _look.set(0, 0.02, 0)).applyMatrix4(mirror.matrixWorldInverse);
    _clip.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);
    const p = mirror.projectionMatrix.elements;
    _q.set((Math.sign(_clip.x) + p[8]) / p[0], (Math.sign(_clip.y) + p[9]) / p[5], -1, (1 + p[10]) / p[14]);
    _clip.multiplyScalar(2 / _clip.dot(_q));
    p[2] = _clip.x;
    p[6] = _clip.y;
    p[10] = _clip.z + 1;
    p[14] = _clip.w;
    mirror.projectionMatrixInverse.copy(mirror.projectionMatrix).invert();

    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(reflection);
    renderer.render(scene, mirror);
    renderer.setRenderTarget(previous);
  }

  let ringCursor = 0;
  return {
    mesh,
    uniforms,
    renderReflection,
    setSize(width, height) {
      reflection.setSize(Math.max(2, Math.round(width * 0.45)), Math.max(2, Math.round(height * 0.45)));
    },
    addRing(x, z, strength = 1) {
      uniforms.uRings.value[ringCursor].set(x, z, 0, strength);
      ringCursor = (ringCursor + 1) % MAX_RIPPLES;
    },
    update(time, dt, camera) {
      uniforms.uTime.value = time;
      mesh.position.set(camera.position.x, 0, camera.position.z);
      for (const ring of uniforms.uRings.value) {
        if (ring.w <= 0) continue;
        ring.z += dt;
        if (ring.z > 6) ring.w = 0;
      }
    },
    rippleTexture: ripples,
  };
}

/** Foam ribbon laid down behind the canoe: two spreading arms and a churned centre that fade with age. */
export function createWake(scene, rippleTexture) {
  const SEGMENTS = 90, LIFE = 9;
  const trail = []; // newest first: { x, z, px, pz, born, speed, width }
  const positions = new Float32Array(SEGMENTS * 2 * 3), across = new Float32Array(SEGMENTS * 2), age = new Float32Array(SEGMENTS * 2);
  const indices = [];
  for (let i = 0; i < SEGMENTS - 1; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  for (let i = 0; i < SEGMENTS; i++) {
    across[i * 2] = -1;
    across[i * 2 + 1] = 1;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aAcross', new THREE.BufferAttribute(across, 1));
  geometry.setAttribute('aAge', new THREE.BufferAttribute(age, 1).setUsage(THREE.DynamicDrawUsage));
  geometry.setIndex(indices);

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -6,
    uniforms: { uTime: { value: 0 }, uRipple: { value: rippleTexture }, uFog: { value: 1 }, uWarm: { value: new THREE.Vector3() }, uLamp: { value: new THREE.Vector3() } },
    vertexShader: /* glsl */ `
      attribute float aAcross, aAge;
      varying float vAcross, vAge;
      varying vec3 vW;
      void main() {
        vAcross = aAcross;
        vAge = aAge;
        vW = position;
        gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uFog;
      uniform sampler2D uRipple;
      uniform vec3 uWarm, uLamp;
      varying float vAcross, vAge;
      varying vec3 vW;
      ${ATMOSPHERE_GLSL}
      void main() {
        float n1 = texture2D(uRipple, vW.xz * 0.37 + uTime * vec2(0.02, 0.011)).z;
        float n2 = texture2D(uRipple, vW.xz * 0.12 - uTime * vec2(0.012, 0.017)).z;
        float a = abs(vAcross);
        float life = 1.0 - vAge;
        float outer = exp(-pow((a - 0.92) / 0.034, 2.0));
        float inner = exp(-pow((a - 0.55) / 0.04, 2.0)) * 0.4;
        float arms = (outer + inner) * (0.3 + 0.7 * smoothstep(0.25, 0.7, n1)) * smoothstep(0.0, 0.2, life) * (0.35 + 0.65 * life);
        float churn = smoothstep(0.5, 0.0, a) * smoothstep(0.45, 0.8, n2) * pow(life, 4.0) * 1.4;
        float foam = clamp(arms + churn, 0.0, 1.0);
        vec3 off = vW - cameraPosition;
        float dl = distance(uLamp, vW);
        vec3 col = ${FOAM_LIT} + uWarm * 0.35 / (1.0 + dl * dl * 0.05);
        col = mix(col, bhHorizon(off), bhFog(cameraPosition, off, uFog));
        gl_FragColor = vec4(col, foam * 0.46);
      }`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  mesh.layers.set(1);
  scene.add(mesh);

  let headWidth = 0.5;
  const write = (index, point, time, height) => {
    const pointAge = time - point.born;
    const width = point.width + pointAge * (0.16 + point.speed * 0.3);
    const y = height(point.x, point.z) + 0.035;
    positions.set([point.x - point.px * width, y, point.z - point.pz * width, point.x + point.px * width, y, point.z + point.pz * width], index * 6);
    age[index * 2] = age[index * 2 + 1] = Math.min(pointAge / LIFE, 1);
  };

  return {
    mesh,
    material,
    setWidth(width) { headWidth = width; },
    /** Shift the whole trail (used when a shot loops the canoe back). */
    shift(dx, dz) { for (const point of trail) { point.x += dx; point.z += dz; } },
    clear() { trail.length = 0; },
    /** Lay a straight wake behind a canoe that is already under way. */
    prewarm(x, z, heading, speed, time) {
      trail.length = 0;
      const fx = Math.cos(heading), fz = -Math.sin(heading);
      for (let i = 1; i < SEGMENTS - 2; i++) {
        const back = i * 0.3, secondsAgo = back / Math.max(speed, 0.1);
        if (secondsAgo > LIFE) break;
        trail.push({ x: x - fx * back, z: z - fz * back, px: -fz, pz: fx, born: time - secondsAgo, speed, width: headWidth });
      }
    },
    update(time, x, z, heading, speed, height) {
      material.uniforms.uTime.value = time;
      const fx = Math.cos(heading), fz = -Math.sin(heading);
      const head = { x, z, px: -fz, pz: fx, born: time, speed: Math.abs(speed), width: headWidth };
      const last = trail[0];
      if (Math.abs(speed) > 0.12 && (!last || Math.hypot(last.x - x, last.z - z) > 0.3)) trail.unshift({ ...head });
      while (trail.length && (time - trail[trail.length - 1].born > LIFE || trail.length > SEGMENTS - 2)) trail.pop();
      write(0, head, time, height);
      for (let i = 0; i < SEGMENTS - 1; i++) write(i + 1, trail[Math.min(i, trail.length - 1)] || head, time, height);
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.aAge.needsUpdate = true;
      mesh.visible = trail.length > 1;
    },
  };
}

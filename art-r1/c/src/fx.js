// Light and air: bloom, lamp halos, fireflies, loot glints, stove embers and smoke.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { canvasTexture } from './palette.js';
import { mulberry32 } from './util.js';

/**
 * Scene -> bloom -> tone map -> FXAA. No MSAA target: on a shared GPU the multisampled float buffer was
 * close to half the frame, and FXAA under bloom reads the same at this softness.
 */
export function createPost(renderer, scene, camera) {
  const target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.42, 0.6, 1.0);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const fxaa = new ShaderPass(FXAAShader);
  composer.addPass(fxaa);
  return {
    composer,
    bloom,
    setSize(width, height, pixelRatio) {
      composer.setPixelRatio(pixelRatio);
      composer.setSize(width, height);
      bloom.setSize(width * pixelRatio * 0.5, height * pixelRatio * 0.5); // bloom chain starts at quarter res
      fxaa.material.uniforms.resolution.value.set(1 / (width * pixelRatio), 1 / (height * pixelRatio));
    },
  };
}

const haloTexture = () => {
  const texture = canvasTexture(128, 128, (ctx) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 128, 128);
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.12, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.16)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.035)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  });
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
};
let sharedHalo = null, sharedPuff = null;
/** Soft white puff with real alpha, for normally-blended smoke. Built as raw texels: canvas alpha speckles. */
const puffTexture = () => {
  const size = 64, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.min(Math.hypot(x - 31.5, y - 31.5) / 31.5, 1), falloff = (1 - d) * (1 - d);
      data.set([255, 255, 255, Math.round(falloff * 230)], (y * size + x) * 4);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
};

/** Soft additive halo: a lamp scattering in the mist. */
export function makeHalo(size, r = 1.0, g = 0.55, b = 0.2, strength = 1) {
  sharedHalo ||= haloTexture();
  const material = new THREE.SpriteMaterial({ map: sharedHalo, color: new THREE.Color().setRGB(r * strength, g * strength, b * strength), blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.setScalar(size);
  return sprite;
}

const POINTS_VERTEX_HEAD = /* glsl */ `
  uniform float uTime, uPixels;
  attribute vec4 aSeed; // phase, rate, size, kind
  varying float vGlow;
  varying float vKind;`;

/** Fireflies near the reeds and loot glints, in one draw call. kind 0 = firefly, 1 = glint. */
export function createMotes(scene, loot, clusters) {
  const random = mulberry32(77);
  const positions = [], seeds = [];
  for (const [x, y, z, count, spread] of clusters) {
    for (let i = 0; i < count; i++) {
      const a = random() * Math.PI * 2, r = Math.sqrt(random()) * spread;
      positions.push(x + Math.cos(a) * r, y + random() * 2.4, z + Math.sin(a) * r);
      seeds.push(random() * 10, 0.5 + random(), 0.09 + random() * 0.07, 0);
    }
  }
  for (const item of loot) {
    positions.push(item.position.x, item.position.y, item.position.z);
    seeds.push(random() * 10, 1, 0.3, 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 4));
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uPixels: { value: 800 }, uMirror: { value: 0 } },
    vertexShader: /* glsl */ `
      ${POINTS_VERTEX_HEAD}
      uniform float uMirror;
      void main() {
        vec3 p = position;
        vKind = aSeed.w;
        float t = uTime * aSeed.y * 0.5 + aSeed.x * 20.0;
        if (aSeed.w < 0.5) {
          p += vec3(sin(t * 0.9) * 1.1 + sin(t * 0.31 + aSeed.x) * 1.8, sin(t * 1.3) * 0.45, cos(t * 0.7) * 1.1 + cos(t * 0.23 + aSeed.x) * 1.8);
          vGlow = smoothstep(0.35, 0.95, sin(uTime * (1.1 + aSeed.y) + aSeed.x * 30.0) * 0.5 + 0.5);
        } else {
          p.y += sin(uTime * 1.6 + aSeed.x) * 0.07;
          vGlow = 0.75 + 0.25 * sin(uTime * 2.4 + aSeed.x * 3.0);
        }
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float px = uPixels * aSeed.z / max(-mv.z, 0.1);
        gl_PointSize = aSeed.w < 0.5 ? clamp(px, 2.5, 40.0) : clamp(px, 32.0, 80.0) * (1.0 - uMirror); // glints are a UI mark: no reflection // glints never shrink below a readable star
      }`,
    fragmentShader: /* glsl */ `
      varying float vGlow;
      varying float vKind;
      void main() {
        vec2 q = gl_PointCoord * 2.0 - 1.0;
        float d = length(q);
        float a;
        vec3 col;
        if (vKind < 0.5) {
          a = smoothstep(1.0, 0.0, d);
          a = a * a * vGlow;
          col = vec3(1.6, 1.25, 0.38) * 1.6;
        } else {
          // four-point star: the game's one "you can take this" mark
          float star = max(0.0, 1.0 - (abs(q.x) * abs(q.y) * 40.0 + d * 0.95));
          float core = smoothstep(0.28, 0.0, d);
          a = (star * 0.9 + core) * vGlow;
          col = vec3(2.6, 1.55, 0.5);
        }
        gl_FragColor = vec4(col * a, a);
      }`,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 6;
  scene.add(points);
  return { points, uniforms: material.uniforms };
}

/** Sparks rising off the stovepipe. Parent it to the canoe body at the chimney anchor. */
export function createEmbers() {
  const random = mulberry32(3), count = 46;
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) seeds.set([random(), 0.35 + random() * 0.5, random() * 6.28, 0.6 + random() * 0.8], i * 4);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 4));
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uPixels: { value: 800 }, uDrift: { value: new THREE.Vector3(-0.5, 0, -0.25) } },
    vertexShader: /* glsl */ `
      uniform float uTime, uPixels;
      uniform vec3 uDrift;
      attribute vec4 aSeed; // offset, rate, angle, size
      varying float vLife;
      void main() {
        float life = fract(uTime * aSeed.y * 0.32 + aSeed.x);
        vLife = life;
        float rise = life * (2.6 + aSeed.w);
        vec3 p = vec3(sin(aSeed.z + life * 5.0) * 0.16 * life, rise, cos(aSeed.z * 1.7 + life * 4.0) * 0.16 * life) + uDrift * rise * (0.6 + life);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(uPixels * 0.045 * aSeed.w / max(-mv.z, 0.1), 1.5, 14.0);
      }`,
    fragmentShader: /* glsl */ `
      varying float vLife;
      void main() {
        float d = length(gl_PointCoord * 2.0 - 1.0);
        float a = smoothstep(1.0, 0.2, d) * smoothstep(0.0, 0.08, vLife) * (1.0 - vLife);
        gl_FragColor = vec4(mix(vec3(3.2, 1.5, 0.4), vec3(2.2, 0.5, 0.1), vLife) * a, a);
      }`,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 6;
  return { points, uniforms: material.uniforms };
}

/** Slow grey smoke from a pipe, as a handful of soft sprites. Parent it at the chimney anchor. */
export function createSmoke(count = 9, tint = [0.42, 0.46, 0.62]) {
  sharedPuff ||= puffTexture();
  const group = new THREE.Group();
  const puffs = [];
  for (let i = 0; i < count; i++) {
    const material = new THREE.SpriteMaterial({ map: sharedPuff, color: new THREE.Color().setRGB(...tint), depthWrite: false, transparent: true, opacity: 0 });
    const sprite = new THREE.Sprite(material);
    group.add(sprite);
    puffs.push({ sprite, offset: i / count, wobble: i * 1.7 });
  }
  return {
    group,
    update(time, drift) {
      for (const puff of puffs) {
        const life = (time * 0.11 + puff.offset) % 1;
        puff.sprite.position.set(drift.x * life * 5 + Math.sin(puff.wobble + life * 4) * 0.2, life * 3.4, drift.z * life * 5 + Math.cos(puff.wobble * 1.3 + life * 3) * 0.2);
        puff.sprite.scale.setScalar(0.5 + life * 2.6);
        puff.sprite.material.opacity = Math.sin(Math.PI * Math.min(life * 1.15, 1)) * 0.34;
      }
    },
  };
}

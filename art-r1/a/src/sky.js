// Golden hour: gradient dome with a faceted sun, chunky clouds, hazy ridgelines, and the light rig.
import * as THREE from 'three';
import { PAL, backdropMat } from './palette.js';
import { Kit, rng } from './kit.js';

export const SUN_DIR = new THREE.Vector3(-0.844, 0.292, 0.449).normalize();

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0);
  gl_Position = p.xyww;
}`;
const SKY_FRAG = /* glsl */`
uniform vec3 cZenith, cUpper, cMid, cHorizon, cSun, cGlow;
uniform vec3 uSunDir;
varying vec3 vDir;
// distance to an n-gon centred on the sun, in radians
float gon(vec2 p, float n, float rot) {
  float a = atan(p.y, p.x) + rot;
  float seg = 6.28318 / n;
  return length(p) * cos(mod(a, seg) - seg * 0.5) / cos(seg * 0.5);
}
void main() {
  vec3 d = normalize(vDir);
  float y = max(d.y, 0.0);
  vec3 col = mix(cHorizon, cMid, smoothstep(0.0, 0.085, y));
  col = mix(col, cUpper, smoothstep(0.06, 0.3, y));
  col = mix(col, cZenith, smoothstep(0.26, 0.8, y));
  // warm wash around the sun, then three hard-edged polygons: halo, halo, disc
  float sd = dot(d, uSunDir);
  col = mix(col, cGlow, pow(max(sd, 0.0), 5.0) * 0.62);
  col = mix(col, cSun, pow(max(sd, 0.0), 40.0) * 0.4);
  vec3 r = normalize(cross(vec3(0.0, 1.0, 0.0), uSunDir));
  vec3 u = cross(uSunDir, r);
  vec2 p = vec2(dot(d, r), dot(d, u)) / max(sd, 0.001);
  float front = step(0.0, sd);
  col = mix(col, cSun, 0.16 * front * step(gon(p, 10.0, 0.3), 0.15));
  col = mix(col, cSun, 0.3 * front * step(gon(p, 10.0, 0.0), 0.085));
  col = mix(col, cSun, front * step(gon(p, 10.0, 0.16), 0.046));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

function clouds() {
  const k = new Kit(201, 0), r = rng(4242);
  const tmp = new THREE.Vector3();
  for (let i = 0; i < 15; i++) {
    const a = -Math.PI * 0.94 + (i / 15) * Math.PI * 1.9 + (r() - 0.5) * 0.2; // mostly ahead, some all round
    const R = 1250 + r() * 800, alt = 150 + r() * 330, size = 70 + r() * 80;
    const cx = Math.sin(a) * R, cz = -Math.cos(a) * R;
    const blobs = 4 + Math.floor(r() * 4);
    const face = Math.atan2(cx, cz);
    for (let b = 0; b < blobs; b++) {
      const f = b / (blobs - 1) - 0.5;
      const rad = size * (0.6 + r() * 0.5) * (1 - Math.abs(f) * 0.7);
      const off = f * size * 2.6;
      const g = new THREE.IcosahedronGeometry(rad, 1);
      const pos = g.attributes.position;
      for (let v = 0; v < pos.count; v++) { // flat bellies
        tmp.fromBufferAttribute(pos, v);
        tmp.y = tmp.y < -rad * 0.22 ? -rad * 0.22 : tmp.y * 0.72;
        pos.setXYZ(v, tmp.x, tmp.y, tmp.z);
      }
      k.geo(g, 0xffffff, new THREE.Matrix4().makeRotationY(face).setPosition(cx + Math.cos(face) * off, alt + rad * 0.2 + r() * 12, cz - Math.sin(face) * off));
    }
  }
  // bake light into the facets: four flat tones
  const geo = k.geometry();
  const pos = geo.attributes.position, colr = geo.attributes.color;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), col = new THREE.Color();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
    n.subVectors(b, a).cross(c.sub(a)).normalize();
    const lit = n.dot(SUN_DIR) * 0.75 + n.y * 0.4;
    col.set(lit > 0.5 ? PAL.cloudTop : lit > 0.08 ? PAL.cloudMid : lit > -0.35 ? PAL.cloudLow : PAL.cloudShade);
    for (let q = 0; q < 3; q++) colr.setXYZ(i + q, col.r, col.g, col.b);
  }
  const m = new THREE.Mesh(geo, backdropMat);
  m.name = 'clouds';
  m.frustumCulled = false;
  return m;
}

// Layered hills ringing the flooded valley, each topped with a sawtooth of spruce.
function ridges() {
  const k = new Kit(202, 0.03), r = rng(99);
  const layers = [[1650, 150, PAL.ridge3, 0.0], [1250, 105, PAL.ridge2, 1.7], [900, 62, PAL.ridge1, 3.9]];
  for (const [R, H, colr, ph] of layers) {
    const n = 150;
    const top = (i) => {
      const a = (i / n) * 6.283;
      return H * (0.42 + 0.3 * Math.sin(a * 3 + ph) + 0.18 * Math.sin(a * 7 + ph * 2) + 0.1 * Math.sin(a * 13 + ph));
    };
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * 6.283, a1 = ((i + 1) / n) * 6.283, h0 = Math.max(top(i), 6), h1 = Math.max(top(i + 1), 6);
      const p0 = [Math.sin(a0) * R, 0, -Math.cos(a0) * R], p1 = [Math.sin(a1) * R, 0, -Math.cos(a1) * R];
      k.quad([p0[0], -4, p0[2]], [p1[0], -4, p1[2]], [p1[0], h1, p1[2]], [p0[0], h0, p0[2]], colr, true);
      const teeth = 3;
      for (let t = 0; t < teeth; t++) {
        const f0 = t / teeth, f1 = (t + 1) / teeth, fm = (f0 + f1) / 2 + (r() - 0.5) * 0.1;
        const L = (f) => [p0[0] + (p1[0] - p0[0]) * f, h0 + (h1 - h0) * f - 0.5, p0[2] + (p1[2] - p0[2]) * f];
        const peak = L(fm); peak[1] += H * (0.1 + r() * 0.14);
        k.tri(L(f0), L(f1), peak, colr, true);
      }
    }
  }
  const m = k.mesh(backdropMat, 'ridges', false);
  m.frustumCulled = false;
  return m;
}

export function createSky(scene, renderer) {
  const horizon = new THREE.Color(PAL.skyHorizon);
  scene.fog = new THREE.Fog(PAL.haze, 150, 1900);
  renderer.setClearColor(horizon);

  const dome = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1, 3),
    new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: {
        cZenith: { value: new THREE.Color(PAL.skyZenith) },
        cUpper: { value: new THREE.Color(PAL.skyUpper) },
        cMid: { value: new THREE.Color(PAL.skyMid) },
        cHorizon: { value: new THREE.Color(PAL.haze) },
        cSun: { value: new THREE.Color(PAL.sunDisc) },
        cGlow: { value: new THREE.Color(PAL.sunGlow) },
        uSunDir: { value: SUN_DIR },
      },
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    }),
  );
  dome.frustumCulled = false;
  dome.renderOrder = -10;
  dome.name = 'sky';
  scene.add(dome);
  scene.add(ridges(), clouds());

  const sun = new THREE.DirectionalLight(PAL.sunLight, 2.7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -78; sc.right = 78; sc.bottom = -24; sc.top = 44; sc.near = 20; sc.far = 420;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.05;
  scene.add(sun, sun.target);
  const fill = new THREE.HemisphereLight(PAL.fillSky, PAL.fillGround, 2.0);
  scene.add(fill);

  return {
    sunDir: SUN_DIR,
    sun,
    // keep the shadow box around what the camera is looking at
    update(focus) {
      const fx = Math.round(focus.x / 2) * 2, fz = Math.round(focus.z / 2) * 2;
      sun.target.position.set(fx, 0, fz);
      sun.position.set(fx, 0, fz).addScaledVector(SUN_DIR, 220);
      sun.target.updateMatrixWorld();
    },
  };
}

// Ink & Wash — frame pipeline.
//   1. mirrored scene  -> reflection target (half res)
//   2. scene           -> colour + aux (view normal.xy, hatch/near-water, ink id) + depth
//   3. composite       -> ink outlines with uneven weight, hatching, white contact foam,
//                         wash blooms, paper grain and the bare-paper frame
import * as THREE from 'three';
import { PAL, GU, NOISE } from './palette.js';

const COMPOSITE = /* glsl */ `
precision highp float;
uniform sampler2D tColor, tAux, tDepth;
uniform vec2 uRes;
uniform float uTime, uBoil, uLineW, uGrain, uHatch, uNear, uFar;
uniform float uPaperLeft, uFrame, uWash;
uniform vec3 uInk, uPaper, uFoam, uMist;
varying vec2 vUv;
${NOISE}
const float THIN = 0.98039;
const vec2 OFFS[8] = vec2[8](
  vec2(1., 0.), vec2(.707, .707), vec2(0., 1.), vec2(-.707, .707),
  vec2(-1., 0.), vec2(-.707, -.707), vec2(0., -1.), vec2(.707, -.707));

float invZ(vec2 uv){
  float z = textureLod(tDepth, uv, 0.).x * 2. - 1.;
  return (uFar + uNear - z * (uFar - uNear)) / (2. * uNear * uFar);
}

void main(){
  float sc = uRes.y / 1080.;
  vec2 px = 1. / uRes;
  vec2 asp = vec2(uRes.x / uRes.y, 1.);
  vec2 q = vUv * asp;
  float seed = floor(uTime * 7.) * uBoil;

  // the whole drawing wavers slightly, so no line is ruler-straight
  vec4 nA = vnoise4(q * 13. + seed * 5.3);
  vec4 nB = vnoise4(q * 52. + seed);
  vec2 wob = nA.xy - .5 + (nB.xy - .5) * .4;
  vec2 uv = vUv + wob * px * 2.4 * sc;

  vec3 col = textureLod(tColor, uv, 0.).rgb;
  vec4 aux = textureLod(tAux, uv, 0.);
  float wc = invZ(uv);
  float zc = 1. / wc;
  float idc = aux.a;
  bool waterC = idc < .002;
  bool skyC = idc > .998;
  // a piece tagged THIN (ropes, wires, rods) is its own pen line: it is never outlined
  bool thinC = abs(idc - THIN) < .0015;
  vec2 nc = aux.xy;

  // uneven line weight: thick and thin along the stroke, heavier up close
  float wv = vnoise(q * 4.6 + 3. + seed * 1.7);
  float nearK = 1. - smoothstep(5., 110., zc);
  float r = uLineW * sc * (.7 + 1.0 * wv) * mix(.62, 1.3, nearK);
  // far away, seams inside an object fade so it reads as one washed shape with a clean silhouette
  float inner = mix(1., .2, smoothstep(16., 70., zc));

  float inkS = 0.; // contour: a real step in depth, or an object against water / sky
  float inkI = 0.; // interior: seams and creases, drawn lighter
  float foam = 0.;
  float zmin = zc;
  bool busy = false;
  float w4[4];
  // outer ring (diagonals): thickens the contour, softens seams, feeds the foam line —
  // and tells us whether anything is happening here at all
  for (int i = 0; i < 4; i++) {
    vec2 o = OFFS[i * 2 + 1] * r * 1.7 * px;
    vec4 a = textureLod(tAux, uv + o, 0.);
    w4[i] = invZ(uv + o);
    bool waterT = a.a < .002;
    bool skyT = a.a > .998;
    bool thin = thinC || abs(a.a - THIN) < .0015;
    float idd = step(.002, abs(a.a - idc));
    if (idd > 0. || distance(a.xy, nc) > .16) busy = true;
    if (waterC && !waterT && a.b > .48) foam += 1.;
    else if (thin) continue;
    else if ((waterC != waterT && (waterC ? a.b : aux.b) < .48 && !skyC && !skyT) || (skyC != skyT && !waterC && !waterT)) inkS += .6;
    else if (!waterC && !skyC && !waterT && !skyT) inkI += .45 * idd;
  }
  if (abs(w4[0] + w4[2] - 2. * wc) > .012 * wc || abs(w4[1] + w4[3] - 2. * wc) > .012 * wc) busy = true;

  if (busy) {
    for (int i = 0; i < 4; i++) {
      vec2 oa = OFFS[i] * r * px;
      vec4 a = textureLod(tAux, uv + oa, 0.);
      vec4 b = textureLod(tAux, uv - oa, 0.);
      float wa = invZ(uv + oa);
      float wb = invZ(uv - oa);
      // planar surfaces are linear in 1/z, so this only fires on real depth steps
      float de = smoothstep(.012, .03, abs(wa + wb - 2. * wc) / wc);
      zmin = min(zmin, 1. / max(wa, wb));
      for (int k = 0; k < 2; k++) {
        vec4 t = k == 0 ? a : b;
        bool waterT = t.a < .002;
        bool skyT = t.a > .998;
        bool thin = thinC || abs(t.a - THIN) < .0015;
        if (waterC != waterT) {
          float nw = waterC ? t.b : aux.b;
          if (nw > .48) { if (waterC) foam += 1.; }
          else if (!(skyC || skyT) && !thin) inkS += 1.;
        } else if (waterC) {
          // open water draws its own marks
        } else if (skyC != skyT) {
          if (!thin) inkS += 1.;
        } else if (!skyC && !thin) {
          float ne = smoothstep(.2, .45, distance(t.xy, nc));
          float ie = step(.002, abs(t.a - idc));
          inkS += de;
          inkI += max(ne, ie) * (1. - de);
        }
      }
    }
  }

  vec2 gp = vUv * uRes / sc;
  vec4 nG = vnoise4(gp * .31);
  if (busy) {
    float eS = smoothstep(.06, .36, inkS / 8.);
    float eI = smoothstep(.08, .42, inkI / 8.) * .64 * inner;
    float e = max(eS, eI);
    float distFade = mix(1., .3, smoothstep(45., 420., zmin));
    vec3 inkCol = mix(uInk, uMist * .6, smoothstep(50., 520., zmin) * .85);
    float dry = .8 + .4 * nG.r;
    // watercolour wet edge: pigment pools just beside the line
    col *= 1. - .08 * smoothstep(0., .25, max(inkS, inkI * .6) / 8.) * distFade;
    col = mix(col, inkCol, clamp(e * distFade * dry, 0., 1.));
    // white ink where things sit in the water
    if (foam > 0.) {
      float f = smoothstep(.04, .3, foam / 8.);
      f *= smoothstep(.22, .42, vnoise(q * 46. + vec2(uTime * .3, 0.)) + nearK * .25);
      col = mix(col, uFoam, f * mix(.55, 1., nearK));
    }
  }

  // hatching in the shadow tone
  float hb = aux.b > .48 ? aux.b - .5 : aux.b;
  float hatch = clamp(hb / .45, 0., 1.) * uHatch * (1. - smoothstep(25., 150., zc));
  if (hatch > .01 && !waterC && !skyC) {
    vec2 hp = gp + wob * 3.;
    float c1 = (hp.x + hp.y * .9) / 7.;
    float l1 = smoothstep(.7, .92, abs(fract(c1) - .5) * 2.);
    float br = vnoise(vec2(floor(c1 + .5) * 7.31, (hp.x - hp.y) / 52.));
    l1 *= smoothstep(.3, .52, br);
    col = mix(col, uInk, l1 * hatch * .42);
  }

  // wash density (blooms) — the pigment never lies perfectly even
  col *= .945 + .11 * (vnoise(q * 2.3 + 5.) * .7 + nA.b * .3);

  // pause: the painting is washed back toward paper
  col = mix(col, uPaper, uWash);

  // bare paper around the painting; in the lobby the left of the sheet is left unpainted
  float left = step(.001, uPaperLeft);
  float dEdge = min((1. - vUv.x) * asp.x, min(vUv.y, 1. - vUv.y)) - uFrame;
  float dLeft = (vUv.x - uPaperLeft) * asp.x - uFrame;
  if (min(dEdge, dLeft) < .14) {
    float nz = fbm(q * 3.1) - .5 + (nB.b - .5) * .12 + (vnoise(q * 24.) - .5) * .3;
    float bristle = (vnoise(vec2(q.x * 1.5, q.y * 46.)) - .5) * .11 + (vnoise(vec2(q.x * 3., q.y * 7.)) - .5) * .12;
    dEdge += nz * uFrame * 1.7;
    dLeft += mix(nz * uFrame * 1.7, bristle, left);
    float d = min(dEdge, dLeft);
    float m = smoothstep(0., .0035, d);
    float pool = (1. - smoothstep(0., .011, d)) * m;
    col *= 1. - .16 * pool;
    // a faint bleed of the wash into the paper
    float bleed = smoothstep(-.03, 0., d) * (1. - m) * .16 * left;
    col = mix(mix(uPaper, col, bleed), col, m);
  }

  // paper grain over everything
  float grain = vnoise(gp * .85) * .55 + nG.g * .3 + nG.b * .15;
  col *= 1. - uGrain * (grain - .5) * .16;
  gl_FragColor = vec4(col, 1.);
}`;

export function createPost(renderer, camera) {
  const gbuf = new THREE.WebGLRenderTarget(4, 4, {
    count: 2,
    depthBuffer: true,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });
  gbuf.textures[1].minFilter = THREE.NearestFilter;
  gbuf.textures[1].magFilter = THREE.NearestFilter;
  gbuf.depthTexture = new THREE.DepthTexture(4, 4);

  const refl = new THREE.WebGLRenderTarget(4, 4, {
    depthBuffer: true,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });

  const uniforms = {
    tColor: { value: gbuf.textures[0] },
    tAux: { value: gbuf.textures[1] },
    tDepth: { value: gbuf.depthTexture },
    uRes: { value: new THREE.Vector2(4, 4) },
    uTime: GU.uTime,
    tNoise: GU.tNoise,
    uBoil: { value: 0 }, // off by default: the 7-a-second re-wobble of the whole frame made Luc motion sick
    uLineW: { value: 1.3 },
    uGrain: { value: 1 },
    uHatch: { value: 1 },
    uNear: { value: camera.near },
    uFar: { value: camera.far },
    uPaperLeft: { value: 0 },
    uFrame: { value: 0.014 },
    uWash: { value: 0 },
    uInk: { value: new THREE.Color(PAL.ink) },
    uPaper: { value: new THREE.Color(PAL.paper) },
    uFoam: { value: new THREE.Color(PAL.foam) },
    uMist: { value: new THREE.Color(PAL.mist) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = position.xy * .5 + .5; gl_Position = vec4(position.xy, 0., 1.); }',
    fragmentShader: COMPOSITE,
    depthTest: false,
    depthWrite: false,
  });
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const quad = new THREE.Mesh(tri, material);
  quad.frustumCulled = false;
  const postScene = new THREE.Scene();
  postScene.add(quad);
  const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const size = new THREE.Vector2();

  return {
    uniforms,
    reflection: refl.texture,
    resolution: uniforms.uRes.value,
    setSize(w, h) {
      size.set(w, h);
      gbuf.setSize(w, h);
      refl.setSize(Math.max(2, w >> 1), Math.max(2, h >> 1));
      uniforms.uRes.value.set(w, h);
    },
    render(scene, cam, water) {
      // mirrored world below the waterline
      GU.uFlip.value = -1;
      water.visible = false;
      scene.scale.y = -1;
      renderer.setRenderTarget(refl);
      renderer.clear();
      renderer.render(scene, cam);
      scene.scale.y = 1;
      water.visible = true;
      GU.uFlip.value = 1;

      renderer.setRenderTarget(gbuf);
      renderer.clear();
      renderer.render(scene, cam);

      renderer.setRenderTarget(null);
      renderer.render(postScene, postCam);
    },
  };
}

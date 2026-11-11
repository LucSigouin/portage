// Ink & Wash — frame pipeline (B2: sharp).
//   1. mirrored scene -> reflection target (first thing the frame-rate ladder shrinks)
//   2. scene          -> colour, multisampled 4x: clean silhouettes, read back at exact pixel centres
//   3. scene          -> ink buffer at up to twice the screen size (normal, ink id, line wobble) + depth:
//                        cheap to fill, and it is what lets the pen lines be anti-aliased
//   4. composite      -> colour + pen lines + white contact foam, paper frame, paper tooth.
//                        Where an edge is near, the pen is worked out at four points inside the pixel
//                        (one per ink-buffer texel) and averaged: that is its anti-aliasing.
// Nothing here resamples the colour, so nothing is smeared. The hand-drawn unevenness moves where a
// line sits (and how heavy it is), and that wobble is read from the object the line belongs to.
import * as THREE from 'three';
import { PAL, GU, NOISE } from './palette.js';

const COMPOSITE = /* glsl */ `
precision highp float;
uniform sampler2D tColor, tAux, tDepth;
uniform vec2 uRes, uARes;
uniform float uS, uSc, uLineW, uWobble, uBoil, uBoilTime, uNear, uFar, uTime;
uniform float uGrain, uPaperLeft, uFrame, uWash;
uniform vec3 uInk, uPaper, uFoam, uMist, uCamPos;
uniform mat3 uRay;
uniform vec2 uDrift;
varying vec2 vUv;
${NOISE}
const float THIN = 0.99609375;   // 2040 / 2048, as in geo.js
const vec2 OFFS[8] = vec2[8](
  vec2(1., 0.), vec2(.707, .707), vec2(0., 1.), vec2(-.707, .707),
  vec2(-1., 0.), vec2(-.707, -.707), vec2(0., -1.), vec2(.707, -.707));

float invZ(vec2 uv){
  float z = textureLod(tDepth, uv, 0.).x * 2. - 1.;
  return (uFar + uNear - z * (uFar - uNear)) / (2. * uNear * uFar);
}
bool solid(float id){ return id >= .002 && id <= .998; }

// The pen at one point inside a pixel: (ink, foam). r: pen half-width in ink texels,
// de: how hard the depth steps across each of the four tap pairs (worked out once per pixel).
vec2 penAt(vec2 uv, vec2 apx, float r, vec4 de, float inner, float weight, float nearK){
  vec4 aux = textureLod(tAux, uv, 0.);
  float idc = aux.a;
  bool waterC = idc < .002;
  bool skyC = idc > .998;
  // a piece tagged THIN (ropes, wires, rods) is its own pen line: it is never outlined
  bool thinC = abs(idc - THIN) < .0015;
  vec2 nc = aux.xy;
  float inkS = 0.; // contour: a real step in depth, or an object against water / sky
  float inkI = 0.; // interior: seams and creases, drawn lighter
  float foam = 0.;
  for (int i = 0; i < 4; i++) {
    vec2 oa = OFFS[i] * r * apx;
    vec4 a = textureLod(tAux, uv + oa, 0.);
    vec4 b = textureLod(tAux, uv - oa, 0.);
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
        float ie = step(.0003, abs(t.a - idc));
        inkS += de[i];
        inkI += max(ne, ie) * (1. - de[i]);
      }
    }
  }
  // the white line where things sit in the water reaches a little further than the pen
  if (waterC) {
    for (int i = 0; i < 4; i++) {
      vec4 a = textureLod(tAux, uv + OFFS[i * 2 + 1] * r * 1.7 * apx, 0.);
      if (a.a >= .002 && a.b > .48) foam += 1.;
    }
  }
  float eS = smoothstep(.05, .21, inkS / 8.);
  float eI = smoothstep(.08, .3, inkI / 8.) * .64 * inner;
  return vec2(max(eS, eI), smoothstep(.04, .3, foam / 8.) * mix(.55, 1., nearK));
}

void main(){
  float sc = uRes.y / 1080.;
  vec2 asp = vec2(uRes.x / uRes.y, 1.);
  vec2 q = vUv * asp;

  // colour at the exact pixel centre: nothing is resampled
  vec3 col = texelFetch(tColor, ivec2(gl_FragCoord.xy), 0).rgb;

  // ---- pen ----
  vec2 apx = 1. / uARes;
  vec4 aux = textureLod(tAux, vUv, 0.);
  bool plain = !solid(aux.a);                // open water or sky: no depth needed to know nothing is here
  float wc = plain ? 1. / uFar : invZ(vUv);
  float nearK = plain ? 1. : 1. - smoothstep(5., 110., 1. / wc);
  // pen half-width in ink-buffer texels (before its thick-and-thin), and how far a line may wander
  float rBase = uLineW * uSc * uS;
  float wobR = uWobble * uSc * uS;
  // probe: is any edge within the pen's reach of this pixel? Two rings of four, the outer on the
  // diagonals and the inner on the axes, so a thin rod is not stepped over. It also finds who owns the
  // line: the surface in front, whose wobble value (aux.b) decides where the line sits and how heavy it is.
  float Rp = 1.45 * (rBase * mix(.62, 1.3, nearK) * 1.26 + wobR) + 1.5 + .7 * uS;
  bool busy = false;
  float wNear = plain ? 0. : wc;
  float sv = aux.b;
  float w4[4];
  for (int i = 0; i < 4; i++) {
    vec2 uvt = vUv + OFFS[i * 2 + 1] * Rp * apx;
    vec4 a = textureLod(tAux, uvt, 0.);
    vec4 b = textureLod(tAux, vUv + OFFS[i * 2] * Rp * .55 * apx, 0.);
    if (abs(a.a - aux.a) > .0003 || distance(a.xy, aux.xy) > .16 || abs(b.a - aux.a) > .0003 || distance(b.xy, aux.xy) > .16) busy = true;
    if (plain) {
      if (wNear == 0.) {
        if (solid(b.a)) { wNear = 1.; sv = b.b; }
        else if (solid(a.a)) { wNear = 1.; sv = a.b; }
      }
    } else {
      float w = invZ(uvt);
      w4[i] = w;
      if (w > wNear && solid(a.a)) { wNear = w; sv = a.b; }
    }
  }
  if (!plain && (abs(w4[0] + w4[2] - 2. * wc) > .012 * wc || abs(w4[1] + w4[3] - 2. * wc) > .012 * wc)) busy = true;

  if (busy) {
    // one object-anchored value, read two ways: where the line sits, and its weight
    float s = fract(sv * 2.) / .9 - .5;
    vec2 wob = vec2(sin(s * 5.), sin(s * 7.3 + 1.1)) * wobR;
    float weight = .5 + .5 * sin(s * 8. + 2.);
    // optional line boil (off by default): the whole drawing re-wobbles a few times a second
    if (uBoil > 0.) wob += (vnoise4(q * 13. + floor(uBoilTime * 7.) * 5.3).xy - .5) * 2.4 * uSc * uS;
    vec2 uv = vUv + wob * apx;
    // depth is read once per pixel: the pen's width here, real depth steps across each tap pair
    // (planar surfaces are linear in 1/z, so this only fires on true steps), and how far the line's owner is
    float wq = invZ(uv);
    float zq = 1. / wq;
    float nk = 1. - smoothstep(5., 110., zq);
    float r = rBase * mix(.62, 1.3, nk) * (.52 + .74 * weight);
    // far away, seams inside an object fade so it reads as one washed shape with a clean silhouette
    float inner = mix(1., .2, smoothstep(16., 70., zq));
    vec4 de;
    float zmin = zq;
    for (int i = 0; i < 4; i++) {
      vec2 oa = OFFS[i] * r * apx;
      float wa = invZ(uv + oa);
      float wb = invZ(uv - oa);
      de[i] = smoothstep(.012, .03, abs(wa + wb - 2. * wq) / wq);
      zmin = min(zmin, 1. / max(wa, wb));
    }
    vec2 pen;
    if (uS > 1.2) {
      // four points inside the pixel, a quarter pixel out from its centre: one per ink texel at 2x
      vec2 h = .25 / uRes;
      pen = (penAt(uv + h, apx, r, de, inner, weight, nk) + penAt(uv - h, apx, r, de, inner, weight, nk)
           + penAt(uv + vec2(h.x, -h.y), apx, r, de, inner, weight, nk) + penAt(uv + vec2(-h.x, h.y), apx, r, de, inner, weight, nk)) * .25;
    } else {
      pen = penAt(uv, apx, r, de, inner, weight, nk);
    }
    float distFade = mix(1., .3, smoothstep(45., 420., zmin));
    float dry = .8 + .4 * weight;                      // a heavier stroke is a wetter one
    float ink = clamp(pen.x * distFade * dry, 0., 1.);
    if (pen.y > 0.) {
      // dry-brush breaks in the white line, from noise that sits on the water (so it drifts with it)
      vec3 dir = uRay * vec3(vUv * 2. - 1., 1.);
      vec2 wp = uCamPos.xz + dir.xz * (-uCamPos.y / min(dir.y, -1e-4)) + uDrift;
      pen.y *= smoothstep(.22, .42, vnoise(wp * 5.5 + vec2(uTime * .3, 0.)) + nk * .25);
    }
    col = mix(col, mix(uInk, uMist * .6, smoothstep(50., 520., zmin) * .85), ink);
    col = mix(col, uFoam, pen.y);
  }

  // pause: the painting is washed back toward paper
  col = mix(col, uPaper, uWash);

  // bare paper around the painting; in the lobby the left of the sheet is left unpainted
  float left = step(.001, uPaperLeft);
  float dEdge = min((1. - vUv.x) * asp.x, min(vUv.y, 1. - vUv.y)) - uFrame;
  float dLeft = (vUv.x - uPaperLeft) * asp.x - uFrame;
  if (min(dEdge, dLeft) < .14) {
    float nz = fbm(q * 3.1) - .5 + (vnoise4(q * 52.).b - .5) * .12 + (vnoise(q * 24.) - .5) * .3;
    float bristle = (vnoise(vec2(q.x * 1.5, q.y * 46.)) - .5) * .11 + (vnoise(vec2(q.x * 3., q.y * 7.)) - .5) * .12;
    dEdge += nz * uFrame * 1.7;
    dLeft += mix(nz * uFrame * 1.7, bristle, left);
    float dd = min(dEdge, dLeft);
    float mk = smoothstep(0., .0035, dd);
    float pool = (1. - smoothstep(0., .011, dd)) * mk;
    col *= 1. - .16 * pool;
    // a faint bleed of the wash into the paper
    float bleed = smoothstep(-.03, 0., dd) * (1. - mk) * .16 * left;
    col = mix(mix(uPaper, col, bleed), col, mk);
  }

  // paper tooth: the one thing that belongs to the sheet, so it stays put on screen
  vec2 gp = vUv * uRes / sc;
  vec4 nG = vnoise4(gp * .31);
  float grain = vnoise(gp * .85) * .55 + nG.g * .3 + nG.b * .15;
  col *= 1. - uGrain * (grain - .5) * .16;
  gl_FragColor = vec4(col, 1.);
}`;

const INK_TEXEL_BUDGET = 9.5e6; // twice the screen each way at 1920x1080, 1.6x at 2560x1440, 1.07x at 3840x2160

export function createPost(renderer, camera) {
  // colour: 4x multisampled, resolved by the renderer when the pass ends
  const color = new THREE.WebGLRenderTarget(4, 4, {
    samples: 4,
    depthBuffer: true,
    resolveDepthBuffer: false,
    generateMipmaps: false,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  });

  // ink buffer: view normal.xy, near-water flag + the object's pen-wobble value, ink id
  const aux = new THREE.WebGLRenderTarget(4, 4, {
    type: THREE.HalfFloatType, // 8 bits held 239 ink ids: not enough for 15 islands. Half-float holds 2003.
    depthBuffer: true,
    generateMipmaps: false,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  });
  aux.depthTexture = new THREE.DepthTexture(4, 4);

  const refl = new THREE.WebGLRenderTarget(4, 4, {
    depthBuffer: true,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });

  const uniforms = {
    tColor: { value: color.texture },
    tAux: { value: aux.texture },
    tDepth: { value: aux.depthTexture },
    tNoise: GU.tNoise,
    uRes: { value: new THREE.Vector2(4, 4) },
    uARes: { value: new THREE.Vector2(4, 4) },
    uS: { value: 2 },
    uSc: GU.uSc,
    uLineW: { value: 1.3 },
    uWobble: { value: 1.5 }, // pixels (at 1080p) a line may sit off the true edge
    uBoil: { value: 0 }, // off, always: the 7-a-second re-wobble of the whole frame made Luc motion sick. Only ?boil=1 turns it on, to prove the steadiness test can fail.
    uBoilTime: { value: 0 },
    uNear: { value: camera.near },
    uFar: { value: camera.far },
    uTime: GU.uTime,
    uCamPos: { value: new THREE.Vector3() },
    uRay: { value: new THREE.Matrix3() },
    uDrift: { value: new THREE.Vector2() },
    uGrain: { value: 0.6 },
    uPaperLeft: { value: 0 },
    uFrame: { value: 0.014 },
    uWash: { value: 0 },
    uInk: { value: new THREE.Color(PAL.ink) },
    uPaper: { value: new THREE.Color(PAL.paper) },
    uFoam: GU.uFoam, // the time-of-day palette
    uMist: GU.uFogColor,
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

  const state = { w: 4, h: 4, inkScale: 2, reflScale: 1, inkW: 4, inkH: 4 };

  return {
    uniforms,
    pen: uniforms, // the pen's own settings (uLineW, uWobble, uBoil) live with the composite
    reflection: refl.texture,
    resolution: uniforms.uRes.value,
    state,
    // w, h: drawing size. reflScale: reflection size against the drawing. inkMax: most ink texels per pixel, each way.
    setSize(w, h, reflScale = 1, inkMax = 2) {
      const s = Math.max(1, Math.min(inkMax, Math.sqrt(INK_TEXEL_BUDGET / (w * h))));
      const iw = Math.round(w * s);
      const ih = Math.round(h * s);
      Object.assign(state, { w, h, inkScale: ih / h, reflScale, inkW: iw, inkH: ih });
      color.setSize(w, h);
      aux.setSize(iw, ih);
      refl.setSize(Math.max(2, Math.round(w * reflScale)), Math.max(2, Math.round(h * reflScale)));
      uniforms.uRes.value.set(w, h);
      uniforms.uARes.value.set(iw, ih);
      uniforms.uS.value = ih / h;
    },
    // share the water's drift, so the foam's dry-brush breaks ride on the water
    linkWater(driftUniform) {
      uniforms.uDrift = driftUniform;
    },
    // overlay: an optional scene of world-anchored marks, drawn over the finished sheet.
    // reflect: false skips the mirrored pass (water detail "low").
    // onPass(pass): called before each scene pass (2 reflection, 0 colour, 1 ink), so the caller can thin out what the mirror sees.
    render(scene, cam, water, overlay = null, reflect = true, onPass = null) {
      uniforms.uNear.value = cam.near;
      uniforms.uFar.value = cam.far;
      if (reflect) {
        // mirrored world below the waterline
        GU.uFlip.value = -1;
        GU.uPass.value = 2;
        if (onPass) onPass(2);
        water.visible = false;
        scene.scale.y = -1;
        renderer.setRenderTarget(refl);
        renderer.clear();
        renderer.render(scene, cam);
        scene.scale.y = 1;
        water.visible = true;
        GU.uFlip.value = 1;
      }

      GU.uPass.value = 0;
      if (onPass) onPass(0);
      renderer.setRenderTarget(color);
      renderer.clear();
      renderer.render(scene, cam);

      GU.uPass.value = 1;
      renderer.setRenderTarget(aux);
      renderer.clear();
      renderer.render(scene, cam);
      GU.uPass.value = 0;

      // the composite rebuilds each pixel's place on the water from the camera, for the foam breaks
      const e = cam.matrixWorld.elements;
      const ty = Math.tan((cam.fov * Math.PI) / 360);
      const tx = ty * cam.aspect;
      uniforms.uCamPos.value.setFromMatrixPosition(cam.matrixWorld);
      uniforms.uRay.value.set(e[0] * tx, e[4] * ty, -e[8], e[1] * tx, e[5] * ty, -e[9], e[2] * tx, e[6] * ty, -e[10]);

      renderer.setRenderTarget(null);
      renderer.render(postScene, postCam);
      if (overlay) renderer.render(overlay, cam);
    },
    dispose() {
      color.dispose();
      aux.dispose();
      refl.dispose();
      tri.dispose();
      material.dispose();
    },
  };
}

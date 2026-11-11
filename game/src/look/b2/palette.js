// Ink & Wash — palette, shared uniforms and the two surface materials.
// Everything that defines "what colour and how it is shaded" lives here.
// (The pen marks drawn inside a wash are in detail.js.)
import * as THREE from 'three';
import { DETAIL } from './detail.js';
import { WAVES, WAVE_UNIFORMS } from './waves.js';

// Colours are authored as display values and used as-is (flat washes, no PBR).
THREE.ColorManagement.enabled = false;

export const PAL = {
  // paper + ink
  paper: '#f3ebd9',
  paperDeep: '#e6dbc3',
  ink: '#2a2b33',
  inkSoft: '#5b5f6b',
  // air
  mist: '#e0e2d8',
  skyTop: '#c6d0cf',
  skyLow: '#eee7d6',
  cloud: '#b4c0c4',
  sun: '#fbf3dc',
  // water
  waterDeep: '#587b90',
  waterMid: '#7f9eab',
  waterPale: '#b7c9c9',
  inkBlue: '#36566b',
  foam: '#fcf9f0',
  // greens
  sage: '#93a88a',
  sageDeep: '#6d866b',
  pine: '#4d6759',
  pineDark: '#3b524b',
  moss: '#a4ad7a',
  mossDeep: '#869664',
  // warm accents
  rust: '#b5553a',
  rustLight: '#cd7c5d',
  rustDark: '#8b3f2e',
  ochre: '#d5a542',
  ochreLight: '#e6c877',
  // cloth
  cream: '#efe6cf',
  canvas: '#e7dabd',
  canvasSage: '#a9b397',
  // stone
  granite: '#b6ada3',
  granitePink: '#c9aca0',
  graniteDark: '#8d8886',
  sand: '#e2d2ab',
  lichen: '#c8b77a',
  // wood
  wood: '#b28b5e',
  woodLight: '#d2b385',
  woodDark: '#7a5a40',
  driftwood: '#cfc7b8',
  bark: '#5d4b42',
  birch: '#f1ebdc',
  // metal + misc
  iron: '#4b4d57',
  tin: '#abb2b3',
  slate: '#6b8396',
  barrelBlue: '#55778f',
  skin: '#e8c7a6',
  glow: '#ffd98a',
};

export function glsl(hex) {
  const c = new THREE.Color(hex);
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
}

// Shared by every material in the scene. Sky/lighting module owns the values.
export const GU = {
  uTime: { value: 0 },
  uLightDir: { value: new THREE.Vector3(-0.52, 0.74, -0.42).normalize() },
  uPaper: { value: new THREE.Color(PAL.paper) },
  uShadowTint: { value: new THREE.Color('#8e97b6') },
  uFogColor: { value: new THREE.Color(PAL.mist) },
  uFogDensity: { value: 0.0025 }, // lighter than B (0.0036): the middle distance keeps its contrast
  uFlip: { value: 1 }, // -1 while the mirrored reflection pass renders
  uPass: { value: 0 }, // 0 colour, 1 ink buffer (normal, id, line wobble), 2 reflection colour (no fine pen work)
  uFine: { value: 1 }, // fine strokes and hatching; the frame-rate ladder turns them off before it touches resolution
  uHatch: { value: 1 },
  uPxK: { value: 0.00086 }, // metres per pixel per metre of distance (set on resize)
  uSc: { value: 1 }, // drawing height / 1080: pen widths scale with the sheet
  // ---- time of day (set by daylight.ts through world-view.ts; the defaults are B2's misty morning) ----
  uLight: { value: new THREE.Color(1, 1, 1) }, // multiplies every lit wash
  uSkyTop: { value: new THREE.Color(PAL.skyTop) },
  uSkyLow: { value: new THREE.Color(PAL.skyLow) },
  uCloud: { value: new THREE.Color(PAL.cloud) },
  uCloudLight: { value: new THREE.Color(PAL.paper) },
  uSunColor: { value: new THREE.Color(PAL.sun) },
  uSunDir: { value: new THREE.Vector3(0.35, 0.115, 0.93).normalize() }, // where the sun is painted (not the shading light)
  uSunGlow: { value: 1 },
  uFarTint: { value: new THREE.Color(1, 1, 1) }, // multiplies the painted far ridges
  uOvercast: { value: 0 },
  uWaterDeep: { value: new THREE.Color(PAL.waterDeep) },
  uWaterMid: { value: new THREE.Color(PAL.waterMid) },
  uWaterPale: { value: new THREE.Color(PAL.waterPale) },
  uInkBlue: { value: new THREE.Color(PAL.inkBlue) },
  uFoam: { value: new THREE.Color(PAL.foam) },
  ...WAVE_UNIFORMS,
};

// One small random texture feeds every noise lookup (a bilinear tap is value noise, and far cheaper than hashing).
const noiseData = new Uint8Array(256 * 256 * 4);
{
  let s = 20261110;
  for (let i = 0; i < noiseData.length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    noiseData[i] = s >>> 24;
  }
}
const noiseTex = new THREE.DataTexture(noiseData, 256, 256, THREE.RGBAFormat);
noiseTex.wrapS = noiseTex.wrapT = THREE.RepeatWrapping;
noiseTex.minFilter = noiseTex.magFilter = THREE.LinearFilter;
noiseTex.needsUpdate = true;
GU.tNoise = { value: noiseTex };

export const NOISE = /* glsl */ `
uniform sampler2D tNoise;
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec4 vnoise4(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return textureLod(tNoise, (i + f + .5) / 256., 0.); }
float vnoise(vec2 p){ return vnoise4(p).r; }
float fbm(vec2 p){ float a = .5, s = 0.; for(int i=0;i<3;i++){ s += a*vnoise(p); p = p*2.03 + 17.3; a *= .5; } return s / .875; }
`;

const VERT = /* glsl */ `
in vec3 aColor;
in vec4 aInfo;   // ink id, glow, kind, long axis
in vec4 aTex;    // piece-local metres + seed
in vec4 aInst;   // per instance: ink id shift (0..1), washed-out share (used-up loot), noise offset. Zero when not instanced.
out vec3 vColor;
out vec3 vN;
out vec3 vWorld;
out vec3 vObj;
out vec3 vL;
flat out vec4 vInfo;
flat out float vSpent;
void main(){
#ifdef USE_INSTANCING
  mat4 M = modelMatrix * instanceMatrix;
#else
  mat4 M = modelMatrix;
#endif
  vec4 wp = M * vec4(position, 1.);
  vWorld = wp.xyz;
  vObj = position + aInst.z * vec3(37.1, 11.3, 23.7);   // each instance gets its own stretch of the object-anchored noise
  vN = mat3(M) * normal;
  vColor = aColor;
  float id = aInfo.x;
  // instances of one mesh must not share ink ids, or two neighbours would merge: shift each one's ids (never the THIN id)
  if (aInst.x > 0. && id < .99) id = (16. + mod(floor(id * 2048. + .5) - 16. + floor(aInst.x * 2003.), 2003.)) / 2048.;
  vInfo = vec4(id, aInfo.y, aInfo.z, aTex.w + aInst.z);
  vSpent = aInst.y;
  // turn the local frame so x runs along the piece (grain, lay, brush drag)
  vL = aInfo.w < .5 ? aTex.xyz : aInfo.w < 1.5 ? aTex.yzx : aTex.zxy;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */ `
precision highp float;
in vec3 vColor;
in vec3 vN;
in vec3 vWorld;
in vec3 vObj;
in vec3 vL;
flat in vec4 vInfo;
flat in float vSpent;
layout(location = 0) out vec4 o0;
uniform vec3 uLightDir, uPaper, uShadowTint, uFogColor, uLight;
uniform float uFogDensity, uFlip, uTime, uFine, uHatch, uPxK, uSc;
uniform int uPass;
${NOISE}
${DETAIL}
${WAVES}
#ifdef TERRAIN
// the region preset (presets.ts): which stone, which green, where the moss grows, how the rock is bedded
uniform vec3 uRockA, uRockB, uRockDark, uLichen, uMossA, uMossB, uSand;
uniform vec4 uMoss;   // flattest slope moss grows on (normal.y), lowest height, bias, tuft strength
uniform vec2 uBeds;   // bedding spacing, joint spacing (metres)
#endif
const vec3 INK = ${glsl(PAL.ink)};
void main(){
  if (uFlip < 0. && vWorld.y > 0.) discard;
  vec3 P = vec3(vWorld.x, vWorld.y * uFlip, vWorld.z);
  vec3 O = vObj;                       // every texture below rides on the object, not the world or the screen
  vec3 gn = normalize(vN);
  if (!gl_FrontFacing) gn = -gn;
  vec3 n = vec3(gn.x, gn.y * uFlip, gn.z);
  float dist = length(vWorld - cameraPosition);
  vec3 base = vColor;
  float id = vInfo.x;
  float glow = vInfo.y * (1. - vSpent);
#ifdef TERRAIN
  float h = P.y;
  float n2 = vnoise(P.xz * .55 + 9.);
  float mossV = (n.y - uMoss.x) + (fbm(P.xz * .33 + 20.) - .5) * .42 + (h - 1.6) * .03 + uMoss.z;
  float mossM = step(0., mossV) * step(uMoss.y, h);
  float sandV = vColor.r * (1. - smoothstep(.75, 1.15, h + (n2 - .5) * .5));
  float sand = step(.5, sandV);
  id = mix(mix(.11, .35, mossM), .52, sand);
  glow = 0.;
#endif

  if (uPass == 1) {
    // ---- ink buffer: what the pen needs ----
    vec3 vn = normalize(mat3(viewMatrix) * gn);
    float nearWater = step(abs(P.y - waveSurface(P.xz)), .11);
    // How the pen wavers on this object: noise on the object itself, at whichever scale spans about
    // 160 pixels from here (two octaves cross-faded by distance). So it is slow enough that a line
    // bends but never doubles, near or far, and it rides with the object when the camera turns.
    // (Per pixel, not per vertex: neighbouring pieces must agree on it where they meet.)
    float lw = log2(max(dist * uPxK, 1e-5) * 160.);
    float l0 = floor(lw);
    float f0 = exp2(-l0);
    vec2 wq = O.xz + O.y * vec2(1.21, .87);
    float wv = mix(vnoise(wq * f0 + 7.), vnoise(wq * f0 * .5 + 7.), lw - l0);
    // b: near-water flag in the top half, the pen-wobble value in the bottom
    o0 = vec4(vn.xy * .5 + .5, nearWater * .5 + wv * .45, id);
    return;
  }

  // ---- colour ----
  float px = dist * uPxK;                                  // metres per pixel at this distance
  float fine = uPass == 0 ? uFine : 0.;
  vec3 Lx = dFdx(vL);
  vec3 Ly = dFdy(vL);
  float gOy = abs(dFdx(O.y)) + abs(dFdy(O.y));
  float hc = dot(O, HATCH_DIR);
  float hg = length(vec2(dFdx(hc), dFdy(hc)));
#ifdef TERRAIN
  vec2 Q = P.xz;
  float gq = length(fwidth(Q)) * .7071;
  float n1 = fbm(Q * .11 + 3.);
  float sandC = washSoft(sandV, .5, fwidth(sandV));
  float mossC = washSoft(mossV, 0., fwidth(mossV)) * washSoft(h, uMoss.y, fwidth(h)) * (1. - sandC);
  float rockC = (1. - mossC) * (1. - sandC);
  // granite: two washes, darker seams of mineral, lichen
  vec3 rock = mix(uRockA, uRockB, washSoft(n1, .5, fwidth(n1)));
  rock = mix(rock, uRockDark, washSoft(n2, .67, fwidth(n2)) * .45);
  float lv = vnoise(Q * 2.7 + 40.);
  rock = mix(rock, uLichen, washSoft(lv, .77, fwidth(lv)) * .34);
  float mv = vnoise(Q * .7 + 70.);
  vec3 moss = mix(uMossA, uMossB, washSoft(mv, .51, fwidth(mv)));
  float mv2 = vnoise(Q * 2.4 + 13.);
  moss = mix(moss, moss * 1.09, washSoft(mv2, .66, fwidth(mv2)) * .7);
  vec3 sandCol = uSand;
  float sv = vnoise(Q * 1.3 + 51.);
  sandCol = mix(sandCol, sandCol * vec3(.93, .92, .9), washSoft(sv, .58, fwidth(sv)) * .8);

  if (fine > 0.) {
    // (every screen derivative is taken here, before the per-region branches below)
    float steep = 1. - smoothstep(.62, .9, n.y);
    float bed = h + (vnoise(Q * .13 + 31.) - .5) * 1.5 + P.x * .05;
    float gBed = fwidth(bed);
    float jx = dot(Q, vec2(.83, .56)) + (vnoise(vec2(h * .9, dot(Q, vec2(-.56, .83)) * .4)) - .5) * .7 + (vnoise(Q * .3 + 77.) - .5) * 2.6;
    float gJ = fwidth(jx);
    float crv = fbm(Q * .4 + vec2(h * .8, 0.) + 60.) - .5;
    float gC = fwidth(crv) + 1e-5;
    float hv = vnoise(Q * 1.1 + vec2(0., h * 1.6) + 12.) - .5;
    float gH = fwidth(hv) + 1e-5;
    float tl = h + (n2 - .5) * .08;
    float gT = fwidth(tl);
    float along = dot(Q, vec2(.8, .6));
    if (rockC > .01) {
      // pen work on the rock: bedding lines that follow the ledges, joints on the steep faces, cracks, crystals
      // On B2's ledged knoll a bedding line was a hand wide. On the game's gentle domes the same height band
      // would be a broad stripe, so its width is capped on the ground (2 cm either side).
      float bedPen = .02 * gBed / max(gq, 1e-5);
      float a1 = bed / uBeds.x + .31;
      float k1 = floor(a1 + .5);
      float beds = penLine(abs(a1 - k1) * uBeds.x, min(.011, bedPen), gBed) * smoothstep(.34, .5, vnoise(vec2(along * .3, k1 * 3.7)));
      float bedFine = uBeds.x * .25;
      float a2 = bed / bedFine + .31;
      float k2 = floor(a2 + .5);
      float fineBeds = penLine(abs(a2 - k2) * bedFine, min(.006, bedPen * .6), gBed) * smoothstep(.5, .62, vnoise(vec2(along * .55, k2 * 5.3)))
        * crowd(gBed / bedFine) * mix(.35, 1., steep);
      float a3 = jx / uBeds.y;
      float k3 = floor(a3 + .5);
      float joints = penLine(abs(a3 - k3) * uBeds.y, .008, gJ) * smoothstep(.45, .6, vnoise(vec2(k3 * 5.1, h * .8 + dot(Q, vec2(-.56, .83)) * .35))) * mix(.35, 1., steep) * crowd(gJ / uBeds.y);
      float crack = clamp(.7 - abs(crv) / gC + .5, 0., 1.) * smoothstep(.3, .5, vnoise(Q * .23 + 5.));
      float hair = clamp(.5 - abs(hv) / gH + .5, 0., 1.) * smoothstep(.55, .7, vnoise(Q * .31 + 31.)) * (1. - smoothstep(.012, .05, px));
      float crystals = flecks(Q, .21, .03, .0055, .42, 3., gq);
      float rockInk = max(max(beds * .62, fineBeds * .42), max(max(joints * .55, crack * .62), max(hair * .36, crystals * .3)));
      rock = mix(rock, vec3(.27, .27, .32), rockInk * mix(1., fine, .75));
      rock = mix(rock, rock * 1.08 + .02, flecks(Q + 3.7, .26, .035, .007, .3, 11., gq) * .7);
    }
    // moss: tufts
    if (mossC > .01) moss = mix(moss, moss * .6, tufts(Q, .3, .12, .55, 5., gq) * .7 * uMoss.w);
    if (sandC > .01) {
      // sand: pebbles, tide lines that follow the shore, a few grains
      vec2 pb = pebbles(Q, .36, .42, 9., gq);
      float pt = hash12(floor(Q / .36) + 4.);
      sandCol = mix(sandCol, mix(uRockA, uRockB, pt) * (.92 + .16 * pt), pb.x);
      sandCol = mix(sandCol, vec3(.27, .27, .32), pb.y * .7);
      float at = tl / .095;
      float kt = floor(at + .5);
      float tide = penLine(abs(at - kt) * .095, .004, gT) * step(kt, 4.5) * step(.5, kt) * smoothstep(.42, .56, vnoise(vec2(along * 1.3, kt * 7.))) * crowd(gT / .095);
      sandCol = mix(sandCol, sandCol * .74, tide * .8);
      sandCol = mix(sandCol, sandCol * .7, flecks(Q + 1.3, .09, .006, .004, .5, 17., gq) * .6);
    }
  }
  // pigment pooled at the edge of each wash
  moss *= 1. - .16 * (1. - smoothstep(0., .05, mossV));
  sandCol *= 1. - .1 * (1. - smoothstep(.5, .62, sandV));
  base = rock * rockC + moss * mossC + sandCol * sandC;
  float wet = 1. - smoothstep(.13, .17, h + (n2 - .5) * .12);
  base *= mix(vec3(1.), vec3(.70, .72, .78), wet);
#else
  if (fine > 0.) base = drawDetail(int(vInfo.z + .5), base, vL, Lx, Ly, vec4(vL, vInfo.w), O.y, gOy, fine, px);
#endif
  base = mix(base, vec3(dot(base, vec3(.3, .5, .2))) * .55 + uPaper * .4, vSpent * .7) * uLight;
  // 3 flat tones with a hand-wobbled terminator
  float lit = dot(n, uLightDir) * .8 + n.y * .2;
  vec4 slow = vnoise4(O.xz * 1.9 + O.y * 1.6 + 2.);       // one lookup: terminator wobble (r), bloom (g)
  float wob = (slow.r - .5) * .2;
  float aa = fwidth(lit) * 1.5 + .004;
  float bHi = smoothstep(-aa, aa, lit + wob - .40);
  float bLo = smoothstep(-aa, aa, lit + wob + .16);
  vec3 c = mix(base * uShadowTint, base, bLo);
  c = mix(c, mix(base, uPaper, .2), bHi);
  // pen hatching in the shadow tone, cut through the object so it stays put when the camera turns
  float hatch = (1. - bLo) * (1. - glow) * uHatch * fine * (1. - smoothstep(25., 150., dist));
  if (uHatch * fine > 0.) c = mix(c, INK, hatchLines(hc, hg, dot(O, HATCH_ALONG), uSc) * hatch * .42);
  // pigment: slow blooms, then granulation at two sizes, each fading before it would turn to noise
  float bloom = slow.g;
  float gran1 = vnoise(O.xz * 7. + O.y * 5.);
  float gran2 = vnoise(O.xz * 29. + O.y * 23. + 5.);
  c *= .95 + .1 * mix(bloom, gran1, .5 * (1. - smoothstep(.02, .07, px)));
  c *= 1. + .075 * (gran2 - .5) * (1. - smoothstep(.005, .014, px));
  c = mix(c, vColor * mix(uLight, vec3(1.), smoothstep(.3, .9, glow)), glow);
  // morning mist
  float fog = 1. - exp(-dist * uFogDensity);
  fog = clamp(fog + smoothstep(70., 320., dist) * smoothstep(7., 0., P.y) * .16, 0., 1.);
  c = mix(c, uFogColor, fog * (1. - glow * .6));
  o0 = vec4(c, 1.);
}`;

function make(defines, extra) {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: extra ? { ...GU, ...extra } : GU,
    defines,
    side: THREE.DoubleSide,
  });
}

export const inkMaterial = make({});

// B2's own island: grey and pink granite, moss on the flats, a sand beach. presets.ts varies it by region.
export const TERRAIN_DEFAULTS = {
  rockA: PAL.granite, rockB: PAL.granitePink, rockDark: PAL.graniteDark, lichen: PAL.lichen,
  mossA: PAL.moss, mossB: PAL.mossDeep, sand: PAL.sand,
  mossSlope: 0.86, mossFloor: 0.8, mossBias: 0, tufts: 1, bedSpacing: 1.25, jointSpacing: 1.1,
};

// A terrain material for one preset. Every preset shares the palette, the noise and the pass switches.
export function terrainMaterialFor(preset = {}) {
  const p = { ...TERRAIN_DEFAULTS, ...preset };
  return make({ TERRAIN: 1 }, {
    uRockA: { value: new THREE.Color(p.rockA) },
    uRockB: { value: new THREE.Color(p.rockB) },
    uRockDark: { value: new THREE.Color(p.rockDark) },
    uLichen: { value: new THREE.Color(p.lichen) },
    uMossA: { value: new THREE.Color(p.mossA) },
    uMossB: { value: new THREE.Color(p.mossB) },
    uSand: { value: new THREE.Color(p.sand) },
    uMoss: { value: new THREE.Vector4(p.mossSlope, p.mossFloor, p.mossBias, p.tufts) },
    uBeds: { value: new THREE.Vector2(p.bedSpacing, p.jointSpacing) },
  });
}

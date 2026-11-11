// Ink & Wash — palette, shared uniforms and the two surface materials.
// Everything that defines "what colour and how it is shaded" lives here.
import * as THREE from 'three';

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
  uFogDensity: { value: 0.0036 },
  uFlip: { value: 1 }, // -1 while the mirrored reflection pass renders
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
in vec2 aInfo;
out vec3 vColor;
out vec3 vN;
out vec3 vWorld;
flat out vec2 vInfo;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.);
  vWorld = wp.xyz;
  vN = mat3(modelMatrix) * normal;
  vColor = aColor;
  vInfo = aInfo;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */ `
precision highp float;
in vec3 vColor;
in vec3 vN;
in vec3 vWorld;
flat in vec2 vInfo;
layout(location = 0) out vec4 oColor;
layout(location = 1) out vec4 oAux;
uniform vec3 uLightDir, uPaper, uShadowTint, uFogColor;
uniform float uFogDensity, uFlip, uTime;
${NOISE}
void main(){
  if (uFlip < 0. && vWorld.y > 0.) discard;
  vec3 P = vec3(vWorld.x, vWorld.y * uFlip, vWorld.z);
  vec3 gn = normalize(vN);
  if (!gl_FrontFacing) gn = -gn;
  vec3 n = vec3(gn.x, gn.y * uFlip, gn.z);
  vec3 base = vColor;
  float id = vInfo.x;
  float glow = vInfo.y;
#ifdef TERRAIN
  float h = P.y;
  float n1 = fbm(P.xz * .11 + 3.);
  float n2 = vnoise(P.xz * .55 + 9.);
  vec3 rock = mix(${glsl(PAL.granite)}, ${glsl(PAL.granitePink)}, smoothstep(.49, .51, n1));
  rock = mix(rock, ${glsl(PAL.graniteDark)}, smoothstep(.66, .68, n2) * .45);
  float li = smoothstep(.76, .78, vnoise(P.xz * 2.7 + 40.));
  rock = mix(rock, ${glsl(PAL.lichen)}, li * .3);
  float mossM = (n.y - .86) + (fbm(P.xz * .33 + 20.) - .5) * .42 + (h - 1.6) * .03;
  mossM = step(0., mossM) * step(.8, h);
  vec3 moss = mix(${glsl(PAL.moss)}, ${glsl(PAL.mossDeep)}, smoothstep(.5, .52, vnoise(P.xz * .7 + 70.)));
  base = mix(rock, moss, mossM);
  id = mix(.11, .35, mossM);
  float sand = step(.5, vColor.r * (1. - smoothstep(.75, 1.15, h + (n2 - .5) * .5)));
  base = mix(base, ${glsl(PAL.sand)}, sand);
  id = mix(id, .52, sand);
  // joints in the granite: a few wandering pen lines, only up close
  float cr = abs(fbm(P.xz * .4 + vec2(P.y * .8, 0.) + 60.) - .5);
  float crack = (1. - smoothstep(.003, .007, cr)) * (1. - mossM) * (1. - sand);
  float nearRock = 1. - smoothstep(26., 60., length(vWorld - cameraPosition));
  crack *= smoothstep(.3, .5, vnoise(P.xz * .23 + 5.)) * nearRock;
  // finer hairline set, fainter
  float cr2 = abs(vnoise(P.xz * 1.1 + vec2(0., P.y * 1.6) + 12.) - .5);
  float hair = (1. - smoothstep(.004, .01, cr2)) * (1. - mossM) * (1. - sand) * smoothstep(.55, .7, vnoise(P.xz * .31 + 31.)) * nearRock;
  base = mix(base, vec3(.27, .27, .32), max(crack * .7, hair * .4));
  float wet = 1. - smoothstep(.13, .17, h + (n2 - .5) * .12);
  base *= mix(vec3(1.), vec3(.70, .72, .78), wet);
  glow = 0.;
#endif
  // 3 flat tones with a hand-wobbled terminator
  float lit = dot(n, uLightDir) * .8 + n.y * .2;
  float wob = (vnoise(P.xz * 2.3 + P.y * 1.9) - .5) * .2;
  float aa = fwidth(lit) * 1.5 + .004;
  float bHi = smoothstep(-aa, aa, lit + wob - .40);
  float bLo = smoothstep(-aa, aa, lit + wob + .16);
  vec3 c = mix(base * uShadowTint, base, bLo);
  c = mix(c, mix(base, uPaper, .2), bHi);
  // pigment granulation
  c *= .95 + .1 * vnoise(P.xz * 7. + P.y * 5.);
  c = mix(c, vColor, glow);
  // morning mist
  float dist = length(vWorld - cameraPosition);
  float fog = 1. - exp(-dist * uFogDensity);
  fog = clamp(fog + smoothstep(70., 320., dist) * smoothstep(7., 0., P.y) * .22, 0., 1.);
  c = mix(c, uFogColor, fog * (1. - glow * .6));
  oColor = vec4(c, 1.);
  vec3 vn = normalize(mat3(viewMatrix) * gn);
  float nearWater = step(abs(P.y), .11);
  oAux = vec4(vn.xy * .5 + .5, (1. - bLo) * (1. - glow) * .45 + nearWater * .5, id);
}`;

function make(defines) {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: GU,
    defines,
    side: THREE.DoubleSide,
  });
}

export const inkMaterial = make({});
export const terrainMaterial = make({ TERRAIN: 1 });

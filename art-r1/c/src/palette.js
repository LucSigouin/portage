// Blue Hour palette, shared materials and the atmosphere GLSL every shader mixes into.
// One file to retune the whole look: colours here, fog maths here, nothing hard-coded elsewhere.
import * as THREE from 'three';

export const PAL = {
  // sky and mist
  zenith: '#040818', high: '#0d1a44', mid: '#1f3668',
  mistCool: '#3f5f90', mistRose: '#5f5490', ember: '#ff7636',
  // water
  waterDeep: '#020612', waterBody: '#07182c', waterShallow: '#27565f', foam: '#d8e4fb',
  // granite and growth
  granite: '#5b5f76', granitePink: '#8d7480', graniteWet: '#15182a', moss: '#4e6548', gravel: '#8f8a84',
  pine: '#0d2226', pineLit: '#234a47', trunk: '#33292c', birch: '#e8eaf0', birchMark: '#26272f', birchLeaf: '#d6b848',
  bush: '#3f6048', berry: '#ff4a5a', reed: '#7a845e', snag: '#8a8b96',
  // built things
  wood: '#946a4c', woodDark: '#54392d', woodPale: '#a89f90', drift: '#d3cec3',
  hull: '#9c3d31', hullIn: '#a98562', patchBark: '#d8d3c4', patchTar: '#17161c',
  canvas: '#d9cfb6', canvasShade: '#a89a80', tarp: '#5f6f58',
  iron: '#24252e', tin: '#93a0b2', rust: '#7a4636', copper: '#b9704a', rope: '#c0a77c',
  paintTeal: '#3f7d82', stone: '#7b7a86', soil: '#3a2c28', leaf: '#5d8a4c', tomato: '#e2463a',
  flagRed: '#b84a3c', flagMustard: '#d6a035', flagTeal: '#3f8a8c', flagCream: '#e9e0c8',
  // paddler
  coat: '#d09b2c', trousers: '#2a2f45', skin: '#dba587', toque: '#b5463a', scarf: '#e6dcc4', boot: '#1f1d22',
  // the one accent
  amber: '#ffb454',
};

/** Compass direction of the sunken sun: 30 degrees left of the player's first heading (-Z). */
export const SUN_AZIMUTH = (30 * Math.PI) / 180;
export const SUN_DIR = new THREE.Vector3(-Math.sin(SUN_AZIMUTH), 0, -Math.cos(SUN_AZIMUTH));

const glsl = (hex) => {
  const c = new THREE.Color(hex);
  return `vec3(${c.r.toFixed(5)}, ${c.g.toFixed(5)}, ${c.b.toFixed(5)})`;
};

/** Shared atmosphere: horizon colour by azimuth, sky gradient, analytic height fog. Linear colour space. */
export const ATMOSPHERE_GLSL = /* glsl */ `
const vec3 BH_ZENITH = ${glsl(PAL.zenith)};
const vec3 BH_HIGH = ${glsl(PAL.high)};
const vec3 BH_MID = ${glsl(PAL.mid)};
const vec3 BH_COOL = ${glsl(PAL.mistCool)};
const vec3 BH_ROSE = ${glsl(PAL.mistRose)};
const vec3 BH_EMBER = ${glsl(PAL.ember)};
const vec2 BH_SUN = vec2(${SUN_DIR.x.toFixed(5)}, ${SUN_DIR.z.toFixed(5)});

float bhSunward(vec3 d) {
  vec2 h = d.xz / max(length(d.xz), 1e-4);
  return dot(h, BH_SUN);
}
vec3 bhHorizon(vec3 d) {
  float az = max(bhSunward(d), 0.0);
  vec3 c = mix(BH_COOL, BH_ROSE, pow(az, 5.0) * 0.85);
  c = mix(c, BH_EMBER, pow(az, 26.0) * 0.8);
  return c;
}
vec3 bhSky(vec3 d) {
  float y = max(d.y, 0.0);
  float az = bhSunward(d);
  float warm = pow(max(az, 0.0), 4.0);
  vec3 c = mix(BH_MID, BH_HIGH, smoothstep(0.03, 0.34, y));
  c = mix(c, BH_ZENITH, smoothstep(0.26, 0.9, y));
  c = mix(c, BH_ROSE * 0.75, warm * exp(-y * 4.5) * 0.5);
  c = mix(c, bhHorizon(d), exp(-y * 9.0));
  return c;
}
// Optical depth through mist that thins with height, integrated along the view ray.
float bhFog(vec3 cam, vec3 off, float density) {
  float dist = length(off);
  float t = clamp(0.05 * off.y, -6.0, 40.0);
  float f = abs(t) > 1e-3 ? (1.0 - exp(-t)) / t : 1.0;
  float od = dist * (0.0039 * exp(-0.05 * max(cam.y, 0.0)) * f + 0.0005) * density;
  return 1.0 - exp(-od);
}
`;

/** Swap three's flat fog for the layered Blue Hour mist on every built-in material. */
export function installAtmosphere() {
  // Evaluated per vertex (meshes here are finely tessellated); the fragment stage is a single mix.
  THREE.ShaderChunk.fog_pars_vertex = `#ifdef USE_FOG
  varying vec4 vFogMix;
  uniform float fogDensity;
  ${ATMOSPHERE_GLSL}
#endif`;
  THREE.ShaderChunk.fog_vertex = `#ifdef USE_FOG
  vec3 bhOff = (vec4(mvPosition.xyz, 0.0) * viewMatrix).xyz;
  vFogMix = vec4(bhHorizon(bhOff), bhFog(cameraPosition, bhOff, fogDensity));
#endif`;
  THREE.ShaderChunk.fog_pars_fragment = '#ifdef USE_FOG\n  varying vec4 vFogMix;\n#endif';
  THREE.ShaderChunk.fog_fragment = '#ifdef USE_FOG\n  gl_FragColor.rgb = mix(gl_FragColor.rgb, vFogMix.rgb, vFogMix.a);\n#endif';
}

const lambert = (color, extra) => new THREE.MeshLambertMaterial({ color, ...extra });
const phong = (color, shininess, specular, extra) => new THREE.MeshPhongMaterial({ color, shininess, specular, ...extra });
const glow = (r, g, b) => new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(r, g, b), fog: false });

export const MAT = {
  wood: lambert(PAL.wood), woodDark: lambert(PAL.woodDark), woodPale: lambert(PAL.woodPale), drift: lambert(PAL.drift),
  hull: lambert(PAL.hull), hullIn: lambert(PAL.hullIn), patchBark: lambert(PAL.patchBark), patchTar: lambert(PAL.patchTar),
  canvas: lambert(PAL.canvas, { side: THREE.DoubleSide }), canvasShade: lambert(PAL.canvasShade, { side: THREE.DoubleSide }),
  tarp: lambert(PAL.tarp, { side: THREE.DoubleSide }),
  iron: phong(PAL.iron, 46, '#5a6a92'), tin: phong(PAL.tin, 70, '#b6c4e6'), rust: lambert(PAL.rust),
  copper: phong(PAL.copper, 60, '#ffc79a'), rope: lambert(PAL.rope), paintTeal: lambert(PAL.paintTeal),
  stone: lambert(PAL.stone), soil: lambert(PAL.soil), leaf: lambert(PAL.leaf), tomato: lambert(PAL.tomato),
  flagRed: lambert(PAL.flagRed, { side: THREE.DoubleSide }), flagMustard: lambert(PAL.flagMustard, { side: THREE.DoubleSide }),
  flagTeal: lambert(PAL.flagTeal, { side: THREE.DoubleSide }), flagCream: lambert(PAL.flagCream, { side: THREE.DoubleSide }),
  coat: lambert(PAL.coat), trousers: lambert(PAL.trousers), skin: lambert(PAL.skin), toque: lambert(PAL.toque),
  scarf: lambert(PAL.scarf), boot: lambert(PAL.boot),
  fish: phong('#aab6c8', 80, '#ffffff'), bilge: phong('#0a1626', 120, '#9fb4ff'),
  // vertex-coloured naturals
  terrain: lambert('#ffffff', { vertexColors: true }), foliage: lambert('#ffffff', { vertexColors: true }),
  bark: lambert('#ffffff', { vertexColors: true }),
  // emitters: values above 1 feed the bloom
  lampGlass: glow(5.2, 2.7, 0.9), emberGlow: glow(5.5, 1.5, 0.3), bulb: glow(3.4, 2.0, 0.85),
  beacon: glow(4.0, 0.35, 0.25), dial: glow(2.2, 1.3, 0.45), berry: glow(1.5, 0.22, 0.3),
};

/** Deterministic canvas texture helper. */
export function canvasTexture(width, height, draw, { repeat = false } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  if (repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// Ink & Wash — drawn interior detail. The pen marks inside a wash: grain, bark, needles, shingles,
// stitches, rope lay, creases. Every mark is computed from the piece's own coordinates (object space),
// so it rides with the piece and never crawls on screen. Each one is anti-aliased against its own
// size on screen and fades out before it would crowd into noise.
//
// No derivative is taken inside a branch: the caller takes dFdx/dFdy of the local frame once and
// every pattern works its pixel size out from those (branch-safe on every graphics driver).
import * as THREE from 'three';

// What a piece is made of. The builder guesses from the colour; pass { kind } to say otherwise.
export const KIND = {
  PLAIN: 0,
  WOOD: 1,
  BARK: 2,
  NEEDLE: 3,
  LEAF: 4,
  CLOTH: 5,
  METAL: 6,
  ROPE: 7,
  SHINGLE: 8,
  STONE: 9,
  DRIFT: 10,
  BIRCH: 11,
  PAINT: 12,
  SIDING: 13, // board lines; seed = board height in metres
  PATCH: 14, // stitched patch: aTex = (x, y, width, height) in metres
  CANE: 15,
  SOIL: 16,
};

// Kinds whose marks run along the piece's long axis (the builder turns the local frame so x is "along").
export const DIRECTIONAL = new Set([KIND.WOOD, KIND.BARK, KIND.DRIFT, KIND.BIRCH, KIND.PAINT, KIND.SHINGLE, KIND.METAL, KIND.ROPE]);

const _c = new THREE.Color();
const _hsl = { h: 0, s: 0, l: 0 };
const guessCache = new Map();
// Say what one colour is made of, where the guess from its hue would be wrong (rope, canvas, bamboo...).
export function tagColor(color, kind) {
  guessCache.set(color, kind);
}
export function kindOf(color) {
  let k = guessCache.get(color);
  if (k !== undefined) return k;
  _c.set(color).getHSL(_hsl);
  const h = _hsl.h * 360;
  const { s, l } = _hsl;
  if (s < 0.13) k = l > 0.86 ? KIND.CLOTH : KIND.METAL; // greys: iron, tin, steel
  else if (h >= 175 && h < 260) k = KIND.METAL; // painted drums, slate, blued steel
  else if (h >= 62 && h < 175) k = KIND.LEAF;
  else if (l > 0.8 && h >= 28 && h < 62) k = KIND.CLOTH; // cream, canvas
  else if (h >= 16 && h < 48 && s < 0.6) k = KIND.WOOD;
  else k = KIND.PAINT; // rust reds, ochres
  guessCache.set(color, k);
  return k;
}

export const DETAIL = /* glsl */ `
// one pen stroke, anti-aliased. d: distance from the stroke's centre line, hw: half width, g: that unit per pixel.
// A stroke thinner than a pixel stays a pixel wide and goes fainter instead of breaking up.
float penLine(float d, float hw, float g){
  g += 1e-6;
  float w = max(hw, .5 * g);
  return clamp((w - d) / g + .5, 0., 1.) * min(1., hw / (.5 * g));
}
// a hard wash edge without stair-steps. w: how much of x one pixel spans
float washSoft(float x, float edge, float w){
  return clamp((x - edge) / (w + 1e-5) + .5, 0., 1.);
}
// pixel size of a straight-line coordinate dot(grad, L), from the local frame's screen derivatives
float pxOf(vec3 grad, vec3 Lx, vec3 Ly){
  return abs(dot(grad, Lx)) + abs(dot(grad, Ly));
}
// patterns thin out as their spacing nears two pixels: g = spacings per pixel
float crowd(float g){ return 1. - smoothstep(.14, .34, g); }

// long broken lines running along L.x: wood grain, bark, brush streaks, scratches.
// per: spacing, dash: dash length, fill: share of dashes drawn, hw: half width, wav: waviness (all metres)
float grainLines(vec3 L, vec3 Lx, vec3 Ly, float s, float per, float dash, float fill, float hw, float wav){
  float u = L.x;
  float v = L.y * .92 + L.z * .78;
  float c = (v + (vnoise(vec2(u * .8, v * 3.) + s * 31.) - .5) * wav) / per + s * 9.;
  float g = pxOf(vec3(0., .92, .78), Lx, Ly) / per;
  float k = floor(c + .5);
  float d = abs(c - k);
  float hk = hash12(vec2(k, s * 57.));
  float q = u / dash + hk * 11.;
  float seg = floor(q);
  float e = q - seg;
  float on = step(1. - fill, hash12(vec2(k * 1.7 + 3., seg + s * 13.)));
  float taper = smoothstep(0., .1, e) * smoothstep(1., .82, e);
  float hwc = hw / per * (.6 + .8 * hash12(vec2(seg, k)));
  return penLine(d, hwc, g) * on * taper * crowd(g);
}

// short marks across the long axis: lenticels on birch
float crossTicks(vec3 L, vec3 Lx, vec3 Ly, float s, float per, float arc, float fill, float hw){
  float c = L.x / per + s * 5.;
  float g = pxOf(vec3(1., 0., 0.), Lx, Ly) / per;
  float k = floor(c + .5);
  float d = abs(c - k);
  float v = (L.y * .9 + L.z * .8) / arc + hash12(vec2(k, s)) * 7.;
  float seg = floor(v);
  float e = v - seg;
  float on = step(1. - fill, hash12(vec2(k + 5., seg + s * 3.)));
  return penLine(d, hw / per, g) * on * smoothstep(0., .15, e) * smoothstep(1., .8, e) * crowd(g);
}

// a wandering pen line: the middle contour of a noise field (folds, scuffs). f: wiggles per metre, px: metres per pixel
float wander(vec2 p, float f, float px){
  float v = abs(vnoise(p * f) - .5);
  float w = f * px * 1.3;
  return (1. - smoothstep(w * .35, w * 1.35, v)) * (1. - smoothstep(.1, .25, f * px));
}

// scattered short marks, one per cell, each at its own angle. g: metres per pixel on this surface
float flecks(vec2 p, float cell, float len, float hw, float fill, float seed, float g){
  vec2 q = p / cell;
  vec2 i = floor(q);
  vec2 f = q - i;
  float r = hash12(i + seed);
  float r2 = hash12(i + seed + 7.3);
  float r3 = hash12(i + seed + 19.1);
  vec2 c = vec2(.32 + .36 * r2, .32 + .36 * r3);
  float ang = r * 43.;
  vec2 dir = vec2(cos(ang), sin(ang));
  vec2 d = (f - c) * cell;
  float t = clamp(dot(d, dir), -len, len);
  float dd = length(d - dir * t);
  return penLine(dd, hw, g) * step(r, fill) * smoothstep(3., 7., cell / (g + 1e-6));
}

// grass marks: three short blades fanning from one root, one tuft per cell
float tufts(vec2 p, float cell, float len, float fill, float seed, float g){
  vec2 q = p / cell;
  vec2 i = floor(q);
  vec2 f = q - i;
  float r = hash12(i + seed);
  vec2 c = vec2(.3 + .4 * hash12(i + seed + 3.1), .22 + .2 * hash12(i + seed + 11.7));
  vec2 d = (f - c) * cell;
  float a = 0.;
  for (int k = 0; k < 3; k++) {
    float ang = (float(k) - 1.) * .5 + (r - .5) * .5;
    vec2 dir = vec2(sin(ang), cos(ang));
    float l = len * (k == 1 ? 1. : .72);
    float t = clamp(dot(d, dir), 0., l);
    a = max(a, penLine(length(d - dir * t), .0045, g) * (1. - .5 * t / l));
  }
  return a * step(r, fill) * smoothstep(4., 9., cell / (g + 1e-6));
}

// pebbles: one flattened stone per cell. Returns (body, inked underside)
vec2 pebbles(vec2 p, float cell, float fill, float seed, float g){
  vec2 q = p / cell;
  vec2 i = floor(q);
  vec2 f = q - i;
  float r = hash12(i + seed);
  vec2 c = vec2(.3 + .4 * hash12(i + seed + 5.3), .3 + .4 * hash12(i + seed + 2.9));
  vec2 d = (f - c) * cell;
  float rad = cell * (.1 + .16 * hash12(i + seed + 8.8));
  d.y *= 1.5;
  float dist = length(d) - rad;
  float lod = step(r, fill) * smoothstep(3.5, 8., cell / (g + 1e-6));
  float body = clamp(-dist / (g + 1e-6) + .5, 0., 1.);
  float rim = penLine(abs(dist), .004, g) * smoothstep(-.4, .5, d.y / rad);
  return vec2(body, rim) * lod;
}

// dashed running stitch just inside the border of a rectangle. T = (x, y, width, height) in metres
float stitches(vec4 T, float g){
  vec2 e = min(T.xy, T.zw - T.xy);
  float d = min(e.x, e.y);
  float along = e.x < e.y ? T.y : T.x;
  return penLine(abs(d - .032), .0065, g) * step(.42, fract(along / .062)) * smoothstep(3., 7., .06 / (g + 1e-6));
}

// The marks for one piece. Returns the wash colour with its pen work on it.
// L: piece-local metres (x runs along the grain) with screen derivatives Lx, Ly; T: raw local frame + seed;
// Oy: object-space height with its pixel size gOy; px: metres per pixel at this distance
vec3 drawDetail(int kind, vec3 base, vec3 L, vec3 Lx, vec3 Ly, vec4 T, float Oy, float gOy, float fine, float px){
  float s = T.w;
  vec3 c = base;
  float dark = 0.;
  float light = 0.;
  if (kind == 1) { // wood: a few long grain lines, a darker heart streak
    c *= 1. - .07 * washSoft(vnoise(vec2(L.x * .45, (L.y + L.z) * 5.) + s * 40.), .66, px * 12.);
    dark = grainLines(L, Lx, Ly, s, .048, .8, .5, .0032, .028) * .62;
  } else if (kind == 2) { // bark: short dense strokes
    c *= 1. - .1 * washSoft(vnoise(vec2(L.x * 1.4, (L.y - L.z) * 7.) + s * 23.), .55, px * 16.);
    dark = grainLines(L, Lx, Ly, s, .034, .2, .62, .0045, .02) * .7;
  } else if (kind == 3) { // conifer bough: needle strokes raking outward, clusters of darker wash
    float rho = length(L.xz);
    float th = atan(L.z, L.x);
    c *= 1. - .2 * washSoft(vnoise(L.xz * 2.1 + L.y * 1.3 + s * 17.), .56, px * 5.);
    c = mix(c, c * 1.12 + .02, washSoft(vnoise(L.xz * 3.3 + s * 5.), .72, px * 8.) * .6);
    float n = 30.;
    float a = th / 6.2832 * n + s * 13. + (vnoise(vec2(rho * 3., th * 2.) + s) - .5) * .5;
    float k = floor(a + .5);
    float gA = (length(abs(Lx.xz) + abs(Ly.xz)) / max(rho, .05)) * n / 6.2832;
    float q = rho / .2 + hash12(vec2(k, s)) * 9.;
    float seg = floor(q);
    float e = q - seg;
    float on = step(.4, hash12(vec2(k + 2., seg + s * 7.)));
    dark = penLine(abs(a - k), .085, gA) * on * smoothstep(0., .2, e) * smoothstep(1., .7, e) * crowd(gA) * .8;
  } else if (kind == 4) { // leaves and brush: dabs and short leaf ticks
    vec2 q2 = vec2(L.x + L.z * .55, L.y + L.z * .3);
    float gq = length(abs(vec2(Lx.x + Lx.z * .55, Lx.y + Lx.z * .3)) + abs(vec2(Ly.x + Ly.z * .55, Ly.y + Ly.z * .3))) * .7071;
    c *= 1. - .12 * washSoft(vnoise(q2 * 4.2 + s * 9.), .55, px * 10.);
    c = mix(c, c * 1.12, washSoft(vnoise(q2 * 6.5 + s * 3. + 9.), .72, px * 16.) * .6);
    dark = flecks(q2, .11, .03, .0045, .6, s * 19., gq) * .55;
  } else if (kind == 5) { // cloth: soft folds and a few creases
    c *= 1. - .05 * washSoft(vnoise(vec2(L.x * 1.6, L.y * 1.1 + L.z * 1.3) + s * 12.), .6, px * 4.);
    dark = max(grainLines(L, Lx, Ly, s, .034, .06, .2, .0022, .0), grainLines(L.yxz, Lx.yxz, Ly.yxz, s + .31, .034, .06, .16, .0022, .0)) * .34;
  } else if (kind == 6) { // metal: scuffs and one bright streak
    c *= 1. - .08 * washSoft(vnoise(vec2(L.x * 2.2, (L.y + L.z) * 3.1) + s * 33.), .62, px * 6.);
    dark = grainLines(L, Lx, Ly, s, .09, .22, .32, .003, .01) * .4;
    light = grainLines(L, Lx, Ly, s + .37, .13, .5, .3, .004, .0) * .5;
  } else if (kind == 7) { // rope: the lay of the strands
    float a = (L.x + L.y * 1.1) / .034;
    float g = pxOf(vec3(1., 1.1, 0.), Lx, Ly) / .034;
    dark = penLine(abs(a - floor(a + .5)), .13, g) * crowd(g) * .55;
  } else if (kind == 8) { // shingles: split shakes, each its own tone
    float a = L.x / .27 + s * 3.;
    float jit = (hash12(vec2(floor(a), s * 91.)) - .5) * .5;
    float a2 = a - jit;
    c *= .9 + .2 * hash12(vec2(floor(a2), s * 37.));
    float g = pxOf(vec3(1., 0., 0.), Lx, Ly) / .27;
    dark = penLine(abs(a2 - floor(a2 + .5)), .028, g) * crowd(g) * .75;
    dark = max(dark, grainLines(L, Lx, Ly, s, .06, .5, .3, .003, .01) * .3);
  } else if (kind == 9) { // stone: speckle and one crack
    vec2 q2 = vec2(L.x + L.z * .6, L.y - L.z * .4);
    float gq = length(abs(vec2(Lx.x + Lx.z * .6, Lx.y - Lx.z * .4)) + abs(vec2(Ly.x + Ly.z * .6, Ly.y - Ly.z * .4))) * .7071;
    dark = max(flecks(q2, .05, .008, .004, .5, s * 7., gq) * .45, wander(q2 + s * 13., 5., px) * .4);
  } else if (kind == 10) { // driftwood: silvered, long checks
    c *= 1. - .06 * washSoft(vnoise(vec2(L.x * .7, (L.y + L.z) * 6.) + s * 11.), .6, px * 12.);
    dark = grainLines(L, Lx, Ly, s, .04, .55, .58, .003, .035) * .5;
  } else if (kind == 11) { // birch: dark lenticels across the trunk
    dark = crossTicks(L, Lx, Ly, s, .12, .09, .5, .008) * .7;
    c *= 1. - .05 * washSoft(vnoise(vec2(L.x * 1.1, L.y * 4.) + s * 3.), .64, px * 8.);
  } else if (kind == 12) { // paint: brush drag along the piece, a few worn scratches
    c *= .965 + .07 * vnoise(vec2(L.x * .7, (L.y * .9 + L.z * .8) * 11.) + s * 29.) * (1. - smoothstep(.01, .03, px));
    dark = grainLines(L, Lx, Ly, s, .075, .45, .26, .0028, .012) * .42;
    light = grainLines(L, Lx, Ly, s + .5, .11, .3, .2, .0035, .02) * .4;
  } else if (kind == 13) { // siding: board lines
    float per = max(s, .05);
    float a = Oy / per;
    float g = gOy / per;
    dark = penLine(abs(a - floor(a + .5)), .05, g) * crowd(g) * .5;
  } else if (kind == 14) { // patch: a running stitch round the edge
    dark = stitches(T, max(abs(Lx.x) + abs(Ly.x), abs(Lx.y) + abs(Ly.y))) * .8;
  } else if (kind == 15) { // cane seat: a woven lattice
    vec2 a = vec2(L.x + L.z, L.x - L.z) / .03;
    vec2 g = vec2(pxOf(vec3(1., 0., 1.), Lx, Ly), pxOf(vec3(1., 0., -1.), Lx, Ly)) / .03;
    float l1 = penLine(abs(a.x - floor(a.x + .5)), .12, g.x);
    float l2 = penLine(abs(a.y - floor(a.y + .5)), .12, g.y);
    dark = max(l1, l2) * crowd(max(g.x, g.y)) * .45;
  } else if (kind == 16) { // soil in the planters: crumbs
    dark = flecks(L.xz, .045, .008, .005, .6, s * 3., length(abs(Lx.xz) + abs(Ly.xz)) * .7071) * .5;
  }
  dark *= fine;
  light *= fine;
  c = mix(c, mix(c * .42, vec3(.165, .169, .2), .28), dark);
  c = mix(c, mix(c, vec3(.99, .97, .92), .5), light);
  return c;
}

// pen hatching in the shadow tone: parallel cuts through the object, so the lines follow its form.
// c: dot(objectPosition, HATCH_DIR), g: metres of c per pixel, along: a coordinate along the lines.
// The spacing is picked per octave from the pixel size: as you back away every other line fades out.
const vec3 HATCH_DIR = vec3(.602, .68, .418);
const vec3 HATCH_ALONG = vec3(-.749, .663, 0.);
float hatchLines(float c, float g, float along, float sc){
  g += 1e-6;
  float l = log2(7.5 * sc * g / .02);
  float l0 = floor(l);
  float f = l - l0;
  float per = .02 * exp2(l0);
  float a = c / per;
  float k = floor(a + .5);
  float w = mix(1., 1. - smoothstep(.15, .85, f), mod(k, 2.));
  float line = penLine(abs(a - k) * per, .62 * sc * g, g);
  float br = vnoise(vec2(k * per * 365., along / (per * 7.5)));
  return line * w * smoothstep(.3, .52, br);
}
`;

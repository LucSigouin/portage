// Ink & Wash — frame pipeline (B2: sharp).
//   1. mirrored scene -> reflection target (first thing the frame-rate ladder shrinks)
//   2. scene          -> colour, multisampled 4x: clean silhouettes, read back at exact pixel centres
//   3. scene          -> ink buffer at up to twice the screen size (normal, ink id, line wobble) + depth:
//                        cheap to fill, and it is what lets the pen lines be anti-aliased
//   4. composite      -> colour + pen lines + white contact foam, paper frame, paper tooth.
//                        Where an edge is near, the pen is worked out at four points inside the pixel
//                        (one per ink-buffer texel) and averaged: that is its anti-aliasing.
//   5. heroes         -> the crew and the canoe, drawn again on their own at the window's full size, whatever
//                        the world behind was drawn at. See "The hero pass" below.
// Nothing here resamples the colour, so nothing is smeared. The hand-drawn unevenness moves where a
// line sits (and how heavy it is), and that wobble is read from the object the line belongs to.
//
// The hero pass. The world (steps 1 to 4) may be drawn smaller than the window: over the pixel budget, at
// render scale below 1, or on the last rungs of the frame-rate ladder. It is then stretched to the window.
// The heroes are never in it. For each hero window (a rectangle of the screen around a hero):
//   a. hero colour: the world's depth is copied in, then the heroes are drawn at one sample per window
//      pixel (4x multisampled), so the world still hides what it should
//   b. hero ink: the world's ink buffer and depth are copied in, then the heroes are drawn over it at two
//      texels per window pixel, with fine strokes on. Hero texels are marked (normal.x + 2).
//   c. the same pen as step 4 runs on that merged buffer at the window's size, and writes only the pixels
//      that a hero touches: the hero itself, and its lines and foam. Every other pixel keeps the world.
// One pen, one line weight (pen widths are in window pixels at both sizes), so there is no seam.
//
// A small hero gets a finer pen. The pen's width is in pixels, so on a hero that is small on the window (zoomed
// far out, or a crewmate a long way off) the full pen is a black blob round an 80-pixel figure. heroPen() says
// how much of its width the pen keeps, from how much of the world the window's height covers at the hero's
// depth: all of it up to HERO_PEN.start metres (every normal play distance), then less, smoothly, down to
// HERO_PEN.floor. It is worked out per pixel from the depth of the nearest hero texel in the pen's reach, so it
// changes smoothly with zoom and does not depend on which window a hero falls in. Only pen points within the
// thinned pen's reach of a hero use it; the rest of the window draws the world's own lines at the world's width.
import * as THREE from 'three';
import { PAL, GU, NOISE, wearMaterials } from './palette.js';
import { DEFAULT_PEN, penDefines } from './pens.js';

// start: metres of world across the window's height at the hero's depth, up to which the pen is full (14.3 m away
// at a 60 degree field of view: past the far end of the long hull in the staged full-canoe view, whose camera
// is 10.5 m out, and so past everything at the default camera distances of 6 and 8.5 m).
// fall: how fast it thins past that (half its width at 18 m, the walking camera fully out).
// floor: the share of its width it never goes under.
export const HERO_PEN = { start: 16.5, fall: 37, floor: 0.3 };

// The crew's own render layer. Every mesh of a figure (its body, its paddle, the tin or tool in its hand) is on it as
// well as on the default layer. The hero pass draws the crew a second time into its ink buffer, marking their
// texels (normal.x 4 higher instead of 2), and the pen draws the edge between a figure and anything that is not
// that figure as a contour, at full ink: against the ground it stands on and the hull it sits in, where the depth
// barely steps, as against water and sky (Luc's list, item 10: before, those edges were drawn as light interior
// seams, grey and broken, and fainter still far off).
export const CREW_LAYER = 1;

// The share of its full width the pen keeps on a hero, where the window's height covers `span` metres of world.
// The shader's heroPen() is this, with the same numbers.
export function heroPen(span) {
  const past = Math.max(0, span / HERO_PEN.start - 1);
  const fallen = HERO_PEN.fall * past * past;
  return 1 - ((1 - HERO_PEN.floor) * fallen) / (1 + fallen);
}

const COMPOSITE = /* glsl */ `
precision highp float;
uniform sampler2D tColor, tAux, tDepth;
uniform vec2 uRes, uARes, uPx;   // sheet size in pixels, ink buffer size in texels, one pixel in the ink buffer's uv
#ifdef HERO
uniform sampler2D tHero;
uniform vec4 uRect;              // the hero window on the sheet, in uv: origin, size
uniform vec2 uFill, uRectPx;     // share of the hero buffers the window fills, and its origin in pixels
uniform float uSpan, uThin;      // 2 tan(half the field of view); 1 thins the pen on small heroes, 0 never does
#endif
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
#ifdef PEN_FULL
// A fuller pen: one of the samples of pens.js, C (bold) by default, another by ?pen=. Today's pen (?pen=today) is drawn with PEN_FULL not defined,
// so none of these blocks is in it. gFull: how much of the fuller pen this pixel gets, 0 (today's pen) to 1.
float gFull = 1.;
// The ground's own washes: the terrain's three ink ids (rock .11, moss .35, sand .52: palette.js) as the half-float
// ink buffer holds them. A chip may round a number down or to the nearest when it stores it, so both neighbours are
// taken: .11 is 1802 or 1803 of 16384, .35 is 1433 or 1434 of 4096, .52 is 1064 or 1065 of 2048.
// An edge between two of them is where one wash meets the next, not the outline of a thing.
float groundAt(float id){
  return step(abs(id * 16384. - 1802.5), .75) + step(abs(id * 4096. - 1433.5), .75) + step(abs(id * 2048. - 1064.5), .75);
}
#endif

#ifdef HERO
// the hero buffers hold one window: a read past its edge takes the edge, as a read past the screen's edge does
vec2 inWindow(vec2 uv){ return clamp(uv, .5 / uARes, uFill - .5 / uARes); }
#else
#define inWindow(uv) (uv)
#endif
float invZ(vec2 uv){
  float z = textureLod(tDepth, inWindow(uv), 0.).x * 2. - 1.;
  return (uFar + uNear - z * (uFar - uNear)) / (2. * uNear * uFar);
}
bool solid(float id){ return id >= .002 && id <= .998; }
// A hero's texel in the merged ink buffer: its normal is stored 2 higher (see palette.js), a crew figure's 4 higher.
float heroAt(vec4 t){ return step(1.5, t.x); }
float crewAt(vec4 t){ return step(3.5, t.x); }
#ifdef HERO
// The share of its width the pen keeps on a hero at this depth: heroPen() in post.js, with the same numbers.
float heroPen(float depth){
  float past = max(0., uSpan * depth / ${HERO_PEN.start.toFixed(4)} - 1.);
  float fallen = ${HERO_PEN.fall.toFixed(4)} * past * past;
  return 1. - uThin * ${(1 - HERO_PEN.floor).toFixed(4)} * fallen / (1. + fallen);   // exactly 1 up to the start
}
#endif

// The pen at one point inside a pixel: (ink, foam, hero texels touched, the same with the point's own texel).
// r: pen half-width in ink texels, de: how hard the depth steps across each of the four tap pairs (worked out
// once per pixel). world 1 (hero pass only): the world's lines alone, as if no hero were there.
vec4 penAt(vec2 uv, vec2 apx, float r, vec4 de, float inner, float weight, float nearK, float world){
  vec4 aux = textureLod(tAux, inWindow(uv), 0.);
  float hit = 0.;
  float own = 0.;
#ifdef HERO
  own = heroAt(aux);
  if (world > .5 && own > 0.) return vec4(0., 0., 0., own);
#endif
  float idc = aux.a;
  bool waterC = idc < .002;
  bool skyC = idc > .998;
  // a piece tagged THIN (ropes, wires, rods) is its own pen line: it is never outlined
  bool thinC = abs(idc - THIN) < .0015;
  vec2 nc = aux.xy;
  float inkS = 0.; // contour: a real step in depth, or an object against water / sky
  float inkI = 0.; // interior: seams and creases, drawn lighter
  float foam = 0.;
#ifdef PEN_FULL
  float inkG = 0.; // one wash of the ground against the next (moss on rock): not the outline of a thing
#endif
  for (int i = 0; i < 4; i++) {
    vec2 oa = OFFS[i] * r * apx;
    vec4 a = textureLod(tAux, inWindow(uv + oa), 0.);
    vec4 b = textureLod(tAux, inWindow(uv - oa), 0.);
#ifdef HERO
    hit += heroAt(a) + heroAt(b);
    if (world > .5 && heroAt(a) + heroAt(b) > 0.) continue;
#endif
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
        // a real step in depth, or a crew figure's edge against anything else: a contour
        float edge = max(de[i], abs(crewAt(t) - crewAt(aux)));
#ifdef PEN_FULL
        // closed: where a thing stands on the ground its edge is a contour too, not a seam
        edge = max(edge, ie * abs(groundAt(t.a) - groundAt(idc)) * gFull);
#endif
        inkS += edge;
        inkI += max(ne, ie) * (1. - edge);
#ifdef PEN_FULL
        // moss against rock is taken out of the seams and counted apart: it stays a thin, light line
        float wash = ie * groundAt(t.a) * groundAt(idc) * gFull * (1. - edge);
        inkI -= max(ne, ie) * (1. - edge) * wash;
        inkG += wash;
#endif
      }
    }
  }
  // the white line where things sit in the water reaches a little further than the pen
  if (waterC) {
    for (int i = 0; i < 4; i++) {
      vec4 a = textureLod(tAux, inWindow(uv + OFFS[i * 2 + 1] * r * 1.7 * apx), 0.);
#ifdef PEN_FULL
      // the white line keeps its reach: a wider pen does not widen it
      a = textureLod(tAux, inWindow(uv + OFFS[i * 2 + 1] * r * 1.7 / mix(1., max(PEN_WIDTH, 1.), gFull) * apx), 0.);
#endif
#ifdef HERO
      hit += heroAt(a);
      if (world > .5 && heroAt(a) > 0.) continue;
#endif
      if (a.a >= .002 && a.b > .48) foam += 1.;
    }
  }
  float eS = smoothstep(.05, .21, inkS / 8.);
  float eI = smoothstep(.08, .3, inkI / 8.) * .64 * inner;
#ifdef PEN_FULL
  eI *= mix(1., PEN_SEAM / .64, gFull);
  // a wash's edge: even, half the line's width (it takes three of the eight taps to see it, not two), a seam's ink
  eI = max(eI, smoothstep(.3, .45, inkG / 8.) * .64 * inner);
#endif
  return vec4(max(eS, eI), smoothstep(.04, .3, foam / 8.) * mix(.55, 1., nearK), hit, hit + own);
}

void main(){
  float sc = uRes.y / 1080.;
  vec2 asp = vec2(uRes.x / uRes.y, 1.);
  vec2 q = vUv * asp;

#ifdef HERO
  // the hero at the exact pixel centre, over the world behind it (smoothed up to the window's size)
  vec2 aUv = (vUv - uRect.xy) / uRect.zw * uFill;
  vec4 hero = texelFetch(tHero, ivec2(gl_FragCoord.xy - uRectPx), 0);
  vec3 col = texture(tColor, vUv).rgb * (1. - hero.a) + hero.rgb;
#else
  // colour at the exact pixel centre: nothing is resampled
  vec2 aUv = vUv;
  vec3 col = texelFetch(tColor, ivec2(gl_FragCoord.xy), 0).rgb;
#endif

  // ---- pen ----
  vec2 apx = 1. / uARes;
  vec4 aux = textureLod(tAux, inWindow(aUv), 0.);
  float hit = heroAt(aux);                   // hero texels this pixel's pen touches (hero pass only)
  bool plain = !solid(aux.a);                // open water or sky: no depth needed to know nothing is here
  float wc = plain ? 1. / uFar : invZ(aUv);
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
#ifdef HERO
  float heroW = hit > 0. ? wc : 0.;          // the nearest hero texel in the pen's reach, as 1 / its depth
#endif
#ifdef PEN_FULL
  // The line's owner, as 1 / its depth: the nearest thing the probe touches. The pixel's own depth says nothing on
  // sky or water, and on the ground behind a trunk it is the ground's.
  float wOwn = plain ? 0. : wc;
#endif
  for (int i = 0; i < 4; i++) {
    vec2 uvt = aUv + OFFS[i * 2 + 1] * Rp * apx;
    vec2 uvb = aUv + OFFS[i * 2] * Rp * .55 * apx;
    vec4 a = textureLod(tAux, inWindow(uvt), 0.);
    vec4 b = textureLod(tAux, inWindow(uvb), 0.);
#ifdef HERO
    hit += heroAt(a) + heroAt(b);
    if (heroAt(a) > 0.) heroW = max(heroW, invZ(uvt));
    if (heroAt(b) > 0.) heroW = max(heroW, invZ(uvb));
#endif
    if (abs(a.a - aux.a) > .0003 || distance(a.xy, aux.xy) > .16 || abs(b.a - aux.a) > .0003 || distance(b.xy, aux.xy) > .16) busy = true;
#ifdef PEN_FULL
    if (solid(a.a) && (plain || abs(a.a - aux.a) > .0003)) wOwn = max(wOwn, invZ(uvt));
    if (solid(b.a) && (plain || abs(b.a - aux.a) > .0003)) wOwn = max(wOwn, invZ(uvb));
#endif
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
#ifdef PEN_FULL
    // The fuller pen: the line sits on the true edge and keeps one weight along it, near (PEN_FROM) or everywhere.
    if (!plain) wOwn = max(wOwn, wNear);
    float zOwn = 1. / max(wOwn, 1. / uFar);
    gFull = 1. - smoothstep(PEN_FROM, PEN_TO, zOwn);
    // A thing narrower on screen than the full pen (a paddle, a rod) would be all line, its two edges meeting in one
    // black stick. Where the pen sits on one, or beside one, it keeps today's line: brown wood with a fine edge.
    float rSlim = rBase * mix(.62, 1.3, 1. - smoothstep(5., 110., zOwn)) * (.52 + .74 * PEN_WEIGHT) * PEN_WIDTH;
    float slim = 0.;
    for (int i = 0; i < 4; i++) {
      vec2 o = OFFS[i] * rSlim * apx;
      float ip = textureLod(tAux, inWindow(aUv + o), 0.).a;
      float im = textureLod(tAux, inWindow(aUv - o), 0.).a;
      // on it: the thing is gone again within the pen's reach on both sides
      if (!plain && abs(ip - aux.a) > .0003 && abs(im - aux.a) > .0003) slim = 1.;
      // beside it: a tap lands on a thing, and twice as far the pixel's own ground is back
      float ip2 = textureLod(tAux, inWindow(aUv + 2. * o), 0.).a;
      float im2 = textureLod(tAux, inWindow(aUv - 2. * o), 0.).a;
      if (solid(ip) && abs(ip - aux.a) > .0003 && abs(ip2 - aux.a) <= .0003) slim = 1.;
      if (solid(im) && abs(im - aux.a) > .0003 && abs(im2 - aux.a) <= .0003) slim = 1.;
    }
    gFull *= 1. - slim;
    wob *= 1. - gFull;
    weight = mix(weight, PEN_WEIGHT, gFull);
#endif
    // optional line boil (off by default): the whole drawing re-wobbles a few times a second
    if (uBoil > 0.) wob += (vnoise4(q * 13. + floor(uBoilTime * 7.) * 5.3).xy - .5) * 2.4 * uSc * uS;
#ifdef HERO
    // A small hero gets a finer pen, and its lines wander less. A pixel out of that pen's reach of every hero
    // goes round again (world 1) for the world's own lines, drawn as the world draws them.
    float thin = heroW > 0. ? heroPen(1. / heroW) : 1.;
    float world = 0.;
    vec4 pen;
    float zmin;
    float nk;
    for (int turn = 0; turn < 2; turn++) {
    vec2 uv = aUv + wob * thin * apx;
#else
    const float thin = 1.;
    const float world = 0.;
    vec4 pen;
    float zmin;
    float nk;
    {
    vec2 uv = aUv + wob * apx;
#endif
    // depth is read once per pixel: the pen's width here, real depth steps across each tap pair
    // (planar surfaces are linear in 1/z, so this only fires on true steps), and how far the line's owner is
    float wq = invZ(uv);
    float zq = 1. / wq;
    nk = 1. - smoothstep(5., 110., zq);
    float r = rBase * mix(.62, 1.3, nk) * (.52 + .74 * weight);
#ifdef PEN_FULL
    // as wide on the far side of the edge as on the near: the owner's distance sets the width, not the pixel's own
    r = mix(r, rBase * mix(.62, 1.3, 1. - smoothstep(5., 110., zOwn)) * (.52 + .74 * PEN_WEIGHT) * PEN_WIDTH, gFull);
#endif
#ifdef HERO
    // a thinned pen never goes under one ink texel: under that its taps would land on the texel they started from
    if (thin < 1.) r = max(r * thin, min(r, 1.));
#endif
    // far away, seams inside an object fade so it reads as one washed shape with a clean silhouette
    float inner = mix(1., .2, smoothstep(16., 70., zq));
    vec4 de;
    zmin = zq;
    for (int i = 0; i < 4; i++) {
      vec2 oa = OFFS[i] * r * apx;
      float wa = invZ(uv + oa);
      float wb = invZ(uv - oa);
      de[i] = smoothstep(.012, .03, abs(wa + wb - 2. * wq) / wq);
      zmin = min(zmin, 1. / max(wa, wb));
    }
    if (uS > 1.2) {
      // four points inside the pixel, a quarter pixel out from its centre: one per ink texel at 2x
      vec2 h = .25 * uPx;
      pen = (penAt(uv + h, apx, r, de, inner, weight, nk, world) + penAt(uv - h, apx, r, de, inner, weight, nk, world)
           + penAt(uv + vec2(h.x, -h.y), apx, r, de, inner, weight, nk, world) + penAt(uv + vec2(-h.x, h.y), apx, r, de, inner, weight, nk, world)) * .25;
    } else {
      pen = penAt(uv, apx, r, de, inner, weight, nk, world);
    }
#ifdef HERO
    if (thin >= 1. || pen.w > 0.) break;
    thin = 1.;
    world = 1.;
#endif
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
    hit += pen.z;
  }
#ifdef HERO
  // only what a hero touches is written: the hero, its lines, its foam. The rest of the window keeps the world.
  if (hit + hero.a <= 0.) discard;
#endif

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
const HERO_INK_TEXEL_BUDGET = 9.5e6; // a hero window gets two ink texels a pixel until it passes 2.4 million pixels (1780 x 1335)

// The world's ink and depth under a hero window, copied into the hero's own buffers before the heroes are drawn.
// Depth is smoothed between the world's texels (it is linear across a flat surface, so a waterline or a
// footprint stays a clean line however small the world was drawn). Ink ids are never blended.
//
// The world is drawn without the canoe, so its water runs straight through where the hull is. Whatever of the
// world lies inside the hull (insideHull: the hull's own shape, makeHullShape in canoe.js, at its inner skin) is
// taken out of the way here, so the floor and whatever is aboard below the waterline are drawn, not painted over.
const PREFILL = /* glsl */ `
precision highp float;
uniform sampler2D tAux, tDepth;
uniform vec2 uARes;
uniform vec4 uRect;
uniform mat4 uHullFromClip; // the whole view's clip space to the hull's own space (keel at y = 0, bow along z)
uniform vec4 uHull; // half length, half beam, depth amidships, scale against B2's hull. Half length 0: no hull
varying vec2 vUv;
bool insideHull(vec2 uv, float depth){
  if (uHull.x <= 0. || depth >= 1.) return false;
  vec4 p = uHullFromClip * vec4(uv * 2. - 1., depth * 2. - 1., 1.);
  p.xyz /= p.w;
  float a = abs(p.z) / uHull.x;
  if (a >= .98) return false;
  const float inset = .024; // the inner skin: inside the outer planking's flat faces everywhere, and no water is left showing against the skin
  float keel = .05 * a * a + .3 * uHull.w * pow(max(0., (a - .84) / .16), 2.) + inset;
  float sheer = uHull.z + .3 * uHull.w * pow(a, 2.8);
  if (p.y <= keel || p.y >= sheer) return false;
  float c = pow(1. - (p.y - keel) / (sheer - keel), 1. / .9);
  float halfBeam = max(.004, uHull.y * pow(max(0., 1. - pow(a, 2.3)), .6) - inset);
  return abs(p.x) < halfBeam * pow(max(0., 1. - c * c), .5 * (.65 + .75 * a * a));
}
void main(){
  vec2 uv = uRect.xy + vUv * uRect.zw;
  ivec2 top = ivec2(uARes) - 1;
  vec2 p = uv * uARes - .5;
  vec2 f = fract(p);
  ivec2 i = ivec2(floor(p));
  float d00 = texelFetch(tDepth, clamp(i, ivec2(0), top), 0).x;
  float d10 = texelFetch(tDepth, clamp(i + ivec2(1, 0), ivec2(0), top), 0).x;
  float d01 = texelFetch(tDepth, clamp(i + ivec2(0, 1), ivec2(0), top), 0).x;
  float d11 = texelFetch(tDepth, clamp(i + ivec2(1, 1), ivec2(0), top), 0).x;
  float depth = mix(mix(d00, d10, f.x), mix(d01, d11, f.x), f.y);
  gl_FragDepth = insideHull(uv, depth) ? 1. : depth;
  gl_FragColor = texelFetch(tAux, clamp(ivec2(uv * uARes), ivec2(0), top), 0);
}`;

// A hero buffer is kept a little larger than its window, so a window that grows or shrinks a few pixels a
// frame (the camera turning, a paddle swinging) does not rebuild it.
const roomFor = (room, need) => (need > room || need < room * 0.4 ? Math.ceil((need * 1.2) / 64) * 64 : room);

// pen: the pen's sample both pens start with (pens.js). The game's own unless asked: C, `bold`.
export function createPost(renderer, camera, pen = DEFAULT_PEN) {
  // colour: 4x multisampled, resolved by the renderer when the pass ends
  const color = new THREE.WebGLRenderTarget(4, 4, {
    samples: 4,
    depthBuffer: true,
    resolveDepthBuffer: false,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter, // the world's own pen reads exact pixels; the hero pass smooths it up to the window
    magFilter: THREE.LinearFilter,
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

  // the finished world, when it is drawn at another size than the window: stretched onto the canvas
  const sheet = new THREE.WebGLRenderTarget(4, 4, {
    depthBuffer: false,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });

  // the heroes' own buffers: one window's worth, at the window's size
  const heroColor = new THREE.WebGLRenderTarget(4, 4, {
    samples: 4,
    depthBuffer: true,
    resolveDepthBuffer: false,
    generateMipmaps: false,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  });
  const heroAux = new THREE.WebGLRenderTarget(4, 4, {
    type: THREE.HalfFloatType,
    depthBuffer: true,
    generateMipmaps: false,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  });
  heroAux.depthTexture = new THREE.DepthTexture(4, 4);

  // what both pens share: the pen's settings, the paper, the palette
  const shared = {
    tNoise: GU.tNoise,
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
  const uniforms = {
    ...shared,
    tColor: { value: color.texture },
    tAux: { value: aux.texture },
    tDepth: { value: aux.depthTexture },
    uRes: { value: new THREE.Vector2(4, 4) },
    uARes: { value: new THREE.Vector2(4, 4) },
    uPx: { value: new THREE.Vector2(0.25, 0.25) },
    uS: { value: 2 },
  };
  const heroUniforms = {
    ...shared,
    tColor: { value: color.texture },
    tHero: { value: heroColor.texture },
    tAux: { value: heroAux.texture },
    tDepth: { value: heroAux.depthTexture },
    uRes: { value: new THREE.Vector2(4, 4) },
    uARes: { value: new THREE.Vector2(4, 4) },
    uPx: { value: new THREE.Vector2(0.25, 0.25) },
    uS: { value: 2 },
    uRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    uFill: { value: new THREE.Vector2(1, 1) },
    uRectPx: { value: new THREE.Vector2() },
    uSpan: { value: 1.1547 },
    uThin: { value: 1 }, // 0 with ?heropen=0: the full pen on every hero, as it was. Only to prove the far-figure test can fail.
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = position.xy * .5 + .5; gl_Position = vec4(position.xy, 0., 1.); }',
    defines: { ...penDefines(pen) },
    fragmentShader: COMPOSITE,
    depthTest: false,
    depthWrite: false,
  });
  const heroMaterial = new THREE.ShaderMaterial({
    uniforms: heroUniforms,
    defines: { HERO: 1, ...penDefines(pen) },
    vertexShader: 'uniform vec4 uRect; varying vec2 vUv; void main(){ vUv = uRect.xy + (position.xy * .5 + .5) * uRect.zw; gl_Position = vec4(vUv * 2. - 1., 0., 1.); }',
    fragmentShader: COMPOSITE,
    depthTest: false,
    depthWrite: false,
  });
  const prefillUniforms = {
    tAux: { value: aux.texture },
    tDepth: { value: aux.depthTexture },
    uARes: uniforms.uARes,
    uRect: heroUniforms.uRect,
    uHullFromClip: { value: new THREE.Matrix4() },
    uHull: { value: new THREE.Vector4() },
  };
  const hullFromWorld = new THREE.Matrix4();
  // The hull the heroes hold, if any: buildHull marks its mesh (userData.hull). Looked for once a frame.
  function findHull(heroes) {
    let found = null;
    heroes.traverseVisible((object) => {
      if (!found && object.userData.hull) found = object;
    });
    return found;
  }
  const prefillMaterial = new THREE.ShaderMaterial({
    uniforms: prefillUniforms,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = position.xy * .5 + .5; gl_Position = vec4(position.xy, 0., 1.); }',
    fragmentShader: PREFILL,
    depthTest: true,
    depthFunc: THREE.AlwaysDepth,
    depthWrite: true,
  });
  const blitMaterial = new THREE.ShaderMaterial({
    uniforms: { tSheet: { value: sheet.texture } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = position.xy * .5 + .5; gl_Position = vec4(position.xy, 0., 1.); }',
    fragmentShader: 'uniform sampler2D tSheet; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(tSheet, vUv).rgb, 1.); }',
    depthTest: false,
    depthWrite: false,
  });

  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const square = new THREE.BufferGeometry();
  square.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  const sceneOf = (geometry, shader) => {
    const mesh = new THREE.Mesh(geometry, shader);
    mesh.frustumCulled = false;
    const scene = new THREE.Scene();
    scene.add(mesh);
    return scene;
  };
  const postScene = sceneOf(tri, material);
  const blitScene = sceneOf(tri, blitMaterial);
  const heroScene = sceneOf(square, heroMaterial);
  // The prefill rides in the heroes' own group, drawn before them, and shows only during the hero pass.
  const prefill = new THREE.Mesh(tri, prefillMaterial);
  prefill.frustumCulled = false;
  prefill.renderOrder = -1;
  prefill.visible = false;
  const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // w, h: the world's drawing size. sheetW, sheetH: the window's (the canvas). hero*: the hero buffers and the last frame's windows.
  const state = {
    w: 4, h: 4, inkScale: 2, reflScale: 1, inkW: 4, inkH: 4,
    sheetW: 4, sheetH: 4, fine: 1,
    heroRoomW: 0, heroRoomH: 0, heroInkScale: 2, heroWindows: [], heroFine: 0, heroDrawnW: 0, heroDrawnH: 0,
    pen,
  };
  const bench = { draws: 1, pass: '', discard: false };
  // ?hullwater=1 leaves the world's water inside the hull, as it was. Only to prove the floor check can fail.
  const hullWater = { keep: false };
  const clearColour = new THREE.Color();
  // ?bench: a pass drawn again over itself is dropped by the driver unless something reads it first. This reads it.
  const keepTarget = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
  const keepMaterial = new THREE.ShaderMaterial({
    uniforms: { tKeep: { value: null } },
    vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0., 1.); }',
    fragmentShader: 'uniform sampler2D tKeep; void main(){ gl_FragColor = texture2D(tKeep, vec2(.5)); }',
    depthTest: false,
    depthWrite: false,
  });
  const keepScene = sceneOf(tri, keepMaterial);
  const keep = (target) => {
    keepMaterial.uniforms.tKeep.value = target.texture;
    renderer.setRenderTarget(keepTarget);
    renderer.render(keepScene, postCam);
    renderer.setRenderTarget(target);
  };

  // The hero buffers are shared by every window of the frame: make them fit the widest and the tallest.
  function fitHeroBuffers(windows) {
    const w = Math.max(...windows.map((win) => win.w));
    const h = Math.max(...windows.map((win) => win.h));
    const s = Math.max(1, Math.min(2, Math.sqrt(HERO_INK_TEXEL_BUDGET / (w * h))));
    const roomW = roomFor(state.heroRoomW, w);
    const roomH = roomFor(state.heroRoomH, h);
    if (roomW === state.heroRoomW && roomH === state.heroRoomH && s === state.heroInkScale) return;
    Object.assign(state, { heroRoomW: roomW, heroRoomH: roomH, heroInkScale: s });
    heroColor.setSize(roomW, roomH);
    heroAux.setSize(Math.round(roomW * s), Math.round(roomH * s));
  }

  // One hero window: the heroes at the window's size, the world's ink and depth under them, then the pen.
  function drawHeroWindow(heroes, cam, win, behind) {
    const { x, y, w, h } = win;
    const { sheetW, sheetH } = state;
    const s = state.heroInkScale;
    const inkW = Math.round(w * s);
    const inkH = Math.round(h * s);
    heroColor.viewport.set(0, 0, w, h);
    heroColor.scissor.set(0, 0, w, h);
    heroColor.scissorTest = true;
    heroAux.viewport.set(0, 0, inkW, inkH);
    heroAux.scissor.set(0, 0, inkW, inkH);
    heroAux.scissorTest = true;

    const u = heroUniforms;
    u.uRes.value.set(sheetW, sheetH);
    u.uARes.value.set(heroAux.width, heroAux.height);
    u.uFill.value.set(inkW / heroAux.width, inkH / heroAux.height);
    u.uPx.value.set(inkW / heroAux.width / w, inkH / heroAux.height / h);
    u.uS.value = inkH / h;
    u.uRect.value.set(x / sheetW, y / sheetH, w / sheetW, h / sheetH);
    u.uRectPx.value.set(x, y);

    // the camera looks through the window alone, at the window's own pixels
    cam.setViewOffset(sheetW, sheetH, x, sheetH - y - h, w, h);
    prefill.visible = true;

    GU.uPass.value = 0;
    prefillMaterial.colorWrite = false;
    renderer.setRenderTarget(heroColor);
    renderer.clear();
    renderer.render(heroes, cam);

    GU.uPass.value = 1;
    GU.uHero.value = 1;
    prefillMaterial.colorWrite = true;
    renderer.setRenderTarget(heroAux);
    renderer.clear();
    renderer.render(heroes, cam);
    // the crew again, over themselves (the same depths pass), their texels marked as the crew's: see CREW_LAYER
    GU.uHero.value = 2;
    cam.layers.set(CREW_LAYER);
    renderer.render(heroes, cam);
    cam.layers.set(0);
    GU.uHero.value = 1;
    if (behind) behind(renderer, heroAux.depthTexture, win, u.uFill.value);
    GU.uPass.value = 0;
    GU.uHero.value = 0;

    prefill.visible = false;
    cam.clearViewOffset();

    renderer.setRenderTarget(null);
    renderer.render(heroScene, postCam);
    // what was really drawn for this window, for the probe: the hero colour buffer's own pixels
    state.heroDrawnW = heroColor.viewport.z;
    state.heroDrawnH = heroColor.viewport.w;
  }

  return {
    uniforms,
    pen: shared, // the pen's own settings (uLineW, uWobble, uBoil) are shared by the world's pen and the heroes'
    heroPen: heroUniforms.uThin, // 1 thins the pen on small heroes
    reflection: refl.texture,
    resolution: uniforms.uRes.value,
    state,
    bench,
    hullWater,
    // One of the pen's samples (pens.js), or today's pen again. The world's pen and the heroes' are compiled with the
    // same settings: one pen, so a world line does not change where it passes a hero's window. Today's pen is
    // compiled with none, as it always was.
    setPen(name) {
      const defines = penDefines(name);
      material.defines = { ...defines };
      heroMaterial.defines = { HERO: 1, ...defines };
      material.needsUpdate = true;
      heroMaterial.needsUpdate = true;
      state.pen = name;
    },
    // w, h: the world's drawing size. reflScale: reflection size against the drawing. inkMax: most ink texels per pixel, each way.
    // sheetW, sheetH: the window's size in pixels (the canvas). fine: the world's fine strokes, 0 or 1.
    setSize(w, h, reflScale = 1, inkMax = 2, sheetW = w, sheetH = h, fine = 1) {
      const s = Math.max(1, Math.min(inkMax, Math.sqrt(INK_TEXEL_BUDGET / (w * h))));
      const iw = Math.round(w * s);
      const ih = Math.round(h * s);
      Object.assign(state, { w, h, inkScale: ih / h, reflScale, inkW: iw, inkH: ih, sheetW, sheetH, fine });
      color.setSize(w, h);
      aux.setSize(iw, ih);
      refl.setSize(Math.max(2, Math.round(w * reflScale)), Math.max(2, Math.round(h * reflScale)));
      if (w !== sheetW || h !== sheetH) sheet.setSize(w, h);
      uniforms.uRes.value.set(w, h);
      uniforms.uARes.value.set(iw, ih);
      uniforms.uPx.value.set(1 / w, 1 / h);
      uniforms.uS.value = ih / h;
    },
    // share the water's drift, so the foam's dry-brush breaks ride on the water
    linkWater(driftUniform) {
      shared.uDrift = driftUniform;
      uniforms.uDrift = driftUniform;
      heroUniforms.uDrift = driftUniform;
    },
    // overlay: an optional scene of world-anchored marks, drawn over the finished sheet.
    // reflect: false skips the mirrored pass (water detail "low").
    // onPass(pass): called before each scene pass (2 reflection, 0 colour, 1 ink), so the caller can thin out what the mirror sees
    // and keep washes of light out of the ink buffer.
    // heroes: the group holding the crew and the canoe (a child of the scene), or null to leave them in the world.
    // heroWindows: where they are on the window, in pixels from the bottom left: [{ x, y, w, h }].
    render(scene, cam, water, overlay = null, reflect = true, onPass = null, heroes = null, heroWindows = []) {
      shared.uNear.value = cam.near;
      shared.uFar.value = cam.far;
      // ?bench=N draws every pass N times; &benchpass=<name> only that pass. The slope against N is the pass's true cost.
      const times = (name) => (bench.pass === '' || bench.pass === name ? bench.draws : 1);
      // pen widths and stroke sizes are in pixels of whatever is being drawn: the world's size here, the window's for the heroes
      const tangent = 2 * Math.tan((cam.fov * Math.PI) / 360);
      GU.uSc.value = state.h / 1080;
      GU.uPxK.value = tangent / state.h;
      GU.uFine.value = state.fine;
      if (heroes && prefill.parent !== heroes) heroes.add(prefill);

      if (reflect) {
        // mirrored world below the waterline (the heroes are in it: they reflect)
        GU.uFlip.value = -1;
        GU.uPass.value = 2;
        if (onPass) onPass(2);
        water.visible = false;
        scene.scale.y = -1;
        wearMaterials(scene, 'mirror');
        renderer.setRenderTarget(refl);
        for (let draw = times('reflection'); draw > 0; draw -= 1) {
          renderer.clear();
          renderer.render(scene, cam);
          if (draw > 1) keep(refl);
        }
        scene.scale.y = 1;
        water.visible = true;
        GU.uFlip.value = 1;
        if (!bench.discard) wearMaterials(scene, 'plain');
      }

      // the world, without the heroes
      if (heroes) heroes.visible = false;
      GU.uPass.value = 0;
      if (onPass) onPass(0);
      renderer.setRenderTarget(color);
      for (let draw = times('colour'); draw > 0; draw -= 1) {
        renderer.clear();
        renderer.render(scene, cam);
        if (draw > 1) keep(color);
      }

      GU.uPass.value = 1;
      if (onPass) onPass(1);
      renderer.setRenderTarget(aux);
      for (let draw = times('ink'); draw > 0; draw -= 1) {
        renderer.clear();
        renderer.render(scene, cam);
        if (draw > 1) keep(aux);
      }
      GU.uPass.value = 0;
      if (heroes) heroes.visible = true;

      // the composite rebuilds each pixel's place on the water from the camera, for the foam breaks
      const e = cam.matrixWorld.elements;
      const ty = Math.tan((cam.fov * Math.PI) / 360);
      const tx = ty * cam.aspect;
      shared.uCamPos.value.setFromMatrixPosition(cam.matrixWorld);
      shared.uRay.value.set(e[0] * tx, e[4] * ty, -e[8], e[1] * tx, e[5] * ty, -e[9], e[2] * tx, e[6] * ty, -e[10]);

      // the world's pen: straight onto the canvas at the window's size, or onto its own sheet, then stretched
      const stretched = state.w !== state.sheetW || state.h !== state.sheetH;
      for (let draw = times('composite'); draw > 1; draw -= 1) {
        if (sheet.width !== state.w || sheet.height !== state.h) sheet.setSize(state.w, state.h);
        renderer.setRenderTarget(sheet);
        renderer.render(postScene, postCam);
        keep(sheet);
      }
      renderer.setRenderTarget(stretched ? sheet : null);
      renderer.render(postScene, postCam);
      if (stretched) {
        renderer.setRenderTarget(null);
        renderer.render(blitScene, postCam);
      }

      // a layer drawn over the sheet may ask what it falls behind (rain.ts): the world's depth now, then each hero window's as it is drawn
      const behind = (overlay ? [overlay].flat() : []).find((layer) => layer.userData.behind)?.userData.behind ?? null;
      if (behind) behind(renderer, aux.depthTexture, null, null);

      // the heroes, at the window's size, with every stroke
      state.heroWindows = heroes ? heroWindows : [];
      state.heroFine = heroes ? 1 : 0;
      state.heroDrawnW = 0;
      state.heroDrawnH = 0;
      if (heroes && heroWindows.length > 0) {
        GU.uSc.value = state.sheetH / 1080;
        GU.uPxK.value = tangent / state.sheetH;
        GU.uFine.value = 1;
        heroUniforms.uSpan.value = tangent;
        renderer.getClearColor(clearColour);
        const clearAlpha = renderer.getClearAlpha();
        renderer.setClearColor(0x000000, 0);
        fitHeroBuffers(heroWindows);
        // where the hull is, for the prefill: from the whole view's clip space (before any window's view offset) to the hull's own space
        const hull = hullWater.keep ? null : findHull(heroes);
        if (hull) {
          const { halfLength, halfBeam, depth, scale } = hull.userData.hull;
          prefillUniforms.uHull.value.set(halfLength, halfBeam, depth, scale);
          prefillUniforms.uHullFromClip.value.copy(hullFromWorld.copy(hull.matrixWorld).invert()).multiply(cam.matrixWorld).multiply(cam.projectionMatrixInverse);
        } else {
          prefillUniforms.uHull.value.set(0, 0, 0, 0);
        }
        for (let draw = times('hero'); draw > 0; draw -= 1) for (const win of heroWindows) drawHeroWindow(heroes, cam, win, behind);
        renderer.setClearColor(clearColour, clearAlpha);
        GU.uSc.value = state.h / 1080;
        GU.uPxK.value = tangent / state.h;
        GU.uFine.value = state.fine;
      }

      // (one scene, or several in order: the rain's strokes go under the marks)
      for (const layer of overlay ? [overlay].flat() : []) {
        renderer.setRenderTarget(null);
        for (let draw = times('overlay'); draw > 0; draw -= 1) renderer.render(layer, cam);
      }
    },
    dispose() {
      prefill.removeFromParent();
      for (const target of [color, aux, refl, sheet, heroColor, heroAux, keepTarget]) target.dispose();
      for (const item of [tri, square, material, heroMaterial, prefillMaterial, blitMaterial, keepMaterial]) item.dispose();
    },
  };
}

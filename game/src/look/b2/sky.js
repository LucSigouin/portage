// Ink & Wash — sky, far ridges and light. Overcast, misty morning.
// The ridges are painted into the dome as stacked washes that dissolve into mist at the waterline.
import * as THREE from 'three';
import { PAL, GU, NOISE, glsl } from './palette.js';


const FRAG = /* glsl */ `
precision highp float;
in vec3 vDir;
layout(location = 0) out vec4 oColor;
uniform float uTime;
uniform int uPass;
uniform float uFogDensity, uOvercast, uSunGlow, uStars, uStorm, uVeil;
uniform vec4 uAhead;
uniform vec3 uAheadColor;
uniform vec3 uFogColor, uSkyTop, uSkyLow, uCloud, uCloudLight, uSunColor, uSunDir, uFarTint;
${NOISE}
const float TAU = 6.28318530718;
float washCloud(vec2 p){ return smoothstep(.45, .55, vnoise(p)); }

// one wash of forested hills: returns its top edge (in elevation) at this azimuth
float ridge(float az, vec2 circ, float f, float base, float amp, float trees, float treeH, float seed){
  float h = base + amp * (fbm(circ * f + seed) - .3);
  float j = vnoise(circ * 31. + seed);
  float x = az * trees / TAU + j * .7;
  float tr = abs(fract(x) - .5) * 2.;
  float big = vnoise(vec2(floor(x + .5) * 3.7, seed));
  // spires, not a saw: each tree a narrow point with its own height
  return h + treeH * pow(tr, 1.6) * (.3 + 1.1 * big);
}


void main(){
  // ink buffer: sky is id 1
  if (uPass == 1) { oColor = vec4(.5, .5, 0., 1.); return; }
  vec3 d = normalize(vDir);
  float el = d.y;
  if (el < -.004) { oColor = vec4(uFogColor, 1.); return; }   // under the horizon there is only mist
  float az = atan(d.x, d.z);
  vec2 circ = vec2(cos(az), sin(az));

  vec3 c = mix(uSkyLow, uSkyTop, smoothstep(0., .5, el));

  // cloud washes with a wet edge
  vec2 cp = d.xz / (abs(d.y) + .32);
  float cl = fbm(cp * 1.25 + vec2(uTime * .006, 3.));
  float ce = .5 - .3 * uOvercast;                        // weather closes the cloud in
  float cm = smoothstep(ce, ce + .03, cl) * smoothstep(.05, .28, el);
  c = mix(c, uCloud, cm * (.5 + .35 * uOvercast));
  c *= 1. - .05 * (smoothstep(ce, ce + .03, cl) - smoothstep(ce + .03, ce + .1, cl)) * smoothstep(.05, .28, el);
  float cl2 = fbm(cp * 2.6 + vec2(-uTime * .004, 11.));
  c = mix(c, uCloudLight, smoothstep(.6, .63, cl2) * .35 * smoothstep(.03, .2, el) * (1. - uOvercast));

  // a storm's cloud hangs low and heavy: a second, darker wash under the first, down to the ridges
  if (uStorm > 0.) {
    float sc = fbm(cp * .62 + vec2(uTime * .009, 21.));
    float low = smoothstep(.4, .43, sc) * smoothstep(.02, .12, el);
    c = mix(c, uCloud * .8, low * uStorm * .7);
    c *= 1. - .06 * uStorm * (low - smoothstep(.43, .5, sc) * smoothstep(.02, .12, el));
  }

  // what is coming: the next weather's cloud stands on the upwind horizon and climbs as its time nears.
  // (fb: the pixel's size in elevation, taken here so no screen derivative sits inside the branch)
  float fb = fwidth(el) * 1.5 + 1e-6;
  if (uAhead.z > 0.) {
    float toward = dot(normalize(d.xz + 1e-5), uAhead.xy);     // 1 looking upwind
    float top = uAhead.z * mix(.07, .8, smoothstep(-.6, 1., toward)) * mix(1., .2, uAhead.w) * (.72 + .56 * fbm(circ * 2.1 + 40.));
    float bank = clamp((top - el) / fb + .5, 0., 1.);
    // one wash with a wet edge along its top
    c = mix(c, uAheadColor * (1. - .07 * (1. - smoothstep(0., .02, top - el))), bank * .92);
  }

  // stars: ink-dot points fixed on the dome, a few of them bigger. They do not twinkle. Cloud hides them.
  // (fs: a pixel's size in star cells, taken here so no screen derivative sits inside the branch)
  vec2 sg = cp * 26.;
  float fs = length(fwidth(sg)) * .7071;
  if (uStars > 0.) {
    vec2 si = floor(sg);
    float sr = hash12(si);
    vec2 sp = vec2(hash12(si + 7.3), hash12(si + 31.1)) * .6 + .2;
    float rad = max(.03 + .07 * step(.992, sr), fs * .8);       // never under a pixel across: a point that small would shimmer as the view turns
    float star = (1. - smoothstep(rad - fs, rad + fs, distance(fract(sg), sp))) * step(.93, sr) * mix(.4, 1., fract(sr * 37.));
    c = mix(c, uSunColor, star * uStars * (1. - cm) * smoothstep(.05, .16, el));
  }

  // the sun, seen through mist
  float sd = dot(d, uSunDir);
  c = mix(c, uSunColor, smoothstep(.9, 1., sd) * .3 * uSunGlow);
  c = mix(c, uSunColor, smoothstep(.9972, .9979, sd) * .85 * uSunGlow);

  // Everything below is the low band above the horizon: ridges, mist, far shore. Higher up the sky is
  // just its washes, so the work is skipped there. (fe: the pixel's size in elevation, taken out here
  // so no screen derivative sits inside the branch.)
  float fe = fwidth(el) * 1.5 + 1e-6;
  if (el < .14) {
    // three ridges, far to near
    float h1 = ridge(az, circ, 1.6, .060, .050, 1500., .0045, 1.7);
    { float t = clamp((h1 - el) / h1, 0., 1.);
      vec3 rc = ${glsl('#bcc8c9')} * uFarTint * (1. - .07 * smoothstep(.004, 0., h1 - el));
      c = mix(c, mix(rc, uFogColor, t * t * .85), clamp((h1 - el) / fe + .5, 0., 1.)); }
    float h2 = ridge(az, circ, 2.7, .036, .042, 900., .0075, 5.2);
    { float t = clamp((h2 - el) / h2, 0., 1.);
      vec3 rc = ${glsl('#a0b2b1')} * uFarTint * (1. - .08 * smoothstep(.004, 0., h2 - el));
      c = mix(c, mix(rc, uFogColor, t * t * .9), clamp((h2 - el) / fe + .5, 0., 1.)); }
    float h3 = ridge(az, circ, 4.1, .014, .034, 520., .012, 9.4);
    { float t = clamp((h3 - el) / max(h3, .001), 0., 1.);
      vec3 rc = ${glsl('#84998f')} * uFarTint * (1. - .09 * smoothstep(.004, 0., h3 - el));
      c = mix(c, mix(rc, uFogColor, t * .82), clamp((h3 - el) / fe + .5, 0., 1.)); }

    // mist lying on the water (thinner when the mist setting is lower)
    float mk = clamp(uFogDensity / .0036, .25, 1.4);
    float band = fbm(vec2(az * 3. + uTime * .01, el * 40.));
    float mist = (smoothstep(.055, .0, el) * .75 + smoothstep(.46, .62, band) * smoothstep(.09, .015, el) * .5) * mk;
    c = mix(c, uFogColor, clamp(mist, 0., 1.));

    // the far shore itself, this side of the mist: a low dark line of spruce with a pen line along its top
    // and a pale strip of bare rock at the water
    if (el < .03) {
      float h4 = ridge(az, circ, 6.3, .0046, .007, 1040., .0125, 3.3);
      float d = h4 - el;
      vec3 rc = mix(${glsl('#7d9389')}, ${glsl('#93a79c')}, washCloud(circ * 23.));
      rc = mix(rc, ${glsl('#cfcabb')}, 1. - smoothstep(.0012, .0022, el + (vnoise(circ * 140.) - .5) * .0012)) * uFarTint;
      rc = mix(rc, uFogColor, .34 * mk);
      c = mix(c, rc, clamp(d / fe + .5, 0., 1.));
      c = mix(c, mix(${glsl(PAL.ink)}, uFogColor, .45), clamp(1.2 - abs(d) / fe, 0., 1.) * .55);
    }
  }
  // fog weather closes the sky: the ridges and the far shore go into it, and the height keeps only a little of its own tone
  c = mix(c, uFogColor, uVeil * mix(.97, .55, smoothstep(0., .45, el)));
  if (el < 0.) c = uFogColor;

  oColor = vec4(c, 1.);
}`;

export function createSky() {
  const geo = new THREE.SphereGeometry(1300, 48, 24);
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      uTime: GU.uTime, uPass: GU.uPass, uFogDensity: GU.uFogDensity, uFogColor: GU.uFogColor, tNoise: GU.tNoise,
      uOvercast: GU.uOvercast, uSunGlow: GU.uSunGlow, uStars: GU.uStars, uStorm: GU.uStorm, uVeil: GU.uVeil, uAhead: GU.uAhead, uAheadColor: GU.uAheadColor, uSkyTop: GU.uSkyTop, uSkyLow: GU.uSkyLow, uCloud: GU.uCloud,
      uCloudLight: GU.uCloudLight, uSunColor: GU.uSunColor, uSunDir: GU.uSunDir, uFarTint: GU.uFarTint,
    },
    vertexShader: /* glsl */ `
      out vec3 vDir;
      void main(){ vDir = position; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.); }`,
    fragmentShader: FRAG,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10; // drawn last, behind everything: only the sky you can see is painted
  return {
    mesh,
    update(camera) {
      mesh.position.set(camera.position.x, 0, camera.position.z);
    },
  };
}

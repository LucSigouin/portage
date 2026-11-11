// Ink & Wash — sky, far ridges and light. Overcast, misty morning.
// The ridges are painted into the dome as stacked washes that dissolve into mist at the waterline.
import * as THREE from 'three';
import { PAL, GU, NOISE, glsl } from './palette.js';

export const SUN_DIR = new THREE.Vector3(0.35, 0.115, 0.93).normalize();

const FRAG = /* glsl */ `
precision highp float;
in vec3 vDir;
layout(location = 0) out vec4 oColor;
uniform float uTime;
uniform int uPass;
uniform float uFogDensity;
uniform vec3 uFogColor;
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

  vec3 c = mix(${glsl(PAL.skyLow)}, ${glsl(PAL.skyTop)}, smoothstep(0., .5, el));

  // cloud washes with a wet edge
  vec2 cp = d.xz / (abs(d.y) + .32);
  float cl = fbm(cp * 1.25 + vec2(uTime * .006, 3.));
  float cm = smoothstep(.5, .53, cl) * smoothstep(.05, .28, el);
  c = mix(c, ${glsl(PAL.cloud)}, cm * .5);
  c *= 1. - .05 * (smoothstep(.5, .53, cl) - smoothstep(.53, .6, cl)) * smoothstep(.05, .28, el);
  float cl2 = fbm(cp * 2.6 + vec2(-uTime * .004, 11.));
  c = mix(c, ${glsl(PAL.paper)}, smoothstep(.6, .63, cl2) * .35 * smoothstep(.03, .2, el));

  // the sun, seen through mist
  float sd = dot(d, ${`vec3(${SUN_DIR.x.toFixed(4)}, ${SUN_DIR.y.toFixed(4)}, ${SUN_DIR.z.toFixed(4)})`});
  c = mix(c, ${glsl(PAL.sun)}, smoothstep(.9, 1., sd) * .3);
  c = mix(c, ${glsl(PAL.sun)}, smoothstep(.9972, .9979, sd) * .85);

  // Everything below is the low band above the horizon: ridges, mist, far shore. Higher up the sky is
  // just its washes, so the work is skipped there. (fe: the pixel's size in elevation, taken out here
  // so no screen derivative sits inside the branch.)
  float fe = fwidth(el) * 1.5 + 1e-6;
  if (el < .14) {
    // three ridges, far to near
    float h1 = ridge(az, circ, 1.6, .060, .050, 1500., .0045, 1.7);
    { float t = clamp((h1 - el) / h1, 0., 1.);
      vec3 rc = ${glsl('#bcc8c9')} * (1. - .07 * smoothstep(.004, 0., h1 - el));
      c = mix(c, mix(rc, uFogColor, t * t * .85), clamp((h1 - el) / fe + .5, 0., 1.)); }
    float h2 = ridge(az, circ, 2.7, .036, .042, 900., .0075, 5.2);
    { float t = clamp((h2 - el) / h2, 0., 1.);
      vec3 rc = ${glsl('#a0b2b1')} * (1. - .08 * smoothstep(.004, 0., h2 - el));
      c = mix(c, mix(rc, uFogColor, t * t * .9), clamp((h2 - el) / fe + .5, 0., 1.)); }
    float h3 = ridge(az, circ, 4.1, .014, .034, 520., .012, 9.4);
    { float t = clamp((h3 - el) / max(h3, .001), 0., 1.);
      vec3 rc = ${glsl('#84998f')} * (1. - .09 * smoothstep(.004, 0., h3 - el));
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
      rc = mix(rc, ${glsl('#cfcabb')}, 1. - smoothstep(.0012, .0022, el + (vnoise(circ * 140.) - .5) * .0012));
      rc = mix(rc, uFogColor, .34 * mk);
      c = mix(c, rc, clamp(d / fe + .5, 0., 1.));
      c = mix(c, mix(${glsl(PAL.ink)}, uFogColor, .45), clamp(1.2 - abs(d) / fe, 0., 1.) * .55);
    }
  }
  if (el < 0.) c = uFogColor;

  oColor = vec4(c, 1.);
}`;

export function createSky() {
  const geo = new THREE.SphereGeometry(1300, 48, 24);
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { uTime: GU.uTime, uPass: GU.uPass, uFogDensity: GU.uFogDensity, uFogColor: GU.uFogColor, tNoise: GU.tNoise },
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

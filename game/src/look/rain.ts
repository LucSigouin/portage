/**
 * Rain, as pen strokes. Each stroke is a short slanted line of ink with a
 * place in the world: it falls along the wind, the eye moves past it like any
 * other thing, and when it leaves the box of air round the eye it comes back
 * in on the far side, faded out at the moment it does. Nothing is tied to the
 * screen, and nothing moves while the look's paint time stands still.
 *
 * The strokes are drawn last, at the window's own size, over the world and the
 * heroes alike: rain falls in front of the crew too.
 */
import * as THREE from 'three';
import { GU } from './b2/palette.js';
import type { Rgb } from './daylight.ts';

/** The box of air round the eye that holds the strokes, metres. */
export const RAIN_BOX = [30, 18, 30] as const;
/** The box sits this far above the eye, metres: the eye looks down at the water, and no stroke is drawn under it. */
const RAIN_LIFT = 3;
/** Strokes in a full storm. Steady rain draws six in ten of them. */
export const RAIN_STROKES = 2400;
/** With the weather's fine work shed (the ladder's first rung), this share of them is drawn. */
export const RAIN_SHED_SHARE = 0.5;

/** A stroke's length in metres: a pen flick, longer in a storm. It moves a ninth of that in a frame, so it slides and never jumps. */
export function strokeLength(storm: number): number {
  return 1 + 0.5 * storm;
}

/** Fall `shift` on by `seconds` at `velocity`, kept inside the box. Wrapping by a whole box moves no stroke. */
export function advanceRain(shift: [number, number, number], velocity: readonly [number, number, number], seconds: number): void {
  for (let axis = 0; axis < 3; axis += 1) {
    const size = RAIN_BOX[axis];
    shift[axis] = (((shift[axis] + velocity[axis] * seconds) % size) + size) % size;
  }
}

export class Rain {
  readonly scene = new THREE.Scene();
  private readonly mesh: THREE.Mesh;
  private readonly uniforms = {
    uShift: { value: new THREE.Vector3() },
    uBox: { value: new THREE.Vector3(...RAIN_BOX) },
    uDirection: { value: new THREE.Vector3(0, -1, 0) },
    uLength: { value: 1 },
    uLevel: { value: 0 },
    uInk: { value: new THREE.Color() },
    uStrength: { value: 1 },
    uPixel: { value: new THREE.Vector2(1, 1) },
    uSheet: { value: 1 },
    uFogDensity: GU.uFogDensity,
    uLamp: GU.uLamp,
    uLampTint: GU.uLampTint,
    uDark: GU.uDark,
  };
  private readonly shift: [number, number, number] = [0, 0, 0];

  constructor() {
    // Four corners a stroke. aSeed: its home in the box (0 to 1 each way) and its own number. aCorner: tail to head, left to right.
    const seeds = new Float32Array(RAIN_STROKES * 16);
    const corners = new Float32Array(RAIN_STROKES * 8);
    const index: number[] = [];
    let random = 20261111;
    const next = (): number => {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      return random / 4294967296;
    };
    for (let stroke = 0; stroke < RAIN_STROKES; stroke += 1) {
      // (the stroke's own number runs evenly from 0 to 1: a rain level of 0.6 draws the first six in ten)
      const seed = [next(), next(), next(), (stroke + 0.5) / RAIN_STROKES];
      for (let corner = 0; corner < 4; corner += 1) {
        seeds.set(seed, (stroke * 4 + corner) * 4);
        corners.set([corner >> 1, (corner & 1) * 2 - 1], (stroke * 4 + corner) * 2);
      }
      const first = stroke * 4;
      index.push(first, first + 1, first + 2, first + 2, first + 1, first + 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RAIN_STROKES * 12), 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    geometry.setAttribute('aCorner', new THREE.BufferAttribute(corners, 2));
    geometry.setIndex(index);
    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        in vec4 aSeed;
        in vec2 aCorner;
        uniform vec3 uShift, uBox, uDirection, uInk;
        uniform float uLength, uLevel, uSheet, uFogDensity, uDark;
        uniform vec2 uPixel;
        uniform vec4 uLamp[4];
        uniform vec4 uLampTint[4];
        out vec3 vInk;
        out vec3 vAt;      // across the stroke in pixels, along it 0 (tail) to 1 (head), its half width in pixels
        out float vAlpha;
        out float vHeight;
        void main(){
          // the stroke's place in the world: its home, fallen and blown by uShift, wrapped into the box round the eye
          vec3 middle = cameraPosition + vec3(0., ${RAIN_LIFT.toFixed(1)}, 0.);
          vec3 head = middle + mod(aSeed.xyz * uBox + uShift - middle + uBox * .5, uBox) - uBox * .5;
          float own = fract(aSeed.w * 61.7);
          vec3 tail = head - uDirection * uLength * mix(.65, 1.2, own);
          vec3 at = mix(tail, head, aCorner.x);
          vec3 off = head - cameraPosition;
          float far = length(off);
          vec4 clipHead = projectionMatrix * viewMatrix * vec4(head, 1.);
          vec4 clipTail = projectionMatrix * viewMatrix * vec4(tail, 1.);
          vec4 clip = mix(clipTail, clipHead, aCorner.x);
          // a pen line: about a pixel and a half wide up close, a hair at the back of the box, plus a pixel of soft edge
          float halfWidth = clamp(2.2 * uSheet * 6. / max(far, 1.), .45 * uSheet, .95 * uSheet) * mix(.8, 1.2, own);
          vec2 along = (clipHead.xy / max(clipHead.w, 1e-4) - clipTail.xy / max(clipTail.w, 1e-4)) / uPixel;
          vec2 across = normalize(vec2(-along.y, along.x) + 1e-6);
          clip.xy += across * (halfWidth + 1.) * aCorner.y * uPixel * clip.w;
          vAt = vec3((halfWidth + 1.) * aCorner.y, aCorner.x, halfWidth);
          vHeight = at.y;
          // drawn only when its number is under the rain's level; faded out at the box's faces (where it wraps), too near the eye, and by the mist
          vec3 edge = abs(head - middle) / (uBox * .5);
          float alpha = smoothstep(0., .06, uLevel - aSeed.w)
            * (1. - smoothstep(.72, .97, max(edge.x, edge.z))) * (1. - smoothstep(.75, .97, edge.y))
            * smoothstep(2.2, 4.5, far) * exp(-far * uFogDensity * 2.);
          // a stroke falling through lamp light takes the lamp's colour
          float lit = 0.;
          vec3 tint = vec3(0.);
          for (int i = 0; i < 4; i++) {
            float v = (1. - distance(uLamp[i].xyz, head) / max(uLamp[i].w, 1e-3)) * uLampTint[i].a;
            if (v > lit) { lit = v; tint = uLampTint[i].rgb; }
          }
          lit = smoothstep(.05, .4, lit) * uDark;
          vInk = mix(uInk, tint * vec3(.96, .93, .86), lit);
          vAlpha = alpha * mix(1., 1.5, lit);
          gl_Position = clipHead.w < .3 || clipTail.w < .3 || alpha <= 0. ? vec4(2., 2., 2., 1.) : clip;
        }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        in vec3 vInk;
        in vec3 vAt;
        in float vAlpha;
        in float vHeight;
        layout(location = 0) out vec4 oColor;
        uniform float uStrength;
        void main(){
          // the pen lands light, presses, and lifts: thin at the tail, full near the head
          float press = smoothstep(0., .55, vAt.y) * (1. - smoothstep(.9, 1., vAt.y));
          float line = 1. - smoothstep(vAt.z * press - .5, vAt.z * press + .5, abs(vAt.x));
          // it ends where it meets the water
          oColor = vec4(vInk, line * press * vAlpha * uStrength * smoothstep(0., .12, vHeight));
        }`,
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  /** True when there is rain to draw. */
  get falling(): boolean {
    return this.uniforms.uLevel.value > 0.001;
  }

  /**
   * `level`: the rain, 0 to 1. `velocity`: its fall in metres a second. `seconds`: how far the look's paint time
   * moved (0 while paused). `ink`: the stroke's colour and strength now. `share`: 1, or less with the weather's fine work shed.
   */
  sync(level: number, storm: number, velocity: readonly [number, number, number], seconds: number, ink: Rgb, strength: number, share: number): void {
    advanceRain(this.shift, velocity, seconds);
    const speed = Math.hypot(...velocity) || 1;
    this.uniforms.uShift.value.set(...this.shift);
    this.uniforms.uDirection.value.set(velocity[0] / speed, velocity[1] / speed, velocity[2] / speed);
    this.uniforms.uLength.value = strokeLength(storm);
    this.uniforms.uLevel.value = level * share;
    this.uniforms.uInk.value.setRGB(ink[0], ink[1], ink[2]);
    this.uniforms.uStrength.value = strength;
    this.mesh.visible = this.falling;
  }

  /** The window's size in pixels: the strokes are drawn at it, whatever the world is drawn at. */
  resize(canvasWidth: number, canvasHeight: number): void {
    this.uniforms.uPixel.value.set(2 / canvasWidth, 2 / canvasHeight);
    this.uniforms.uSheet.value = canvasHeight / 1080;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

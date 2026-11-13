/**
 * Pings in the world: a tall column of light standing on each spot the crew has marked (`src/sim/pings.ts`),
 * in the colour of the player who marked it.
 *
 * It is painted the way the lamps' glows are: flat washes laid one inside the other on a card that turns to face
 * the eye. A pale core of light, a wash of the player's colour round it, and a faint wider wash of the same
 * colour round that. The landscape shows through all three. The sides wobble up its height as a hand would
 * draw them, and the top lifts off to a point. No pen line goes round it: light has no outline.
 *
 * It is still. Nothing in it reads a clock: it has no pulse, no shimmer, no sparks, and it neither fades in nor
 * out. It is there with the ping and gone with it. It only changes on the screen when the eye moves.
 *
 * It is seen from anywhere on the lake:
 * - it never draws thinner than a few pixels (`BEAM.minimumAngle`), however far off it stands;
 * - mist takes at most part of it (`BEAM.mistFloor`): by day, at night and in a storm it still shows;
 * - past the camera's reach it is drawn at the reach, along the same line of sight, so it is not cut off.
 *
 * Like the lamps' glows it is part of the world (it mirrors in the water, and an island in front hides it) and
 * it is left out of the ink buffer: the pen never outlines light. Four of them are one draw call.
 */
import * as THREE from 'three';
import { MAXIMUM_PLAYERS, pingColour, standingPings, terrainHeight } from '../sim/index.ts';
import type { GameState, PlayerId } from '../sim/index.ts';
import { GU, NOISE } from './b2/palette.js';
import type { Rgb } from './daylight.ts';

/**
 * - `height`: metres from its foot to its tip. Taller than any ridge an island has.
 * - `halfWidth`: half the coloured wash's width, metres.
 * - `core`: the share of that width the pale core takes.
 * - `halo`: how many times wider than the wash the faint outer wash is.
 * - `minimumAngle`: the least half-width the wash is drawn at, as an angle from the eye, radians. Four pixels at 1080p.
 * - `mistFloor`: the share of its strength the thickest mist leaves it.
 * - `drawWithin`: metres from the eye past which it is drawn nearer along the same line of sight. Under the camera's far plane (1700).
 * - `deepest`: the brightest its colour may be (0 to 1). A pale toque's beam is deepened to this, or it would not
 *   show against a day sky: light on paper is drawn by the darker wash round it.
 */
export const BEAM = {
  height: 200,
  halfWidth: 1.6,
  core: 0.38,
  halo: 2.1,
  minimumAngle: 0.0042,
  mistFloor: 0.68,
  drawWithin: 1500,
  deepest: 0.52,
} as const;

export interface Beam {
  playerId: PlayerId;
  /** Its foot: the spot, on the ground or on the water. */
  x: number;
  y: number;
  z: number;
  /** The player's colour, 0 to 1 a channel. */
  colour: Rgb;
}

/** `#rrggbb` as three shares of one. */
export function colourOf(hex: string): Rgb {
  const value = /^#[0-9a-f]{6}$/i.test(hex) ? Number.parseInt(hex.slice(1), 16) : 0xffffff;
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

/** How bright a colour is, 0 to 1, weighed as the eye does. */
export const brightness = (colour: Rgb): number => colour[0] * 0.3 + colour[1] * 0.5 + colour[2] * 0.2;

/**
 * The colour a player's beam is washed in: their own colour, the hue untouched, deepened when it is paler than
 * `BEAM.deepest` (the cream toque becomes a warm grey: a white light, with its edge drawn).
 */
export function beamColour(hex: string): Rgb {
  const colour = colourOf(hex);
  const scale = Math.min(1, BEAM.deepest / Math.max(brightness(colour), 1e-6));
  return [colour[0] * scale, colour[1] * scale, colour[2] * scale];
}

/** A beam for every ping standing, in player order, each with its foot on the ground or the waterline. */
export function beamsOf(state: GameState): Beam[] {
  return standingPings(state).slice(0, MAXIMUM_PLAYERS).map((ping) => ({
    playerId: ping.playerId,
    x: ping.x,
    y: Math.max(0, terrainHeight(ping.x, ping.z)),
    z: ping.z,
    colour: beamColour(pingColour(ping.playerId)),
  }));
}

/**
 * How wide a beam is drawn, as half its width in metres, `distance` metres from the eye: its own width up close,
 * and never under `BEAM.minimumAngle` of the view. The shader works out the same number.
 */
export function beamHalfWidth(distance: number): number {
  return Math.max(BEAM.halfWidth, distance * BEAM.minimumAngle);
}

/** The share of its strength a beam keeps through `distance` metres of mist of this density. Never under `BEAM.mistFloor`. */
export function beamThroughMist(distance: number, density: number): number {
  return BEAM.mistFloor + (1 - BEAM.mistFloor) * Math.exp(-distance * density * 0.5);
}

const VERTEX = /* glsl */ `
  in vec4 aFoot;    // the foot of the beam in the world, and its seed
  in vec3 aTint;    // the player's colour
  out vec2 vAt;     // across: -1 to 1 over the card. up: 0 at the foot to 1 at the tip
  out vec3 vTint;
  out float vSeed;
  out float vWide;  // half the wash's width as drawn, metres
  out float vMist;
  uniform int uPass;
  uniform float uFogDensity, uVeil;
  const float HEIGHT = ${BEAM.height.toFixed(1)};
  const float HALF = ${BEAM.halfWidth.toFixed(3)};
  const float MIN_ANGLE = ${BEAM.minimumAngle.toFixed(5)};
  const float FLOOR = ${BEAM.mistFloor.toFixed(3)};
  const float WITHIN = ${BEAM.drawWithin.toFixed(1)};
  const float ROOM = 3.;  // the card is this many times the wash's width: the faint outer wash and the wobble need the room
  void main(){
    // light is not ink: the pen's buffer never sees it
    if (uPass == 1) { gl_Position = vec4(2., 2., 2., 1.); return; }
    // (through the model matrix: the mirrored pass turns the world over, and the beam with it)
    vec3 foot = (modelMatrix * vec4(aFoot.xyz, 1.)).xyz;
    vec3 tip = (modelMatrix * vec4(aFoot.xyz + vec3(0., HEIGHT, 0.), 1.)).xyz;
    vec2 away = foot.xz - cameraPosition.xz;
    float dist = max(length(away), .001);
    // upright, and turned to face the eye: its width lies across the line of sight, flat on the water
    vec2 across = vec2(-away.y, away.x) / dist;
    // mist spreads a light a little; far off it keeps a few pixels of width
    float wide = max(HALF * (1. + .35 * uVeil), dist * MIN_ANGLE);
    vec3 world = mix(foot, tip, position.y);
    world.xz += across * position.x * wide * ROOM;
    vec4 view = viewMatrix * vec4(world, 1.);
    // past the camera's reach it is drawn at the reach, on the same line of sight: the same place on the screen
    float range = length(view.xyz);
    if (range > WITHIN) view.xyz *= WITHIN / range;
    gl_Position = projectionMatrix * view;
    vAt = vec2(position.x * ROOM, position.y);
    vTint = aTint;
    vSeed = aFoot.w;
    vWide = wide;
    // a light carries further than a rock does, and a ping is meant to be found: the mist never takes all of it
    vMist = FLOOR + (1. - FLOOR) * exp(-dist * uFogDensity * .5);
  }`;

const FRAGMENT = /* glsl */ `
  precision highp float;
  in vec2 vAt;
  in vec3 vTint;
  in float vSeed;
  in float vWide;
  in float vMist;
  layout(location = 0) out vec4 oColor;
  uniform float uDark;
  ${NOISE}
  const float HEIGHT = ${BEAM.height.toFixed(1)};
  const float CORE = ${BEAM.core.toFixed(3)};
  const float HALO = ${BEAM.halo.toFixed(3)};
  const vec3 PAPER = vec3(.953, .922, .851);
  void main(){
    float up = vAt.y;
    float metres = up * HEIGHT;
    // the stroke: full width up most of its height, lifting off to a point at the tip, spreading a little where it lands
    float body = (1. - smoothstep(.72, 1., up) * .94) * (1. + .45 * exp(-metres / max(vWide * 1.6, .01)));
    // the sides wobble as you go up it: drawn once, by hand. Worked out from the height alone, so it never moves.
    float wobble = (vnoise(vec2(metres * .09 + vSeed, vSeed * 1.7)) - .5) * .26 + (vnoise(vec2(metres * .31 - vSeed, 4.3)) - .5) * .08;
    float loose = (vnoise(vec2(metres * .04 - vSeed * 2.3, 7.9)) - .5) * .5;
    float lean = (vnoise(vec2(metres * .05 + 9.1, vSeed * .6)) - .5) * .14;
    float r = abs(vAt.x - lean) / body;
    float aa = fwidth(r) * 1.1 + .002;
    float halo = 1. - smoothstep(HALO + loose - aa, HALO + loose + aa, r);
    float wash = 1. - smoothstep(1. + wobble - aa, 1. + wobble + aa, r);
    float core = 1. - smoothstep(CORE + wobble * .5 - aa, CORE + wobble * .5 + aa, r);
    // three flat tones, as the lamps' glows have two: by night it is the brightest thing in the valley,
    // by day a clear wash that lets the far shore show through
    float night = clamp(uDark, 0., 1.);
    vec3 c = mix(vTint * mix(1., 1.1, night), mix(vTint, PAPER, mix(.72, .8, night)), core);
    float strength = halo * mix(.2, .24, night) + wash * mix(.4, .42, night) + core * mix(.34, .32, night);
    // the foot thins into the water over the last stride, so no hard line sits on the surface
    strength *= smoothstep(0., 1.2, metres);
    oColor = vec4(c, strength * vMist);
  }`;

/**
 * The beams, one instanced card each. `sync` writes them only when the state's list of pings is another list:
 * a standing ping costs a draw call, and nothing else.
 */
export class PingBeams {
  readonly mesh: THREE.InstancedMesh;
  private readonly feet: THREE.InstancedBufferAttribute;
  private readonly tints: THREE.InstancedBufferAttribute;
  private source: unknown = null;
  /** The beams as last written, for the probe and the tests. */
  private drawn: Beam[] = [];

  constructor() {
    // One unit wide either way and one unit tall: the shader stands it up and turns it.
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0], 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.feet = new THREE.InstancedBufferAttribute(new Float32Array(MAXIMUM_PLAYERS * 4), 4);
    this.tints = new THREE.InstancedBufferAttribute(new Float32Array(MAXIMUM_PLAYERS * 3), 3);
    geometry.setAttribute('aFoot', this.feet.setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aTint', this.tints.setUsage(THREE.DynamicDrawUsage));
    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: { uPass: GU.uPass, uDark: GU.uDark, uVeil: GU.uVeil, uFogDensity: GU.uFogDensity, tNoise: GU.tNoise },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, MAXIMUM_PLAYERS);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  /** Stand a beam on every ping. Does nothing while the state's list of pings is the one it last read. */
  sync(state: GameState): void {
    const source: unknown = state.pings;
    if (source === this.source) return;
    this.source = source;
    this.drawn = beamsOf(state);
    this.drawn.forEach((beam, index) => {
      // The seed is the player's, not the place's: a ping that moves keeps its hand.
      this.feet.setXYZW(index, beam.x, beam.y, beam.z, 3.1 + beam.playerId * 7.7);
      this.tints.setXYZ(index, beam.colour[0], beam.colour[1], beam.colour[2]);
    });
    this.mesh.count = this.drawn.length;
    this.mesh.visible = this.drawn.length > 0;
    this.feet.needsUpdate = true;
    this.tints.needsUpdate = true;
  }

  /** The beams standing in the world right now. */
  get beams(): readonly Beam[] {
    return this.drawn;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

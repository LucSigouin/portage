/**
 * The lights that matter at night: the canoe's lantern, the firebox aboard,
 * the camp fires and the lit Beacon. Each throws a warm pool on what is near
 * it (the surface shaders, through `GU.uLamp`) and has a glow round its flame
 * (a wash on a card that faces the eye).
 *
 * Every one follows the rules: the lantern by `canoe.lanternLit`, the firebox
 * by being fitted (the rules have it burn whenever it is aboard), a camp fire
 * by its island having a camp (the rules keep it lit), the Beacon by its flag.
 * None of them flickers: a flame that pulsed would break the look's first rule.
 */
import * as THREE from 'three';
import { ISLANDS, ISLANDS_BY_ID, spotPosition } from '../data/index.ts';
import { terrainHeight } from '../sim/index.ts';
import type { GameState } from '../sim/index.ts';
import { GU, NOISE } from './b2/palette.js';
import type { Rgb } from './daylight.ts';
import { LANDMARK_HEIGHT } from './landmarks.ts';

export type Point = readonly [number, number, number];

export interface Lamp {
  position: Point;
  /** How far its pool reaches, metres. */
  reach: number;
  /** What its light does to a colour. */
  tint: Rgb;
  /** 0 out, 1 burning. */
  strength: number;
  /** Radius of the glow round the flame, metres. */
  glow: number;
}

/** The surface shaders take this many lamps. */
export const LAMP_SLOTS = 4;

const LANTERN_TINT: Rgb = [1, 0.87, 0.64];
const FIRE_TINT: Rgb = [1, 0.74, 0.5];

/** Each kind of lamp: its reach, tint and glow. The lantern is the one that makes a night easy. */
export const LAMP_KINDS = {
  lantern: { reach: 12, tint: LANTERN_TINT, glow: 0.8 },
  firebox: { reach: 3.2, tint: FIRE_TINT, glow: 0.4 },
  campfire: { reach: 10, tint: FIRE_TINT, glow: 1.5 },
  beacon: { reach: 70, tint: LANTERN_TINT, glow: 15 },
} as const;

/** Every camp fire in the valley, where its flame is. */
export const CAMP_FIRES: readonly Point[] = ISLANDS.filter((island) => island.camp).map((island) => {
  const spot = spotPosition(island, island.camp!.spot);
  return [spot.x, Math.max(0, terrainHeight(spot.x, spot.z)) + 0.3, spot.z];
});

/** Where the Beacon's lamp is: the top of the radio tower. */
export function beaconPoint(): Point {
  const island = ISLANDS_BY_ID.the_beacon;
  const tower = island.landmarks.find((landmark) => landmark.kind === 'radio_tower');
  const spot = spotPosition(island, tower ? tower.spot : { along: 0, across: 0 });
  return [spot.x, terrainHeight(spot.x, spot.z) + (LANDMARK_HEIGHT.radio_tower ?? 30) + 1.2, spot.z];
}

const lamp = (kind: keyof typeof LAMP_KINDS, position: Point, burning: boolean): Lamp => ({ position, strength: burning ? 1 : 0, ...LAMP_KINDS[kind] });

/**
 * Every light in the game right now. `aboard` is where the look drew the lantern's flame and the firebox's,
 * or null where the canoe has none. The order is fixed: lantern, firebox, Beacon, then every camp fire.
 */
export function lampsOf(state: GameState, aboard: { lantern: Point | null; firebox: Point | null }): Lamp[] {
  const origin: Point = [0, 0, 0];
  return [
    lamp('lantern', aboard.lantern ?? origin, aboard.lantern !== null && state.canoe.lanternLit && state.canoe.attachments.includes('lantern_mast')),
    lamp('firebox', aboard.firebox ?? origin, aboard.firebox !== null && state.canoe.attachments.includes('firebox')),
    lamp('beacon', beaconPoint(), state.flags.beacon_lit === true),
    ...CAMP_FIRES.map((fire) => lamp('campfire', fire, true)),
  ];
}

/**
 * The lamps whose pools are drawn: the canoe's two and the Beacon keep their slots, and the last slot goes to the
 * camp fire nearest `x, z`. Camps are hundreds of metres apart, so no two of their pools are ever in one view.
 */
export function poolLamps(lamps: readonly Lamp[], x: number, z: number): Lamp[] {
  const fixed = lamps.slice(0, LAMP_SLOTS - 1);
  const fires = lamps.slice(LAMP_SLOTS - 1).filter((fire) => fire.strength > 0);
  const range = (fire: Lamp): number => Math.hypot(fire.position[0] - x, fire.position[2] - z);
  const nearest = fires.reduce<Lamp | null>((best, fire) => (best === null || range(fire) < range(best) ? fire : best), null);
  return nearest ? [...fixed, nearest] : fixed;
}

const GLOW_SLOTS = 16;

/**
 * The glow round each flame: two flat washes of its colour on a card that faces the eye, the edge wobbling
 * round the ring. It is part of the world (it mirrors in the water and mist closes over it), it is left out of
 * the ink buffer, and it shows by the same share as the pools do: not in daylight.
 */
export class LampGlows {
  readonly mesh: THREE.InstancedMesh;
  private readonly places: THREE.InstancedBufferAttribute;
  private readonly tints: THREE.InstancedBufferAttribute;

  constructor() {
    const geometry = new THREE.PlaneGeometry(2, 2);
    this.places = new THREE.InstancedBufferAttribute(new Float32Array(GLOW_SLOTS * 4), 4);
    this.tints = new THREE.InstancedBufferAttribute(new Float32Array(GLOW_SLOTS * 4), 4);
    geometry.setAttribute('aPlace', this.places.setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aTint', this.tints.setUsage(THREE.DynamicDrawUsage));
    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: { uDark: GU.uDark, uVeil: GU.uVeil, uFogDensity: GU.uFogDensity, tNoise: GU.tNoise },
      vertexShader: /* glsl */ `
        in vec4 aPlace;   // the flame, and the glow's radius in metres
        in vec4 aTint;    // its colour and strength
        out vec2 vAt;
        out vec4 vTint;
        out float vSeed;
        uniform float uVeil, uFogDensity;
        void main(){
          // (through the model matrix: the mirrored pass turns the world over, and the glow with it)
          vec4 centre = viewMatrix * modelMatrix * vec4(aPlace.xyz, 1.);
          // mist spreads a light, and closes over it with distance (a light carries further than a rock does)
          float radius = aPlace.w * (1. + .7 * uVeil);
          vTint = vec4(aTint.rgb, aTint.a * exp(centre.z * uFogDensity * .5));
          vAt = position.xy;
          vSeed = aPlace.x * .37 + aPlace.z * .11;
          centre.xy += position.xy * radius;
          gl_Position = projectionMatrix * centre;
        }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        in vec2 vAt;
        in vec4 vTint;
        in float vSeed;
        layout(location = 0) out vec4 oColor;
        uniform float uDark;
        ${NOISE}
        void main(){
          float r = length(vAt);
          // the ring's edge wobbles as you go round it: drawn once, by hand, not round
          float edge = (vnoise(normalize(vAt + 1e-4) * 1.7 + vSeed) - .5) * .16;
          float aa = fwidth(r) * 1.2 + .002;
          float inner = 1. - smoothstep(.4 + edge - aa, .4 + edge + aa, r);
          float outer = 1. - smoothstep(.84 + edge - aa, .84 + edge + aa, r);
          oColor = vec4(vTint.rgb, (inner * .13 + outer * .09) * vTint.a * uDark);
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, GLOW_SLOTS);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  /** Place a glow on every burning lamp. */
  sync(lamps: readonly Lamp[]): void {
    let count = 0;
    for (const light of lamps) {
      if (light.strength <= 0 || count >= GLOW_SLOTS) continue;
      this.places.setXYZW(count, light.position[0], light.position[1], light.position[2], light.glow);
      this.tints.setXYZW(count, light.tint[0], light.tint[1], light.tint[2], light.strength);
      count += 1;
    }
    this.mesh.count = count;
    this.places.needsUpdate = true;
    this.tints.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

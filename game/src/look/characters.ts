/**
 * Survivors: one standing figure each, in the paddler's storybook
 * proportions, told apart by coat and hat. They are stand-ins: step 2 builds
 * real character models and swaps them in with `registerCharacter`.
 */
import * as THREE from 'three';
import type { NpcId } from '../data/index.ts';
import { KIND } from './b2/detail.js';
import { Builder } from './b2/geo.js';
import { PAL } from './b2/palette.js';

export type CharacterBuilder = (builder: Builder) => void;

interface Outfit { coat: string; trim: string; hat: string; legs: string }

/** A standing figure facing -z, feet at y = 0. */
export function standingFigure(builder: Builder, outfit: Outfit): void {
  builder.kind = KIND.CLOTH;
  const coat = builder.cyl(0.135, 0.2, 0.56, outfit.coat, { pos: [0, 1.1, 0], flat: true }, 10);
  builder.sphere(0.16, outfit.coat, { pos: [0, 1.36, 0], scale: [1.3, 0.5, 0.92], id: coat, flat: true }, 10);
  builder.torus(0.1, 0.036, outfit.trim, { pos: [0, 1.43, 0], rot: [Math.PI / 2, 0, 0] }, 10);
  for (const side of [-1, 1]) {
    builder.beam([side * 0.2, 1.33, 0], [side * 0.27, 0.93, -0.06], 0.055, outfit.coat, { id: coat, flat: true }, 7);
    builder.sphere(0.06, '#454d5c', { pos: [side * 0.27, 0.9, -0.06], flat: true }, 7);
    builder.beam([side * 0.09, 0.84, 0], [side * 0.11, 0.1, 0], 0.07, outfit.legs, { r2: 0.06, flat: true }, 7);
    builder.box(0.1, 0.09, 0.21, '#5a4538', { pos: [side * 0.11, 0.05, -0.04], kind: KIND.PLAIN });
  }
  const head = builder.sphere(0.135, PAL.skin, { pos: [0, 1.6, -0.008], flat: true, kind: KIND.PLAIN }, 12);
  builder.sphere(0.143, outfit.hat, { pos: [0, 1.68, 0.014], scale: [1, 0.8, 1], flat: true }, 12);
  builder.torus(0.136, 0.034, outfit.trim, { pos: [0, 1.668, 0.012], rot: [Math.PI / 2 - 0.16, 0, 0] }, 12);
  for (const side of [-0.052, 0.052]) builder.sphere(0.02, PAL.ink, { pos: [side, 1.585, -0.128], id: head, flat: true, kind: KIND.PLAIN }, 6);
  builder.kind = null;
}

const OUTFITS: Record<NpcId, Outfit> = {
  odile: { coat: PAL.sage, trim: PAL.cream, hat: '#d9cdb0', legs: '#6f5a47' },
  wren: { coat: PAL.slate, trim: PAL.rust, hat: '#3f4654', legs: '#3f4654' },
  tink: { coat: PAL.rust, trim: PAL.ochre, hat: PAL.iron, legs: '#57697b' },
};

const BUILDERS: Record<NpcId, CharacterBuilder> = {
  odile: (builder) => standingFigure(builder, OUTFITS.odile),
  wren: (builder) => standingFigure(builder, OUTFITS.wren),
  tink: (builder) => standingFigure(builder, OUTFITS.tink),
};

/** Replace how a survivor is drawn. */
export function registerCharacter(npcId: NpcId, build: CharacterBuilder): void {
  BUILDERS[npcId] = build;
}

/** A survivor's mesh, facing -z with its feet at the origin. */
export function buildCharacter(npcId: NpcId): THREE.Mesh {
  const builder = new Builder(1800 + Object.keys(BUILDERS).indexOf(npcId));
  BUILDERS[npcId](builder);
  return builder.mesh();
}

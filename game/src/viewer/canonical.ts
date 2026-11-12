/**
 * The same picture whatever was opened before it. The game's builder gives every piece an ink id from one global
 * counter, and the ids are the counter's value mod 2003. A thing built after other things therefore gets other ids,
 * and two pieces that meet may draw a pen line between them or not. A second counter seeds the pen on each limb. The game builds in one fixed order, so it
 * never sees this; a viewer that builds in the order a person clicks would. So before each build the counter is
 * walked on to a fixed phase, and the game's shared drawings (landmarks, nodes, props, the ground's dressing) are
 * forgotten, so they are built again from that phase and not kept from whenever they were first needed.
 */
import { nextId, resetPieceCount } from '../look/b2/geo.js';
import { disposeLandmarks } from '../look/landmarks.ts';
import { disposeNodes } from '../look/nodes.ts';
import { disposePropLibrary } from '../look/props.ts';
import { disposeTerrainMaterials } from '../look/terrain.ts';

const PHASES = 2003;

/** The counter is `c`; an id says `(c * 53) % 2003`. Which `c` mod 2003 made this id? */
function phaseOf(id: number): number {
  const residue = Math.round(id * 2048) - 16;
  for (let guess = 0; guess < PHASES; guess += 1) if ((guess * 53) % PHASES === residue) return guess;
  throw new Error('The game has changed how it numbers its ink ids: the viewer cannot line them up.');
}

/** Walk the game's id counter on until it is a whole multiple of 2003, so the next piece built is always the same piece one. */
export function alignInkIds(): void {
  const phase = phaseOf(nextId());
  for (let step = (PHASES - phase) % PHASES; step > 0; step -= 1) nextId();
}

/** Forget the game's shared drawings, and line the ids up. Call with nothing of the game's on the stage. */
export function canonicalBuild(): void {
  disposeLandmarks();
  disposeNodes();
  disposePropLibrary();
  disposeTerrainMaterials();
  alignInkIds();
  resetPieceCount();
}

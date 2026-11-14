/**
 * Four people, four coats (`CAST_COATS`, `dressAs` in `look/cast.ts`). Read from the figures themselves.
 *
 * - Each of the four wears their own coat and trousers, the same in every seat.
 * - The headgear is the seat's colour (`CREW_MARKS`, the toque), in every seat: four who pick the same person are
 *   still four, and the HUD's toque still finds each one.
 * - The voyageur in seat 1 is the paddler of old, colour for colour.
 * - In a crew, a player who picks someone wears that someone's coat, not their seat's.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CHARACTER_IDS, CREW_MARKS } from '../../src/data/index.ts';
import { createGame } from '../../src/sim/index.ts';
import { createCrew } from '../../src/look/b2/canoe.js';
import type { Crew as Figure } from '../../src/look/b2/canoe.js';
import { PAL } from '../../src/look/b2/palette.js';
import { CanoeView } from '../../src/look/canoe.ts';
import { CAST_COATS } from '../../src/look/cast.ts';
import { crewOf } from '../../src/look/crew.ts';

const hexOf = (attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, index: number): string =>
  `#${new THREE.Color(attribute.getX(index), attribute.getY(index), attribute.getZ(index)).getHexString()}`;

/** Every colour on a figure but its paddle, with how many vertices carry it. */
function coloursOf(figure: Figure): Map<string, number> {
  const colours = new Map<string, number>();
  figure.root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || mesh === figure.paddler.paddle) return;
    const attribute = mesh.geometry.getAttribute('aColor');
    for (let index = 0; index < attribute.count; index += 1) colours.set(hexOf(attribute, index), (colours.get(hexOf(attribute, index)) ?? 0) + 1);
  });
  return colours;
}

const sleeveOf = (figure: Figure): string[] => [...new Set([figure.paddler.L.upper, figure.paddler.R.fore].map((mesh) => hexOf(mesh.geometry.getAttribute('aColor'), 0)))];
const seatOutfit = (seat: number) => ({ coat: CREW_MARKS[seat].coat, toque: CREW_MARKS[seat].toque, legs: CREW_MARKS[seat].legs });

/** The colour of the highest part of the figure's torso mesh: what the camera sees first from above. */
function topColour(figure: Figure): string {
  const torso = figure.root.children[0].children[0] as THREE.Mesh;
  const positions = torso.geometry.getAttribute('position');
  let best = 0;
  for (let index = 1; index < positions.count; index += 1) if (positions.getY(index) > positions.getY(best)) best = index;
  return hexOf(torso.geometry.getAttribute('aColor'), best);
}

describe('four coats', () => {
  it('are four, each from the game\'s palette or the paddler\'s own', () => {
    const coats = CHARACTER_IDS.map((who) => CAST_COATS[who].coat);
    expect(new Set(coats).size).toBe(4);
    const palette = new Set(Object.values(PAL));
    for (const who of CHARACTER_IDS) expect(palette.has(CAST_COATS[who].coat), who).toBe(true);
  });

  for (const who of CHARACTER_IDS) {
    it(`the ${who} wears their own coat and trousers in every seat, and the seat's colour on the head`, () => {
      for (let seat = 0; seat < CREW_MARKS.length; seat += 1) {
        const figure = createCrew(seatOutfit(seat), who);
        expect(sleeveOf(figure), `${who}, seat ${seat + 1}`).toEqual([CAST_COATS[who].coat]);
        expect(hexOf(figure.paddler.L.thigh.geometry.getAttribute('aColor'), 0)).toBe(CAST_COATS[who].legs);
        const colours = coloursOf(figure);
        expect(colours.has(CREW_MARKS[seat].toque), `${who}, seat ${seat + 1}: the toque colour`).toBe(true);
        // The seat's coat is nowhere on them, unless it is their own or the seat's toque.
        const seatCoat = CREW_MARKS[seat].coat;
        if (seatCoat !== CAST_COATS[who].coat && seatCoat !== CREW_MARKS[seat].toque) expect(colours.has(seatCoat), `${who}, seat ${seat + 1}`).toBe(false);
      }
    });
  }

  it('four of the same person, one in each seat: four head colours, one coat', () => {
    for (const who of CHARACTER_IDS) {
      const figures = CREW_MARKS.map((_, seat) => createCrew(seatOutfit(seat), who));
      expect(new Set(figures.map(sleeveOf).flat()).size, who).toBe(1);
      // The trapper's crown sits inside its fur band and the voyageur's toque under its bobble: the rest wear it on top.
      if (who === 'angler' || who === 'scout') expect(new Set(figures.map(topColour)).size, who).toBe(4);
    }
  });

  it('the voyageur in seat 1 is the paddler of old: ochre coat, red toque, blue-grey legs, and nothing else changed', () => {
    // (The wool's colours are the paddler's own, each cloth piece a shade off its base: rust scarf, cream band.)
    const figure = createCrew(seatOutfit(0), 'voyageur');
    const colours = coloursOf(figure);
    expect([...colours.keys()].sort()).toEqual(['#2a2b33', '#454d5c', '#57697b', '#5a4538', '#6b4f1e', '#a57f2e', '#a9483a', '#b7563b', '#b8573b', '#d5a542', '#e8c7a6', '#eae1cb', '#f1e8d1']);
  });
});

describe('in a crew', () => {
  it('a player who picks someone wears their coat, whatever seat they are in', () => {
    const state = createGame(7, { crew: 4 });
    for (const player of state.players) player.character = 'scout';
    const view = new CanoeView();
    view.sync(state, crewOf(state), 0, 0, true, true);
    expect(view.figures().map((figure) => figure.coat)).toEqual(CREW_MARKS.map(() => CAST_COATS.scout.coat));
    state.players[2].character = 'trapper';
    view.sync(state, crewOf(state), 1 / 60, 0.5, true, false);
    expect(view.figures()[2].coat).toBe(CAST_COATS.trapper.coat);
  });
});

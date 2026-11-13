/**
 * The two floats, and which is which (the fix round after the master review of round 3, finding 11).
 *
 * The review read: "The lobby sketch draws the starboard float blue. In the game it is wood." The game's starboard
 * float is three blue fuel drums, and its port float is a hollowed log. The picture taken for "wood" was of the port
 * side. The lobby's sketch is the game's own canoe (`canoe-sketch.test.ts`), so it draws the same two floats in the
 * same colours. This holds both: nobody "fixes" the sketch to a colour the game does not draw.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { posedCanoe } from '../../src/client/preview.ts';
import { PAL } from '../../src/look/b2/palette.js';
import { sketchCanoe } from '../../src/look/canoe-sketch.ts';
import { CanoeView } from '../../src/look/canoe.ts';
import { crewOf } from '../../src/look/crew.ts';
import type { GameState } from '../../src/sim/index.ts';
import { newGame } from '../support.ts';

/** The port float's log, as `look/canoe/deck-parts.ts` paints it. */
const LOG = '#8d6d4d';

/** A long canoe with both outriggers and nothing else, posed as the lobby poses it. */
function withBothFloats(): GameState {
  const state = newGame();
  state.canoe.hullTier = 3;
  state.canoe.attachments = ['outrigger_port', 'outrigger_starboard'];
  state.canoe = posedCanoe(state.canoe)!;
  return state;
}

type Inside = { attachments: THREE.Group };

/** How many vertices of each colour one outrigger has, by the colour's own numbers. (The log is 240 of them, the drums 432.) */
function coloursOf(view: CanoeView, index: number): Map<string, number> {
  const colours = new Map<string, number>();
  (view as unknown as Inside).attachments.children[index]!.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const colour = mesh.geometry.getAttribute('aColor');
    for (let vertex = 0; vertex < colour.count; vertex += 1) {
      const key = `${colour.getX(vertex).toFixed(3)},${colour.getY(vertex).toFixed(3)},${colour.getZ(vertex).toFixed(3)}`;
      colours.set(key, (colours.get(key) ?? 0) + 1);
    }
  });
  return colours;
}

/**
 * True when a good many vertices are painted this colour, or a shade of it: the builder varies a piece's paint a
 * little from vertex to vertex, so the colour is looked for by nearness.
 */
function has(colours: Map<string, number>, hex: string): boolean {
  const wanted = new THREE.Color(hex);
  let near = 0;
  for (const [key, count] of colours) {
    const [r, g, b] = key.split(',').map(Number) as [number, number, number];
    if (Math.hypot(r - wanted.r, g - wanted.g, b - wanted.b) < 0.07) near += count;
  }
  return near >= 150;
}

describe('the outrigger floats', () => {
  it('port is a hollowed log and starboard is three blue fuel drums, in the game', () => {
    const state = withBothFloats();
    const game = new CanoeView();
    game.sync(state, crewOf(state), 0, 0, true, true);
    const [port, starboard] = [coloursOf(game, 0), coloursOf(game, 1)];
    expect(has(port, LOG)).toBe(true);
    expect(has(port, PAL.barrelBlue)).toBe(false);
    expect(has(starboard, PAL.barrelBlue)).toBe(true);
    expect(has(starboard, LOG)).toBe(false);
    game.dispose();
  });

  it('and the lobby\'s sketch draws both in the very colours the game does, vertex for vertex', () => {
    const state = withBothFloats();
    const game = new CanoeView();
    game.sync(state, crewOf(state), 0, 0, true, true);
    const sketch = sketchCanoe(state);
    for (const index of [0, 1]) {
      const [drawn, played] = [coloursOf(sketch, index), coloursOf(game, index)];
      expect(drawn.size).toBeGreaterThanOrEqual(4);
      expect([...drawn.entries()].sort()).toEqual([...played.entries()].sort());
    }
    expect(has(coloursOf(sketch, 1), PAL.barrelBlue)).toBe(true);
    expect(has(coloursOf(sketch, 0), LOG)).toBe(true);
    sketch.dispose();
    game.dispose();
  });
});

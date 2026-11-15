/**
 * Luc, from the live game, as a guest: "when in friend lobby all character movements don't animate".
 *
 * The look stops its paint clock and snaps every figure on a frame whose state is not the one before, a moment on:
 * a new game, a load. A guest's view is a new object on most frames and is still the same game: it must carry on,
 * or a guest sees no stride, no stroke and still water.
 */
import { describe, expect, it } from 'vitest';
import { carriesOn } from '../../src/look/world-view.ts';
import { FIXED_STEP } from '../../src/sim/index.ts';
import { newGame } from '../support.ts';
import { calmGame, createRig } from '../net/rig.ts';

describe('the picture carries on', () => {
  it('through a guest\'s view, every frame of five seconds afloat', () => {
    const rig = createRig({ game: calmGame() });
    const sam = rig.join('Sam', undefined, { delay: 0.03 });
    rig.run(3);
    rig.hostInput = { paddle: 1 };
    let [frames, fresh, carried] = [0, 0, 0];
    let before = sam.link.view()!;
    for (let frame = 0; frame < 300; frame += 1) {
      rig.run(FIXED_STEP);
      const view = sam.link.view()!;
      frames += 1;
      if (view !== before) fresh += 1;
      if (carriesOn(before, view)) carried += 1;
      before = view;
    }
    // The case is real: most of a guest's frames are a new object.
    expect(fresh).toBeGreaterThan(frames / 2);
    expect(carried).toBe(frames);
  });

  it('and is cut by another game, by a game gone back in time, and by a long jump ahead', () => {
    const game = newGame(7);
    expect(carriesOn(null, game)).toBe(false);
    expect(carriesOn(game, game)).toBe(true);
    expect(carriesOn(game, newGame(8))).toBe(false);
    game.tick = 600;
    expect(carriesOn(game, { ...game, tick: 599 })).toBe(false);
    expect(carriesOn(game, { ...game, tick: 600 })).toBe(true);
    expect(carriesOn(game, { ...game, tick: 660 })).toBe(true);
    expect(carriesOn(game, { ...game, tick: 661 })).toBe(false);
  });
});

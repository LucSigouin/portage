/**
 * Luc, from the live game, as a guest: "i switched tabs and now i can't move my character".
 *
 * A hidden tab draws no frames, so a guest in one sends nothing. After ten seconds of that the host marks it away.
 * Back on the tab the guest asks straight back in (`knock`) and is given a new sitting, in which steps count from 0.
 * An input sent before the welcome arrives still carries the old sitting's step count: the host must never take that
 * for the new sitting's, or it counts the guest's walk as already walked that far and the guest stands for as long
 * as it had played.
 */
import { describe, expect, it } from 'vitest';
import { ISLANDS_BY_ID, spotPosition } from '../../src/data/index.ts';
import { FIXED_STEP, NEUTRAL_INPUT, drainEvents, step, terrainHeight } from '../../src/sim/index.ts';
import type { GameState } from '../../src/sim/index.ts';
import { newGame, standOn } from '../support.ts';
import { createRig } from './rig.ts';
import type { Rig, Seat } from './rig.ts';

/** The canoe beached at Home Knoll, host and guest on foot by the fire. */
function campGame(): GameState {
  const game = newGame(7);
  standOn(game, 'home_knoll');
  game.weather.secondsRemaining = 99999;
  drainEvents(game);
  return game;
}

function seatByFire(game: GameState): void {
  const fire = spotPosition(ISLANDS_BY_ID.home_knoll, ISLANDS_BY_ID.home_knoll.camp!.spot);
  game.players.forEach((player, index) => {
    const x = fire.x + 1 + index * 0.9;
    Object.assign(player, {
      mode: 'foot', seat: null, islandId: 'home_knoll', position: { x, y: terrainHeight(x, fire.z), z: fire.z },
      hunger: 100, thirst: 100, energy: 100,
    });
  });
}

/** The host plays on while the guest's tab is hidden: the wire still carries messages, the guest runs no frame. */
function hostAlone(rig: Rig, seat: Seat, seconds: number): void {
  for (let frame = 0; frame < Math.round(seconds / FIXED_STEP); frame += 1) {
    seat.pair.advance(FIXED_STEP);
    step(rig.game, rig.host.crewInput({ ...NEUTRAL_INPUT }, 0), FIXED_STEP);
    rig.host.afterFrame(drainEvents(rig.game), FIXED_STEP);
  }
}

const gap = (first: { x: number; z: number }, second: { x: number; z: number }): number => Math.hypot(second.x - first.x, second.z - first.z);

describe('a guest back from a hidden tab', () => {
  it.each([
    ['hidden long enough to be marked away', 12, false],
    ['hidden a moment, still seated', 3, true],
  ])('%s: walks again at once, on the host and on its own screen', (_name, hiddenSeconds, stillHere) => {
    const rig = createRig({ game: campGame() });
    const sam = rig.join('Sam', undefined, { delay: 0.03 });
    rig.run(3);
    expect(sam.link.status).toBe('playing');
    seatByFire(rig.game);
    // A minute at the fire, some of it walking: the sitting's step count is in the thousands.
    sam.input = { moveX: 1 };
    rig.run(2);
    sam.input = {};
    rig.run(58);

    hostAlone(rig, sam, hiddenSeconds);
    expect(rig.game.players[1]!.connected).toBe(stillHere);

    sam.link.knock();
    rig.run(1);
    expect(sam.link.status).toBe('playing');
    expect(rig.game.players[1]!.connected).toBe(true);

    const hostBefore = { ...rig.game.players[1]!.position };
    const shownBefore = { ...sam.link.view()!.players[1]!.position };
    sam.input = { moveX: -1 };
    rig.run(3);
    expect(gap(hostBefore, rig.game.players[1]!.position)).toBeGreaterThan(2);
    expect(gap(shownBefore, sam.link.view()!.players[1]!.position)).toBeGreaterThan(2);
  });
});

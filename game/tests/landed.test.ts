/**
 * Luc's list, line 17: "you should be able to stow gear to boat from anywhere if the boat is at the same island.
 * also you should be able to craft from anywhere as long as its on your character or on the boat and the boat is
 * at the island."
 *
 * Landed at this island: the canoe rests on the ground (it touched the shore, or was pulled up when someone stepped
 * out) and the island it rests at is the one the player stands on. Paddling it off ends it. Stations stay where
 * they are: a bench recipe still needs a bench.
 */
import { describe, expect, it } from 'vitest';
import { ISLANDS_BY_ID } from '../src/data/index.ts';
import { dispatch, selectInventory } from '../src/sim/index.ts';
import type { GameState, PlayerState } from '../src/sim/index.ts';
import { canoeLandedHere } from '../src/sim/inventory.ts';
import { countIn, give, newGame, standOn, teleport } from './support.ts';

/** The far side of Home Knoll from its landing: about 85 m from the canoe and 60 m from the camp. */
const FAR_SIDE = { x: ISLANDS_BY_ID.home_knoll.center.x, z: ISLANDS_BY_ID.home_knoll.center.z + 39 };

function farFromTheCanoe(crew = 1): GameState {
  const state = newGame(7, { crew });
  standOn(state, 'home_knoll');
  teleport(state, 'home_knoll', FAR_SIDE.x, FAR_SIDE.z);
  return state;
}

const away = (state: GameState, player: PlayerState): number =>
  Math.hypot(player.position.x - state.canoe.position.x, player.position.z - state.canoe.position.z);

describe('the canoe landed at the island you stand on', () => {
  it('takes the backpack and gives back from cargo, from the far side of the island', () => {
    const state = farFromTheCanoe();
    const player = state.players[0];
    expect(away(state, player)).toBeGreaterThan(60);
    expect(canoeLandedHere(state, player)).toBe(true);
    expect(selectInventory(state).cargoAccessible).toBe(true);
    give(state, 'driftwood', 5);
    expect(dispatch(state, { type: 'stow_backpack' }).ok).toBe(true);
    expect(countIn(state.canoe.cargo, 'driftwood')).toBe(5);
    expect(dispatch(state, { type: 'transfer', from: 'cargo', itemId: 'driftwood', count: 2 }).ok).toBe(true);
    expect(countIn(player.backpack, 'driftwood')).toBe(2);
  });

  it('crafts from what is on you and what is in the canoe together', () => {
    const state = farFromTheCanoe();
    give(state, 'fiber', 1);
    give(state, 'fiber', 2, 'cargo');
    expect(dispatch(state, { type: 'craft', recipeId: 'rope' })).toMatchObject({ ok: true });
    expect(countIn(state.players[0].backpack, 'fiber') + countIn(state.canoe.cargo, 'fiber')).toBe(0);
  });

  it('works for every player of a crew, a guest too: the host runs the same rule for each', () => {
    const state = farFromTheCanoe(2);
    const guest = state.players[1];
    Object.assign(guest, { mode: 'foot', seat: null, islandId: 'home_knoll', position: { ...state.players[0].position } });
    guest.backpack.push({ itemId: 'stone', count: 3 });
    expect(dispatch(state, { type: 'stow_backpack' }, 1).ok).toBe(true);
    expect(countIn(state.canoe.cargo, 'stone')).toBe(3);
  });

  it('keeps the stations where they are: sawing still needs a bench', () => {
    const state = farFromTheCanoe();
    give(state, 'saw');
    give(state, 'log', 1, 'cargo');
    const result = dispatch(state, { type: 'craft', recipeId: 'plank' });
    expect(result).toMatchObject({ ok: false, missing: { station: 'bench', items: [] } });
  });

  it('ends at the water: on another island, or once the canoe is paddled off, the cargo is out of reach', () => {
    const elsewhere = farFromTheCanoe();
    teleport(elsewhere, 'birch_islet', ISLANDS_BY_ID.birch_islet.center.x, ISLANDS_BY_ID.birch_islet.center.z);
    give(elsewhere, 'driftwood', 2);
    expect(dispatch(elsewhere, { type: 'stow_backpack' })).toMatchObject({ ok: false, reason: 'not_at_canoe' });

    const launched = farFromTheCanoe();
    launched.canoe.beached = false;
    give(launched, 'driftwood', 2);
    expect(selectInventory(launched).cargoAccessible).toBe(false);
    expect(dispatch(launched, { type: 'stow_backpack' })).toMatchObject({ ok: false, reason: 'not_at_canoe' });
    give(launched, 'fiber', 2, 'cargo');
    give(launched, 'fiber', 1);
    expect(dispatch(launched, { type: 'craft', recipeId: 'rope' })).toMatchObject({ ok: false, missing: { items: [{ itemId: 'fiber', count: 2 }] } });
  });
});

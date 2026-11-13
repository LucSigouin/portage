/**
 * The canoe's stations in the rules (Luc's list, Round 3): the firebox, the workbench, the smoker and the forge
 * craft anywhere on the water for whoever is aboard, host or guest, and nowhere else but beside the canoe.
 */
import { describe, expect, it } from 'vitest';
import type { AttachmentId, RecipeId } from '../src/data/index.ts';
import { addPlayer, canoeStations, dispatch, islandAt, playerOf, selectInventory } from '../src/sim/index.ts';
import type { GameState } from '../src/sim/index.ts';
import { build, countIn, floatCanoeAt, give, newGame, standOn, teleport } from './support.ts';

/** Open water in the middle of the Shallows: no island within reach, no camp, no shore. */
const MID_LAKE = { x: -40, z: 1085 };

/** One recipe per station aboard, with what it eats (put in the cargo) and what it makes. */
const ABOARD: { attachmentId: AttachmentId; recipeId: RecipeId; inputs: [Parameters<typeof give>[1], number][]; makes: Parameters<typeof give>[1] }[] = [
  { attachmentId: 'firebox', recipeId: 'pitch', inputs: [['spruce_gum', 2], ['driftwood', 1]], makes: 'pitch' },
  { attachmentId: 'workbench', recipeId: 'hammer', inputs: [['scrap_metal', 2], ['driftwood', 1], ['rope', 1]], makes: 'hammer' },
  { attachmentId: 'smoker', recipeId: 'smoked_fish', inputs: [['raw_fish', 1], ['driftwood', 1]], makes: 'smoked_fish' },
  { attachmentId: 'forge', recipeId: 'metal_sheet', inputs: [['scrap_metal', 3], ['charcoal', 1]], makes: 'metal_sheet' },
];

function afloat(...attachmentIds: AttachmentId[]): GameState {
  const state = newGame();
  state.canoe.hullTier = 2;
  build(state, ...attachmentIds);
  floatCanoeAt(state, MID_LAKE.x, MID_LAKE.z);
  return state;
}

const has = (state: GameState, itemId: Parameters<typeof give>[1]): boolean =>
  state.tools.includes(itemId as never) || countIn(state.canoe.cargo, itemId) > 0 || state.players.some((player) => countIn(player.backpack, itemId) > 0);

describe('the canoe\'s stations', () => {
  it('stands on open water: the test point is no island', () => {
    expect(islandAt(MID_LAKE.x, MID_LAKE.z)).toBeNull();
  });

  it('lists the crafting attachments that are built, in the builder\'s order, and nothing else', () => {
    const state = afloat();
    expect(canoeStations(state, playerOf(state))).toEqual([]);
    // Built out of order, with parts that are no station between them.
    build(state, 'forge', 'cargo_rack', 'firebox', 'outrigger_port', 'rain_catcher');
    expect(canoeStations(state, playerOf(state)).map((entry) => [entry.attachmentId, entry.station])).toEqual([
      ['firebox', 'fire'], ['forge', 'forge'],
    ]);
    build(state, 'smoker', 'workbench');
    expect(canoeStations(state, playerOf(state)).map((entry) => entry.attachmentId)).toEqual(['firebox', 'workbench', 'smoker', 'forge']);
    expect(canoeStations(state, playerOf(state)).every((entry) => entry.inReach)).toBe(true);
  });

  for (const { attachmentId, recipeId, inputs, makes } of ABOARD) {
    it(`the ${attachmentId} crafts on open water for the host aboard`, () => {
      const state = afloat();
      for (const [itemId, count] of inputs) give(state, itemId, count, 'cargo');
      // Not built: the recipe has no station out here.
      expect(dispatch(state, { type: 'craft', recipeId })).toMatchObject({ ok: false, reason: 'missing_requirements' });
      expect(has(state, makes)).toBe(false);
      build(state, attachmentId);
      expect(state.canoe.beached).toBe(false);
      expect(dispatch(state, { type: 'craft', recipeId }).ok).toBe(true);
      expect(has(state, makes)).toBe(true);
    });

    it(`the ${attachmentId} crafts on open water for a guest aboard`, () => {
      const state = afloat(attachmentId);
      const guest = addPlayer(state)!;
      expect(guest.mode).toBe('canoe');
      for (const [itemId, count] of inputs) give(state, itemId, count, 'cargo');
      expect(selectInventory(state, guest.id).stations).toContain(canoeStations(state, guest)[0].station);
      expect(dispatch(state, { type: 'craft', recipeId }, guest.id).ok).toBe(true);
      expect(has(state, makes)).toBe(true);
    });
  }

  it('reaches a player on foot beside the landed canoe, and not one who has walked off', () => {
    const state = newGame();
    state.canoe.hullTier = 2;
    build(state, 'firebox', 'workbench');
    standOn(state, 'cabin_roofs');
    expect(canoeStations(state, playerOf(state)).map((entry) => entry.inReach)).toEqual([true, true]);
    expect(selectInventory(state).stations).toEqual(['hands', 'fire', 'bench']);
    teleport(state, 'cabin_roofs', -330, 985);
    // Still listed (they are built), and out of reach.
    expect(canoeStations(state, playerOf(state)).map((entry) => entry.inReach)).toEqual([false, false]);
    expect(selectInventory(state).stations).toEqual(['hands']);
    give(state, 'spruce_gum', 2);
    give(state, 'driftwood', 1);
    expect(dispatch(state, { type: 'craft', recipeId: 'pitch' })).toMatchObject({ ok: false, missing: { station: 'fire' } });
  });

  it('is each player\'s own: a guest ashore is out of reach while the host aboard is not', () => {
    const state = afloat('firebox');
    const guest = addPlayer(state)!;
    guest.mode = 'foot';
    guest.seat = null;
    guest.islandId = 'cabin_roofs';
    guest.position = { x: -330, y: 0, z: 985 };
    expect(canoeStations(state, playerOf(state, 0))[0].inReach).toBe(true);
    expect(canoeStations(state, guest)[0].inReach).toBe(false);
  });
});

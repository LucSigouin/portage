import { describe, expect, it } from 'vitest';
import { dispatch, selectBuildOptions, selectCraftableRecipes, selectInventory } from '../src/sim/index.ts';
import { build, countIn, floatCanoeAt, give, newGame, standOn, teleport, teleportToCamp } from './support.ts';

describe('crafting', () => {
  it('makes a stone knife by hand and puts it on the belt', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    give(state, 'stone', 3);
    give(state, 'driftwood', 2);
    give(state, 'fiber', 2);
    const result = dispatch(state, { type: 'craft', recipeId: 'stone_knife' });
    expect(result).toMatchObject({ ok: true, gained: [{ itemId: 'stone_knife', count: 1 }] });
    expect(state.tools).toContain('stone_knife');
    expect(countIn(state.players[0].backpack, 'stone')).toBe(1);
    expect(countIn(state.players[0].backpack, 'driftwood')).toBe(1);
    expect(countIn(state.players[0].backpack, 'fiber')).toBe(0);
  });

  it('says exactly what is missing: items with the count still needed, tools and the station', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    give(state, 'log', 1);
    // Plank needs a bench, the saw and (for 3 crafts) 3 logs.
    const result = dispatch(state, { type: 'craft', recipeId: 'plank', count: 3 });
    expect(result).toEqual({
      ok: false,
      reason: 'missing_requirements',
      missing: { items: [{ itemId: 'log', count: 2 }], tools: ['saw'], station: 'bench', hullTier: null, attachments: [], flag: null },
    });
    const recipe = selectCraftableRecipes(state).find((entry) => entry.recipeId === 'plank')!;
    expect(recipe.craftable).toBe(false);
    expect(recipe.missing.tools).toEqual(['saw']);
    expect(recipe.missing.station).toBe('bench');
    expect(recipe.maximumCount).toBe(0);
  });

  it('needs the right station: the Home Knoll campfire, then the firebox aboard', () => {
    const state = newGame();
    standOn(state, 'cabin_roofs');
    give(state, 'spruce_gum', 4);
    give(state, 'driftwood', 2);
    expect(dispatch(state, { type: 'craft', recipeId: 'pitch' })).toMatchObject({ ok: false, missing: { station: 'fire' } });
    build(state, 'firebox');
    state.canoe.hullTier = 2;
    expect(selectInventory(state).stations).toContain('fire');
    expect(dispatch(state, { type: 'craft', recipeId: 'pitch' }).ok).toBe(true);
    teleport(state, 'cabin_roofs', -330, 985);
    expect(selectInventory(state).stations).toEqual(['hands']); // the canoe is out of reach up here

    const home = newGame();
    standOn(home, 'home_knoll');
    give(home, 'spruce_gum', 2);
    give(home, 'driftwood', 1);
    teleportToCamp(home, 'home_knoll');
    expect(selectInventory(home).stations).toEqual(['hands', 'fire', 'bench']);
    expect(dispatch(home, { type: 'craft', recipeId: 'pitch' }).ok).toBe(true);
  });

  it('draws inputs from the backpack and the cargo together', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    give(state, 'fiber', 2);
    give(state, 'fiber', 4, 'cargo');
    const result = dispatch(state, { type: 'craft', recipeId: 'rope', count: 2 });
    expect(result.ok).toBe(true);
    expect(countIn(state.players[0].backpack, 'fiber') + countIn(state.canoe.cargo, 'fiber')).toBe(0);
    expect(countIn(state.players[0].backpack, 'rope')).toBe(2);
  });

  it('keeps sailcloth locked until Wren teaches it', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    teleportToCamp(state, 'home_knoll');
    give(state, 'cloth', 3);
    give(state, 'fiber', 2);
    expect(dispatch(state, { type: 'craft', recipeId: 'sailcloth' }))
      .toMatchObject({ ok: false, reason: 'recipe_locked', missing: { flag: 'wren_taught_sailcloth' } });
    expect(selectCraftableRecipes(state).find((entry) => entry.recipeId === 'sailcloth')!.known).toBe(false);
    state.flags.wren_taught_sailcloth = true;
    expect(dispatch(state, { type: 'craft', recipeId: 'sailcloth' }).ok).toBe(true);
  });

  it('refuses when the result will not fit, and spends nothing', () => {
    const state = newGame();
    teleport(state, 'home_knoll', 30, 1170); // away from the canoe: backpack only
    for (let slot = 0; slot < 7; slot += 1) give(state, 'stone', 20);
    give(state, 'fiber', 20);
    expect(dispatch(state, { type: 'craft', recipeId: 'rope' })).toMatchObject({ ok: false, reason: 'inventory_full' });
    expect(countIn(state.players[0].backpack, 'fiber')).toBe(20);
    expect(dispatch(state, { type: 'craft', recipeId: 'rope', count: 0 })).toMatchObject({ ok: false, reason: 'invalid_amount' });
  });
});

describe('the canoe builder', () => {
  it('patches the hull with pitch and bark, only when the canoe is beached and in reach', () => {
    const state = newGame();
    give(state, 'pitch', 2, 'cargo');
    give(state, 'birch_bark', 3, 'cargo');
    expect(dispatch(state, { type: 'upgrade_hull' })).toMatchObject({ ok: false, reason: 'canoe_not_beached' });
    standOn(state, 'home_knoll');
    teleport(state, 'home_knoll', 30, 1170);
    expect(dispatch(state, { type: 'upgrade_hull' })).toMatchObject({ ok: false, reason: 'not_at_canoe' });
    expect(selectBuildOptions(state)).toMatchObject({ canBuildHere: false, blockedReason: 'not_at_canoe' });
    standOn(state, 'home_knoll');
    expect(selectBuildOptions(state).hull).toMatchObject({ tier: 1, buildable: true });
    expect(dispatch(state, { type: 'upgrade_hull' }).ok).toBe(true);
    expect(state.canoe.hullTier).toBe(1);
    expect(state.canoe.cargo).toHaveLength(0);
  });

  it('needs the hammer for the ribbed hull and reports the planks still short', () => {
    const state = newGame();
    state.canoe.hullTier = 1;
    standOn(state, 'home_knoll');
    give(state, 'plank', 5);
    give(state, 'nails', 6);
    give(state, 'rope', 2);
    expect(dispatch(state, { type: 'upgrade_hull' })).toMatchObject({
      ok: false, reason: 'missing_requirements', missing: { items: [{ itemId: 'plank', count: 3 }], tools: ['hammer'] },
    });
    give(state, 'plank', 3);
    give(state, 'hammer');
    expect(dispatch(state, { type: 'upgrade_hull' }).ok).toBe(true);
    state.canoe.hullTier = 3;
    expect(dispatch(state, { type: 'upgrade_hull' })).toMatchObject({ ok: false, reason: 'hull_at_maximum' });
    expect(selectBuildOptions(state).hull).toBeNull();
  });

  it('gates attachments on hull tier, on the attachment they sit on, and on cost', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    give(state, 'hammer');
    give(state, 'saw');
    give(state, 'plank', 20);
    give(state, 'nails', 20);
    give(state, 'scrap_metal', 5);
    give(state, 'log', 4);
    give(state, 'rope', 6);
    expect(dispatch(state, { type: 'build_attachment', attachmentId: 'outrigger_port' }))
      .toMatchObject({ ok: false, reason: 'missing_requirements', missing: { hullTier: 2 } });
    state.canoe.hullTier = 2;
    expect(dispatch(state, { type: 'build_attachment', attachmentId: 'workbench' }))
      .toMatchObject({ ok: false, missing: { attachments: ['outrigger_port'] } });
    expect(dispatch(state, { type: 'build_attachment', attachmentId: 'outrigger_port' }).ok).toBe(true);
    expect(dispatch(state, { type: 'build_attachment', attachmentId: 'outrigger_port' })).toMatchObject({ ok: false, reason: 'already_built' });
    expect(dispatch(state, { type: 'build_attachment', attachmentId: 'workbench' }).ok).toBe(true);
    expect(countIn(state.players[0].backpack, 'plank')).toBe(10);
    expect(dispatch(state, { type: 'build_attachment', attachmentId: 'radio' })).toMatchObject({ ok: false, missing: { hullTier: 3 } });
    const options = selectBuildOptions(state);
    expect(options.attachments.find((entry) => entry.attachmentId === 'workbench')).toMatchObject({ built: true, buildable: false });
    expect(options.attachments.find((entry) => entry.attachmentId === 'cargo_rack')).toMatchObject({ built: false, buildable: true });
    expect(options.attachments).toHaveLength(22);
  });

  it('builds cosmetic rewards from their key item, and cannot build afloat', () => {
    const state = newGame();
    state.canoe.hullTier = 2;
    standOn(state, 'steeple_rock');
    expect(dispatch(state, { type: 'build_attachment', attachmentId: 'flag' }))
      .toMatchObject({ ok: false, missing: { items: [{ itemId: 'signal_flag', count: 1 }] } });
    give(state, 'signal_flag');
    expect(dispatch(state, { type: 'build_attachment', attachmentId: 'flag' }).ok).toBe(true);
    expect(state.keyItems.signal_flag).toBeUndefined();
    give(state, 'carved_figurehead');
    floatCanoeAt(state, 0, 600);
    expect(dispatch(state, { type: 'build_attachment', attachmentId: 'figurehead' })).toMatchObject({ ok: false, reason: 'canoe_not_beached' });
  });
});

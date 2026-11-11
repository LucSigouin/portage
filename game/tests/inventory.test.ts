import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/data/index.ts';
import { dispatch, selectInventory } from '../src/sim/index.ts';
import { addToStacks, cargoSlots, removeFromStacks } from '../src/sim/inventory.ts';
import type { ItemStack } from '../src/sim/index.ts';
import { build, countIn, give, newGame, standOn, teleport, teleportToCamp } from './support.ts';

describe('stacks', () => {
  it('holds 20 to a stack, tops up part stacks first and reports what did not fit', () => {
    const stacks: ItemStack[] = [{ itemId: 'driftwood', count: 15 }];
    expect(addToStacks(stacks, 2, 'driftwood', 10)).toBe(0);
    expect(stacks).toEqual([{ itemId: 'driftwood', count: 20 }, { itemId: 'driftwood', count: 5 }]);
    expect(addToStacks(stacks, 2, 'stone', 1)).toBe(1);
    expect(addToStacks(stacks, 2, 'driftwood', 30)).toBe(15);
    expect(TUNING.inventory.stackSize).toBe(20);
  });

  it('removes from the smallest stacks first and drops empty ones', () => {
    const stacks: ItemStack[] = [{ itemId: 'nails', count: 20 }, { itemId: 'nails', count: 3 }, { itemId: 'rope', count: 1 }];
    expect(removeFromStacks(stacks, 'nails', 5)).toBe(5);
    expect(stacks).toEqual([{ itemId: 'nails', count: 18 }, { itemId: 'rope', count: 1 }]);
    expect(removeFromStacks(stacks, 'nails', 99)).toBe(18);
    expect(stacks).toEqual([{ itemId: 'rope', count: 1 }]);
  });
});

describe('capacity', () => {
  it('gives the backpack 8 slots and the cargo 8, 8, 12, 16, plus 6 with the rack', () => {
    const state = newGame();
    expect(selectInventory(state).backpackSlots).toBe(8);
    const slots = [0, 1, 2, 3].map((tier) => {
      state.canoe.hullTier = tier;
      return cargoSlots(state);
    });
    expect(slots).toEqual([8, 8, 12, 16]);
    build(state, 'cargo_rack');
    expect(cargoSlots(state)).toBe(22);
    expect(selectInventory(state).cargoSlots).toBe(22);
  });

  it('keeps tools and key items out of the slots', () => {
    const state = newGame();
    give(state, 'hammer');
    give(state, 'lens');
    const inventory = selectInventory(state);
    expect(inventory.backpack).toHaveLength(0);
    expect(inventory.tools).toEqual(['bailing_can', 'hammer']);
    expect(inventory.keyItems).toEqual([{ itemId: 'lens', count: 1 }]);
  });
});

describe('moving things', () => {
  it('stows the whole backpack into the cargo in one action', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    give(state, 'driftwood', 7);
    give(state, 'fiber', 4);
    const result = dispatch(state, { type: 'stow_backpack' });
    expect(result.ok).toBe(true);
    expect(countIn(state.player.backpack, 'driftwood') + countIn(state.player.backpack, 'fiber')).toBe(0);
    expect(countIn(state.canoe.cargo, 'driftwood')).toBe(7);
    expect(countIn(state.canoe.cargo, 'fiber')).toBe(4);
  });

  it('stows what fits and says so when the cargo is full', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    for (let slot = 0; slot < 8; slot += 1) give(state, 'stone', 20, 'cargo');
    give(state, 'clay', 5);
    expect(dispatch(state, { type: 'stow_backpack' })).toMatchObject({ ok: false, reason: 'inventory_full' });
    state.canoe.cargo.pop();
    give(state, 'fiber', 3);
    expect(dispatch(state, { type: 'stow_backpack' }).ok).toBe(true);
    expect(countIn(state.canoe.cargo, 'clay')).toBe(5);
    expect(countIn(state.player.backpack, 'fiber')).toBe(3);
  });

  it('transfers stacks both ways and refuses what it cannot do', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    give(state, 'nails', 12);
    expect(dispatch(state, { type: 'transfer', from: 'backpack', itemId: 'nails', count: 5 }))
      .toMatchObject({ ok: true, gained: [{ itemId: 'nails', count: 5 }] });
    expect(dispatch(state, { type: 'transfer', from: 'cargo', itemId: 'nails', count: 2 }).ok).toBe(true);
    expect(countIn(state.player.backpack, 'nails')).toBe(9);
    expect(countIn(state.canoe.cargo, 'nails')).toBe(3);
    expect(dispatch(state, { type: 'transfer', from: 'cargo', itemId: 'rope', count: 1 })).toMatchObject({ ok: false, reason: 'item_not_held' });
    expect(dispatch(state, { type: 'transfer', from: 'cargo', itemId: 'nails', count: 0 })).toMatchObject({ ok: false, reason: 'invalid_amount' });
    expect(dispatch(state, { type: 'transfer', from: 'cargo', itemId: 'hammer', count: 1 })).toMatchObject({ ok: false, reason: 'unknown_id' });
    expect(dispatch(state, { type: 'discard', from: 'backpack', itemId: 'nails', count: 4 })).toMatchObject({ ok: true });
    expect(countIn(state.player.backpack, 'nails')).toBe(5);
  });
});

describe('reaching the cargo', () => {
  it('is in reach aboard, beside the canoe, and at a camp on the island where the canoe is beached', () => {
    const state = newGame();
    expect(selectInventory(state).cargoAccessible).toBe(true); // aboard
    standOn(state, 'home_knoll');
    expect(selectInventory(state).cargoAccessible).toBe(true); // beside it
    teleport(state, 'home_knoll', 30, 1170);
    expect(selectInventory(state).cargoAccessible).toBe(false); // across the island
    expect(dispatch(state, { type: 'stow_backpack' })).toMatchObject({ ok: false, reason: 'not_at_canoe' });
    teleportToCamp(state, 'home_knoll');
    expect(selectInventory(state).cargoAccessible).toBe(true); // at the camp
    state.canoe.lastBeached.islandId = 'birch_islet';
    expect(selectInventory(state).cargoAccessible).toBe(false); // canoe is elsewhere
  });
});

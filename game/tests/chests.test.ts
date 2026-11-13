/**
 * The three chests (Luc's list, round 3: "buildable chests up to 4 to get more storage on the boat", each dearer
 * than the last). The cargo rack is the first of the four storage builds. The table, the build order, the cargo
 * room after each, a refused build, what the canoe builder lists, a guest, old saves, and that storage weighs nothing.
 */
import { describe, expect, it } from 'vitest';
import { ATTACHMENTS, ATTACHMENT_IDS, HULL_TIERS, ITEMS } from '../src/data/index.ts';
import type { AttachmentId } from '../src/data/index.ts';
import { buildCanoeBuilderPanel } from '../src/client/viewmodels/index.ts';
import { deserialize, serialize } from '../src/save/index.ts';
import { attachmentSections } from '../src/viewer/guide.ts';
import { dispatch, selectBuildOptions, selectCanoeStats, selectInventory } from '../src/sim/index.ts';
import type { GameState } from '../src/sim/index.ts';
import { canoeStability } from '../src/sim/canoe.ts';
import { cargoSlots } from '../src/sim/inventory.ts';
import { build, countIn, give, newGame, run, standOn } from './support.ts';
import { createRig } from './net/rig.ts';

const STORAGE: AttachmentId[] = ['cargo_rack', 'plank_chest', 'tin_trunk', 'sea_chest'];
const CHESTS = STORAGE.slice(1);
const price = (attachmentId: AttachmentId): number => ATTACHMENTS[attachmentId].cost.reduce((sum, entry) => sum + entry.count, 0);

/** Beached at Cabin Roofs on the long hull, every tool on the belt and every material a chest asks for in the pack. */
function stocked(hullTier = 3): GameState {
  const state = newGame();
  state.canoe.hullTier = hullTier;
  standOn(state, 'cabin_roofs');
  for (const toolId of ['hammer', 'saw', 'wrench'] as const) give(state, toolId);
  for (const attachmentId of CHESTS) for (const { itemId, count } of ATTACHMENTS[attachmentId].cost) give(state, itemId, count);
  return state;
}

describe('the table of storage builds', () => {
  it('has four: the cargo rack, then three chests, six stacks each', () => {
    expect(ATTACHMENT_IDS.filter((attachmentId) => ATTACHMENTS[attachmentId].cargoSlotsBonus > 0)).toEqual(STORAGE);
    expect(STORAGE.map((attachmentId) => ATTACHMENTS[attachmentId].cargoSlotsBonus)).toEqual([6, 6, 6, 6]);
  });

  it('prices each one clearly above the one before: more pieces, and never fewer of anything it shares', () => {
    expect(STORAGE.map(price)).toEqual([8, 17, 23, 27]);
    for (let index = 1; index < STORAGE.length; index += 1) {
      expect(price(STORAGE[index]), STORAGE[index]).toBeGreaterThanOrEqual(price(STORAGE[index - 1]) + 4);
      expect(ATTACHMENTS[STORAGE[index]].tools.length, STORAGE[index]).toBeGreaterThanOrEqual(ATTACHMENTS[STORAGE[index - 1]].tools.length);
    }
    // Planks are in all four, and climb: 4, 8, 10, 14.
    expect(STORAGE.map((attachmentId) => ATTACHMENTS[attachmentId].cost.find((entry) => entry.itemId === 'plank')!.count)).toEqual([4, 8, 10, 14]);
    // The last two want forged metal, and the last one wants the most of it: a late build.
    const forged = (attachmentId: AttachmentId): number => ATTACHMENTS[attachmentId].cost
      .filter((entry) => entry.itemId === 'metal_sheet' || entry.itemId === 'hardware').reduce((sum, entry) => sum + entry.count, 0);
    expect(STORAGE.map(forged)).toEqual([0, 0, 3, 10]);
    for (const attachmentId of CHESTS) for (const { itemId } of ATTACHMENTS[attachmentId].cost) expect(ITEMS[itemId], itemId).toBeDefined();
  });

  it('builds them in order, each on the one before, the first two on the ribbed hull and the last on the long one', () => {
    expect(ATTACHMENTS.plank_chest.requiresAttachments).toEqual(['cargo_rack', 'outrigger_port']);
    expect(ATTACHMENTS.tin_trunk.requiresAttachments).toEqual(['plank_chest', 'outrigger_starboard']);
    expect(ATTACHMENTS.sea_chest.requiresAttachments).toEqual(['tin_trunk']);
    expect(CHESTS.map((attachmentId) => ATTACHMENTS[attachmentId].minimumHullTier)).toEqual([2, 2, 3]);
    // Each has a mount of its own, and the long hull alone offers the third.
    expect(CHESTS.map((attachmentId) => ATTACHMENTS[attachmentId].mountId)).toEqual(['port_deck_mid', 'starboard_deck_mid', 'midship_thwart']);
    expect(HULL_TIERS[2].mountIds).not.toContain('midship_thwart');
    expect(HULL_TIERS[3].mountIds).toContain('midship_thwart');
  });

  it('says in each description what it gives', () => {
    for (const attachmentId of STORAGE) expect(ATTACHMENTS[attachmentId].description, attachmentId).toMatch(/Six more stacks/);
  });
});

describe('building the chests', () => {
  it('refuses a chest before the one it stands on, and spends nothing when it refuses', () => {
    const state = stocked();
    const before = JSON.stringify(state.players[0].backpack);
    expect(dispatch(state, { type: 'build_attachment', attachmentId: 'plank_chest' }))
      .toMatchObject({ ok: false, reason: 'missing_requirements', missing: { attachments: ['cargo_rack', 'outrigger_port'] } });
    expect(dispatch(state, { type: 'build_attachment', attachmentId: 'tin_trunk' }))
      .toMatchObject({ ok: false, reason: 'missing_requirements', missing: { attachments: ['plank_chest', 'outrigger_starboard'] } });
    expect(dispatch(state, { type: 'build_attachment', attachmentId: 'sea_chest' }))
      .toMatchObject({ ok: false, reason: 'missing_requirements', missing: { attachments: ['tin_trunk'] } });
    expect(state.canoe.attachments).toEqual([]);
    expect(JSON.stringify(state.players[0].backpack)).toBe(before);
    expect(cargoSlots(state)).toBe(16);
    // The rack alone does not carry a chest: the deck it stands on is the outrigger's.
    build(state, 'cargo_rack');
    expect(dispatch(state, { type: 'build_attachment', attachmentId: 'plank_chest' })).toMatchObject({ ok: false, missing: { attachments: ['outrigger_port'] } });
  });

  it('refuses the sea chest on the ribbed hull, with everything else in hand', () => {
    const state = stocked(2);
    build(state, 'cargo_rack', 'outrigger_port', 'outrigger_starboard', 'plank_chest', 'tin_trunk');
    expect(dispatch(state, { type: 'build_attachment', attachmentId: 'sea_chest' }))
      .toMatchObject({ ok: false, reason: 'missing_requirements', missing: { hullTier: 3, attachments: [], items: [] } });
    expect(cargoSlots(state)).toBe(30);
  });

  it('refuses a chest the crew cannot pay for, and says what is short', () => {
    const state = stocked();
    build(state, 'cargo_rack', 'outrigger_port');
    state.players[0].backpack = state.players[0].backpack.filter((stack) => stack.itemId !== 'nails');
    give(state, 'nails', 2);
    expect(dispatch(state, { type: 'build_attachment', attachmentId: 'plank_chest' }))
      .toMatchObject({ ok: false, reason: 'missing_requirements', missing: { items: [{ itemId: 'nails', count: 4 }] } });
    expect(state.canoe.attachments).not.toContain('plank_chest');
  });

  it('adds six stacks of cargo with each one built: 16, 22, 28, 34, 40 on the long hull', () => {
    const state = stocked();
    const room = [cargoSlots(state)];
    build(state, 'cargo_rack', 'outrigger_port', 'outrigger_starboard');
    room.push(cargoSlots(state));
    for (const attachmentId of CHESTS) {
      expect(dispatch(state, { type: 'build_attachment', attachmentId }), attachmentId).toMatchObject({ ok: true });
      room.push(cargoSlots(state));
      expect(selectInventory(state).cargoSlots).toBe(cargoSlots(state));
      expect(selectCanoeStats(state).cargoSlots).toBe(cargoSlots(state));
    }
    expect(room).toEqual([16, 22, 28, 34, 40]);
    expect(state.canoe.attachments.slice(-3)).toEqual(CHESTS);
    // Every piece was paid for: the pack held exactly the three costs.
    for (const itemId of ['plank', 'nails', 'rope', 'metal_sheet', 'hardware', 'pitch'] as const) expect(countIn(state.players[0].backpack, itemId), itemId).toBe(0);
    expect(dispatch(state, { type: 'build_attachment', attachmentId: 'sea_chest' })).toMatchObject({ ok: false, reason: 'already_built' });
  });

  it('gives the ribbed hull 12, 18, 24, 30 and no fourth', () => {
    const state = stocked(2);
    const room = [cargoSlots(state)];
    build(state, 'cargo_rack', 'outrigger_port', 'outrigger_starboard');
    room.push(cargoSlots(state));
    for (const attachmentId of ['plank_chest', 'tin_trunk'] as const) {
      expect(dispatch(state, { type: 'build_attachment', attachmentId }).ok, attachmentId).toBe(true);
      room.push(cargoSlots(state));
    }
    expect(room).toEqual([12, 18, 24, 30]);
  });

  it('holds what the room says: the fortieth stack goes in and the forty-first does not', () => {
    const state = stocked();
    build(state, 'cargo_rack', 'outrigger_port', 'outrigger_starboard', ...CHESTS);
    state.players[0].backpack = [];
    for (let stack = 0; stack < 40; stack += 1) state.canoe.cargo.push({ itemId: 'stone', count: 20 });
    give(state, 'driftwood', 5);
    expect(dispatch(state, { type: 'transfer', from: 'backpack', itemId: 'driftwood', count: 5 })).toMatchObject({ ok: false, reason: 'inventory_full' });
    state.canoe.cargo.pop();
    expect(dispatch(state, { type: 'transfer', from: 'backpack', itemId: 'driftwood', count: 5 })).toMatchObject({ ok: true });
    expect(state.canoe.cargo).toHaveLength(40);
  });
});

describe('the canoe builder lists the chests from the table, with no change to the screen', () => {
  it('shows each chest by name with its cost and tools, and what must be built first', () => {
    const state = stocked(2);
    const panel = buildCanoeBuilderPanel(state);
    expect(panel.attachments).toHaveLength(ATTACHMENT_IDS.length);
    expect(selectBuildOptions(state).attachments.map((entry) => entry.attachmentId).slice(-3)).toEqual(CHESTS);
    for (const attachmentId of CHESTS) {
      const definition = ATTACHMENTS[attachmentId];
      const row = panel.attachments.find((entry) => entry.name === definition.name)!;
      expect(row, attachmentId).toBeDefined();
      expect(row.costs.map((cost) => cost.name), attachmentId)
        .toEqual([...definition.cost.map((entry) => ITEMS[entry.itemId].name), ...definition.tools.map((toolId) => ITEMS[toolId].name)]);
      expect(row.build?.enabled, attachmentId).toBe(false);
      expect(row.needs.length, `${attachmentId}: says what is needed first`).toBeGreaterThan(0);
    }
    build(state, 'cargo_rack', 'outrigger_port');
    const ready = buildCanoeBuilderPanel(state).attachments.find((entry) => entry.name === 'Plank chest')!;
    expect(ready.build?.enabled).toBe(true);
    expect(ready.needs).toEqual([]);
  });
});

describe('the asset viewer\'s guide', () => {
  it('says for each chest what it costs, what must be built first, which hull, and what it gives', () => {
    for (const attachmentId of CHESTS) {
      const definition = ATTACHMENTS[attachmentId];
      const text = attachmentSections(definition).flatMap((section) => section.lines.map((line) => `${line.lead}: ${line.text}`)).join(' | ');
      expect(text, attachmentId).toContain('Cargo: 6 more slots.');
      for (const { itemId, count } of definition.cost) expect(text.toLowerCase(), `${attachmentId}: ${count} ${itemId}`).toContain(`${count} ${ITEMS[itemId].name.toLowerCase()}`);
      for (const required of definition.requiresAttachments) expect(text.toLowerCase(), attachmentId).toContain(ATTACHMENTS[required].name.toLowerCase());
      expect(text.toLowerCase(), attachmentId).toContain(`the ${HULL_TIERS[definition.minimumHullTier].name.toLowerCase()} or better`);
    }
  });
});

describe('storage is free, as the cargo rack is', () => {
  it('leaves the canoe as steady and as quick with three full chests as with none', () => {
    const paddle = (chests: boolean): { stability: number; distance: number; speed: number } => {
      const state = newGame();
      state.canoe.hullTier = 3;
      state.weather.secondsRemaining = 99999;
      build(state, 'cargo_rack', 'outrigger_port', 'outrigger_starboard');
      if (chests) {
        build(state, ...CHESTS);
        for (let stack = 0; stack < 40; stack += 1) state.canoe.cargo.push({ itemId: 'stone', count: 20 });
      }
      state.players[0].mode = 'canoe';
      state.canoe.beached = false;
      state.canoe.position = { x: 200, y: 0, z: 1300 };
      state.players[0].position = { ...state.canoe.position };
      run(state, { paddle: 1 }, 20);
      return { stability: canoeStability(state), distance: state.statistics.distancePaddled, speed: state.canoe.speed };
    };
    const [bare, laden] = [paddle(false), paddle(true)];
    expect(laden.stability).toBe(bare.stability);
    expect(laden.distance).toBe(bare.distance);
    expect(laden.speed).toBe(bare.speed);
    expect(bare.distance).toBeGreaterThan(30);
    for (const attachmentId of CHESTS) expect(ATTACHMENTS[attachmentId].stabilityBonus).toBe(0);
  });
});

describe('a guest', () => {
  it('sees the chests the host builds, and the larger cargo', () => {
    const game = stocked();
    game.weather.secondsRemaining = 99999;
    build(game, 'cargo_rack', 'outrigger_port', 'outrigger_starboard');
    const rig = createRig({ game });
    const sam = rig.join('Sam');
    rig.run(0.3);
    expect(rig.settle()).toBe(true);
    expect(cargoSlots(sam.link.truth!)).toBe(22);
    for (const attachmentId of CHESTS) expect(dispatch(rig.game, { type: 'build_attachment', attachmentId }).ok, attachmentId).toBe(true);
    rig.run(0.5);
    expect(rig.settle()).toBe(true);
    expect(sam.link.truth!.canoe.attachments.slice(-3)).toEqual(CHESTS);
    expect(cargoSlots(sam.link.truth!)).toBe(40);
    expect(selectInventory(sam.link.truth!, sam.link.playerId!).cargoSlots).toBe(40);
  });
});

describe('saves', () => {
  const fixtures = import.meta.glob<string>('./fixtures/save-*.json', { eager: true, query: '?raw', import: 'default' });

  it('loads every old save as it was: no chest appears, and its cargo room is its hull and rack', () => {
    expect(Object.keys(fixtures).length).toBeGreaterThanOrEqual(7);
    for (const [name, text] of Object.entries(fixtures)) {
      const loaded = deserialize(text);
      expect(loaded.ok, name).toBe(true);
      if (!loaded.ok) continue;
      const { canoe } = loaded.state;
      for (const attachmentId of CHESTS) expect(canoe.attachments, name).not.toContain(attachmentId);
      expect(cargoSlots(loaded.state), name).toBe(HULL_TIERS[canoe.hullTier].cargoSlots + (canoe.attachments.includes('cargo_rack') ? 6 : 0));
      expect(canoe.cargo.length, name).toBeLessThanOrEqual(cargoSlots(loaded.state));
    }
  });

  it('keeps three chests and forty stacks through a save and a load, with no new field', () => {
    const state = stocked();
    build(state, 'cargo_rack', 'outrigger_port', 'outrigger_starboard', ...CHESTS);
    for (let stack = 0; stack < 40; stack += 1) state.canoe.cargo.push({ itemId: 'stone', count: 20 });
    const fresh = newGame();
    expect(Object.keys(state.canoe).sort()).toEqual(Object.keys(fresh.canoe).sort());
    const loaded = deserialize(serialize(state, 5));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.state.canoe.attachments.slice(-3)).toEqual(CHESTS);
    expect(loaded.state.canoe.cargo).toHaveLength(40);
    expect(cargoSlots(loaded.state)).toBe(40);
  });
});

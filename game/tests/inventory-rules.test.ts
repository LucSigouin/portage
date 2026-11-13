/**
 * The rules behind the inventory grid (Luc's bugfix list, round 3): the tool belt in each player's own order, a
 * stack moved whole to the other side, and what may never be dropped.
 */
import { describe, expect, it } from 'vitest';
import { readCommand } from '../src/net/messages.ts';
import { deserialize, serialize } from '../src/save/index.ts';
import {
  BELT_SLOTS, NUMBERED_BELT_SLOTS, addPlayer, beltOf, discardRefusal, dispatch, drainEvents, questHolding, roomFor,
} from '../src/sim/index.ts';
import type { GameState } from '../src/sim/index.ts';
import { countIn, floatCanoeAt, give, newGame, standOn, teleport } from './support.ts';

const fixtures = import.meta.glob<string>('./fixtures/save-live-*.json', { eager: true, query: '?raw', import: 'default' });

/** Ashore at Home Knoll beside the canoe, with a second player aboard nobody's keys drive. */
function crewOfTwo(): GameState {
  const state = newGame();
  standOn(state, 'home_knoll');
  addPlayer(state);
  drainEvents(state);
  return state;
}

describe('the tool belt, in each player\'s own order', () => {
  it('starts in the order the crew got its tools, and reading it writes nothing', () => {
    const state = newGame();
    give(state, 'hatchet');
    give(state, 'saw');
    expect(BELT_SLOTS).toBe(8);
    expect(NUMBERED_BELT_SLOTS).toBe(5);
    expect(beltOf(state, state.players[0])).toEqual(['bailing_can', 'hatchet', 'saw', null, null, null, null, null]);
    expect('toolSlots' in state.players[0]).toBe(false);
  });

  it('moves a tool to any slot: the tool that was there takes the slot it left', () => {
    const state = newGame();
    give(state, 'hatchet');
    give(state, 'saw');
    // Onto an empty slot: its old slot is left empty.
    expect(dispatch(state, { type: 'move_tool', toolId: 'bailing_can', slot: 4 })).toMatchObject({ ok: true });
    expect(beltOf(state, state.players[0])).toEqual([null, 'hatchet', 'saw', null, 'bailing_can', null, null, null]);
    // Onto a taken slot: the two change places.
    expect(dispatch(state, { type: 'move_tool', toolId: 'saw', slot: 1 }).ok).toBe(true);
    expect(beltOf(state, state.players[0])).toEqual([null, 'saw', 'hatchet', null, 'bailing_can', null, null, null]);
    // A tool the crew gets later takes the first free slot, and nothing already placed moves.
    give(state, 'hammer');
    expect(beltOf(state, state.players[0])).toEqual(['hammer', 'saw', 'hatchet', null, 'bailing_can', null, null, null]);
    // Onto its own slot: nothing changes.
    expect(dispatch(state, { type: 'move_tool', toolId: 'saw', slot: 1 }).ok).toBe(true);
    expect(beltOf(state, state.players[0])).toEqual(['hammer', 'saw', 'hatchet', null, 'bailing_can', null, null, null]);
  });

  it('is each player\'s own: the tools are the crew\'s, the order is not', () => {
    const state = crewOfTwo();
    give(state, 'hatchet');
    expect(dispatch(state, { type: 'move_tool', toolId: 'hatchet', slot: 0 }, 1).ok).toBe(true);
    expect(beltOf(state, state.players[1]).slice(0, 2)).toEqual(['hatchet', 'bailing_can']);
    expect(beltOf(state, state.players[0]).slice(0, 2)).toEqual(['bailing_can', 'hatchet']);
    expect('toolSlots' in state.players[0]).toBe(false);
    // Every tool is still on every belt, once.
    for (const player of state.players) expect(beltOf(state, player).filter(Boolean).sort()).toEqual(['bailing_can', 'hatchet']);
  });

  it('refuses a tool the crew does not have, and a slot the belt does not have', () => {
    const state = newGame();
    expect(dispatch(state, { type: 'move_tool', toolId: 'wrench', slot: 0 })).toMatchObject({ ok: false, reason: 'tool_not_owned' });
    for (const slot of [-1, 8, 1.5, Number.NaN]) {
      expect(dispatch(state, { type: 'move_tool', toolId: 'bailing_can', slot }), String(slot)).toMatchObject({ ok: false, reason: 'invalid_amount' });
    }
    expect('toolSlots' in state.players[0]).toBe(false);
  });

  it('reads a saved order it cannot trust as empty slots: a tool the crew lacks, one named twice, too many', () => {
    const state = newGame();
    give(state, 'hatchet');
    state.players[0].toolSlots = ['wrench', 'hatchet', 'hatchet', null, null, null, null, null, 'bailing_can', 'saw'];
    expect(beltOf(state, state.players[0])).toEqual(['bailing_can', 'hatchet', null, null, null, null, null, null]);
    (state.players[0] as { toolSlots?: unknown }).toolSlots = 'nonsense';
    expect(beltOf(state, state.players[0])).toEqual(['bailing_can', 'hatchet', null, null, null, null, null, null]);
  });

  it('is kept in the save with its player, and a save from before it loads with the crew\'s order', () => {
    const state = crewOfTwo();
    give(state, 'hatchet');
    dispatch(state, { type: 'move_tool', toolId: 'hatchet', slot: 3 }, 1);
    const loaded = deserialize(serialize(state, 1000));
    if (!loaded.ok) throw new Error(loaded.reason);
    expect(loaded.state.players[1].toolSlots).toEqual(['bailing_can', null, null, 'hatchet', null, null, null, null]);
    expect('toolSlots' in loaded.state.players[0]).toBe(false);

    // The three saves made on the live site have no such field: they load, and their belts are the crew's order.
    expect(Object.keys(fixtures)).toHaveLength(3);
    for (const [name, text] of Object.entries(fixtures)) {
      const old = deserialize(text);
      if (!old.ok) throw new Error(`${name}: ${old.reason}`);
      expect(old.migratedFrom, name).toBeNull();
      for (const player of old.state.players) {
        expect('toolSlots' in player, name).toBe(false);
        expect(beltOf(old.state, player).filter(Boolean), name).toEqual(old.state.tools);
      }
    }
  });

  it('comes over the wire only whole: a known tool and a slot of the belt', () => {
    expect(readCommand({ type: 'move_tool', toolId: 'hatchet', slot: 4 })).toEqual({ type: 'move_tool', toolId: 'hatchet', slot: 4 });
    expect(readCommand({ type: 'move_tool', toolId: 'hatchet', slot: 7 })).not.toBeNull();
    for (const bad of [
      { type: 'move_tool', toolId: 'hatchet', slot: 8 }, { type: 'move_tool', toolId: 'hatchet', slot: -1 },
      { type: 'move_tool', toolId: 'hatchet', slot: 1.5 }, { type: 'move_tool', toolId: 'driftwood', slot: 1 },
      { type: 'move_tool', toolId: 'hatchet' }, { type: 'move_tool', toolId: 'hatchet', slot: 1, extra: true },
    ]) expect(readCommand(bad), JSON.stringify(bad)).toBeNull();
  });
});

describe('a whole stack to the other side', () => {
  it('goes both ways while the cargo is in reach', () => {
    const state = crewOfTwo();
    give(state, 'driftwood', 12);
    expect(dispatch(state, { type: 'transfer', from: 'backpack', itemId: 'driftwood', count: 12 })).toMatchObject({ ok: true, gained: [{ itemId: 'driftwood', count: 12 }] });
    expect(countIn(state.players[0].backpack, 'driftwood')).toBe(0);
    expect(countIn(state.canoe.cargo, 'driftwood')).toBe(12);
    expect(dispatch(state, { type: 'transfer', from: 'cargo', itemId: 'driftwood', count: 12 }).ok).toBe(true);
    expect(countIn(state.players[0].backpack, 'driftwood')).toBe(12);
    expect(countIn(state.canoe.cargo, 'driftwood')).toBe(0);
  });

  it('moves what fits when the other side is full, and the answer says how many went', () => {
    const state = crewOfTwo();
    // Seven full stacks of stone and 15 driftwood in the hold's eighth: room for 5 more driftwood, no free slot.
    for (let stack = 0; stack < 7; stack += 1) give(state, 'stone', 20, 'cargo');
    give(state, 'driftwood', 15, 'cargo');
    give(state, 'driftwood', 12);
    expect(roomFor(state.canoe.cargo, 8, 'driftwood')).toBe(5);
    expect(roomFor(state.canoe.cargo, 8, 'clay')).toBe(0);
    expect(dispatch(state, { type: 'transfer', from: 'backpack', itemId: 'driftwood', count: 12 })).toMatchObject({ ok: true, gained: [{ itemId: 'driftwood', count: 5 }] });
    expect(countIn(state.players[0].backpack, 'driftwood')).toBe(7);
    expect(countIn(state.canoe.cargo, 'driftwood')).toBe(20);
    // Nothing fits any more: refused, and nothing moved.
    expect(dispatch(state, { type: 'transfer', from: 'backpack', itemId: 'driftwood', count: 7 })).toMatchObject({ ok: false, reason: 'inventory_full' });
    expect(countIn(state.players[0].backpack, 'driftwood')).toBe(7);
  });

  it('is refused both ways when the cargo is out of reach', () => {
    const state = crewOfTwo();
    give(state, 'driftwood', 6);
    give(state, 'stone', 4, 'cargo');
    // Paddled off without this player: not beside the canoe, and the canoe is not landed here.
    teleport(state, 'home_knoll', 0, 1150);
    state.canoe.beached = false;
    expect(dispatch(state, { type: 'transfer', from: 'backpack', itemId: 'driftwood', count: 6 })).toMatchObject({ ok: false, reason: 'not_at_canoe' });
    expect(dispatch(state, { type: 'transfer', from: 'cargo', itemId: 'stone', count: 4 })).toMatchObject({ ok: false, reason: 'not_at_canoe' });
    expect(countIn(state.players[0].backpack, 'driftwood')).toBe(6);
    expect(countIn(state.canoe.cargo, 'stone')).toBe(4);
  });
});

describe('what is never dropped', () => {
  it('a tool and a key item refuse, each with its own reason, and stay', () => {
    const state = newGame();
    give(state, 'lens');
    expect(dispatch(state, { type: 'discard', from: 'backpack', itemId: 'bailing_can', count: 1 })).toMatchObject({ ok: false, reason: 'tool_kept' });
    expect(dispatch(state, { type: 'discard', from: 'backpack', itemId: 'lens', count: 1 })).toMatchObject({ ok: false, reason: 'key_item_kept' });
    expect(state.tools).toContain('bailing_can');
    expect(state.keyItems.lens).toBe(1);
  });

  it('what an open quest still asks for refuses; what the crew holds beyond that is free to go', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    state.quests.first_haul.status = 'active'; // Gather 3 driftwood, pull 4 cattail fiber
    give(state, 'driftwood', 5);
    drainEvents(state);
    // The whole stack would leave the crew with none of the three: refused, nothing lost, nothing said by an event.
    expect(questHolding(state, 'driftwood', 5)).toBe('first_haul');
    expect(discardRefusal(state, 'driftwood', 5)).toBe('quest_needs_item');
    expect(dispatch(state, { type: 'discard', from: 'backpack', itemId: 'driftwood', count: 5 })).toMatchObject({ ok: false, reason: 'quest_needs_item' });
    expect(countIn(state.players[0].backpack, 'driftwood')).toBe(5);
    expect(drainEvents(state).filter((event) => event.type === 'item_lost')).toEqual([]);
    // Two of the five are spare: they go.
    expect(questHolding(state, 'driftwood', 2)).toBeNull();
    expect(dispatch(state, { type: 'discard', from: 'backpack', itemId: 'driftwood', count: 2 })).toMatchObject({ ok: true, spent: [{ itemId: 'driftwood', count: 2 }] });
    expect(countIn(state.players[0].backpack, 'driftwood')).toBe(3);
    // What the cargo holds counts for the crew: with three more in the hold, the backpack's three are spare.
    give(state, 'driftwood', 3, 'cargo');
    expect(questHolding(state, 'driftwood', 3)).toBeNull();
    // An item no open quest names is free.
    give(state, 'stone', 4);
    expect(discardRefusal(state, 'stone', 4)).toBeNull();
    expect(dispatch(state, { type: 'discard', from: 'backpack', itemId: 'stone', count: 4 }).ok).toBe(true);
  });

  it('holds only while the quest is open: not before it is given, not once it is handed in', () => {
    const state = newGame();
    give(state, 'driftwood', 3);
    for (const [status, held] of [['locked', false], ['available', false], ['active', true], ['ready', true], ['completed', false]] as const) {
      state.quests.first_haul.status = status;
      expect(questHolding(state, 'driftwood', 3) !== null, status).toBe(held);
    }
  });

  it('lets go of an ingredient once it has been made into the thing the quest was for', () => {
    const state = newGame();
    give(state, 'sailcloth', 2);
    // The quest that asks for two sailcloth, to sew the sail from.
    const questIds = Object.keys(state.quests) as (keyof typeof state.quests)[];
    const quest = questIds.find((questId) => {
      state.quests[questId].status = 'active';
      const held = questHolding(state, 'sailcloth', 2) === questId;
      state.quests[questId].status = 'locked';
      return held;
    });
    expect(quest, 'a quest asks for sailcloth').toBeDefined();
    state.quests[quest!].status = 'active';
    expect(discardRefusal(state, 'sailcloth', 2)).toBe('quest_needs_item');
    // The mast and sail are up: the step is done for good, and sailcloth is only cloth again.
    state.canoe.attachments.push('mast_sail');
    expect(discardRefusal(state, 'sailcloth', 2)).toBeNull();
  });

  it('a guest is held to the same rules, and may do all of it', () => {
    const state = crewOfTwo();
    state.quests.first_haul.status = 'active';
    const guest = state.players[1];
    guest.backpack.push({ itemId: 'driftwood', count: 3 }, { itemId: 'stone', count: 6 });
    floatCanoeAt(state, state.canoe.position.x, state.canoe.position.z);
    expect(dispatch(state, { type: 'discard', from: 'backpack', itemId: 'driftwood', count: 3 }, 1)).toMatchObject({ ok: false, reason: 'quest_needs_item' });
    expect(dispatch(state, { type: 'discard', from: 'backpack', itemId: 'bailing_can', count: 1 }, 1)).toMatchObject({ ok: false, reason: 'tool_kept' });
    expect(dispatch(state, { type: 'discard', from: 'backpack', itemId: 'stone', count: 6 }, 1).ok).toBe(true);
    expect(dispatch(state, { type: 'transfer', from: 'backpack', itemId: 'driftwood', count: 3 }, 1).ok).toBe(true);
    expect(countIn(guest.backpack, 'driftwood')).toBe(0);
    expect(countIn(state.canoe.cargo, 'driftwood')).toBe(3);
    expect(dispatch(state, { type: 'transfer', from: 'cargo', itemId: 'driftwood', count: 3 }, 1).ok).toBe(true);
    expect(countIn(guest.backpack, 'driftwood')).toBe(3);
  });
});

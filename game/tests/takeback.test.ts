/**
 * A dropped stack's way back, in the rules (the master review of round 3, finding 2): `take_back` puts a drop
 * where it was for a few seconds, whole or not at all, once, and only for the player who dropped it.
 */
import { describe, expect, it } from 'vitest';
import { readCommand } from '../src/net/messages.ts';
import { deserialize, serialize } from '../src/save/index.ts';
import { TAKE_BACK, addPlayer, dispatch, drainEvents, standingDrop } from '../src/sim/index.ts';
import type { GameState } from '../src/sim/index.ts';
import { countIn, give, newGame, run, standOn, teleport } from './support.ts';

const fixtures = import.meta.glob<string>('./fixtures/save-*.json', { eager: true, query: '?raw', import: 'default' });

/** Ashore at Home Knoll beside the landed canoe. */
function ashore(prepare: (state: GameState) => void = () => {}): GameState {
  const state = newGame();
  standOn(state, 'home_knoll');
  // The first quest is behind: its reward does not land in the backpack mid-test.
  state.quests.bail_out.status = 'completed';
  prepare(state);
  drainEvents(state);
  return state;
}

const drop = (state: GameState, itemId: 'stone' | 'clay' | 'driftwood' | 'berries', count: number, from: 'backpack' | 'cargo' = 'backpack', playerId = 0) =>
  dispatch(state, { type: 'discard', from, itemId, count }, playerId);

describe('a dropped stack may be taken back', () => {
  it('for a few seconds, a second longer than the note that offers it', () => {
    expect(TAKE_BACK.seconds).toBe(6);
  });

  it('goes back where it was: the same slot of the same container, and the drop\'s number is on the event', () => {
    const state = ashore((made) => {
      give(made, 'clay', 4);
      give(made, 'stone', 9);
      give(made, 'berries', 2);
    });
    expect(drop(state, 'stone', 9)).toMatchObject({ ok: true, spent: [{ itemId: 'stone', count: 9 }] });
    expect(drainEvents(state)).toEqual([{ type: 'item_lost', itemId: 'stone', count: 9, dropId: 1, playerId: 0 }]);
    expect(state.players[0].backpack).toEqual([{ itemId: 'clay', count: 4 }, { itemId: 'berries', count: 2 }]);
    expect(standingDrop(state, 0, 1)).toMatchObject({ id: 1, itemId: 'stone', count: 9, from: 'backpack', slot: 1 });

    expect(dispatch(state, { type: 'take_back', drop: 1 })).toEqual({ ok: true, gained: [{ itemId: 'stone', count: 9 }], spent: [] });
    expect(state.players[0].backpack).toEqual([{ itemId: 'clay', count: 4 }, { itemId: 'stone', count: 9 }, { itemId: 'berries', count: 2 }]);
    expect(drainEvents(state)).toEqual([{ type: 'item_gained', itemId: 'stone', count: 9, container: 'backpack', dropId: 1, playerId: 0 }]);
    expect(standingDrop(state, 0, 1)).toBeNull();
  });

  it('goes back to the cargo when it was dropped from the cargo, and tops up its own stack first', () => {
    const state = ashore((made) => {
      give(made, 'stone', 20, 'cargo');
      give(made, 'stone', 5, 'cargo');
      give(made, 'clay', 3, 'cargo');
    });
    // Twenty go: the stack of five first, then fifteen of the twenty.
    expect(drop(state, 'stone', 20, 'cargo').ok).toBe(true);
    expect(state.canoe.cargo).toEqual([{ itemId: 'stone', count: 5 }, { itemId: 'clay', count: 3 }]);
    expect(dispatch(state, { type: 'take_back', drop: 1 }).ok).toBe(true);
    expect(state.canoe.cargo).toEqual([{ itemId: 'stone', count: 20 }, { itemId: 'stone', count: 5 }, { itemId: 'clay', count: 3 }]);
    expect(countIn(state.players[0].backpack, 'stone')).toBe(0);
  });

  it('comes back once: asked twice, the second answer is no and nothing more comes', () => {
    const state = ashore((made) => give(made, 'stone', 9));
    drop(state, 'stone', 9);
    expect(dispatch(state, { type: 'take_back', drop: 1 }).ok).toBe(true);
    expect(dispatch(state, { type: 'take_back', drop: 1 })).toMatchObject({ ok: false, reason: 'nothing_to_take_back' });
    expect(countIn(state.players[0].backpack, 'stone')).toBe(9);
  });

  it('never brings back more than was dropped, whatever number is asked for', () => {
    const state = ashore((made) => give(made, 'stone', 9));
    // Three of nine dropped: three come back, and no other number names anything.
    drop(state, 'stone', 3);
    for (const dropId of [0, 2, 99, -1, 1.5]) {
      expect(dispatch(state, { type: 'take_back', drop: dropId }), String(dropId)).toMatchObject({ ok: false, reason: 'nothing_to_take_back' });
    }
    expect(countIn(state.players[0].backpack, 'stone')).toBe(6);
    expect(dispatch(state, { type: 'take_back', drop: 1 })).toMatchObject({ ok: true, gained: [{ itemId: 'stone', count: 3 }] });
    expect(countIn(state.players[0].backpack, 'stone')).toBe(9);
    // Asked to drop more than is held: what went is what comes back, not what was asked.
    expect(drop(state, 'stone', 50)).toMatchObject({ ok: true, spent: [{ itemId: 'stone', count: 9 }] });
    expect(dispatch(state, { type: 'take_back', drop: 2 })).toMatchObject({ ok: true, gained: [{ itemId: 'stone', count: 9 }] });
    expect(countIn(state.players[0].backpack, 'stone')).toBe(9);
    // A player with no drop at all.
    expect(dispatch(newGame(), { type: 'take_back', drop: 1 })).toMatchObject({ ok: false, reason: 'nothing_to_take_back' });
  });

  it('is too late once its seconds are over, and the stack stays gone', () => {
    const state = ashore((made) => give(made, 'stone', 9));
    drop(state, 'stone', 9);
    run(state, {}, TAKE_BACK.seconds - 0.5);
    expect(standingDrop(state, 0, 1)).not.toBeNull();
    run(state, {}, 1);
    expect(standingDrop(state, 0, 1)).toBeNull();
    expect(dispatch(state, { type: 'take_back', drop: 1 })).toMatchObject({ ok: false, reason: 'take_back_too_late' });
    expect(countIn(state.players[0].backpack, 'stone')).toBe(0);
    // And it is cleared away: asked again, there is nothing to take back.
    expect(dispatch(state, { type: 'take_back', drop: 1 })).toMatchObject({ ok: false, reason: 'nothing_to_take_back' });
  });

  it('is all or nothing: with no room for the whole stack nothing moves, and the offer stands while room is made', () => {
    const state = ashore((made) => {
      for (let stack = 0; stack < 7; stack += 1) give(made, 'clay', 20);
      give(made, 'stone', 9);
    });
    drop(state, 'stone', 9);
    // The freed slot is taken by something else.
    give(state, 'berries', 1);
    expect(dispatch(state, { type: 'take_back', drop: 1 })).toMatchObject({ ok: false, reason: 'inventory_full' });
    expect(countIn(state.players[0].backpack, 'stone')).toBe(0);
    expect(standingDrop(state, 0, 1)).not.toBeNull();
    // Room made in time: it comes back whole.
    expect(dispatch(state, { type: 'eat', itemId: 'berries' }).ok).toBe(true);
    expect(dispatch(state, { type: 'take_back', drop: 1 }).ok).toBe(true);
    expect(countIn(state.players[0].backpack, 'stone')).toBe(9);
    expect(state.players[0].backpack).toHaveLength(8);
  });

  it('needs the canoe in reach for a stack dropped from the cargo', () => {
    const state = ashore((made) => give(made, 'stone', 9, 'cargo'));
    drop(state, 'stone', 9, 'cargo');
    teleport(state, 'home_knoll', 0, 1150);
    state.canoe.beached = false;
    expect(dispatch(state, { type: 'take_back', drop: 1 })).toMatchObject({ ok: false, reason: 'not_at_canoe' });
    expect(countIn(state.canoe.cargo, 'stone')).toBe(0);
    expect(standingDrop(state, 0, 1)).not.toBeNull();
  });

  it('leaves the refusals as they were: a tool, a key item and what a quest needs are not dropped, so there is nothing to take back', () => {
    const state = ashore((made) => {
      made.quests.bail_out.status = 'completed';
      made.quests.first_haul.status = 'active';
      give(made, 'lens');
      give(made, 'driftwood', 3);
    });
    expect(dispatch(state, { type: 'discard', from: 'backpack', itemId: 'bailing_can', count: 1 })).toMatchObject({ ok: false, reason: 'tool_kept' });
    expect(dispatch(state, { type: 'discard', from: 'backpack', itemId: 'lens', count: 1 })).toMatchObject({ ok: false, reason: 'key_item_kept' });
    expect(drop(state, 'driftwood', 3)).toMatchObject({ ok: false, reason: 'quest_needs_item' });
    expect(state.players[0].drops).toBeUndefined();
    expect(dispatch(state, { type: 'take_back', drop: 1 })).toMatchObject({ ok: false, reason: 'nothing_to_take_back' });
    expect(state.tools).toContain('bailing_can');
    expect(state.keyItems.lens).toBe(1);
  });

  it('is each player\'s own: a crewmate cannot take back what another dropped', () => {
    const state = ashore((made) => give(made, 'stone', 9));
    addPlayer(state);
    const sam = state.players[1];
    Object.assign(sam, { mode: 'foot', seat: null, islandId: state.players[0].islandId, position: { ...state.players[0].position } });
    sam.backpack.push({ itemId: 'clay', count: 5 });
    drop(state, 'stone', 9);
    expect(dispatch(state, { type: 'take_back', drop: 1 }, 1)).toMatchObject({ ok: false, reason: 'nothing_to_take_back' });
    expect(countIn(sam.backpack, 'stone')).toBe(0);
    // Each counts their own drops from 1.
    expect(drop(state, 'clay', 5, 'backpack', 1).ok).toBe(true);
    expect(dispatch(state, { type: 'take_back', drop: 1 }, 1)).toMatchObject({ ok: true, gained: [{ itemId: 'clay', count: 5 }] });
    expect(countIn(sam.backpack, 'clay')).toBe(5);
    expect(dispatch(state, { type: 'take_back', drop: 1 }, 0)).toMatchObject({ ok: true, gained: [{ itemId: 'stone', count: 9 }] });
  });

  it('remembers several drops, each with its own number, and no more than a few', () => {
    const state = ashore((made) => {
      give(made, 'stone', 9);
      give(made, 'clay', 4);
    });
    drop(state, 'stone', 9);
    drop(state, 'clay', 4);
    expect(dispatch(state, { type: 'take_back', drop: 1 }).ok).toBe(true);
    expect(dispatch(state, { type: 'take_back', drop: 2 }).ok).toBe(true);
    expect(countIn(state.players[0].backpack, 'stone')).toBe(9);
    expect(countIn(state.players[0].backpack, 'clay')).toBe(4);
    // Eight single stones dropped one by one: the oldest two are forgotten.
    for (let made = 0; made < TAKE_BACK.kept + 2; made += 1) drop(state, 'stone', 1);
    expect(state.players[0].drops!.open.map((record) => record.id)).toEqual([5, 6, 7, 8, 9, 10]);
    expect(dispatch(state, { type: 'take_back', drop: 3 })).toMatchObject({ ok: false, reason: 'nothing_to_take_back' });
  });

  it('counts for a quest again once it is back', () => {
    const state = ashore((made) => {
      made.quests.bail_out.status = 'completed';
      made.quests.first_haul.status = 'active';
      give(made, 'driftwood', 6);
    });
    // Three are spare: they go, and come back.
    expect(drop(state, 'driftwood', 3).ok).toBe(true);
    expect(dispatch(state, { type: 'take_back', drop: 1 }).ok).toBe(true);
    expect(countIn(state.players[0].backpack, 'driftwood')).toBe(6);
  });
});

describe('take_back on the wire and in a save', () => {
  it('is read from a guest with its number and nothing else', () => {
    expect(readCommand({ type: 'take_back', drop: 3 })).toEqual({ type: 'take_back', drop: 3 });
    for (const bad of [
      { type: 'take_back' }, { type: 'take_back', drop: 0 }, { type: 'take_back', drop: -1 }, { type: 'take_back', drop: 1.5 },
      { type: 'take_back', drop: '1' }, { type: 'take_back', drop: 1, count: 99 }, { type: 'take_back', drop: 1, itemId: 'plank' },
      { type: 'take_back', drop: 1, playerId: 0 },
    ]) expect(readCommand(bad), JSON.stringify(bad)).toBeNull();
  });

  it('adds no field to a game until a player drops something, and every saved game loads without it', () => {
    expect('drops' in newGame().players[0]).toBe(false);
    expect(Object.keys(fixtures).length).toBeGreaterThanOrEqual(7);
    for (const [path, text] of Object.entries(fixtures)) {
      const loaded = deserialize(text);
      expect(loaded.ok, path).toBe(true);
      if (!loaded.ok) continue;
      expect(loaded.state.players.every((player) => player.drops === undefined), path).toBe(true);
      expect(dispatch(loaded.state, { type: 'take_back', drop: 1 }), path).toMatchObject({ ok: false, reason: 'nothing_to_take_back' });
    }
  });

  it('a save made right after a drop loads, and the drop may still be taken back', () => {
    const state = ashore((made) => give(made, 'stone', 9));
    drop(state, 'stone', 9);
    const loaded = deserialize(serialize(state, 1));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(dispatch(loaded.state, { type: 'take_back', drop: 1 }).ok).toBe(true);
    expect(countIn(loaded.state.players[0].backpack, 'stone')).toBe(9);
  });
});

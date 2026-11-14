/**
 * Give, in the rules (Luc, round 4): a stack goes from one backpack to a crewmate's who stands close. Nothing is
 * made or lost, and everything else is refused with its own reason.
 */
import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/data/index.ts';
import type { ItemId } from '../src/data/index.ts';
import { readCommand } from '../src/net/messages.ts';
import { serialize } from '../src/save/index.ts';
import { crewInGiveReach, dispatch, drainEvents, setConnected, withinGiveReach } from '../src/sim/index.ts';
import type { GameState, PlayerId } from '../src/sim/index.ts';
import { countIn, newGame, standOn } from './support.ts';

const SLOTS = TUNING.inventory.backpackSlots;
const STACK = TUNING.inventory.stackSize;

/** A crew ashore on Home Knoll by the landed canoe, a step and a half apart, nobody holding anything. */
function crew(count = 2): GameState {
  const state = newGame(7, { crew: count });
  standOn(state, 'home_knoll');
  // The first quest is behind: its reward does not land in a backpack mid-test.
  state.quests.bail_out.status = 'completed';
  const spot = { ...state.players[0].position };
  state.players.forEach((player, index) => {
    Object.assign(player, { mode: 'foot', seat: null, islandId: 'home_knoll', position: { ...spot, x: spot.x + index * 1.5 }, backpack: [] });
  });
  state.canoe.cargo = [];
  drainEvents(state);
  return state;
}

const give = (state: GameState, to: PlayerId, itemId: ItemId, count: number, from: PlayerId = 0) =>
  dispatch(state, { type: 'give', to, itemId, count }, from);

/** Every piece of an item in every backpack and the cargo: what a give must leave unchanged. */
const inTheWorld = (state: GameState, itemId: ItemId): number =>
  state.players.reduce((sum, player) => sum + countIn(player.backpack, itemId), 0) + countIn(state.canoe.cargo, itemId);

const refused = (reason: string) => ({ ok: false, reason, missing: null });

describe('give: a stack goes to a crewmate standing close', () => {
  it('moves the whole stack, and nothing is made or lost: both backpacks add up to what they did', () => {
    const state = crew();
    state.players[0].backpack = [{ itemId: 'clay', count: 3 }, { itemId: 'plank', count: 5 }];
    state.players[1].backpack = [{ itemId: 'plank', count: 2 }, { itemId: 'stone', count: 9 }];
    const before = { plank: inTheWorld(state, 'plank'), clay: inTheWorld(state, 'clay'), stone: inTheWorld(state, 'stone') };

    expect(give(state, 1, 'plank', 5)).toEqual({ ok: true, gained: [], spent: [{ itemId: 'plank', count: 5 }] });
    expect(state.players[0].backpack).toEqual([{ itemId: 'clay', count: 3 }]);
    // Their own stack is topped up first.
    expect(state.players[1].backpack).toEqual([{ itemId: 'plank', count: 7 }, { itemId: 'stone', count: 9 }]);
    expect({ plank: inTheWorld(state, 'plank'), clay: inTheWorld(state, 'clay'), stone: inTheWorld(state, 'stone') }).toEqual(before);
  });

  it('tells both: the giver\'s event names who it went to, the other\'s who it came from', () => {
    const state = crew();
    state.players[0].backpack = [{ itemId: 'plank', count: 5 }];
    give(state, 1, 'plank', 5);
    expect(drainEvents(state)).toEqual([
      { type: 'item_lost', itemId: 'plank', count: 5, givenTo: 1, playerId: 0 },
      { type: 'item_gained', itemId: 'plank', count: 5, container: 'backpack', givenBy: 0, playerId: 1 },
    ]);
  });

  it('gives a part of a stack when that is what was asked', () => {
    const state = crew();
    state.players[0].backpack = [{ itemId: 'plank', count: 5 }];
    expect(give(state, 1, 'plank', 2).ok).toBe(true);
    expect(state.players[0].backpack).toEqual([{ itemId: 'plank', count: 3 }]);
    expect(state.players[1].backpack).toEqual([{ itemId: 'plank', count: 2 }]);
  });

  it('gives the part that fits when the other backpack is nearly full, and the rest stays with the giver', () => {
    const state = crew();
    state.players[0].backpack = [{ itemId: 'clay', count: 12 }];
    // Every slot taken, and five short of a full stack of clay: room for five.
    state.players[1].backpack = [{ itemId: 'clay', count: STACK - 5 }, ...Array.from({ length: SLOTS - 1 }, () => ({ itemId: 'stone' as ItemId, count: STACK }))];
    const before = inTheWorld(state, 'clay');
    expect(give(state, 1, 'clay', 12)).toEqual({ ok: true, gained: [], spent: [{ itemId: 'clay', count: 5 }] });
    expect(state.players[0].backpack).toEqual([{ itemId: 'clay', count: 7 }]);
    expect(countIn(state.players[1].backpack, 'clay')).toBe(STACK);
    expect(state.players[1].backpack).toHaveLength(SLOTS);
    expect(inTheWorld(state, 'clay')).toBe(before);
    expect(drainEvents(state).map((event) => 'count' in event && event.count)).toEqual([5, 5]);
  });

  it('works both ways: a guest gives and receives as the host does', () => {
    const state = crew();
    state.players[1].backpack = [{ itemId: 'berries', count: 4 }];
    expect(give(state, 0, 'berries', 4, 1).ok).toBe(true);
    expect(state.players[0].backpack).toEqual([{ itemId: 'berries', count: 4 }]);
    expect(give(state, 1, 'berries', 1, 0).ok).toBe(true);
    expect(state.players[1].backpack).toEqual([{ itemId: 'berries', count: 1 }]);
    expect(inTheWorld(state, 'berries')).toBe(4);
  });

  it('adds no field to the save', () => {
    const state = crew();
    state.players[0].backpack = [{ itemId: 'plank', count: 5 }];
    const keys = (): string[][] => (JSON.parse(serialize(state, 1)) as { state: GameState }).state.players.map((player) => Object.keys(player).sort());
    const before = keys();
    give(state, 1, 'plank', 5);
    drainEvents(state);
    expect(keys()).toEqual(before);
  });
});

describe('give: who is close', () => {
  it('is a few steps on the same island: 4 metres, named in the tuning table', () => {
    expect(TUNING.foot.giveRange).toBe(4);
    const state = crew();
    const [luc, sam] = state.players;
    state.players[0].backpack = [{ itemId: 'plank', count: 5 }];
    sam.position = { ...luc.position, x: luc.position.x + 4.2 };
    expect(withinGiveReach(luc, sam)).toBe(false);
    expect(crewInGiveReach(state, luc)).toEqual([]);
    expect(give(state, 1, 'plank', 5)).toEqual(refused('crewmate_too_far'));
    expect(state.players[0].backpack).toEqual([{ itemId: 'plank', count: 5 }]);
    expect(sam.backpack).toEqual([]);

    sam.position = { ...luc.position, x: luc.position.x + 3.9 };
    expect(crewInGiveReach(state, luc).map((player) => player.id)).toEqual([1]);
    expect(give(state, 1, 'plank', 5).ok).toBe(true);
  });

  it('is both aboard the canoe, wherever it is', () => {
    const state = crew();
    const [luc, sam] = state.players;
    luc.backpack = [{ itemId: 'plank', count: 5 }];
    for (const player of state.players) Object.assign(player, { mode: 'canoe', islandId: null, position: { ...state.canoe.position } });
    luc.seat = 0;
    sam.seat = 1;
    expect(give(state, 1, 'plank', 5).ok).toBe(true);
    expect(sam.backpack).toEqual([{ itemId: 'plank', count: 5 }]);
  });

  it('is not one aboard and one ashore, and not two islands', () => {
    const state = crew();
    const [luc, sam] = state.players;
    luc.backpack = [{ itemId: 'plank', count: 5 }];
    Object.assign(sam, { mode: 'canoe', seat: 0, islandId: null, position: { ...luc.position } });
    expect(give(state, 1, 'plank', 5)).toEqual(refused('crewmate_too_far'));
    // Being aboard is what counts, whatever the island field still says.
    sam.islandId = luc.islandId;
    expect(give(state, 1, 'plank', 5)).toEqual(refused('crewmate_too_far'));
    Object.assign(sam, { mode: 'foot', seat: null, islandId: 'birch_islet' });
    expect(give(state, 1, 'plank', 5)).toEqual(refused('crewmate_too_far'));
    expect(luc.backpack).toEqual([{ itemId: 'plank', count: 5 }]);
  });
});

describe('give: what is refused, each with its own reason, and nothing moves', () => {
  const staged = (): GameState => {
    const state = crew(3);
    state.players[0].backpack = [{ itemId: 'plank', count: 5 }];
    state.players[1].backpack = [{ itemId: 'stone', count: 2 }];
    return state;
  };
  const untouched = (state: GameState): void => {
    expect(state.players[0].backpack).toEqual([{ itemId: 'plank', count: 5 }]);
    expect(state.players[1].backpack).toEqual([{ itemId: 'stone', count: 2 }]);
    expect(state.players[2].backpack).toEqual([]);
    expect(drainEvents(state)).toEqual([]);
  };

  it('a full backpack', () => {
    const state = staged();
    state.players[2].backpack = Array.from({ length: SLOTS }, () => ({ itemId: 'stone' as ItemId, count: STACK }));
    expect(give(state, 2, 'plank', 5)).toEqual(refused('crewmate_bag_full'));
    expect(state.players[0].backpack).toEqual([{ itemId: 'plank', count: 5 }]);
    expect(countIn(state.players[2].backpack, 'plank')).toBe(0);
  });

  it('a tool: the crew has it already', () => {
    const state = staged();
    state.tools.push('hatchet');
    expect(give(state, 1, 'hatchet', 1)).toEqual(refused('tool_is_shared'));
    expect(state.tools).toContain('hatchet');
    untouched(state);
  });

  it('a key item, a quest\'s or a find: the crew has it already', () => {
    const state = staged();
    state.keyItems.saw_blade = 1;
    expect(give(state, 1, 'saw_blade', 1)).toEqual(refused('key_item_is_shared'));
    expect(state.keyItems.saw_blade).toBe(1);
    untouched(state);
  });

  it('a crewmate who has left', () => {
    const state = staged();
    setConnected(state, 1, false);
    drainEvents(state);
    expect(give(state, 1, 'plank', 5)).toEqual(refused('crewmate_away'));
    expect(crewInGiveReach(state, state.players[0]).map((player) => player.id)).toEqual([2]);
    untouched(state);
  });

  it('yourself', () => {
    const state = staged();
    expect(give(state, 0, 'plank', 5)).toEqual(refused('give_to_self'));
    untouched(state);
  });

  it('a made-up player: a number nobody in the crew has', () => {
    const state = crew(2);
    state.players[0].backpack = [{ itemId: 'plank', count: 5 }];
    // Player 3 does not exist in a crew of two. The rules do not fall back to the first player.
    expect(give(state, 3, 'plank', 5)).toEqual(refused('no_such_crewmate'));
    expect(state.players[0].backpack).toEqual([{ itemId: 'plank', count: 5 }]);
    expect(state.players[1].backpack).toEqual([]);
    // And the wire lets through nothing that is not a seat number.
    for (const to of [4, 7, -1, 1.5, '1', null]) expect(readCommand({ type: 'give', to, itemId: 'plank', count: 5 }), String(to)).toBeNull();
  });

  it('a stack that changed between the click and the answer: never more than the giver has now', () => {
    const state = staged();
    // The click said five. Two were used since.
    state.players[0].backpack = [{ itemId: 'plank', count: 3 }];
    expect(give(state, 1, 'plank', 5)).toEqual(refused('stack_changed'));
    expect(state.players[0].backpack).toEqual([{ itemId: 'plank', count: 3 }]);
    expect(countIn(state.players[1].backpack, 'plank')).toBe(0);
    // All of it gone since: there is nothing to give.
    state.players[0].backpack = [];
    expect(give(state, 1, 'plank', 5)).toEqual(refused('item_not_held'));
  });

  it('what is in the canoe and not in the backpack: a give is from a backpack only', () => {
    const state = staged();
    state.canoe.cargo = [{ itemId: 'rope', count: 6 }];
    expect(give(state, 1, 'rope', 6)).toEqual(refused('item_not_held'));
    expect(state.canoe.cargo).toEqual([{ itemId: 'rope', count: 6 }]);
    untouched(state);
  });

  it('an amount that is not one, and a thing that is not one', () => {
    const state = staged();
    for (const count of [0, -2, 1.5, Number.NaN]) expect(give(state, 1, 'plank', count), String(count)).toEqual(refused('invalid_amount'));
    expect(give(state, 1, 'gold_bar' as ItemId, 1)).toEqual(refused('unknown_id'));
    expect(give(state, 1, 'constructor' as ItemId, 1)).toEqual(refused('unknown_id'));
    untouched(state);
  });

  it('a giver who is away, and a giver in a talk', () => {
    const state = staged();
    state.players[0].dialogue = { npcId: 'odile', nodeId: 'start' };
    expect(give(state, 1, 'plank', 5)).toEqual(refused('in_dialogue'));
    state.players[0].dialogue = null;
    setConnected(state, 0, false);
    drainEvents(state);
    expect(give(state, 1, 'plank', 5)).toEqual(refused('player_away'));
    untouched(state);
  });
});

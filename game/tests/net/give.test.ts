/**
 * Give between a host and a guest, over the wire (Luc, round 4): the host runs it, both backpacks change on both
 * screens, and each player reads their own note.
 */
import { describe, expect, it } from 'vitest';
import { toastsForPlayer } from '../../src/client/viewmodels/toasts.ts';
import { partMovedText } from '../../src/client/viewmodels/inventory.ts';
import { failureText } from '../../src/client/viewmodels/format.ts';
import { TUNING } from '../../src/data/index.ts';
import type { ItemId } from '../../src/data/index.ts';
import { dispatch, drainEvents, setPlayerName } from '../../src/sim/index.ts';
import type { GameState } from '../../src/sim/index.ts';
import { countIn, newGame, standOn } from '../support.ts';
import { createRig } from './rig.ts';
import type { Rig, Seat } from './rig.ts';

/** Luc hosts, ashore on Home Knoll by the landed canoe, under a sky that holds. */
function shoreGame(): GameState {
  const game = newGame(7);
  standOn(game, 'home_knoll');
  game.quests.bail_out.status = 'completed';
  game.weather.secondsRemaining = 99999;
  setPlayerName(game, 0, 'Luc');
  game.players[0].backpack = [];
  drainEvents(game);
  return game;
}

/** Sam joins and stands a step from Luc. */
function together(): { rig: Rig; sam: Seat } {
  const rig = createRig({ game: shoreGame() });
  const sam = rig.join('Sam');
  rig.run(0.5);
  const [luc, guest] = rig.game.players;
  Object.assign(guest, { mode: 'foot', seat: null, islandId: luc.islandId, position: { ...luc.position, x: luc.position.x + 1 }, backpack: [] });
  rig.run(0.2);
  rig.hostEvents.length = 0;
  sam.events.length = 0;
  return { rig, sam };
}

const planks = (state: GameState): number[] => state.players.map((player) => countIn(player.backpack, 'plank'));

describe('give, host and guest', () => {
  it('the host gives to a guest: it lands in the guest\'s backpack on both screens, and each reads their own note', () => {
    const { rig, sam } = together();
    rig.game.players[0].backpack = [{ itemId: 'plank', count: 5 }];
    expect(dispatch(rig.game, { type: 'give', to: 1, itemId: 'plank', count: 5 }, 0).ok).toBe(true);
    rig.run(0.5);
    expect(rig.settle()).toBe(true);
    expect(planks(rig.game)).toEqual([0, 5]);
    expect(planks(sam.link.truth!)).toEqual([0, 5]);
    // The host's screen and the guest's, each from the events it was handed.
    expect(toastsForPlayer(rig.hostEvents, rig.game, 0).map((note) => note.text)).toEqual(['You gave Sam 5 x Plank']);
    expect(toastsForPlayer(sam.events, sam.link.truth!, 1).map((note) => note.text)).toEqual(['Luc gave you 5 x Plank']);
    // Neither note offers to take anything back: nothing was dropped.
    expect(toastsForPlayer(rig.hostEvents, rig.game, 0)[0]).not.toHaveProperty('takeBack');
  });

  it('a guest gives to the host: the host checks it and answers, and nothing is made or lost on the way', () => {
    const { rig, sam } = together();
    rig.game.players[1].backpack = [{ itemId: 'plank', count: 8 }];
    rig.run(0.2);
    sam.link.sendCommand({ type: 'give', to: 0, itemId: 'plank', count: 8 });
    rig.run(0.5);
    expect(rig.settle()).toBe(true);
    expect(sam.results.map((outcome) => outcome.result)).toEqual([{ ok: true, gained: [], spent: [{ itemId: 'plank', count: 8 }] }]);
    expect(planks(rig.game)).toEqual([8, 0]);
    expect(planks(sam.link.truth!)).toEqual([8, 0]);
    expect(toastsForPlayer(sam.events, sam.link.truth!, 1).map((note) => note.text)).toEqual(['You gave Luc 8 x Plank']);
    expect(toastsForPlayer(rig.hostEvents, rig.game, 0).map((note) => note.text)).toEqual(['Sam gave you 8 x Plank']);
  });

  it('a guest cannot give out of the host\'s backpack: the command is the sender\'s own, whatever it says', () => {
    const { rig, sam } = together();
    rig.game.players[0].backpack = [{ itemId: 'plank', count: 5 }];
    rig.run(0.2);
    // Sam holds no planks and asks for Luc's to come over.
    sam.link.sendCommand({ type: 'give', to: 1, itemId: 'plank', count: 5 });
    sam.link.sendCommand({ type: 'give', to: 0, itemId: 'plank', count: 5 });
    rig.run(0.5);
    expect(sam.results.map((outcome) => !outcome.result.ok && outcome.result.reason)).toEqual(['give_to_self', 'item_not_held']);
    expect(planks(rig.game)).toEqual([5, 0]);
  });

  it('a guest who has left is given nothing, and the giver is told why', () => {
    const { rig, sam } = together();
    rig.game.players[0].backpack = [{ itemId: 'plank', count: 5 }];
    sam.link.close();
    rig.run(0.5);
    expect(rig.game.players[1].connected).toBe(false);
    const result = dispatch(rig.game, { type: 'give', to: 1, itemId: 'plank', count: 5 }, 0);
    expect(result).toEqual({ ok: false, reason: 'crewmate_away', missing: null });
    expect(failureText('crewmate_away', null)).toBe('They have left. Nothing was given.');
    expect(planks(rig.game)).toEqual([5, 0]);
  });

  it('a stack that changed while the guest\'s give was on the wire is refused whole', () => {
    const { rig, sam } = together();
    rig.game.players[1].backpack = [{ itemId: 'berries', count: 6 }];
    rig.run(0.2);
    // The click says six. An eat sent just before it gets there first.
    sam.link.sendCommand({ type: 'eat', itemId: 'berries' });
    sam.link.sendCommand({ type: 'give', to: 0, itemId: 'berries', count: 6 });
    rig.run(0.5);
    expect(sam.results.map((outcome) => (outcome.result.ok ? 'ok' : outcome.result.reason))).toEqual(['ok', 'stack_changed']);
    expect(rig.game.players.map((player) => countIn(player.backpack, 'berries'))).toEqual([0, 5]);
    expect(failureText('stack_changed', null)).toBe('That stack changed. Nothing was given. Try again.');
  });

  it('when only a part fits, the giver is told how many went and how many stayed', () => {
    const { rig, sam } = together();
    const slots = TUNING.inventory.backpackSlots;
    const full = TUNING.inventory.stackSize;
    rig.game.players[0].backpack = [{ itemId: 'clay', count: full - 5 }, ...Array.from({ length: slots - 1 }, () => ({ itemId: 'stone' as ItemId, count: full }))];
    rig.game.players[1].backpack = [{ itemId: 'clay', count: 12 }];
    rig.run(0.2);
    const sent = { type: 'give', to: 0, itemId: 'clay', count: 12 } as const;
    sam.link.sendCommand(sent);
    rig.run(0.5);
    expect(sam.results).toHaveLength(1);
    expect(partMovedText(sent, sam.results[0].result)).toBe('Their backpack is full: 5 of 12 Clay given, 7 stayed.');
    expect(toastsForPlayer(sam.events, sam.link.truth!, 1).map((note) => note.text)).toEqual(['You gave Luc 5 x Clay']);
    // A give that went whole says nothing more.
    expect(partMovedText({ type: 'give', to: 0, itemId: 'clay', count: 5 }, { ok: true, gained: [], spent: [{ itemId: 'clay', count: 5 }] })).toBeNull();
  });

  it('a given stack and a found one in the same frame are two notes: the gift is not folded into "+N"', () => {
    const game = shoreGame();
    const notes = toastsForPlayer([
      { type: 'item_gained', itemId: 'plank', count: 2, container: 'backpack', playerId: 0 },
      { type: 'item_gained', itemId: 'plank', count: 5, container: 'backpack', givenBy: 1, playerId: 0 },
    ], { ...game, players: [game.players[0], { ...game.players[0], id: 1, name: 'Sam' }] }, 0);
    expect(notes.map((note) => note.text)).toEqual(['+2 Plank', 'Sam gave you 5 x Plank']);
  });
});

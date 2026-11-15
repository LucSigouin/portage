/**
 * A drop, then the one who dropped it leaves (the second review of round 3, new finding 2: the neighbours).
 *
 * - A guest who leaves rides along in their seat. A capsize while they are away still ends their drop from the
 *   cargo: back in their seat they get nothing.
 * - A seat that goes to someone new comes with nothing to take back. A drop is its dropper's own.
 * - The same guest, back under their own key, still has their own drop for the seconds it stands.
 */
import { describe, expect, it } from 'vitest';
import { TUNING } from '../../src/data/index.ts';
import { FIXED_STEP, standingDrop } from '../../src/sim/index.ts';
import { countIn } from '../support.ts';
import { calmGame, createRig } from './rig.ts';
import type { Rig, Seat } from './rig.ts';

const NOTHING = { ok: false, reason: 'nothing_to_take_back' };

/** The host and three guests, all here: Ann is player 1, Bo 2, Cy 3. The first quest is behind. */
function fullRig(): { rig: Rig; ann: Seat; bo: Seat; cy: Seat } {
  const game = calmGame();
  game.quests.bail_out.status = 'completed';
  const rig = createRig({ game });
  const [ann, bo, cy] = ['Ann', 'Bo', 'Cy'].map((name) => rig.join(name)) as [Seat, Seat, Seat];
  rig.run(0.5);
  expect(rig.game.players.map((player) => [player.id, player.name])).toEqual([[0, ''], [1, 'Ann'], [2, 'Bo'], [3, 'Cy']]);
  return { rig, ann, bo, cy };
}

/** A guest hangs up, and the host hears of it. */
function leave(rig: Rig, seat: Seat): void {
  seat.link.close();
  rig.run(0.5);
}

/** A guest's command, answered by the host. */
function ask(rig: Rig, seat: Seat, command: Parameters<Seat['link']['sendCommand']>[0]): unknown {
  const id = seat.link.sendCommand(command);
  rig.run(0.3);
  const outcome = seat.results.find((result) => result.id === id);
  expect(outcome, `no answer to ${command.type}`).toBeDefined();
  return outcome!.result;
}

describe('a guest drops a stack and leaves', () => {
  it('a capsize while they are away ends their drop from the cargo: back in their seat, nothing comes back', () => {
    const { rig, ann } = fullRig();
    rig.game.canoe.cargo.push({ itemId: 'stone', count: 20 });
    const played = rig.game.playedSeconds;
    expect(ask(rig, ann, { type: 'discard', from: 'cargo', itemId: 'stone', count: 20 })).toMatchObject({ ok: true });
    leave(rig, ann);
    expect(rig.game.players[1]).toMatchObject({ connected: false, mode: 'canoe' });

    rig.game.canoe.waterLevel = TUNING.canoe.capsizeLevel;
    rig.run(FIXED_STEP);
    expect(rig.hostEvents.some((event) => event.type === 'capsized')).toBe(true);
    // Ann was away: not washed ashore, still in her seat, in reach of the cargo.
    expect(rig.game.players[1]).toMatchObject({ connected: false, mode: 'canoe' });

    const back = rig.join('Ann');
    rig.run(0.5);
    expect(back.link.playerId).toBe(1);
    expect(ask(rig, back, { type: 'take_back', drop: 1 })).toMatchObject(NOTHING);
    expect(countIn(rig.game.canoe.cargo, 'stone')).toBe(0);
    // All of it inside the seconds a drop stands: it is the capsize that said no, not the clock.
    expect(rig.game.playedSeconds - played).toBeLessThan(5);
  });

  it('back under their own key, with no loss in between, their own drop still comes back', () => {
    const { rig, ann } = fullRig();
    rig.game.players[1]!.backpack.push({ itemId: 'stone', count: 9 });
    expect(ask(rig, ann, { type: 'discard', from: 'backpack', itemId: 'stone', count: 9 })).toMatchObject({ ok: true });
    leave(rig, ann);
    const back = rig.join('Ann');
    rig.run(0.5);
    expect(back.link.playerId).toBe(1);
    expect(ask(rig, back, { type: 'take_back', drop: 1 })).toMatchObject({ ok: true, gained: [{ itemId: 'stone', count: 9 }] });
    expect(ask(rig, back, { type: 'take_back', drop: 1 })).toMatchObject(NOTHING);
    expect(countIn(rig.game.players[1]!.backpack, 'stone')).toBe(9);
  });
});

describe('a seat that changes hands', () => {
  it('comes with nothing to take back: the newcomer cannot undo what the one before them dropped', () => {
    const { rig, ann } = fullRig();
    const player = rig.game.players[1]!;
    player.backpack.push({ itemId: 'stone', count: 9 }, { itemId: 'clay', count: 4 });
    rig.game.canoe.cargo.push({ itemId: 'driftwood', count: 12 });
    const played = rig.game.playedSeconds;
    expect(ask(rig, ann, { type: 'discard', from: 'backpack', itemId: 'stone', count: 9 })).toMatchObject({ ok: true });
    expect(ask(rig, ann, { type: 'discard', from: 'cargo', itemId: 'driftwood', count: 12 })).toMatchObject({ ok: true });
    leave(rig, ann);
    // Away, Ann's drops still stand: they are hers to come back to.
    expect([1, 2].map((dropId) => standingDrop(rig.game, 1, dropId)?.count)).toEqual([9, 12]);

    // The canoe is full and Ann is the only one away: Dee is handed her seat, with the starting kit: Ann's pack is in Ann's browser.
    const dee = rig.join('Dee');
    rig.run(0.5);
    expect(dee.link.playerId).toBe(1);
    expect(player).toMatchObject({ name: 'Dee', connected: true, backpack: [] });
    for (const dropId of [1, 2]) {
      expect(standingDrop(rig.game, 1, dropId), String(dropId)).toBeNull();
      expect(ask(rig, dee, { type: 'take_back', drop: dropId }), String(dropId)).toMatchObject(NOTHING);
    }
    expect(player.backpack).toEqual([]);
    expect(countIn(rig.game.canoe.cargo, 'driftwood')).toBe(0);
    expect(rig.game.playedSeconds - played).toBeLessThan(5);
    // Dee finds some clay of her own.
    player.backpack.push({ itemId: 'clay', count: 4 });
    rig.run(0.2);

    // Dee's own drops count on from Ann's: a number never names two drops in one seat.
    expect(ask(rig, dee, { type: 'discard', from: 'backpack', itemId: 'clay', count: 4 })).toMatchObject({ ok: true });
    expect(standingDrop(rig.game, 1, 3)).toMatchObject({ id: 3, itemId: 'clay', count: 4 });
    expect(ask(rig, dee, { type: 'take_back', drop: 3 })).toMatchObject({ ok: true, gained: [{ itemId: 'clay', count: 4 }] });
    expect(rig.settle()).toBe(true);
  });
});

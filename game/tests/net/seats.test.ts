/**
 * A seat in the canoe is given back. The rule: when the canoe is full, a new
 * guest takes the seat of a player who is away, the one away the longest.
 * Nobody who is here loses a seat, and while there is room nothing changes.
 */
import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, createLoopbackPair } from '../../src/net/index.ts';
import { setConnected } from '../../src/sim/index.ts';
import type { GameState } from '../../src/sim/index.ts';
import { calmGame, createRig, key } from './rig.ts';
import type { Rig, Seat } from './rig.ts';

const v = PROTOCOL_VERSION;

/** Who is in the canoe: id, name, here or away. */
const crew = (game: GameState): [number, string, string][] =>
  game.players.map((player) => [player.id, player.name, player.connected ? 'here' : 'away']);

/** The host and three guests, all here: Ann is player 1, Bo 2, Cy 3. */
function fullRig(): { rig: Rig; ann: Seat; bo: Seat; cy: Seat } {
  const rig = createRig();
  const [ann, bo, cy] = ['Ann', 'Bo', 'Cy'].map((name) => rig.join(name)) as [Seat, Seat, Seat];
  rig.run(0.5);
  expect(crew(rig.game)).toEqual([[0, '', 'here'], [1, 'Ann', 'here'], [2, 'Bo', 'here'], [3, 'Cy', 'here']]);
  return { rig, ann, bo, cy };
}

/** A guest hangs up, and the host hears of it. */
function leave(rig: Rig, seat: Seat): void {
  seat.link.close();
  rig.run(0.5);
}

/** A saved game the host starts again: three named players, all away, and a host link that remembers nobody. */
function savedGame(): GameState {
  const game = calmGame(4);
  ['Ann', 'Bo', 'Cy'].forEach((name, index) => {
    game.players[index + 1]!.name = name;
    setConnected(game, index + 1, false, true);
  });
  return game;
}

describe('a full canoe gives a seat back', () => {
  it('seats a newcomer in the seat of a player who is away, once three guests have come and gone', () => {
    const { rig, ann, bo, cy } = fullRig();
    for (const seat of [ann, bo, cy]) leave(rig, seat);
    expect(rig.host.guests).toEqual([]);
    const dee = rig.join('Dee');
    rig.run(0.5);
    expect(dee.link.status).toBe('playing');
    expect(rig.game.players).toHaveLength(4);
    expect(rig.game.players[dee.link.playerId]).toMatchObject({ name: 'Dee', connected: true });
    expect(dee.link.playerId).not.toBe(0);
    expect(rig.settle()).toBe(true);
  });

  it('takes the one away the longest first, then the next', () => {
    const { rig, ann, bo, cy } = fullRig();
    // Bo leaves first, then Cy, then Ann.
    for (const seat of [bo, cy, ann]) leave(rig, seat);
    const taken = ['Dee', 'Eve', 'Fay'].map((name) => {
      const seat = rig.join(name);
      rig.run(0.5);
      return seat.link.playerId;
    });
    expect(taken).toEqual([2, 3, 1]);
    expect(crew(rig.game)).toEqual([[0, '', 'here'], [1, 'Fay', 'here'], [2, 'Dee', 'here'], [3, 'Eve', 'here']]);
  });

  it('after the host starts a saved game again it remembers nobody leaving: the highest seat goes first, and anyone who leaves after that goes last', () => {
    const game = savedGame();
    const rig = createRig({ game });
    // Cy comes back under the old name, plays, and leaves again: the one leaving this host has seen.
    const cy = rig.join('Cy');
    rig.run(0.5);
    expect(cy.link.playerId).toBe(3);
    leave(rig, cy);
    // Ann and Bo were away before the host started: away longer than Cy. Of those two, the higher seat first.
    const dee = rig.join('Dee');
    rig.run(0.5);
    expect(dee.link.playerId).toBe(2);
    const eve = rig.join('Eve');
    rig.run(0.5);
    expect(eve.link.playerId).toBe(1);
    const fay = rig.join('Fay');
    rig.run(0.5);
    expect(fay.link.playerId).toBe(3);
    expect(crew(game)).toEqual([[0, '', 'here'], [1, 'Eve', 'here'], [2, 'Dee', 'here'], [3, 'Fay', 'here']]);
  });

  it('hands the seat over as it stands: the pack, the meters and the place go to the newcomer, under the newcomer\'s name', () => {
    const { rig, ann } = fullRig();
    const player = rig.game.players[1]!;
    player.backpack.push({ itemId: 'driftwood', count: 7 });
    Object.assign(player, { hunger: 41, thirst: 52 });
    leave(rig, ann);
    const place = { mode: player.mode, seat: player.seat };
    expect(place).toEqual({ mode: 'canoe', seat: 1 });
    rig.hostEvents.length = 0;
    const dee = rig.join('Dee');
    rig.run(0.5);
    expect(dee.link.playerId).toBe(1);
    expect(rig.game.players).toHaveLength(4);
    expect(player).toMatchObject({ id: 1, name: 'Dee', connected: true, backpack: [{ itemId: 'driftwood', count: 7 }], ...place });
    expect(player.hunger).toBeGreaterThan(40.9);
    expect(player.hunger).toBeLessThanOrEqual(41);
    // The crew reads "Dee joined the crew", not "Dee is back".
    expect(rig.hostEvents.filter((event) => event.type === 'crew_changed')).toEqual([{ type: 'crew_changed', who: 1, change: 'joined' }]);
    expect(rig.settle()).toBe(true);
    expect(dee.link.truth!.players[1]).toMatchObject({ name: 'Dee', backpack: [{ itemId: 'driftwood', count: 7 }] });
  });

  it('leaves no old name on a seat that a guest with no name takes', () => {
    const { rig, ann } = fullRig();
    leave(rig, ann);
    const nameless = rig.join('', key('nameless'));
    rig.run(0.5);
    expect(nameless.link.playerId).toBe(1);
    expect(crew(rig.game)[1]).toEqual([1, '', 'here']);
  });
});

describe('nobody who is here loses a seat', () => {
  it('turns a newcomer away when all four are here, and takes only the away seat when one is', () => {
    const { rig, ann, bo, cy } = fullRig();
    const fifth = rig.join('Dee');
    rig.run(0.5);
    expect(fifth.link.status).toBe('refused');
    expect(fifth.link.leaveReason).toBe('full');
    expect(crew(rig.game)).toEqual([[0, '', 'here'], [1, 'Ann', 'here'], [2, 'Bo', 'here'], [3, 'Cy', 'here']]);

    leave(rig, bo);
    const eve = rig.join('Eve');
    rig.run(0.5);
    expect(eve.link.playerId).toBe(2);
    const sixth = rig.join('Fay');
    rig.run(0.5);
    expect(sixth.link.status).toBe('refused');
    expect(sixth.link.leaveReason).toBe('full');
    // Ann and Cy never moved, and still play their own players.
    expect([ann, cy, eve].map((seat) => [seat.link.status, seat.link.playerId])).toEqual([['playing', 1], ['playing', 3], ['playing', 2]]);
    expect(crew(rig.game)).toEqual([[0, '', 'here'], [1, 'Ann', 'here'], [2, 'Eve', 'here'], [3, 'Cy', 'here']]);
    expect(rig.host.guests.sort()).toEqual([1, 2, 3]);
  });

  it('never gives the host\'s seat away, even with the host\'s player marked away', () => {
    const { rig } = fullRig();
    rig.game.players[0]!.name = 'Luc';
    setConnected(rig.game, 0, false, true);
    const dee = rig.join('Dee');
    rig.run(0.5);
    expect(dee.link.status).toBe('refused');
    expect(dee.link.leaveReason).toBe('full');
    expect(rig.game.players[0]).toMatchObject({ id: 0, name: 'Luc', connected: false });
  });
});

describe('while the canoe has room nothing changes', () => {
  it('gives a newcomer a new seat, not the seat of someone away, and the key its own player back', () => {
    const rig = createRig();
    const ann = rig.join('Ann');
    rig.run(0.5);
    rig.game.players[1]!.backpack.push({ itemId: 'driftwood', count: 3 });
    leave(rig, ann);
    const seats = ['Dee', 'Eve'].map((name) => rig.join(name));
    rig.run(0.5);
    expect(seats.map((seat) => seat.link.playerId)).toEqual([2, 3]);
    expect(rig.game.players[1]).toMatchObject({ name: 'Ann', connected: false, backpack: [{ itemId: 'driftwood', count: 3 }] });
    const back = rig.join('Ann');
    rig.run(0.5);
    expect(back.link.playerId).toBe(1);
    expect(rig.game.players[1]).toMatchObject({ name: 'Ann', connected: true, backpack: [{ itemId: 'driftwood', count: 3 }] });
  });

  it('gives a key its own player back in a full canoe, whoever else has been away longer', () => {
    const { rig, ann, bo } = fullRig();
    leave(rig, ann);
    leave(rig, bo);
    const back = rig.join('Bo');
    rig.run(0.5);
    expect(back.link.playerId).toBe(2);
    expect(crew(rig.game)).toEqual([[0, '', 'here'], [1, 'Ann', 'away'], [2, 'Bo', 'here'], [3, 'Cy', 'here']]);
  });

  it('gives a name its old seat after the host starts again, before any seat changes hands', () => {
    const game = savedGame();
    game.players[1]!.backpack.push({ itemId: 'driftwood', count: 4 });
    const rig = createRig({ game });
    const ann = rig.join('Ann', key('ann-new-browser'));
    rig.run(0.5);
    expect(ann.link.playerId).toBe(1);
    expect(game.players[1]).toMatchObject({ name: 'Ann', connected: true, backpack: [{ itemId: 'driftwood', count: 4 }] });
    expect(crew(game)).toEqual([[0, '', 'here'], [1, 'Ann', 'here'], [2, 'Bo', 'away'], [3, 'Cy', 'away']]);
  });
});

describe('a friend whose seat was given away', () => {
  it('comes back as a new guest: the seat of someone away, or "full" when all four are here', () => {
    const { rig, ann, bo } = fullRig();
    leave(rig, ann);
    const dee = rig.join('Dee');
    rig.run(0.5);
    expect(dee.link.playerId).toBe(1);

    // Everyone is here: Ann's old key buys nothing, and Dee is not put out.
    const early = rig.join('Ann');
    rig.run(0.5);
    expect(early.link.status).toBe('refused');
    expect(early.link.leaveReason).toBe('full');
    expect(dee.link.status).toBe('playing');
    expect(rig.game.players[1]).toMatchObject({ name: 'Dee', connected: true });

    // Bo goes away: Ann gets Bo's seat, as any new guest would.
    leave(rig, bo);
    const later = rig.join('Ann');
    rig.run(0.5);
    expect(later.link.status).toBe('playing');
    expect(later.link.playerId).toBe(2);
    expect(dee.link.status).toBe('playing');
    expect(crew(rig.game)).toEqual([[0, '', 'here'], [1, 'Dee', 'here'], [2, 'Ann', 'here'], [3, 'Cy', 'here']]);

    // And Bo, whose seat that was, finds the canoe full.
    const boAgain = rig.join('Bo');
    rig.run(0.5);
    expect(boAgain.link.status).toBe('refused');
    expect(boAgain.link.leaveReason).toBe('full');
    expect(rig.settle()).toBe(true);
  });

  it('is told "full" on a wire that went quiet, came back and found the seat taken', () => {
    const rig = createRig({ host: { silenceSeconds: 4 } });
    const [, bo] = ['Ann', 'Bo', 'Cy'].map((name) => rig.join(name)) as [Seat, Seat, Seat];
    rig.run(1);
    bo.pair.conditions.loss = 1;
    rig.run(5);
    expect(rig.game.players[2]!.connected).toBe(false);
    const dee = rig.join('Dee');
    rig.run(0.5);
    expect(dee.link.playerId).toBe(2);
    // Bo's line clears. Bo has been asking to join again all along, on the same wire and under the same key.
    bo.pair.conditions.loss = 0;
    rig.run(4);
    expect(bo.link.leaveReason).toBe('full');
    expect(['refused', 'closed']).toContain(bo.link.status);
    expect(dee.link.status).toBe('playing');
    expect(crew(rig.game)).toEqual([[0, '', 'here'], [1, 'Ann', 'here'], [2, 'Dee', 'here'], [3, 'Cy', 'here']]);
  });
});

describe('one wire, one seat, in a full canoe too', () => {
  it('a wire that asks again under other keys takes one away seat and no more', () => {
    const { rig, ann, bo, cy } = fullRig();
    for (const seat of [ann, bo, cy]) leave(rig, seat);
    const pair = createLoopbackPair();
    rig.host.accept(pair.host);
    const welcomed: number[] = [];
    pair.guest.receive((message) => {
      const heard = message as { type: string; playerId: number };
      if (heard.type === 'welcome') welcomed.push(heard.playerId);
    });
    const refused = rig.host.stats.refused;
    for (const name of ['first', 'second', 'third']) {
      pair.guest.send({ v, type: 'join', name: 'x', key: key(name), character: 'voyageur' });
      pair.advance(0);
      pair.advance(0);
    }
    expect(welcomed).toEqual([1]);
    expect(rig.host.stats.refused).toBe(refused + 2);
    expect(crew(rig.game)).toEqual([[0, '', 'here'], [1, 'x', 'here'], [2, 'Bo', 'away'], [3, 'Cy', 'away']]);
    expect(rig.host.guests).toEqual([1]);
  });
});

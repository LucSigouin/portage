/**
 * Pings over the wire: the host keeps them, every guest sees them, a late guest sees those standing,
 * and what a guest asks for is checked like any command.
 */
import { describe, expect, it } from 'vitest';
import { GuestLink, PROTOCOL_VERSION, createLoopbackPair, readClientMessage, readCommand } from '../../src/net/index.ts';
import { dispatch, hashState, standingPings } from '../../src/sim/index.ts';
import type { GameState } from '../../src/sim/index.ts';
import { createRig, key } from './rig.ts';

const spots = (game: GameState): [number, number, number][] => standingPings(game).map((ping) => [ping.playerId, ping.x, ping.z]);

describe('reading a ping from the wire', () => {
  it('reads the two commands, exactly', () => {
    expect(readCommand({ type: 'ping', x: 12.5, z: -300 })).toEqual({ type: 'ping', x: 12.5, z: -300 });
    expect(readCommand({ type: 'clear_ping', playerId: 2 })).toEqual({ type: 'clear_ping', playerId: 2 });
    expect(readClientMessage({ v: PROTOCOL_VERSION, type: 'command', id: 1, at: 0, command: { type: 'ping', x: 1, z: 2 } }))
      .toMatchObject({ command: { type: 'ping', x: 1, z: 2 } });
  });

  it('refuses a spot that is not a number, a field too many, a player the game cannot have', () => {
    const bad: unknown[] = [
      { type: 'ping' }, { type: 'ping', x: 1 }, { type: 'ping', x: '1', z: 2 }, { type: 'ping', x: 1, z: null },
      { type: 'ping', x: Number.NaN, z: 2 }, { type: 'ping', x: 1, z: Number.POSITIVE_INFINITY },
      { type: 'ping', x: 1, z: 2, playerId: 0 }, { type: 'ping', x: 1, z: 2, color: '#ff0000' }, { type: 'ping', x: 1, z: 2, tick: 0 },
      { type: 'clear_ping' }, { type: 'clear_ping', playerId: 4 }, { type: 'clear_ping', playerId: -1 }, { type: 'clear_ping', playerId: 1.5 },
      { type: 'clear_ping', playerId: '1' }, { type: 'clear_ping', playerId: 1, x: 0 },
    ];
    for (const command of bad) expect(readCommand(command), JSON.stringify(command)).toBeNull();
  });

  it('speaks a version an older host turns away, not one that drops the command unanswered', () => {
    expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(4);
  });
});

describe('a crew pinging', () => {
  it('shows the host\'s ping on every guest\'s screen', () => {
    const rig = createRig();
    const sam = rig.join('Sam');
    const bo = rig.join('Bo');
    rig.run(0.5);
    expect(dispatch(rig.game, { type: 'ping', x: -400, z: 250 }, 0).ok).toBe(true);
    rig.run(0.5);
    expect(rig.settle()).toBe(true);
    for (const seat of [sam, bo]) expect(spots(seat.link.truth!)).toEqual([[0, -400, 250]]);
  });

  it('runs a guest\'s ping on the host, as that guest and nobody else, and hands it to the rest', () => {
    const rig = createRig();
    const sam = rig.join('Sam');
    const bo = rig.join('Bo');
    rig.run(0.5);
    sam.link.sendCommand({ type: 'ping', x: 300.4, z: -700.2 });
    rig.run(0.5);
    expect(sam.results.map((outcome) => outcome.result.ok)).toEqual([true]);
    expect(spots(rig.game)).toEqual([[sam.link.playerId, 300, -700]]);
    expect(rig.settle()).toBe(true);
    expect(spots(bo.link.truth!)).toEqual([[sam.link.playerId, 300, -700]]);
    expect(hashState(bo.link.truth!)).toBe(rig.hostHash());
  });

  it('keeps one ping a player: each guest\'s next takes the place of their own', () => {
    const rig = createRig();
    const sam = rig.join('Sam');
    const bo = rig.join('Bo');
    rig.run(0.5);
    sam.link.sendCommand({ type: 'ping', x: 100, z: 100 });
    bo.link.sendCommand({ type: 'ping', x: 200, z: 200 });
    rig.run(1.5);
    sam.link.sendCommand({ type: 'ping', x: 300, z: 300 });
    rig.run(0.5);
    expect(spots(rig.game)).toEqual([[1, 300, 300], [2, 200, 200]]);
    expect(rig.game.pings).toHaveLength(2);
  });

  it('shows a guest who joins late the pings that stand, and not the ones that are gone', () => {
    const rig = createRig();
    const sam = rig.join('Sam');
    rig.run(0.5);
    dispatch(rig.game, { type: 'ping', x: -400, z: 250 }, 0);
    sam.link.sendCommand({ type: 'ping', x: 500, z: -100 });
    rig.run(2);
    dispatch(rig.game, { type: 'clear_ping', playerId: 0 }, 0);
    rig.run(30);
    const late = rig.join('Late');
    rig.run(0.5);
    expect(late.link.status).toBe('playing');
    expect(spots(late.link.truth!)).toEqual([[1, 500, -100]]);
  });

  it('lets a guest clear a crewmate\'s ping', () => {
    const rig = createRig();
    const sam = rig.join('Sam');
    rig.run(0.5);
    dispatch(rig.game, { type: 'ping', x: -400, z: 250 }, 0);
    rig.run(0.2);
    sam.link.sendCommand({ type: 'clear_ping', playerId: 0 });
    rig.run(0.5);
    expect(sam.results.map((outcome) => outcome.result.ok)).toEqual([true]);
    expect(spots(rig.game)).toEqual([]);
  });

  it('refuses a guest\'s ping off the chart, and tells them', () => {
    const rig = createRig();
    const sam = rig.join('Sam');
    rig.run(0.5);
    sam.link.sendCommand({ type: 'ping', x: 5000, z: 0 });
    rig.run(0.5);
    expect(sam.results.map((outcome) => [outcome.result.ok, !outcome.result.ok && outcome.result.reason])).toEqual([[false, 'off_the_map']]);
    expect(rig.game.pings).toBeUndefined();
  });

  it('holds a guest to one ping a second, however many it sends', () => {
    const rig = createRig();
    const sam = rig.join('Sam');
    rig.run(0.5);
    for (let burst = 0; burst < 8; burst += 1) sam.link.sendCommand({ type: 'ping', x: 100 + burst * 50, z: 100 });
    rig.run(0.6);
    expect(sam.results).toHaveLength(8);
    expect(sam.results.filter((outcome) => outcome.result.ok)).toHaveLength(1);
    expect(sam.results.slice(1).every((outcome) => !outcome.result.ok && outcome.result.reason === 'ping_too_soon')).toBe(true);
    expect(spots(rig.game)).toEqual([[1, 100, 100]]);
  });

  it('never takes a forged ping: one that names another player is thrown away whole', () => {
    const rig = createRig();
    const sam = rig.join('Sam');
    rig.run(0.5);
    const refused = rig.host.stats.refused;
    sam.pair.guest.send({ v: PROTOCOL_VERSION, type: 'command', id: 1, at: 0, command: { type: 'ping', x: 10, z: 10, playerId: 0 } });
    rig.run(0.5);
    expect(rig.host.stats.refused).toBe(refused + 1);
    expect(rig.game.pings).toBeUndefined();
  });

  it('sends the pings only when they change: a standing ping costs the wire nothing', () => {
    const rig = createRig();
    // A guest whose wire is listened in on: every state message the host sends it, and which keys each carries.
    const pair = createLoopbackPair({}, 5);
    const carried: string[][] = [];
    const send = pair.host.send.bind(pair.host);
    pair.host.send = (message: unknown): void => {
      const heard = message as { type: string; base: number | null; changed: Record<string, unknown> };
      if (heard.type === 'state' && heard.base !== null) carried.push(Object.keys(heard.changed));
      send(message);
    };
    rig.host.accept(pair.host);
    rig.seats.push({ pair, link: new GuestLink(pair.guest, { name: 'Sam', key: key('Sam') }), input: {}, events: [], results: [] });
    rig.hostInput = { paddle: 1 };
    rig.run(1);
    const withPings = (): number => carried.filter((keys) => keys.includes('pings')).length;
    expect(carried.length).toBeGreaterThan(5);
    expect(withPings()).toBe(0);
    dispatch(rig.game, { type: 'ping', x: -400, z: 250 }, 0);
    rig.run(5);
    // Once, when it was set. Then seventy more states, and not one carries it again.
    expect(withPings()).toBe(1);
    expect(carried.length).toBeGreaterThan(70);
    dispatch(rig.game, { type: 'clear_ping', playerId: 0 }, 0);
    rig.run(1);
    expect(withPings()).toBe(2);
  });
});

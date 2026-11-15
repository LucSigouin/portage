/**
 * A guest who was playing, whose seat went to a newcomer while their tab was hidden, is turned away with `full`.
 * Seats may have emptied since, so the word must not tell them the crew is full: it tells them to join again.
 * A `full` on a first join still says the crew is full.
 */
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/client/app.ts';
import type { App } from '../../src/client/app.ts';
import { createSilentAudio } from '../../src/client/contracts.ts';
import type { WorldView } from '../../src/client/contracts.ts';
import { leaveText } from '../../src/client/viewmodels/crew.ts';
import { GuestLink, createLoopbackPair } from '../../src/net/index.ts';
import type { HostLink } from '../../src/net/index.ts';
import { FIXED_STEP, NEUTRAL_INPUT, drainEvents } from '../../src/sim/index.ts';
import { FakeStorage, floatCanoeAt, newGame } from '../support.ts';

function client(): App {
  const worldView: WorldView = {
    mount: () => {}, resize: () => {}, applyGraphicsSettings: () => {}, showStage: () => {},
    sync: () => {}, handleEvents: () => {}, render: () => {}, dispose: () => {},
  };
  return createApp({ worldView, gameInterface: { mount: () => {}, update: () => {}, dispose: () => {} }, audio: createSilentAudio(), storage: new FakeStorage(), now: () => 5000, randomSeed: () => 42 });
}

describe('the word for a seat that went to someone else', () => {
  it('a first join told full reads as full; one who was seated is told to join again', () => {
    expect(leaveText('full', false)).toBe('That crew is full.');
    expect(leaveText('full', true)).toBe('Your seat went to someone else. Join again by the link.');
    expect(leaveText('removed', true)).toBe('The host took you out of the crew.');
  });

  it('full canoe: Sam hidden and marked away, his seat goes to Dee, and his screen tells him to join again', () => {
    const host = client();
    const guest = client();
    let link: HostLink | null = null;
    host.session.playerName = 'Luc';
    host.session.onShare = (made) => {
      link = made;
    };
    const game = newGame(7);
    floatCanoeAt(game, 200, 1300, 0);
    game.weather.secondsRemaining = 99999;
    drainEvents(game);
    host.session.adoptGame(game);
    const notices: string[] = [];
    guest.session.subscribe((signal) => {
      if (signal.type === 'notice') notices.push(signal.text);
    });
    const samPair = createLoopbackPair({});
    link!.accept(samPair.host);
    guest.session.joinGame(samPair.guest, { name: 'Sam', key: 'key-sam-0123456789' });
    const others: { pair: ReturnType<typeof createLoopbackPair>; link: GuestLink }[] = [];
    const seat = (name: string): GuestLink => {
      const pair = createLoopbackPair({});
      link!.accept(pair.host);
      const made = new GuestLink(pair.guest, { name, key: `key-${name}-0123456789` });
      others.push({ pair, link: made });
      return made;
    };
    const tick = (seconds: number, samHidden: boolean): void => {
      for (let frame = 0; frame < Math.round(seconds / FIXED_STEP); frame += 1) {
        samPair.advance(FIXED_STEP);
        for (const other of others) other.pair.advance(FIXED_STEP);
        host.frame(FIXED_STEP);
        if (!samHidden) guest.frame(FIXED_STEP);
        for (const other of others) {
          other.link.update(FIXED_STEP);
          other.link.sendInput({ ...NEUTRAL_INPUT });
        }
      }
    };
    seat('Ann');
    seat('Bo');
    tick(1, false);
    const samId = guest.session.localPlayerId;
    expect(guest.session.screen).toBe('game');
    expect(game.players).toHaveLength(4);
    // Sam's tab is hidden: it runs no frame, and the host marks him away.
    guest.setHidden(true);
    tick(12, true);
    expect(game.players.find((player) => player.id === samId)!.connected).toBe(false);
    const dee = seat('Dee');
    tick(1, true);
    expect(dee.playerId).toBe(samId);
    // Sam's tab is back: it asks straight back in and is turned away.
    guest.setHidden(false);
    tick(2, false);
    expect(guest.session.screen).toBe('lobby');
    expect(notices).toContain('Your seat went to someone else. Join again by the link.');
    expect(notices).not.toContain('That crew is full.');
  });
});

/**
 * A guest's carry is written when the page goes hidden, not only when it
 * closes: a tab killed, a phone put to sleep or a crash never says it is
 * closing, and what was picked up since the last write would be lost. Hidden
 * is still in the game: the link stays open and the seat stays taken.
 */
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/client/app.ts';
import type { App } from '../../src/client/app.ts';
import { createSilentAudio } from '../../src/client/contracts.ts';
import type { WorldView } from '../../src/client/contracts.ts';
import { carrySlot } from '../../src/client/carrystore.ts';
import { createLoopbackPair } from '../../src/net/index.ts';
import type { HostLink } from '../../src/net/index.ts';
import { FIXED_STEP, drainEvents } from '../../src/sim/index.ts';
import { FakeStorage, floatCanoeAt, newGame } from '../support.ts';

function client(): { app: App; storage: FakeStorage } {
  const worldView: WorldView = {
    mount: () => {}, resize: () => {}, applyGraphicsSettings: () => {}, showStage: () => {},
    sync: () => {}, handleEvents: () => {}, render: () => {}, dispose: () => {},
  };
  const storage = new FakeStorage();
  const app = createApp({ worldView, gameInterface: { mount: () => {}, update: () => {}, dispose: () => {} }, audio: createSilentAudio(), storage, now: () => 5000, randomSeed: () => 42 });
  return { app, storage };
}

/** How much driftwood the kept carry of Sam holds in this browser. */
function keptDriftwood(storage: FakeStorage): number {
  const text = storage.getItem(carrySlot('Sam'));
  if (text === null) return -1;
  const carry = JSON.parse(text) as { backpack: { itemId: string; count: number }[] };
  return carry.backpack.filter((stack) => stack.itemId === 'driftwood').reduce((sum, stack) => sum + stack.count, 0);
}

describe('the carry is kept when the page goes hidden', () => {
  it('hidden writes what waits, and the guest stays in the crew', () => {
    const host = client();
    const guest = client();
    let link: HostLink | null = null;
    host.app.session.playerName = 'Luc';
    host.app.session.onShare = (made) => {
      link = made;
    };
    const game = newGame(7);
    floatCanoeAt(game, 200, 1300, 0);
    game.weather.secondsRemaining = 99999;
    drainEvents(game);
    host.app.session.adoptGame(game);
    const pair = createLoopbackPair({});
    link!.accept(pair.host);
    guest.app.session.joinGame(pair.guest, { name: 'Sam', key: 'key-sam-0123456789' });
    const tick = (seconds: number): void => {
      for (let frame = 0; frame < Math.round(seconds / FIXED_STEP); frame += 1) {
        pair.advance(FIXED_STEP);
        host.app.frame(FIXED_STEP);
        guest.app.frame(FIXED_STEP);
      }
    };
    tick(1);
    expect(guest.app.session.localPlayerId).toBe(1);
    // The first confirmed state is written at once; six driftwood a second later wait for the next write.
    expect(keptDriftwood(guest.storage)).toBe(0);
    game.players[1]!.backpack.push({ itemId: 'driftwood', count: 6 });
    tick(1);
    expect(guest.app.session.game!.players[1]!.backpack.some((stack) => stack.itemId === 'driftwood' && stack.count === 6)).toBe(true);
    expect(keptDriftwood(guest.storage)).toBe(0);

    guest.app.setHidden(true);
    expect(keptDriftwood(guest.storage)).toBe(6);
    tick(1);
    // Still in the game: the wire is open and the host still has Sam at the seat.
    expect(guest.app.session.screen).toBe('game');
    expect(host.app.session.game!.players[1]!.connected).toBe(true);
  });
});

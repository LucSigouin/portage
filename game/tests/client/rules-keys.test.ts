/**
 * Keys from Luc's bugfix list, on whole clients: a solo game, and a host with a guest on a loopback wire.
 * - Line 21: F at the stump bench (or the workbench on the canoe) says "Use the bench" and opens crafting, as C does.
 */
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/client/app.ts';
import type { App } from '../../src/client/app.ts';
import { createSilentAudio } from '../../src/client/contracts.ts';
import type { GameInterface, InterfaceModel, WorldView } from '../../src/client/contracts.ts';
import { CAMP_LAYOUTS } from '../../src/data/index.ts';
import { createLoopbackPair } from '../../src/net/index.ts';
import type { HostLink, LoopbackPair } from '../../src/net/index.ts';
import { FIXED_STEP, drainEvents, terrainHeight } from '../../src/sim/index.ts';
import type { GameState, PlayerState } from '../../src/sim/index.ts';
import { FakeStorage, newGame, standOn } from '../support.ts';

interface Client {
  app: App;
  models: InterfaceModel[];
  toasts(): string[];
}

function client(): Client {
  const models: InterfaceModel[] = [];
  const worldView: WorldView = {
    mount: () => {}, resize: () => {}, applyGraphicsSettings: () => {}, showStage: () => {},
    sync: () => {}, handleEvents: () => {}, render: () => {}, dispose: () => {},
  };
  const gameInterface: GameInterface = { mount: () => {}, update: (model) => void models.push(model), dispose: () => {} };
  const app = createApp({ worldView, gameInterface, audio: createSilentAudio(), storage: new FakeStorage(), now: () => 5000, randomSeed: () => 42 });
  return { app, models, toasts: () => models.at(-1)?.toasts.map((toast) => toast.text) ?? [] };
}

/** A host sharing `game` and a guest who joined it, both clients framed together. */
function table(game: GameState): { host: Client; guest: Client; link: HostLink; pair: LoopbackPair; tick(seconds: number): void } {
  const host = client();
  const guest = client();
  let link: HostLink | null = null;
  host.app.session.playerName = 'Luc';
  host.app.session.onShare = (made) => {
    link = made;
  };
  host.app.session.adoptGame(game);
  const pair = createLoopbackPair({});
  link!.accept(pair.host);
  guest.app.session.joinGame(pair.guest, { name: 'Sam', key: 'key-sam-0123456789' });
  return {
    host, guest, link: link!, pair,
    tick(seconds: number): void {
      for (let frame = 0; frame < Math.round(seconds / FIXED_STEP); frame += 1) {
        pair.advance(FIXED_STEP);
        host.app.frame(FIXED_STEP);
        guest.app.frame(FIXED_STEP);
      }
    },
  };
}

function frames(app: App, seconds: number): void {
  for (let frame = 0; frame < Math.round(seconds / FIXED_STEP); frame += 1) app.frame(FIXED_STEP);
}

const stump = (): { x: number; z: number } => CAMP_LAYOUTS.home_knoll!.landmarks.find((landmark) => landmark.kind === 'stump_bench')!;

function standAt(player: PlayerState, x: number, z: number): void {
  Object.assign(player, { mode: 'foot', seat: null, islandId: 'home_knoll', position: { x, y: terrainHeight(x, z), z } });
}

/** Home Knoll, the canoe on the beach, the first quest done, a sky that holds. */
function ashoreGame(): GameState {
  const game = newGame(7);
  standOn(game, 'home_knoll');
  game.weather.secondsRemaining = 99999;
  game.quests.bail_out.status = 'completed';
  game.quests.first_haul.status = 'active';
  drainEvents(game);
  return game;
}

describe('F at the bench (Luc\'s list, line 21)', () => {
  it('says "Use the bench" and opens crafting, as C does', () => {
    const solo = client();
    const game = ashoreGame();
    const bench = stump();
    standAt(game.players[0], bench.x + 1.5, bench.z);
    solo.app.session.adoptGame(game);
    frames(solo.app, 0.1);
    expect(solo.models.at(-1)!.hud!.prompt).toMatchObject({ text: 'Use the bench', keyLabel: 'F' });
    expect(solo.app.session.isOpen('crafting')).toBe(false);
    solo.app.session.keyDown('KeyF');
    solo.app.session.keyUp('KeyF');
    expect(solo.app.session.isOpen('crafting')).toBe(true);
    // Nothing went to the rules: no refusal, no command.
    frames(solo.app, 0.1);
    expect(solo.toasts()).toEqual([]);
  });

  it('does the same on a guest\'s screen', () => {
    const game = ashoreGame();
    const { guest, tick } = table(game);
    tick(1);
    expect(guest.app.session.localPlayerId).toBe(1);
    const bench = stump();
    standAt(game.players[1], bench.x + 1.5, bench.z);
    tick(0.5);
    expect(guest.models.at(-1)!.hud!.prompt).toMatchObject({ text: 'Use the bench', keyLabel: 'F' });
    guest.app.session.keyDown('KeyF');
    guest.app.session.keyUp('KeyF');
    expect(guest.app.session.isOpen('crafting')).toBe(true);
  });
});

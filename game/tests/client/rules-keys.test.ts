/**
 * Keys from Luc's bugfix list, on whole clients: a solo game, and a host with a guest on a loopback wire.
 * - Line 21: F at the stump bench (or the workbench on the canoe) says "Use the bench" and opens crafting, as C does.
 * - Line 14: Q paddles the canoe forward on its own; Q again, W or S stops it. Aboard only, a guest too, rebindable.
 */
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/client/app.ts';
import type { App } from '../../src/client/app.ts';
import { createSilentAudio } from '../../src/client/contracts.ts';
import type { GameInterface, InterfaceModel, WorldView } from '../../src/client/contracts.ts';
import { buildHowToPlayPanel } from '../../src/client/viewmodels/menus.ts';
import { buildSettingsPanel } from '../../src/client/viewmodels/settings.ts';
import { CAMP_LAYOUTS } from '../../src/data/index.ts';
import { DEFAULT_KEY_BINDINGS, actionForKey, createDefaultSettings, rebindKey, sanitizeSettings } from '../../src/settings/index.ts';
import { createLoopbackPair } from '../../src/net/index.ts';
import type { HostLink, LoopbackPair } from '../../src/net/index.ts';
import { FIXED_STEP, drainEvents, terrainHeight } from '../../src/sim/index.ts';
import type { GameState, PlayerState } from '../../src/sim/index.ts';
import { FakeStorage, floatCanoeAt, newGame, standOn } from '../support.ts';

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

/** Afloat on calm water south of Home Knoll, a tight dry hull, the first quest done, a sky that holds. */
function afloatGame(): GameState {
  const game = newGame(7);
  game.canoe.hullTier = 1;
  floatCanoeAt(game, 200, 1300, 0);
  game.weather.secondsRemaining = 99999;
  game.quests.bail_out.status = 'completed';
  game.quests.first_haul.status = 'active';
  drainEvents(game);
  return game;
}

describe('Q paddles on its own (Luc\'s list, line 14)', () => {
  it('starts with Q and keeps paddling with no key held, says so, and Q again stops it', () => {
    const solo = client();
    const game = afloatGame();
    solo.app.session.adoptGame(game);
    const start = game.canoe.position.z;
    solo.app.session.keyDown('KeyQ');
    solo.app.session.keyUp('KeyQ');
    frames(solo.app, 0.1);
    expect(solo.toasts()).toContain('Paddling on. Q, W or S to stop.');
    frames(solo.app, 4);
    expect(game.players[0].paddling).toBe(true);
    expect(start - game.canoe.position.z).toBeGreaterThan(5);
    solo.app.session.keyDown('KeyQ');
    solo.app.session.keyUp('KeyQ');
    frames(solo.app, 0.2);
    expect(game.players[0].paddling).toBe(false);
    expect(solo.toasts()).toContain('Paddling off.');
  });

  it('stops with W or S as well, and those keys then paddle as they always did', () => {
    for (const key of ['KeyW', 'KeyS']) {
      const solo = client();
      const game = afloatGame();
      solo.app.session.adoptGame(game);
      solo.app.session.keyDown('KeyQ');
      solo.app.session.keyUp('KeyQ');
      frames(solo.app, 1);
      solo.app.session.keyDown(key);
      expect(solo.app.session.input.autoPaddle, key).toBe(false);
      frames(solo.app, 1);
      expect(solo.app.session.lastInput.paddle, key).toBe(key === 'KeyW' ? 1 : -1);
      solo.app.session.keyUp(key);
      frames(solo.app, 0.2);
      expect(game.players[0].paddling, key).toBe(false);
      expect(solo.toasts(), key).toContain('Paddling off.');
    }
  });

  it('does nothing on foot, and ends when the paddler steps ashore', () => {
    const solo = client();
    const game = ashoreGame();
    solo.app.session.adoptGame(game);
    solo.app.session.keyDown('KeyQ');
    expect(solo.app.session.input.autoPaddle).toBe(false);
    frames(solo.app, 0.2);
    expect(solo.toasts()).toEqual([]);

    const afloat = client();
    const water = afloatGame();
    afloat.app.session.adoptGame(water);
    afloat.app.session.keyDown('KeyQ');
    afloat.app.session.keyUp('KeyQ');
    standAt(water.players[0], ...[stump().x, stump().z] as [number, number]);
    frames(afloat.app, 0.1);
    expect(afloat.app.session.input.autoPaddle).toBe(false);
    Object.assign(water.players[0], { mode: 'canoe', seat: 0, islandId: null, position: { ...water.canoe.position } });
    frames(afloat.app, 0.5);
    expect(water.players[0].paddling).toBe(false);
  });

  it('works for a guest: the guest\'s Q reaches the host as paddling', () => {
    const game = afloatGame();
    const { guest, tick } = table(game);
    tick(1);
    expect(game.players[1].mode).toBe('canoe');
    const start = game.canoe.position.z;
    guest.app.session.keyDown('KeyQ');
    guest.app.session.keyUp('KeyQ');
    tick(0.1);
    expect(guest.toasts()).toContain('Paddling on. Q, W or S to stop.');
    tick(4);
    expect(game.players[1].paddling).toBe(true);
    expect(game.players[0].paddling).toBe(false);
    expect(start - game.canoe.position.z).toBeGreaterThan(5);
    guest.app.session.keyDown('KeyS');
    guest.app.session.keyUp('KeyS');
    tick(1);
    expect(game.players[1].paddling).toBe(false);
  });

  it('is in the keys list in Settings and How to Play, and rebinds like the others', () => {
    const settings = createDefaultSettings();
    expect(DEFAULT_KEY_BINDINGS.autoPaddle).toEqual(['KeyQ']);
    const row = JSON.stringify(buildSettingsPanel(settings, 'controls', null, ''));
    expect(row).toContain('Auto-paddle (on and off)');
    expect(JSON.stringify(buildHowToPlayPanel(settings))).toContain('Auto-paddle: press again, or paddle, to stop');
    const { bindings } = rebindKey(settings.controls.keyBindings, 'autoPaddle', 0, 'KeyE');
    expect(actionForKey(bindings, 'KeyE', 'canoe')).toBe('autoPaddle');
    expect(actionForKey(bindings, 'KeyQ', 'canoe')).toBeNull();
    // On a rebound key, the new key starts it and the old one does nothing.
    const solo = client();
    solo.app.session.updateSettings({ ...settings, controls: { ...settings.controls, keyBindings: bindings } });
    const game = afloatGame();
    solo.app.session.adoptGame(game);
    solo.app.session.keyDown('KeyQ');
    expect(solo.app.session.input.autoPaddle).toBe(false);
    solo.app.session.keyDown('KeyE');
    expect(solo.app.session.input.autoPaddle).toBe(true);
    frames(solo.app, 0.2);
    expect(solo.toasts()).toContain('Paddling on. E, W or S to stop.');
  });

  it('leaves Q alone in settings saved before it, where the player gave Q to something else aboard', () => {
    const stored = createDefaultSettings();
    const { autoPaddle: _unused, ...older } = { ...stored.controls.keyBindings, steerPort: ['KeyQ'] };
    const loaded = sanitizeSettings({ ...stored, controls: { ...stored.controls, keyBindings: older } });
    expect(loaded.controls.keyBindings.steerPort).toEqual(['KeyQ']);
    expect(loaded.controls.keyBindings.autoPaddle).toEqual([]);
    // Saved before it, Q free: it takes Q.
    const { autoPaddle: _alsoUnused, ...plain } = stored.controls.keyBindings;
    expect(sanitizeSettings({ ...stored, controls: { ...stored.controls, keyBindings: plain } }).controls.keyBindings.autoPaddle).toEqual(['KeyQ']);
  });
});

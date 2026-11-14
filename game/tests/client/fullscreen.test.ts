/**
 * Full screen (Luc's feedback note #7): a line in the lobby menu and on the pause card, whose words follow the page,
 * and no line where the browser has no Fullscreen API.
 */
import { describe, expect, it } from 'vitest';
import { FullscreenSwitch } from '../../src/client/fullscreen.ts';
import type { FullscreenPage, FullscreenView } from '../../src/client/fullscreen.ts';
import { createPanelState, reducePanels } from '../../src/client/panels.ts';
import type { PanelState } from '../../src/client/panels.ts';
import { FULLSCREEN_LABEL, LEAVE_FULLSCREEN_LABEL, buildInterfaceModel } from '../../src/client/viewmodels/index.ts';
import { createDefaultSettings } from '../../src/settings/index.ts';
import { createApp } from '../../src/client/app.ts';
import { createSilentAudio } from '../../src/client/contracts.ts';
import type { GameInterface, InterfaceModel, WorldView } from '../../src/client/contracts.ts';
import { FIXED_STEP } from '../../src/sim/index.ts';
import { FakeStorage, newGame } from '../support.ts';

/** A page that goes in and out of full screen at once, as the browser does after its promise. */
class FakePage implements FullscreenPage {
  fullscreenElement: Element | null = null;
  calls: string[] = [];
  readonly documentElement = {
    requestFullscreen: (): Promise<void> => {
      this.calls.push('request');
      this.fullscreenElement = {} as Element;
      return Promise.resolve();
    },
  };

  readonly fullscreenEnabled: boolean;

  constructor(enabled: boolean) {
    this.fullscreenEnabled = enabled;
  }

  exitFullscreen(): Promise<void> {
    this.calls.push('exit');
    this.fullscreenElement = null;
    return Promise.resolve();
  }
}

function model(panels: PanelState, fullscreen: FullscreenView | null | undefined) {
  const game = panels.screen === 'game' ? newGame() : null;
  return buildInterfaceModel({
    panels, settings: createDefaultSettings(), game, playerId: 0, paused: true, cameraYaw: 0, toasts: [], slots: [], latestSlot: null,
    currentSlot: null, now: 0, capture: null, bindingNotice: '', progressText: '', debug: null, fullscreen,
  });
}

const paused = (): PanelState =>
  reducePanels(createPanelState('game'), { type: 'open', panel: 'pause' }, { canoeBeached: true, boatOpensOn: undefined }).state;
const lobbyLabels = (fullscreen: FullscreenView | null | undefined): string[] =>
  model(createPanelState('lobby'), fullscreen).lobby!.buttons.map((entry) => entry.label);
function pauseLabels(fullscreen: FullscreenView | null | undefined): string[] {
  const panel = model(paused(), fullscreen).panel;
  if (panel?.id !== 'pause') throw new Error('expected the pause card');
  return panel.buttons.map((entry) => entry.label);
}

describe('full screen', () => {
  it('stands under Settings in the lobby and on the pause card, in words that follow the page', () => {
    expect(lobbyLabels({ active: false })).toEqual(['Continue', 'New Game', 'Settings', FULLSCREEN_LABEL, 'How to Play', 'Feedback', 'Credits']);
    expect(pauseLabels({ active: false })).toEqual(['Resume', 'Settings', FULLSCREEN_LABEL, 'How to Play', 'Feedback', 'Save and quit to the lobby']);
    expect(lobbyLabels({ active: true })).toContain(LEAVE_FULLSCREEN_LABEL);
    expect(pauseLabels({ active: true })).toContain(LEAVE_FULLSCREEN_LABEL);
    expect(FULLSCREEN_LABEL).toBe('Full screen');
    expect(LEAVE_FULLSCREEN_LABEL).toBe('Leave full screen');
  });

  it('has no line where the browser cannot go full screen', () => {
    for (const none of [null, undefined]) {
      expect(lobbyLabels(none)).not.toContain(FULLSCREEN_LABEL);
      expect(pauseLabels(none)).not.toContain(FULLSCREEN_LABEL);
    }
    expect(new FullscreenSwitch(new FakePage(false)).view).toBeNull();
  });

  it('toggles the page, and reads the page itself: a leave by Esc or F11 is seen', () => {
    const page = new FakePage(true);
    const toggle = new FullscreenSwitch(page);
    expect(toggle.view).toEqual({ active: false });
    toggle.toggle();
    expect(toggle.view).toEqual({ active: true });
    // The browser's own Esc: the page leaves without the game asking.
    page.fullscreenElement = null;
    expect(toggle.view).toEqual({ active: false });
    toggle.toggle();
    toggle.toggle();
    expect(page.calls).toEqual(['request', 'request', 'exit']);
  });

  it('asks nothing of a browser without the API, and a refusal throws nothing', async () => {
    const without = new FakePage(false);
    new FullscreenSwitch(without).toggle();
    expect(without.calls).toEqual([]);
    const refusing = new FakePage(true);
    refusing.documentElement.requestFullscreen = () => Promise.reject(new TypeError('Permissions check failed'));
    expect(() => new FullscreenSwitch(refusing).toggle()).not.toThrow();
    await Promise.resolve();
  });

  it('on a whole client: the pause line goes in, its words follow, and no key stays held across', () => {
    const models: InterfaceModel[] = [];
    const worldView: WorldView = {
      mount: () => {}, resize: () => {}, applyGraphicsSettings: () => {}, showStage: () => {},
      sync: () => {}, handleEvents: () => {}, render: () => {}, dispose: () => {},
    };
    const gameInterface: GameInterface = { mount: () => {}, update: (next) => void models.push(next), dispose: () => {} };
    const app = createApp({ worldView, gameInterface, audio: createSilentAudio(), storage: new FakeStorage(), now: () => 5000, randomSeed: () => 42 });
    const page = new FakePage(true);
    app.session.fullscreen = new FullscreenSwitch(page);
    app.session.adoptGame(newGame());
    app.session.handleIntent({ type: 'open_panel', panel: 'pause' });
    app.frame(FIXED_STEP);
    const line = (): string | undefined => {
      const panel = models[models.length - 1].panel;
      return panel?.id === 'pause' ? panel.buttons.find((entry) => entry.intent.type === 'toggle_fullscreen')?.label : undefined;
    };
    expect(line()).toBe(FULLSCREEN_LABEL);
    app.session.keyDown('KeyW');
    app.session.handleIntent({ type: 'toggle_fullscreen' });
    expect((app.session.input as unknown as { held: Set<string> }).held.size).toBe(0);
    app.frame(FIXED_STEP);
    expect(line()).toBe(LEAVE_FULLSCREEN_LABEL);
    // Left by the browser's Esc: main.ts hands the change to `session.blur`, and the words turn back on the next frame.
    app.session.keyDown('KeyW');
    page.fullscreenElement = null;
    app.session.blur();
    expect((app.session.input as unknown as { held: Set<string> }).held.size).toBe(0);
    app.frame(FIXED_STEP);
    expect(line()).toBe(FULLSCREEN_LABEL);
    // And the game's own Esc still works after: it closes the pause card.
    app.session.keyDown('Escape');
    app.session.keyUp('Escape');
    app.frame(FIXED_STEP);
    expect(models[models.length - 1].panel?.id).not.toBe('pause');
  });
});

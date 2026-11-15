/**
 * The graphics card note's rule and words (Round 6): on the main menu and on the join card when the browser draws
 * in software, nowhere when it draws on a real card or does not say, nowhere in a staged shot or a driven browser,
 * and forced either way by `&card=`.
 */
import { describe, expect, it } from 'vitest';
import type { CrewView } from '../../src/client/crewlobby.ts';
import { parseDebugParameters } from '../../src/client/debug/parameters.ts';
import { createPanelState, reducePanels } from '../../src/client/panels.ts';
import type { PanelState } from '../../src/client/panels.ts';
import { buildInterfaceModel } from '../../src/client/viewmodels/index.ts';
import type { InterfaceModel } from '../../src/client/viewmodels/index.ts';
import {
  GRAPHICS_CARD_CHROME_LINE, GRAPHICS_CARD_EDGE_LINE, GRAPHICS_CARD_FIREFOX_LINE, GRAPHICS_CARD_OTHER_LINE, GRAPHICS_CARD_SLOW_LINE,
  GRAPHICS_CARD_TITLE, browserFamily, buildGraphicsCardNote, withGraphicsCardNote,
} from '../../src/client/viewmodels/graphicscard.ts';
import type { GraphicsCardFacts } from '../../src/client/viewmodels/graphicscard.ts';
import { createDefaultSettings } from '../../src/settings/index.ts';
import { newGame } from '../support.ts';

const SWIFTSHADER = 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)';
const REAL_CARD = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)';
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const EDGE = `${CHROME} Edg/142.0.0.0`;
const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0';
const OPERA = `${CHROME} OPR/120.0.0.0`;
const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';

const facts = (change: Partial<GraphicsCardFacts> = {}): GraphicsCardFacts => ({
  rendererName: SWIFTSHADER, userAgent: CHROME, forced: null, staged: false, driven: false, ...change,
});

const crew: CrewView = {
  name: 'Luc', code: '', inGame: false,
  host: { phase: 'idle', code: '', link: '', guests: 0, failure: null, copied: false },
  join: { phase: 'idle', problem: null, leave: null, hostHere: true },
};
const open = (panels: PanelState, panel: 'crew_join' | 'crew_host' | 'settings' | 'save_slots'): PanelState =>
  reducePanels(panels, { type: 'open', panel }, { canoeBeached: true, boatOpensOn: undefined }).state;
function frame(panels: PanelState): InterfaceModel {
  return buildInterfaceModel({
    panels, settings: createDefaultSettings(), game: panels.screen === 'game' ? newGame() : null, playerId: 0, paused: false, cameraYaw: 0,
    toasts: [], slots: [], latestSlot: null, currentSlot: null, now: 0, capture: null, bindingNotice: '', progressText: '', debug: null, crew,
  });
}
/** Where the note is in a frame: on the menu, on the open card, both or neither. */
const places = (model: InterfaceModel): string[] => [
  ...(model.lobby?.graphicsCard ? ['menu'] : []),
  ...(model.panel && 'graphicsCard' in model.panel && model.panel.graphicsCard ? [model.panel.id] : []),
];
const shown = (change: Partial<GraphicsCardFacts>, panels: PanelState): string[] => places(withGraphicsCardNote(frame(panels), buildGraphicsCardNote(facts(change))));

describe('the graphics card note', () => {
  it('is on the main menu and on the join card when the browser draws in software', () => {
    expect(shown({}, createPanelState('lobby'))).toEqual(['menu']);
    expect(shown({}, open(createPanelState('lobby'), 'crew_join'))).toEqual(['menu', 'crew_join']);
    const note = buildGraphicsCardNote(facts())!;
    expect(withGraphicsCardNote(frame(createPanelState('lobby')), note).lobby!.graphicsCard).toBe(note);
  });

  it('is on no other card and not in the game', () => {
    for (const other of ['crew_host', 'settings', 'save_slots'] as const) {
      expect(shown({}, open(createPanelState('lobby'), other))).toEqual(['menu']);
    }
    const playing = frame(createPanelState('game'));
    expect(places(withGraphicsCardNote(playing, buildGraphicsCardNote(facts())))).toEqual([]);
    expect(withGraphicsCardNote(playing, buildGraphicsCardNote(facts()))).toBe(playing);
  });

  it('is absent on a real card, and the frame is handed on untouched', () => {
    expect(buildGraphicsCardNote(facts({ rendererName: REAL_CARD }))).toBeNull();
    const menu = frame(open(createPanelState('lobby'), 'crew_join'));
    expect(withGraphicsCardNote(menu, null)).toBe(menu);
    expect(shown({ rendererName: REAL_CARD }, open(createPanelState('lobby'), 'crew_join'))).toEqual([]);
  });

  it('is absent when the browser does not say who draws', () => {
    for (const unknown of [null, '', 'WebKit WebGL']) expect(buildGraphicsCardNote(facts({ rendererName: unknown }))).toBeNull();
  });

  it('is absent in a staged shot and in a browser a test drives, though it draws in software', () => {
    expect(buildGraphicsCardNote(facts({ staged: true }))).toBeNull();
    expect(buildGraphicsCardNote(facts({ driven: true }))).toBeNull();
    expect(shown({ staged: true }, createPanelState('lobby'))).toEqual([]);
  });

  it('is forced on by card=soft and off by card=real, whatever draws and wherever', () => {
    expect(buildGraphicsCardNote(facts({ forced: 'soft', rendererName: REAL_CARD, staged: true, driven: true }))).not.toBeNull();
    expect(buildGraphicsCardNote(facts({ forced: 'soft', rendererName: null }))).not.toBeNull();
    expect(buildGraphicsCardNote(facts({ forced: 'real' }))).toBeNull();
    expect(shown({ forced: 'soft', rendererName: REAL_CARD, staged: true }, open(createPanelState('lobby'), 'crew_join'))).toEqual(['menu', 'crew_join']);
    expect(shown({ forced: 'real' }, open(createPanelState('lobby'), 'crew_join'))).toEqual([]);
  });

  it('reads the switch from the address, and the switch is no sandbox', () => {
    expect(parseDebugParameters('').card).toBeNull();
    expect(parseDebugParameters('?card=soft')).toMatchObject({ card: 'soft', sandbox: false });
    expect(parseDebugParameters('?shot=lobby&card=real')).toMatchObject({ card: 'real', shot: 'lobby' });
    expect(parseDebugParameters('?card=1').card).toBeNull();
  });
});

describe('the note\'s words', () => {
  it('says what is wrong and that the game will be slow, in two short lines', () => {
    const note = buildGraphicsCardNote(facts())!;
    expect(note.title).toBe('This browser is drawing without the graphics card.');
    expect(note.title).toBe(GRAPHICS_CARD_TITLE);
    expect(note.lines[0]).toBe(GRAPHICS_CARD_SLOW_LINE);
    expect(GRAPHICS_CARD_SLOW_LINE).toBe('The game will be very slow until that is turned on.');
  });

  it('names the fix in the browser\'s own settings when the browser is sure', () => {
    expect(buildGraphicsCardNote(facts({ userAgent: CHROME }))!.lines).toEqual([GRAPHICS_CARD_SLOW_LINE, GRAPHICS_CARD_CHROME_LINE]);
    expect(buildGraphicsCardNote(facts({ userAgent: EDGE }))!.lines).toEqual([GRAPHICS_CARD_SLOW_LINE, GRAPHICS_CARD_EDGE_LINE]);
    expect(buildGraphicsCardNote(facts({ userAgent: FIREFOX }))!.lines).toEqual([GRAPHICS_CARD_SLOW_LINE, GRAPHICS_CARD_FIREFOX_LINE]);
    expect(GRAPHICS_CARD_CHROME_LINE).toBe('Chrome: Settings, System, turn on "Use graphics acceleration when available", then restart the browser.');
    expect(GRAPHICS_CARD_EDGE_LINE).toBe('Edge: Settings, System, turn on "Use graphics acceleration when available", then restart the browser.');
    expect(GRAPHICS_CARD_FIREFOX_LINE).toBe('Firefox: Settings, General, Performance, turn on "Use hardware acceleration when available", then restart the browser.');
  });

  it('gives Chrome\'s line and one for the rest when the browser is not sure', () => {
    for (const unsure of [OPERA, SAFARI, '']) {
      expect(browserFamily(unsure)).toBeNull();
      expect(buildGraphicsCardNote(facts({ userAgent: unsure }))!.lines).toEqual([GRAPHICS_CARD_SLOW_LINE, GRAPHICS_CARD_CHROME_LINE, GRAPHICS_CARD_OTHER_LINE]);
    }
    expect(GRAPHICS_CARD_OTHER_LINE).toBe('Other browsers: look for hardware or graphics acceleration in the settings.');
  });

  it('stays short: four lines at most, none longer than 130 letters', () => {
    for (const userAgent of [CHROME, EDGE, FIREFOX, SAFARI]) {
      const note = buildGraphicsCardNote(facts({ userAgent }))!;
      expect(note.lines.length).toBeLessThanOrEqual(3);
      for (const line of [note.title, ...note.lines]) expect(line.length).toBeLessThanOrEqual(130);
    }
  });
});

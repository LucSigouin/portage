import { describe, expect, it } from 'vitest';
import {
  PANEL_RULES, allowsGameplayInput, coversPlayView, createPanelState, pausesSimulation, reducePanels, topPanel,
} from '../../src/client/panels.ts';
import type { PanelAction, PanelEffect, PanelId, PanelState } from '../../src/client/panels.ts';

const BEACHED = { canoeBeached: true };
const AFLOAT = { canoeBeached: false };

/** Run actions in order. Freezes every state on the way, so a mutation would throw. */
function play(start: PanelState, actions: PanelAction[], context = BEACHED): { state: PanelState; effects: PanelEffect[] } {
  let state = start;
  const effects: PanelEffect[] = [];
  for (const action of actions) {
    Object.freeze(state);
    Object.freeze(state.stack);
    const result = reducePanels(state, action, context);
    state = result.state;
    effects.push(...result.effects);
  }
  return { state, effects };
}

const game = (): PanelState => createPanelState('game');
const lobby = (): PanelState => createPanelState('lobby');

describe('the panel state machine', () => {
  it('Esc opens the pause menu in the game, and does nothing at the lobby root', () => {
    expect(play(game(), [{ type: 'escape' }]).state.stack).toEqual(['pause']);
    expect(play(lobby(), [{ type: 'escape' }]).state.stack).toEqual([]);
  });

  it('Esc closes the top panel, one at a time, before it ever pauses', () => {
    const opened = play(game(), [{ type: 'escape' }, { type: 'open', panel: 'settings' }]);
    expect(opened.state.stack).toEqual(['pause', 'settings']);
    const once = play(opened.state, [{ type: 'escape' }]);
    expect(once.state.stack).toEqual(['pause']);
    expect(play(once.state, [{ type: 'escape' }]).state.stack).toEqual([]);

    const inventory = play(game(), [{ type: 'toggle', panel: 'inventory' }, { type: 'escape' }]);
    expect(inventory.state.stack).toEqual([]); // closed the inventory, did not open pause
  });

  it('keeps one panel-key panel open at a time: a second key replaces the first, the same key closes it', () => {
    const replaced = play(game(), [{ type: 'toggle', panel: 'inventory' }, { type: 'toggle', panel: 'map' }]);
    expect(replaced.state.stack).toEqual(['map']);
    expect(replaced.effects).toEqual([
      { type: 'opened', panel: 'inventory' }, { type: 'closed', panel: 'inventory' }, { type: 'opened', panel: 'map' },
    ]);
    expect(play(replaced.state, [{ type: 'toggle', panel: 'map' }]).state.stack).toEqual([]);
  });

  it('needs the canoe beached for the canoe builder, and only for that', () => {
    const refused = play(game(), [{ type: 'toggle', panel: 'canoe_builder' }], AFLOAT);
    expect(refused.state.stack).toEqual([]);
    expect(refused.effects).toEqual([{ type: 'refused', panel: 'canoe_builder', reason: 'canoe_not_beached' }]);
    expect(play(game(), [{ type: 'toggle', panel: 'canoe_builder' }], BEACHED).state.stack).toEqual(['canoe_builder']);
    for (const panel of ['inventory', 'crafting', 'quest_log', 'map'] as const) {
      expect(play(game(), [{ type: 'toggle', panel }], AFLOAT).state.stack, panel).toEqual([panel]);
    }
    const needing = (Object.keys(PANEL_RULES) as PanelId[]).filter((panel) => PANEL_RULES[panel].needsBeachedCanoe);
    expect(needing).toEqual(['canoe_builder']);
  });

  it('stacks menus only on their parent: settings opens from the lobby or from pause, not over play', () => {
    expect(play(lobby(), [{ type: 'open', panel: 'settings' }]).state.stack).toEqual(['settings']);
    const overPlay = play(game(), [{ type: 'open', panel: 'settings' }]);
    expect(overPlay.state.stack).toEqual([]);
    expect(overPlay.effects[0]).toMatchObject({ type: 'refused', panel: 'settings' });
    expect(play(game(), [{ type: 'escape' }, { type: 'open', panel: 'how_to_play' }]).state.stack).toEqual(['pause', 'how_to_play']);
  });

  it('ignores the panel keys while a menu is open: nothing opens, nothing is said', () => {
    for (const panel of ['inventory', 'crafting', 'canoe_builder', 'quest_log', 'map'] as const) {
      const paused = play(game(), [{ type: 'escape' }, { type: 'toggle', panel }]);
      expect(paused.state.stack).toEqual(['pause']);
      // The only effect is the pause menu opening: no refusal for the session to voice.
      expect(paused.effects).toEqual([{ type: 'opened', panel: 'pause' }]);
      const inSettings = play(game(), [{ type: 'escape' }, { type: 'open', panel: 'settings' }, { type: 'toggle', panel }]);
      expect(inSettings.state.stack).toEqual(['pause', 'settings']);
      expect(inSettings.effects.some((effect) => effect.type === 'refused')).toBe(false);
      const confirming = play(game(), [{ type: 'ask_confirm', action: { type: 'quit_to_lobby' } }, { type: 'toggle', panel }]);
      expect(confirming.state.stack).toEqual(['confirm']);
      expect(confirming.effects.some((effect) => effect.type === 'refused')).toBe(false);
    }
    // With no menu in the way the same key still opens its panel, and closes it again.
    expect(play(game(), [{ type: 'toggle', panel: 'inventory' }]).state.stack).toEqual(['inventory']);
    expect(play(game(), [{ type: 'toggle', panel: 'inventory' }, { type: 'toggle', panel: 'inventory' }]).state.stack).toEqual([]);
    // A button that asks for a panel it cannot have is still told why.
    const asked = play(game(), [{ type: 'escape' }, { type: 'open', panel: 'inventory' }]);
    expect(asked.effects.at(-1)).toEqual({ type: 'refused', panel: 'inventory', reason: 'menu_open' });
  });

  it('says when a panel covers the play view: any panel or menu, but not a conversation', () => {
    expect(coversPlayView(game())).toBe(false);
    expect(coversPlayView(lobby())).toBe(false);
    for (const panel of ['inventory', 'crafting', 'quest_log', 'map'] as const) {
      expect(coversPlayView(play(game(), [{ type: 'toggle', panel }]).state), panel).toBe(true);
    }
    expect(coversPlayView(play(game(), [{ type: 'escape' }]).state)).toBe(true);
    expect(coversPlayView(play(game(), [{ type: 'escape' }, { type: 'open', panel: 'settings' }]).state)).toBe(true);
    expect(coversPlayView(play(lobby(), [{ type: 'open', panel: 'settings' }]).state)).toBe(true);
    expect(coversPlayView(play(game(), [{ type: 'ask_confirm', action: { type: 'quit_to_lobby' } }]).state)).toBe(true);
    const talking = play(game(), [{ type: 'sync_dialogue', open: true }]).state;
    expect(talking.stack).toEqual(['dialogue']);
    expect(coversPlayView(talking)).toBe(false);
    // A dialog over a conversation covers it.
    expect(coversPlayView(play(game(), [{ type: 'sync_dialogue', open: true }, { type: 'ask_confirm', action: { type: 'quit_to_lobby' } }]).state)).toBe(true);
  });

  it('refuses game panels in the lobby', () => {
    const inLobby = play(lobby(), [{ type: 'toggle', panel: 'inventory' }, { type: 'open', panel: 'pause' }]);
    expect(inLobby.state.stack).toEqual([]);
    expect(inLobby.effects.map((effect) => effect.type)).toEqual(['refused', 'refused']);
    // And the save slots are a lobby panel only.
    expect(play(lobby(), [{ type: 'open', panel: 'save_slots' }]).state.stack).toEqual(['save_slots']);
    expect(play(game(), [{ type: 'escape' }, { type: 'open', panel: 'save_slots' }]).state.stack).toEqual(['pause']);
  });

  it('pauses the simulation for every full panel and not for a conversation', () => {
    expect(pausesSimulation(game())).toBe(false);
    for (const panel of ['inventory', 'crafting', 'canoe_builder', 'quest_log', 'map'] as const) {
      expect(pausesSimulation(play(game(), [{ type: 'toggle', panel }]).state), panel).toBe(true);
    }
    expect(pausesSimulation(play(game(), [{ type: 'escape' }]).state)).toBe(true);
    const talking = play(game(), [{ type: 'sync_dialogue', open: true }]).state;
    expect(talking.stack).toEqual(['dialogue']);
    expect(pausesSimulation(talking)).toBe(false);
    const notPausing = (Object.keys(PANEL_RULES) as PanelId[]).filter((panel) => !PANEL_RULES[panel].pausesSimulation);
    expect(notPausing).toEqual(['dialogue']);
  });

  it('lets keys drive the game only with nothing open', () => {
    expect(allowsGameplayInput(game())).toBe(true);
    expect(allowsGameplayInput(lobby())).toBe(false);
    expect(allowsGameplayInput(play(game(), [{ type: 'toggle', panel: 'map' }]).state)).toBe(false);
    expect(allowsGameplayInput(play(game(), [{ type: 'sync_dialogue', open: true }]).state)).toBe(false);
  });

  it('follows the rules engine into and out of a conversation', () => {
    const talking = play(game(), [{ type: 'toggle', panel: 'inventory' }, { type: 'sync_dialogue', open: true }]);
    expect(talking.state.stack).toEqual(['dialogue']); // the inventory was pushed aside
    // Esc asks the engine to end it; the panel only goes when the engine says so.
    const escaped = play(talking.state, [{ type: 'escape' }]);
    expect(escaped.state.stack).toEqual(['dialogue']);
    expect(escaped.effects).toEqual([{ type: 'end_dialogue' }]);
    // Panel keys are refused mid-conversation.
    const key = play(talking.state, [{ type: 'toggle', panel: 'map' }]);
    expect(key.state.stack).toEqual(['dialogue']);
    expect(key.effects).toEqual([{ type: 'refused', panel: 'map', reason: 'in_dialogue' }]);
    expect(play(talking.state, [{ type: 'sync_dialogue', open: false }]).state.stack).toEqual([]);
    // Syncing twice changes nothing.
    expect(play(talking.state, [{ type: 'sync_dialogue', open: true }]).effects).toEqual([]);
    // Dialogue cannot be opened by hand.
    expect(play(game(), [{ type: 'open', panel: 'dialogue' }]).state.stack).toEqual([]);
  });

  it('puts a confirm dialog on top of anything and reports the answer', () => {
    const asked = play(lobby(), [{ type: 'open', panel: 'save_slots' }, { type: 'ask_confirm', action: { type: 'delete_save', slot: 1 } }]);
    expect(asked.state.stack).toEqual(['save_slots', 'confirm']);
    expect(asked.state.confirm).toEqual({ type: 'delete_save', slot: 1 });
    expect(topPanel(asked.state)).toBe('confirm');

    const accepted = play(asked.state, [{ type: 'answer_confirm', accepted: true }]);
    expect(accepted.state.stack).toEqual(['save_slots']);
    expect(accepted.state.confirm).toBeNull();
    expect(accepted.effects).toContainEqual({ type: 'confirmed', action: { type: 'delete_save', slot: 1 } });

    const declined = play(asked.state, [{ type: 'answer_confirm', accepted: false }]);
    expect(declined.state.stack).toEqual(['save_slots']);
    expect(declined.effects.some((effect) => effect.type === 'confirmed')).toBe(false);

    // Esc is a no.
    const escaped = play(asked.state, [{ type: 'escape' }]);
    expect(escaped.state.stack).toEqual(['save_slots']);
    expect(escaped.state.confirm).toBeNull();
    expect(escaped.effects.some((effect) => effect.type === 'confirmed')).toBe(false);

    // Nothing opens over a confirm, and an answer with no question is ignored.
    expect(play(asked.state, [{ type: 'open', panel: 'settings' }]).state.stack).toEqual(['save_slots', 'confirm']);
    expect(play(lobby(), [{ type: 'answer_confirm', accepted: true }]).effects).toEqual([]);
  });

  it('remembers the settings tab and clears everything on a screen change', () => {
    const tabbed = play(lobby(), [{ type: 'open', panel: 'settings' }, { type: 'select_settings_tab', tab: 'controls' }]);
    expect(tabbed.state.settingsTab).toBe('controls');
    expect(tabbed.effects.at(-1)).toEqual({ type: 'tab_changed', tab: 'controls' });
    expect(play(tabbed.state, [{ type: 'select_settings_tab', tab: 'controls' }]).effects).toEqual([]);
    const moved = play(tabbed.state, [{ type: 'ask_confirm', action: { type: 'quit_to_lobby' } }, { type: 'show_screen', screen: 'game' }]);
    expect(moved.state).toMatchObject({ screen: 'game', stack: [], confirm: null, settingsTab: 'controls' });
  });

  it('closes every menu at once on resume, but never a conversation', () => {
    const deep = play(game(), [{ type: 'sync_dialogue', open: true }, { type: 'ask_confirm', action: { type: 'quit_to_lobby' } }]);
    expect(deep.state.stack).toEqual(['dialogue', 'confirm']);
    const resumed = play(deep.state, [{ type: 'close_all' }]);
    expect(resumed.state.stack).toEqual(['dialogue']);
    expect(resumed.state.confirm).toBeNull();
    expect(play(game(), [{ type: 'escape' }, { type: 'open', panel: 'settings' }, { type: 'close_all' }]).state.stack).toEqual([]);
  });
});

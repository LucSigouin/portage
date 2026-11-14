/**
 * Every crafting menu a player can open where they stand, opened the way the session opens it: the panel machine
 * takes the key or the click, and the whole interface model draws what it shows (Luc, Round 4).
 *
 * - C: the hands, then each card of the row (a station of the camp the player stands in).
 * - B: each station built on the canoe that can be pressed.
 */
import { boatOpensOn, buildInterfaceModel } from '../../src/client/viewmodels/index.ts';
import type { PanelModel, RecipeRowModel } from '../../src/client/viewmodels/index.ts';
import { createPanelState, reducePanels } from '../../src/client/panels.ts';
import type { PanelAction, PanelState } from '../../src/client/panels.ts';
import { createDefaultSettings } from '../../src/settings/index.ts';
import type { Settings } from '../../src/settings/index.ts';
import type { GameState } from '../../src/sim/index.ts';

export type CraftingPanelModel = Extract<PanelModel, { id: 'crafting' }>;
export type BoatPanelModel = Extract<PanelModel, { id: 'canoe_builder' }>;

export interface CraftMenu {
  /** "C: Hands", "C: Campfire", "B: Firebox". */
  name: string;
  /** The panels as they stand with this menu open. */
  panels: PanelState;
  recipes: RecipeRowModel[];
}

/** The panel on top, as the whole interface model gives it. */
export function panelOf(state: GameState, panels: PanelState, playerId = 0, settings: Settings = createDefaultSettings()): PanelModel | null {
  return buildInterfaceModel({
    panels, settings, game: state, playerId, paused: false, cameraYaw: 0, toasts: [], slots: [], latestSlot: null,
    currentSlot: null, now: 0, capture: null, bindingNotice: '', progressText: '', debug: null,
  }).panel;
}

/** One action through the panel machine, with the context the session gives it. */
export function act(state: GameState, panels: PanelState, action: PanelAction, playerId = 0): PanelState {
  return reducePanels(panels, action, { canoeBeached: state.canoe.beached, boatOpensOn: boatOpensOn(state, playerId) }).state;
}

/** The crafting panel as the crafting key opens it, or with a card of its row clicked after. */
export function craftingPanel(state: GameState, playerId = 0, tab?: CraftingPanelModel['tab'], settings?: Settings): CraftingPanelModel {
  let panels = act(state, createPanelState('game'), { type: 'open', panel: 'crafting' }, playerId);
  if (tab) panels = act(state, panels, { type: 'select_craft_tab', tab }, playerId);
  const panel = panelOf(state, panels, playerId, settings);
  if (panel?.id !== 'crafting') throw new Error('expected the crafting panel');
  return panel;
}

/** Every crafting menu the player can open right now, each with the recipes it lists. */
export function craftMenus(state: GameState, playerId = 0, settings?: Settings): CraftMenu[] {
  const menus: CraftMenu[] = [];
  const crafting = act(state, createPanelState('game'), { type: 'open', panel: 'crafting' }, playerId);
  const hands = panelOf(state, crafting, playerId, settings);
  if (hands?.id !== 'crafting') throw new Error('expected the crafting panel');
  menus.push({ name: 'C: Hands', panels: crafting, recipes: hands.stations.flatMap((station) => station.recipes) });
  for (const door of hands.doors) {
    if (door.selected) continue;
    // A click on the card: the session hands the card's own intent to the panel machine.
    if (door.intent.type !== 'select_craft_tab') throw new Error('a card of the crafting row selects a menu');
    const panels = act(state, crafting, door.intent, playerId);
    const panel = panelOf(state, panels, playerId, settings);
    if (panel?.id !== 'crafting') throw new Error('expected the crafting panel');
    menus.push({ name: `C: ${door.label}`, panels, recipes: panel.stations.flatMap((station) => station.recipes) });
  }
  const boat = act(state, createPanelState('game'), { type: 'open', panel: 'canoe_builder' }, playerId);
  const builder = panelOf(state, boat, playerId, settings);
  if (builder?.id !== 'canoe_builder') throw new Error('expected the boat\'s panel');
  for (const tab of builder.tabs) {
    if (tab.tab === 'builder' || !tab.enabled) continue;
    if (tab.intent.type !== 'select_boat_tab') throw new Error('a card of the boat\'s row selects a menu');
    const panels = act(state, boat, tab.intent, playerId);
    const panel = panelOf(state, panels, playerId, settings);
    if (panel?.id !== 'canoe_builder') throw new Error('expected the boat\'s panel');
    menus.push({ name: `B: ${tab.label}`, panels, recipes: panel.station?.recipes ?? [] });
  }
  return menus;
}

/** Every recipe row on every menu the player can open right now. */
export const craftRows = (state: GameState, playerId = 0, settings?: Settings): RecipeRowModel[] =>
  craftMenus(state, playerId, settings).flatMap((menu) => menu.recipes);

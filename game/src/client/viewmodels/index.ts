/**
 * View models: pure functions from the selectors to display-ready rows.
 * `buildInterfaceModel` assembles one frame of UI from plain inputs.
 */
import type { SlotSummary } from '../../save/index.ts';
import type { InputAction, Settings } from '../../settings/index.ts';
import type { GameState, PlayerId } from '../../sim/index.ts';
import { seenCells, valleyChart } from './chart.ts';
import type { CrewView } from '../crewlobby.ts';
import { topPanel } from '../panels.ts';
import type { PanelId, PanelState } from '../panels.ts';
import {
  buildCanoeBuilderPanel, buildCraftingPanel, buildDialoguePanel, buildInventoryPanel, buildMapPanel,
  buildQuestLogPanel,
} from './gamepanels.ts';
import { buildCrewHostPanel, buildCrewJoinPanel } from './crew.ts';
import { buildHudModel } from './hud.ts';
import {
  buildConfirmModel, buildCreditsPanel, buildHowToPlayPanel, buildLobbyModel, buildPausePanel, buildSaveSlotsPanel,
} from './menus.ts';
import { buildSettingsPanel } from './settings.ts';
import type { ArrivalModel } from './arrival.ts';
import type { DebugModel, InterfaceModel, PanelModel, ToastModel } from './types.ts';

export * from './types.ts';
export * from './format.ts';
export * from './hud.ts';
export * from './shore.ts';
export * from './toasts.ts';
export * from './arrival.ts';
export * from './gamepanels.ts';
export * from './stations.ts';
export * from './menus.ts';
export * from './crew.ts';
export * from './settings.ts';
export * from './chart.ts';

export interface InterfaceModelInput {
  panels: PanelState;
  settings: Settings;
  /** The game being played, or null in the lobby. */
  game: GameState | null;
  /** The player this screen belongs to: the HUD and the panels are theirs. Player 0 when left out. */
  playerId?: PlayerId;
  /** The player whose browser runs a shared game, for the crew list's host tag. Null or absent when the game is not shared. */
  hostId?: PlayerId | null;
  /** True on a guest's screen while it has had no word from the host: the HUD says so until it has. */
  hostQuiet?: boolean;
  paused: boolean;
  /** Bearing the camera looks along, radians. */
  cameraYaw: number;
  toasts: ToastModel[];
  slots: readonly SlotSummary[];
  latestSlot: number | null;
  currentSlot: number | null;
  /** Wall clock, milliseconds. */
  now: number;
  /** The key binding waiting for a key, or null. */
  capture: { action: InputAction; slot: number } | null;
  bindingNotice: string;
  /** "Quest 5 of 12: A proper edge". */
  progressText: string;
  /** The crew lobby's state. Null or absent in a game built without a relay: no crew entries, no crew panels. */
  crew?: CrewView | null;
  /** The words of the built view while it holds the screen (`builtWords`). Null or absent the rest of the time. */
  built?: { kicker: string; title: string; text: string } | null;
  /** The arrival card on the screen this frame (`ArrivalQueue.model`). Null or absent the rest of the time. */
  arrival?: ArrivalModel | null;
  debug: DebugModel | null;
}

/** True when this screen is a guest's: the game it shows runs in somebody else's browser. */
const isGuestScreen = (input: InterfaceModelInput): boolean =>
  input.hostId !== null && input.hostId !== undefined && input.hostId !== (input.playerId ?? 0);

const PANEL_TITLES: Readonly<Record<PanelId, string>> = {
  settings: 'Settings', how_to_play: 'How to Play', credits: 'Credits', pause: 'Paused', save_slots: 'Save slots',
  inventory: 'Inventory', crafting: 'Crafting', canoe_builder: 'Canoe builder', quest_log: 'Quest log', map: 'Map',
  dialogue: 'Conversation', confirm: 'Confirm', crew_host: 'Host a crew', crew_join: 'Join a crew',
};

/** The model of one open panel, or null when it has nothing to show. */
export function buildPanelModel(panel: PanelId, input: InterfaceModelInput): PanelModel | null {
  const frame = {
    title: PANEL_TITLES[panel],
    close: {
      label: panel === 'dialogue' ? 'Leave' : 'Close',
      intent: { type: 'close_panel' as const }, enabled: true, note: null,
    },
  };
  const game = input.game;
  const playerId = input.playerId ?? 0;
  switch (panel) {
    case 'settings':
      return { ...frame, ...buildSettingsPanel(input.settings, input.panels.settingsTab, input.capture, input.bindingNotice) };
    case 'how_to_play':
      return { ...frame, ...buildHowToPlayPanel(input.settings) };
    case 'credits':
      return { ...frame, ...buildCreditsPanel(game?.flags.beacon_lit === true) };
    case 'pause':
      return { ...frame, ...buildPausePanel(input.progressText, input.crew ?? null, isGuestScreen(input)) };
    case 'save_slots':
      return { ...frame, ...buildSaveSlotsPanel(input.slots, input.now, input.currentSlot) };
    case 'inventory':
      return game ? { ...frame, ...buildInventoryPanel(game, playerId, input.settings.controls.keyBindings) } : null;
    case 'crafting':
      return game ? { ...frame, ...buildCraftingPanel(game, playerId, input.settings.controls.keyBindings) } : null;
    case 'canoe_builder':
      return game ? { ...frame, ...buildCanoeBuilderPanel(game, playerId, input.panels.boatTab, input.settings.controls.keyBindings) } : null;
    case 'quest_log':
      return game ? { ...frame, ...buildQuestLogPanel(game, playerId) } : null;
    case 'map':
      return game ? { ...frame, ...buildMapPanel(game, playerId) } : null;
    case 'dialogue': {
      const body = game ? buildDialoguePanel(game, playerId) : null;
      return body ? { ...frame, ...body } : null;
    }
    case 'crew_host':
      return input.crew ? { ...frame, ...buildCrewHostPanel(input.crew, input.slots, input.latestSlot) } : null;
    case 'crew_join':
      return input.crew ? { ...frame, ...buildCrewJoinPanel(input.crew) } : null;
    case 'confirm':
      return null;
  }
}

/** One frame of UI. Only the panel on top (under any confirm dialog) is built. */
export function buildInterfaceModel(input: InterfaceModelInput): InterfaceModel {
  const { panels, settings, game } = input;
  const top = topPanel(panels);
  const beneath = top === 'confirm' ? panels.stack[panels.stack.length - 2] ?? null : top;
  return {
    screen: panels.screen,
    uiScale: settings.accessibility.uiScale,
    patternedMeters: settings.accessibility.patternedMeters,
    paused: input.paused,
    lobby: panels.screen === 'lobby' ? buildLobbyModel(input.slots, input.latestSlot, input.crew ?? null) : null,
    hud: game ? buildHudModel(game, settings, input.cameraYaw, input.playerId ?? 0, input.hostId ?? null, input.hostQuiet ?? false) : null,
    toasts: input.toasts,
    panel: beneath ? buildPanelModel(beneath, input) : null,
    openPanels: [...panels.stack],
    confirm: top === 'confirm' && panels.confirm ? buildConfirmModel(panels.confirm, isGuestScreen(input)) : null,
    built: input.built ? { ...input.built, hint: 'Any key', dismiss: { type: 'end_built_view' } } : null,
    chart: game ? {
      geometry: valleyChart(), seen: seenCells(game.seen), fullChart: game.canoe.attachments.includes('map_table'),
    } : null,
    arrival: input.arrival ?? null,
    debug: input.debug,
  };
}

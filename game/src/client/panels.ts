/**
 * The panel state machine. The one place that decides what Esc does, which
 * panels stack on which, which pause the simulation, and which need the canoe
 * beached. Pure: `reducePanels` takes a state and an action and returns the
 * next state plus effects for the session to carry out.
 */
import type { AttachmentId, StationId } from '../data/index.ts';

export type ScreenId = 'lobby' | 'game';

export type PanelId =
  | 'settings' | 'how_to_play' | 'credits' | 'pause' | 'inventory' | 'crafting' | 'canoe_builder'
  | 'quest_log' | 'map' | 'dialogue' | 'save_slots' | 'confirm'
  /** Hosting a room on the relay, and joining one. Only reachable in a game built with a relay address. */
  | 'crew_host' | 'crew_join'
  /** A note for Luc from a play tester (`feedback.ts`). In every build: without a relay the panel says feedback is off. */
  | 'feedback';

export type SettingsTabId = 'audio' | 'graphics' | 'controls' | 'gameplay' | 'accessibility';

export const SETTINGS_TABS: readonly SettingsTabId[] = ['audio', 'graphics', 'controls', 'gameplay', 'accessibility'];

/** A menu of the boat's panel (key B): the canoe builder, or a crafting attachment built on the canoe. */
export type BoatTabId = 'builder' | AttachmentId;

/** Something that needs a yes before it happens. */
export type ConfirmAction =
  | { type: 'delete_save'; slot: number }
  | { type: 'overwrite_save'; slot: number }
  | { type: 'quit_to_lobby' }
  | { type: 'reset_key_bindings' };

export interface PanelState {
  screen: ScreenId;
  /** Open panels, bottom to top. The last one has the keyboard. */
  stack: PanelId[];
  settingsTab: SettingsTabId;
  /** The menu the boat's panel shows. Set when the panel opens, and after that only by the player's own click. */
  boatTab: BoatTabId;
  /**
   * The menu the crafting panel shows: the hands, or a station of the camp the player stands in (`handcraft.ts`).
   * The hands when left out. The crafting key always opens on the hands.
   */
  craftTab?: StationId;
  /** What the confirm dialog on the stack is asking about. */
  confirm: ConfirmAction | null;
}

/** The bits of the game the machine needs to rule on an action. */
export interface PanelContext {
  canoeBeached: boolean;
  /** The menu the boat's panel opens on (`boatOpensOn`). The canoe builder when left out. */
  boatOpensOn?: BoatTabId;
}

type PanelGroup =
  /** In-game panels on the panel keys. One at a time: opening one replaces another. */
  | 'gameplay'
  /** Menus. Each opens only on top of its parent. */
  | 'menu'
  /** Opened and closed by the rules engine, never by a key. */
  | 'dialogue'
  /** Stacks on anything. */
  | 'confirm';

interface PanelRule {
  group: PanelGroup;
  /** What the panel may open on top of, per screen. `root` is no panel at all. */
  parents: Partial<Record<ScreenId, readonly (PanelId | 'root')[]>>;
  /** Full panels freeze the simulation while they are open. */
  pausesSimulation: boolean;
  needsBeachedCanoe: boolean;
}

const GAME_ROOT = { game: ['root'] } as const;

export const PANEL_RULES: Readonly<Record<PanelId, PanelRule>> = {
  settings: { group: 'menu', parents: { lobby: ['root'], game: ['pause'] }, pausesSimulation: true, needsBeachedCanoe: false },
  how_to_play: { group: 'menu', parents: { lobby: ['root'], game: ['pause'] }, pausesSimulation: true, needsBeachedCanoe: false },
  credits: { group: 'menu', parents: { lobby: ['root'], game: ['root'] }, pausesSimulation: true, needsBeachedCanoe: false },
  // A host picks the game to share from the room's own panel.
  save_slots: { group: 'menu', parents: { lobby: ['root', 'crew_host'] }, pausesSimulation: true, needsBeachedCanoe: false },
  // The host's room card is also on the pause menu: the place to copy the link again mid-game.
  crew_host: { group: 'menu', parents: { lobby: ['root'], game: ['pause'] }, pausesSimulation: true, needsBeachedCanoe: false },
  crew_join: { group: 'menu', parents: { lobby: ['root'] }, pausesSimulation: true, needsBeachedCanoe: false },
  feedback: { group: 'menu', parents: { lobby: ['root'], game: ['pause'] }, pausesSimulation: true, needsBeachedCanoe: false },
  pause: { group: 'menu', parents: GAME_ROOT, pausesSimulation: true, needsBeachedCanoe: false },
  inventory: { group: 'gameplay', parents: GAME_ROOT, pausesSimulation: true, needsBeachedCanoe: false },
  crafting: { group: 'gameplay', parents: GAME_ROOT, pausesSimulation: true, needsBeachedCanoe: false },
  // The boat's menu opens afloat too: its stations craft on the water. Building still needs the canoe beached, and says so.
  canoe_builder: { group: 'gameplay', parents: GAME_ROOT, pausesSimulation: true, needsBeachedCanoe: false },
  quest_log: { group: 'gameplay', parents: GAME_ROOT, pausesSimulation: true, needsBeachedCanoe: false },
  map: { group: 'gameplay', parents: GAME_ROOT, pausesSimulation: true, needsBeachedCanoe: false },
  // A conversation holds the player still inside the rules engine; the world keeps moving.
  dialogue: { group: 'dialogue', parents: GAME_ROOT, pausesSimulation: false, needsBeachedCanoe: false },
  confirm: { group: 'confirm', parents: {}, pausesSimulation: true, needsBeachedCanoe: false },
};

export type RefusalReason =
  /** The panel does not exist on this screen. */
  | 'not_available_here'
  /** A menu is in the way. */
  | 'menu_open'
  | 'in_dialogue'
  | 'canoe_not_beached';

export type PanelAction =
  | { type: 'open'; panel: PanelId }
  /** A panel key: open it, or close it when it is already on top. */
  | { type: 'toggle'; panel: PanelId }
  /** Close the top panel. */
  | { type: 'close' }
  /** Close every panel. */
  | { type: 'close_all' }
  | { type: 'escape' }
  | { type: 'select_settings_tab'; tab: SettingsTabId }
  | { type: 'select_boat_tab'; tab: BoatTabId }
  | { type: 'select_craft_tab'; tab: StationId }
  | { type: 'ask_confirm'; action: ConfirmAction }
  | { type: 'answer_confirm'; accepted: boolean }
  | { type: 'show_screen'; screen: ScreenId }
  /** Follow the rules engine: is a conversation open? */
  | { type: 'sync_dialogue'; open: boolean };

export type PanelEffect =
  | { type: 'opened'; panel: PanelId }
  | { type: 'closed'; panel: PanelId }
  | { type: 'tab_changed'; tab: SettingsTabId }
  | { type: 'refused'; panel: PanelId; reason: RefusalReason }
  /** The player backed out of a conversation: tell the rules engine. */
  | { type: 'end_dialogue' }
  | { type: 'confirmed'; action: ConfirmAction };

export interface PanelResult {
  state: PanelState;
  effects: PanelEffect[];
}

export function createPanelState(screen: ScreenId = 'lobby'): PanelState {
  return { screen, stack: [], settingsTab: 'audio', boatTab: 'builder', confirm: null };
}

export function topPanel(state: PanelState): PanelId | null {
  return state.stack.length > 0 ? state.stack[state.stack.length - 1] : null;
}

export function isPanelOpen(state: PanelState, panel: PanelId): boolean {
  return state.stack.includes(panel);
}

/** True while any open panel freezes the simulation. */
export function pausesSimulation(state: PanelState): boolean {
  return state.stack.some((panel) => PANEL_RULES[panel].pausesSimulation);
}

/** True while a panel or a menu covers the play view. A conversation leaves the world showing. */
export function coversPlayView(state: PanelState): boolean {
  return state.stack.some((panel) => panel !== 'dialogue');
}

/** True when keys should drive the canoe and the player: in the game with nothing open. */
export function allowsGameplayInput(state: PanelState): boolean {
  return state.screen === 'game' && state.stack.length === 0;
}

const unchanged = (state: PanelState, effects: PanelEffect[] = []): PanelResult => ({ state, effects });

function open(state: PanelState, panel: PanelId, context: PanelContext): PanelResult {
  const rule = PANEL_RULES[panel];
  const refuse = (reason: RefusalReason): PanelResult => unchanged(state, [{ type: 'refused', panel, reason }]);
  const parents = rule.parents[state.screen];
  // Dialogue and confirm are opened by `sync_dialogue` and `ask_confirm` only.
  if (!parents || rule.group === 'dialogue' || rule.group === 'confirm') return refuse('not_available_here');
  const top = topPanel(state);
  if (top === panel) return unchanged(state);
  if (top === 'dialogue') return refuse('in_dialogue');
  if (rule.needsBeachedCanoe && !context.canoeBeached) return refuse('canoe_not_beached');
  // The boat's panel opens on the menu the context names, and holds it: nothing swaps under the player.
  const boat = panel === 'canoe_builder' ? { ...state, boatTab: context.boatOpensOn ?? 'builder' } : state;
  // The crafting panel opens on the hands, whatever it showed last (Luc, Round 4).
  const from: PanelState = panel === 'crafting' ? { ...boat, craftTab: 'hands' } : boat;
  if (rule.group === 'gameplay' && top !== null && PANEL_RULES[top].group === 'gameplay') {
    return {
      state: { ...from, stack: [...state.stack.slice(0, -1), panel] },
      effects: [{ type: 'closed', panel: top }, { type: 'opened', panel }],
    };
  }
  if (!parents.includes(top ?? 'root')) return refuse('menu_open');
  return { state: { ...from, stack: [...state.stack, panel] }, effects: [{ type: 'opened', panel }] };
}

function close(state: PanelState): PanelResult {
  const top = topPanel(state);
  if (top === null) return unchanged(state);
  // The rules engine owns the conversation: ask it to end, and `sync_dialogue` drops the panel.
  if (top === 'dialogue') return unchanged(state, [{ type: 'end_dialogue' }]);
  return {
    state: { ...state, stack: state.stack.slice(0, -1), confirm: top === 'confirm' ? null : state.confirm },
    effects: [{ type: 'closed', panel: top }],
  };
}

/** The whole machine. Never mutates `state`. */
export function reducePanels(state: PanelState, action: PanelAction, context: PanelContext): PanelResult {
  switch (action.type) {
    case 'open':
      return open(state, action.panel, context);
    case 'toggle': {
      // Under a menu (pause, settings, a confirm) the panel keys are dead: no refusal, no sound.
      const top = topPanel(state);
      if (top !== null && top !== action.panel && (PANEL_RULES[top].group === 'menu' || PANEL_RULES[top].group === 'confirm')) {
        return unchanged(state);
      }
      return top === action.panel ? close(state) : open(state, action.panel, context);
    }
    case 'close':
      return close(state);
    case 'close_all': {
      const kept = state.stack.filter((panel) => panel === 'dialogue');
      const closed = state.stack.filter((panel) => panel !== 'dialogue');
      return {
        state: { ...state, stack: kept, confirm: null },
        effects: closed.reverse().map((panel) => ({ type: 'closed', panel })),
      };
    }
    case 'escape':
      if (topPanel(state) !== null) return close(state);
      return state.screen === 'game' ? open(state, 'pause', context) : unchanged(state);
    case 'select_settings_tab':
      if (state.settingsTab === action.tab) return unchanged(state);
      return { state: { ...state, settingsTab: action.tab }, effects: [{ type: 'tab_changed', tab: action.tab }] };
    case 'select_boat_tab':
      return state.boatTab === action.tab ? unchanged(state) : { state: { ...state, boatTab: action.tab }, effects: [] };
    case 'select_craft_tab':
      return (state.craftTab ?? 'hands') === action.tab ? unchanged(state) : { state: { ...state, craftTab: action.tab }, effects: [] };
    case 'ask_confirm':
      if (topPanel(state) === 'confirm') return unchanged(state);
      return {
        state: { ...state, stack: [...state.stack, 'confirm'], confirm: action.action },
        effects: [{ type: 'opened', panel: 'confirm' }],
      };
    case 'answer_confirm': {
      if (topPanel(state) !== 'confirm' || state.confirm === null) return unchanged(state);
      const effects: PanelEffect[] = [{ type: 'closed', panel: 'confirm' }];
      if (action.accepted) effects.push({ type: 'confirmed', action: state.confirm });
      return { state: { ...state, stack: state.stack.slice(0, -1), confirm: null }, effects };
    }
    case 'show_screen':
      return { state: { ...state, screen: action.screen, stack: [], confirm: null }, effects: [] };
    case 'sync_dialogue': {
      const present = isPanelOpen(state, 'dialogue');
      if (action.open === present) return unchanged(state);
      if (!action.open) {
        return { state: { ...state, stack: state.stack.filter((panel) => panel !== 'dialogue') }, effects: [{ type: 'closed', panel: 'dialogue' }] };
      }
      if (state.screen !== 'game') return unchanged(state);
      // A conversation pushes the panel keys' panels aside and sits under any menu.
      const menus = state.stack.filter((panel) => PANEL_RULES[panel].group !== 'gameplay');
      return { state: { ...state, stack: ['dialogue', ...menus] }, effects: [{ type: 'opened', panel: 'dialogue' }] };
    }
  }
}

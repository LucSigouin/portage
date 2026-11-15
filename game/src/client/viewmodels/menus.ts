/** The lobby, save slots, pause menu, how to play, credits and confirm dialogs. */
import { MAIN_QUESTS } from '../../data/index.ts';
import type { SlotSummary } from '../../save/index.ts';
import type { Settings } from '../../settings/index.ts';
import type { InterfaceIntent } from '../intents.ts';
import type { CrewView } from '../crewlobby.ts';
import type { ConfirmAction } from '../panels.ts';
import { buildCrewLobbyButtons, buildCrewPauseButton } from './crew.ts';
import { MAXIMUM_TRACKED } from '../../sim/index.ts';
import { SLEEP_FROM_TEXT, actionKeys, capitalise, durationText, keyLabel } from './format.ts';
import { TAKE_BACK_KEY_CODE } from './takeback.ts';

/** How to Play's line for a click on a stack: its menu, and Give. Short: the page already scrolls. */
export const HOW_TO_PLAY_CLICK_LABEL = 'A stack: eat, drop, give to crew';
import { TOAST_SECONDS } from './toasts.ts';
import type { ButtonModel, ConfirmModel, ControlLineModel, LobbyModel, PanelModel, SaveSlotModel } from './types.ts';

type PanelBody<Id extends PanelModel['id']> = Omit<Extract<PanelModel, { id: Id }>, 'title' | 'close'>;

const button = (label: string, intent: InterfaceIntent, enabled = true, note: string | null = null): ButtonModel => ({
  label, intent, enabled, note,
});

/** "Quest 5: A proper edge", or what a finished game says. */
export function questText(mainQuestId: string | null): string {
  const quest = MAIN_QUESTS.find((definition) => definition.id === mainQuestId);
  return quest ? `Quest ${quest.order}: ${quest.name}` : 'The Beacon is lit. Free play.';
}

/** "just now", "4 min ago", "3 h ago", "2 days ago". */
export function savedAgoText(savedAt: number, now: number): string {
  const seconds = Math.max(0, (now - savedAt) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  const days = Math.floor(seconds / 86400);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function buildSaveSlot(summary: SlotSummary, now: number, currentSlot: number | null): SaveSlotModel {
  const title = `Slot ${summary.slot + 1}`;
  const start = button(summary.empty ? 'New game here' : 'New game (overwrite)', { type: 'new_game', slot: summary.slot });
  if (summary.empty) {
    return {
      slot: summary.slot, title, empty: true, corrupt: false, summary: 'Empty', questText: '', savedText: '',
      current: false, buttons: [start],
    };
  }
  const remove = button('Delete', { type: 'delete_save', slot: summary.slot });
  if (summary.corrupt) {
    return {
      slot: summary.slot, title, empty: false, corrupt: true, summary: 'This save cannot be read.', questText: '',
      savedText: '', current: false, buttons: [start, remove],
    };
  }
  return {
    slot: summary.slot, title, empty: false, corrupt: false,
    summary: `Day ${summary.day}, ${durationText(summary.playedSeconds)} played, ${capitalise(summary.difficulty)}`,
    questText: questText(summary.mainQuestId),
    savedText: `Saved ${savedAgoText(summary.savedAt, now)}`,
    current: summary.slot === currentSlot,
    buttons: [button('Load', { type: 'load_game', slot: summary.slot }), start, remove],
  };
}

export function buildSaveSlotsPanel(summaries: readonly SlotSummary[], now: number, currentSlot: number | null): PanelBody<'save_slots'> {
  return { id: 'save_slots', slots: summaries.map((summary) => buildSaveSlot(summary, now, currentSlot)) };
}

/** `crew` is the crew lobby's state, or null in a game built without a relay: then the menu has no crew entries at all. */
export function buildLobbyModel(summaries: readonly SlotSummary[], latestSlot: number | null, crew: CrewView | null = null): LobbyModel {
  const latest = summaries.find((summary) => summary.slot === latestSlot);
  return {
    title: 'Portage',
    tagline: 'The valley flooded and stayed flooded. You have a leaky canoe.',
    buttons: [
      button('Continue', { type: 'continue_game' }, latest !== undefined,
        latest ? `Slot ${latest.slot + 1}: day ${latest.day}, ${questText(latest.mainQuestId)}` : 'No saved game yet'),
      button('New Game', { type: 'open_panel', panel: 'save_slots' }, true, 'Pick one of three save slots'),
      ...(crew ? buildCrewLobbyButtons(crew) : []),
      button('Settings', { type: 'open_panel', panel: 'settings' }),
      button('How to Play', { type: 'open_panel', panel: 'how_to_play' }),
      button('Credits', { type: 'open_panel', panel: 'credits' }),
    ],
  };
}

/**
 * `guest` is true on the screen of a guest in someone else's game. A guest saves nothing: the game is the host's.
 * What a guest does is leave, and the host keeps their seat for them.
 */
export function buildPausePanel(summary: string, crew: CrewView | null = null, guest = false): PanelBody<'pause'> {
  const crewButton = crew ? buildCrewPauseButton(crew) : null;
  return {
    id: 'pause',
    summary,
    buttons: [
      button('Resume', { type: 'resume' }),
      ...(crewButton ? [crewButton] : []),
      button('Settings', { type: 'open_panel', panel: 'settings' }),
      button('How to Play', { type: 'open_panel', panel: 'how_to_play' }),
      button(guest ? 'Leave the crew' : 'Save and quit to the lobby', { type: 'quit_to_lobby' }),
    ],
  };
}

/**
 * The inventory's drop key (`DROP_KEY_CODE` in `interface/inventoryview.ts`, which this layer does not read: a test
 * holds the two together). It is fixed, like the key that takes a drop back.
 */
export const HOW_TO_PLAY_DROP_KEY = 'Q';

/**
 * How to Play's line for the crafting key (Luc, Round 4: the key lists hand crafts only). A camp's stations are
 * cards on that panel; the canoe's have the next line, on the boat's key.
 */
export const HOW_TO_PLAY_CRAFT_LABEL = "Crafting by hand. A camp's fire and bench are on it too";
const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five'];

/** The rules in a page, with the keys as they are bound right now. */
export function buildHowToPlayPanel(settings: Settings): PanelBody<'how_to_play'> {
  const bindings = settings.controls.keyBindings;
  const control = (label: string, ...actions: Parameters<typeof actionKeys>[1][]): ControlLineModel => ({
    label, keys: actions.map((action) => actionKeys(bindings, action)).join(', '),
  });
  return {
    id: 'how_to_play',
    sections: [
      {
        heading: 'The loop',
        lines: [
          'Paddle to an island, land, scavenge on foot, haul it back, craft and cook, and bolt what you build onto the canoe.',
          'Quests steer the order. The main line ends when you light the Beacon.',
        ],
        controls: [],
      },
      {
        heading: 'In the canoe',
        lines: ['The leaky hull takes on water: bail it. Rough water floods any hull that is not steady enough for it.'],
        controls: [
          control('Paddle, back-paddle', 'paddle', 'backPaddle'),
          control('Auto-paddle: press again, or paddle, to stop', 'autoPaddle'),
          control('Steer', 'steerPort', 'steerStarboard'),
          control('Power stroke (costs energy)', 'powerStroke'),
          control('Bail (hold)', 'bail'),
          control('Lantern, sail', 'lantern', 'sail'),
          control('Land, or haul up what is alongside (one press)', 'interact'),
        ],
      },
      {
        heading: 'On foot',
        lines: ['Walking follows the camera. One press scavenges, picks up, talks or sleeps. Stand by the canoe and press it to board.'],
        controls: [
          control('Walk', 'moveForward', 'moveBack', 'moveLeft', 'moveRight'),
          control('Run (costs energy)', 'run'),
          control('Jump', 'jump'),
          control('Interact, scavenge, board', 'interact'),
          control('Tools 1 to 5', 'tool1', 'tool2', 'tool3', 'tool4', 'tool5'),
        ],
      },
      {
        heading: 'Panels and camera',
        lines: ['Drag with the mouse to look around, wheel to zoom. Full panels pause the game.'],
        // What round 3 added and the page did not say (the master review, finding 6), each beside the panel it
        // belongs to. Shift+click, the drop key and the take-back key are fixed, not bound.
        controls: [
          control('Inventory', 'inventory'),
          // Round 4's click menu and Give (the master review of round 4, finding 5).
          { label: HOW_TO_PLAY_CLICK_LABEL, keys: 'Click' },
          { label: 'A stack to the other side', keys: 'Shift+click' },
          { label: 'Pointer on a stack: drop it', keys: HOW_TO_PLAY_DROP_KEY },
          { label: `Take a drop back, within ${TOAST_SECONDS.warning} s`, keys: keyLabel(TAKE_BACK_KEY_CODE) },
          // Round 4: the crafting key lists hand crafts. A camp's stations are cards on it; the canoe's are the next line.
          control(HOW_TO_PLAY_CRAFT_LABEL, 'craft'),
          control('The canoe: its builder (beached), its stations (afloat too)', 'canoeBuilder'),
          control(`Quest log: track up to ${NUMBER_WORDS[MAXIMUM_TRACKED] ?? MAXIMUM_TRACKED} quests`, 'questLog'),
          control('Map: a click marks a spot for the crew', 'map'),
          control('Pause, or close a panel', 'pause'),
        ],
      },
      {
        heading: 'Staying alive',
        lines: [
          'Hunger and thirst fall slowly; hard paddling and running speed them up. Eat and drink from the inventory. Boil water at a fire first.',
          // A bed, not a camp: the fire warms and cooks, only a bed sleeps (the lean-to, a bedroll, the keeper's hut).
          `Energy comes back when you rest. Sleep at a bed (the lean-to, or a bedroll) after ${SLEEP_FROM_TEXT} to refill it and skip the night.`,
          'Each region is rougher than the last. Stability is 1, plus 1 for each outrigger. Roughness above stability floods the canoe.',
          'Run out of energy or swamp the canoe and you wake at your last camp, six hours later, with half of every cargo stack gone. Tools and the canoe are never lost.',
        ],
        controls: [],
      },
    ],
  };
}

export function buildCreditsPanel(completed: boolean): PanelBody<'credits'> {
  return {
    id: 'credits',
    completed,
    lines: [
      ...(completed ? ['The Beacon is lit. Somewhere down the valley, someone will see it.', ''] : []),
      'Portage',
      'A flooded valley, a leaky canoe.',
      '',
      'Design: Luc Sigouin',
      'Rules, world, client, sound and art: drawn in code, no asset packs',
      'Built with Three.js, TypeScript and Vite',
      '',
      ...(completed ? ['The valley is still yours. Close this to keep paddling.'] : []),
    ],
  };
}

const CONFIRM_TEXT: Record<ConfirmAction['type'], (slot: number, name: string) => { title: string; message: string; accept: string }> = {
  delete_save: (slot) => ({ title: 'Delete this save?', message: `Slot ${slot + 1} will be gone for good.`, accept: 'Delete' }),
  overwrite_save: (slot) => ({
    title: 'Start over in this slot?', message: `Slot ${slot + 1} already holds a game. A new game replaces it.`, accept: 'Start new game',
  }),
  quit_to_lobby: () => ({ title: 'Quit to the lobby?', message: 'The game is saved first.', accept: 'Save and quit' }),
  reset_key_bindings: () => ({ title: 'Reset every key?', message: 'All key bindings go back to their defaults.', accept: 'Reset keys' }),
  remove_player: (_slot, name) => ({
    title: `Take ${name} out of the crew?`, message: 'They leave the game for good. What they carried goes into the canoe.', accept: 'Take out',
  }),
};

/** What quitting is to a guest: nothing is saved here, and the seat waits in the host's game. */
const LEAVE_CREW_TEXT = { title: 'Leave the crew?', message: 'Your seat is kept.', accept: 'Leave the crew' };

/** `guest` is true on the screen of a guest in someone else's game: quitting is leaving, and says so. */
export function buildConfirmModel(action: ConfirmAction, guest = false): ConfirmModel {
  const text = guest && action.type === 'quit_to_lobby' ? LEAVE_CREW_TEXT : CONFIRM_TEXT[action.type]('slot' in action ? action.slot : 0, 'name' in action ? action.name : '');
  return {
    title: text.title,
    message: text.message,
    accept: button(text.accept, { type: 'answer_confirm', accepted: true }),
    cancel: button('Cancel', { type: 'answer_confirm', accepted: false }),
  };
}

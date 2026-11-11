/** The lobby, save slots, pause menu, how to play, credits and confirm dialogs. */
import { MAIN_QUESTS } from '../../data/index.ts';
import type { SlotSummary } from '../../save/index.ts';
import type { Settings } from '../../settings/index.ts';
import type { InterfaceIntent } from '../intents.ts';
import type { ConfirmAction } from '../panels.ts';
import { actionKeys, capitalise, durationText } from './format.ts';
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

export function buildLobbyModel(summaries: readonly SlotSummary[], latestSlot: number | null): LobbyModel {
  const latest = summaries.find((summary) => summary.slot === latestSlot);
  return {
    title: 'Portage',
    tagline: 'The valley flooded and stayed flooded. You have a leaky canoe.',
    buttons: [
      button('Continue', { type: 'continue_game' }, latest !== undefined,
        latest ? `Slot ${latest.slot + 1}: day ${latest.day}, ${questText(latest.mainQuestId)}` : 'No saved game yet'),
      button('New Game', { type: 'open_panel', panel: 'save_slots' }, true, 'Pick one of three save slots'),
      button('Settings', { type: 'open_panel', panel: 'settings' }),
      button('How to Play', { type: 'open_panel', panel: 'how_to_play' }),
      button('Credits', { type: 'open_panel', panel: 'credits' }),
    ],
  };
}

export function buildPausePanel(summary: string): PanelBody<'pause'> {
  return {
    id: 'pause',
    summary,
    buttons: [
      button('Resume', { type: 'resume' }),
      button('Settings', { type: 'open_panel', panel: 'settings' }),
      button('How to Play', { type: 'open_panel', panel: 'how_to_play' }),
      button('Save and quit to the lobby', { type: 'quit_to_lobby' }),
    ],
  };
}

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
          control('Steer', 'steerPort', 'steerStarboard'),
          control('Power stroke (costs energy)', 'powerStroke'),
          control('Bail (hold)', 'bail'),
          control('Lantern, sail', 'lantern', 'sail'),
          control('Land or use what is alongside', 'interact'),
        ],
      },
      {
        heading: 'On foot',
        lines: ['Walking follows the camera. Stand by the canoe and interact to board.'],
        controls: [
          control('Walk', 'moveForward', 'moveBack', 'moveLeft', 'moveRight'),
          control('Run (costs energy)', 'run'),
          control('Interact; hold to scavenge', 'interact'),
          control('Tools 1 to 5', 'tool1', 'tool2', 'tool3', 'tool4', 'tool5'),
        ],
      },
      {
        heading: 'Panels and camera',
        lines: ['Drag with the mouse to look around, wheel to zoom. Full panels pause the game.'],
        controls: [
          control('Inventory', 'inventory'),
          control('Crafting', 'craft'),
          control('Canoe builder (canoe beached)', 'canoeBuilder'),
          control('Quest log', 'questLog'),
          control('Map', 'map'),
          control('Pause, or close a panel', 'pause'),
        ],
      },
      {
        heading: 'Staying alive',
        lines: [
          'Hunger and thirst fall slowly; hard paddling and running speed them up. Eat and drink from the inventory. Boil water at a fire first.',
          'Energy comes back when you rest. Sleep at a camp after 19:00 to refill it and skip the night.',
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

const CONFIRM_TEXT: Record<ConfirmAction['type'], (slot: number) => { title: string; message: string; accept: string }> = {
  delete_save: (slot) => ({ title: 'Delete this save?', message: `Slot ${slot + 1} will be gone for good.`, accept: 'Delete' }),
  overwrite_save: (slot) => ({
    title: 'Start over in this slot?', message: `Slot ${slot + 1} already holds a game. A new game replaces it.`, accept: 'Start new game',
  }),
  quit_to_lobby: () => ({ title: 'Quit to the lobby?', message: 'The game is saved first.', accept: 'Save and quit' }),
  reset_key_bindings: () => ({ title: 'Reset every key?', message: 'All key bindings go back to their defaults.', accept: 'Reset keys' }),
};

export function buildConfirmModel(action: ConfirmAction): ConfirmModel {
  const text = CONFIRM_TEXT[action.type]('slot' in action ? action.slot : 0);
  return {
    title: text.title,
    message: text.message,
    accept: button(text.accept, { type: 'answer_confirm', accepted: true }),
    cancel: button('Cancel', { type: 'answer_confirm', accepted: false }),
  };
}

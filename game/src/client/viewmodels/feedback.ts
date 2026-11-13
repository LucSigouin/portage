/**
 * The Feedback panel in words: the menu entry, the three kinds, what the
 * panel says is sent, and a plain sentence for every way a send can end.
 *
 * The list under "Sent with it" is built from the same rows the note
 * carries (`FeedbackDesk.body`): what the panel says and what goes over the
 * line cannot drift apart, and a test holds the two together.
 */
import { HULL_TIERS, ISLANDS_BY_ID, REGIONS_BY_ID } from '../../data/index.ts';
import { FEEDBACK_KINDS, FEEDBACK_LINE_LENGTH, FEEDBACK_NAME_LENGTH, FEEDBACK_NOTE_LENGTH } from '../../net/feedback.ts';
import type { FeedbackKind } from '../../net/feedback.ts';
import type { Settings } from '../../settings/index.ts';
import { playerOf, selectActiveQuests } from '../../sim/index.ts';
import type { GameState, PlayerId } from '../../sim/index.ts';
import type { FeedbackContextRow, FeedbackView } from '../feedback.ts';
import { capitalise, durationText } from './format.ts';
import type { ButtonModel, Tone } from './types.ts';

/** One of the three kinds: a button that is drawn pressed when it is the one picked. */
export interface FeedbackKindModel {
  kind: FeedbackKind;
  picked: boolean;
  button: ButtonModel;
}

/** One line of "Sent with it". `part` says which part of the note it stands for. */
export interface FeedbackSentRow {
  part: string;
  label: string;
  value: string;
}

/** The Feedback panel, without its title and its way out. */
export interface FeedbackPanelBody {
  id: 'feedback';
  /** False in a game built without a relay: the panel is the status line and nothing to type in. */
  on: boolean;
  kinds: FeedbackKindModel[];
  note: { label: string; value: string; maxLength: number; placeholder: string; countText: string; enabled: boolean };
  name: { label: string; value: string; maxLength: number; placeholder: string; enabled: boolean };
  status: string;
  statusTone: Tone;
  sentHeading: string;
  sent: FeedbackSentRow[];
  /** What is not sent, in one sentence. */
  notSent: string;
  send: ButtonModel;
}

export const FEEDBACK_KIND_LABEL: Readonly<Record<FeedbackKind, string>> = { bug: 'Bug', idea: 'Idea', other: 'Other' };

export const FEEDBACK_TEXT = {
  off: 'Feedback is off here. This copy of the game has no relay to carry a note.',
  sending: 'Sending…',
  sent: 'Sent. Thank you.',
  failed: 'Could not send. Your note is still in the box, and kept in this browser. Try again in a minute.',
  notSent: 'Nothing else. No save, no crew code, and no address is kept with it.',
} as const;

/** The entry of the lobby and of the pause menu. It is there in every build: a build with no relay says so in the panel. */
export const buildFeedbackButton = (): ButtonModel => ({
  label: 'Feedback', intent: { type: 'open_panel', panel: 'feedback' }, enabled: true, note: 'A bug, an idea, anything',
});

/** A menu with the Feedback entry in it, just above its last line (Credits in the lobby, quitting on the pause card). */
export const withFeedbackEntry = (buttons: ButtonModel[]): ButtonModel[] => [...buttons.slice(0, -1), buildFeedbackButton(), ...buttons.slice(-1)];

const row = (key: FeedbackContextRow['key'], label: string, value: string): FeedbackContextRow => ({
  key, label, value: value.slice(0, FEEDBACK_LINE_LENGTH),
});

/**
 * Where the player is, as the lines a note carries. In a game: the tracked
 * quest, the island, the hull, the time played, the crew size and the
 * quality level. In the lobby: that, and the quality level. Nothing else of
 * the game is read here.
 */
export function buildFeedbackContext(game: GameState | null, settings: Settings, playerId: PlayerId = 0): FeedbackContextRow[] {
  const quality = row('quality', 'Quality', capitalise(settings.graphics.qualityPreset));
  if (!game) return [row('where', 'Where you are', 'The lobby, no game open'), quality];
  const player = playerOf(game, playerId);
  // `selectActiveQuests` puts the tracked quest first, as the HUD's tracker does.
  const quest = selectActiveQuests(game)[0];
  const island = player.mode === 'foot' && player.islandId ? ISLANDS_BY_ID[player.islandId].name : `On the water, ${REGIONS_BY_ID[player.regionId].name}`;
  const crew = game.players.length;
  return [
    row('quest', 'Tracked quest', quest ? quest.name : 'None'),
    row('island', 'Island', island),
    row('hull', 'Hull', HULL_TIERS[game.canoe.hullTier]?.name ?? `Tier ${game.canoe.hullTier}`),
    row('played', 'Time played', durationText(game.playedSeconds)),
    row('crew', 'Crew', crew === 1 ? 'Alone' : `${crew} players`),
    quality,
  ];
}

const count = (length: number): string => `${length.toLocaleString('en-CA')} / ${FEEDBACK_NOTE_LENGTH.toLocaleString('en-CA')}`;

export function buildFeedbackPanel(view: FeedbackView): FeedbackPanelBody {
  const busy = view.phase === 'sending';
  const editable = view.on && !busy;
  const hasNote = view.note.trim() !== '';
  const status = !view.on ? FEEDBACK_TEXT.off : view.phase === 'writing' ? '' : FEEDBACK_TEXT[view.phase];
  const statusTone: Tone = !view.on ? 'warning' : view.phase === 'sent' ? 'good' : view.phase === 'failed' ? 'danger' : 'info';
  return {
    id: 'feedback',
    on: view.on,
    kinds: FEEDBACK_KINDS.map((kind) => ({
      kind, picked: kind === view.kind,
      button: { label: FEEDBACK_KIND_LABEL[kind], intent: { type: 'feedback_kind', kind }, enabled: editable, note: null },
    })),
    note: {
      label: 'Your note', value: view.note, maxLength: FEEDBACK_NOTE_LENGTH, enabled: editable, countText: count(view.note.length),
      placeholder: 'What happened, or what you would like. Where you were helps.',
    },
    name: { label: 'Your name', value: view.name, maxLength: FEEDBACK_NAME_LENGTH, placeholder: 'If you like', enabled: editable },
    status,
    statusTone,
    sentHeading: 'Sent with it',
    sent: [
      { part: 'note', label: 'The note', value: `the ${FEEDBACK_KIND_LABEL[view.kind].toLowerCase()} written above` },
      { part: 'name', label: 'Your name', value: view.name.trim() === '' ? 'not given' : view.name.trim() },
      { part: 'version', label: 'Version', value: view.version },
      ...view.context.map((line) => ({ part: line.key, label: line.label, value: line.value })),
    ],
    notSent: FEEDBACK_TEXT.notSent,
    send: {
      label: view.phase === 'failed' ? 'Send again' : 'Send', intent: { type: 'feedback_send' },
      enabled: editable && hasNote, note: editable && !hasNote && view.phase !== 'sent' ? 'Write a note first' : null,
    },
  };
}

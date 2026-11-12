/**
 * The crew lobby in words: the two lobby entries, the host's room card and
 * the join card. Every state of the line has a plain sentence here, and
 * nowhere else.
 */
import type { SlotSummary } from '../../save/index.ts';
import { MAXIMUM_NAME_LENGTH } from '../../sim/index.ts';
import type { LeaveReason } from '../../net/index.ts';
import type { RelayFailure } from '../../net/relay.ts';
import type { CrewView, JoinProblem } from '../crewlobby.ts';
import type { InterfaceIntent } from '../intents.ts';
import type { ButtonModel, PanelModel, TextFieldModel, Tone } from './types.ts';

type PanelBody<Id extends PanelModel['id']> = Omit<Extract<PanelModel, { id: Id }>, 'title' | 'close'>;

const button = (label: string, intent: InterfaceIntent, enabled = true, note: string | null = null): ButtonModel => ({
  label, intent, enabled, note,
});

/** Why the host let a guest go, in words. */
export const LEAVE_TEXT: Readonly<Record<LeaveReason, string>> = {
  full: 'That crew is full.',
  version: 'The host runs another version of the game. Reload the page.',
  replaced: 'You joined this game from another window.',
  closed: 'The host closed the game.',
};

/** Why a guest's line to the crew is closed, in words. */
export const JOIN_PROBLEM_TEXT: Readonly<Record<JoinProblem, string>> = {
  unreachable: 'The relay cannot be reached. Check your connection and try again.',
  'no-room': 'No crew with that code. Check it with whoever sent it.',
  full: 'That crew is full.',
  taken: 'No crew with that code. Check it with whoever sent it.',
  'host-left': 'The host left.',
  idle: 'That room sat empty too long and was closed.',
  refused: 'The crew let this window go.',
  'bad-code': 'That is not a crew code. A code is six letters and digits, like FHJ-K3M.',
  'no-name': 'Type a name first.',
};

/** Why a host's room is closed, in words. */
export const HOST_PROBLEM_TEXT: Readonly<Record<RelayFailure, string>> = {
  unreachable: 'The relay cannot be reached. Check your connection and try again.',
  'no-room': 'The relay lost the room. Open it again.',
  full: 'The relay is full. Try again in a minute.',
  taken: 'The relay had no free code. Try again.',
  'host-left': 'The room was closed from another window.',
  idle: 'The room sat empty for half an hour and was closed. Open a new one.',
  refused: 'The relay closed the room. Open a new one.',
};

/** A room code as it is shown and read aloud: "FHJ-K3M". */
export const roomCodeText = (code: string): string => `${code.slice(0, 3)}-${code.slice(3)}`;

/** The two crew entries of the lobby menu. */
export function buildCrewLobbyButtons(crew: CrewView): ButtonModel[] {
  const host = crew.host;
  const hostNote = host.phase === 'open' || host.phase === 'reconnecting' ? `Room ${roomCodeText(host.code)} is open`
    : host.phase === 'connecting' ? 'Opening a room…' : 'Friends join by a link';
  const joining = crew.join.phase === 'connecting' || crew.join.phase === 'waiting' || crew.join.phase === 'reconnecting';
  return [
    button('Host a crew', { type: 'open_panel', panel: 'crew_host' }, true, hostNote),
    button('Join a crew', { type: 'open_panel', panel: 'crew_join' }, true, joining ? 'Waiting for the host…' : 'With a code from a friend'),
  ];
}

/** The crew entry of the pause menu, or null for a guest: a guest has no room to show. */
export function buildCrewPauseButton(crew: CrewView): ButtonModel | null {
  if (crew.join.phase !== 'idle' && crew.join.phase !== 'failed') return null;
  const open = crew.host.phase === 'open' || crew.host.phase === 'reconnecting';
  return button(open ? 'Crew room' : 'Host a crew', { type: 'open_panel', panel: 'crew_host' }, true,
    open ? `${roomCodeText(crew.host.code)}: the code and the invite link` : null);
}

const nameField = (crew: CrewView, enabled: boolean): TextFieldModel => ({
  field: 'name', label: 'Your name', value: crew.name, maxLength: MAXIMUM_NAME_LENGTH, placeholder: 'Twelve letters at most', enabled,
});

const friendsText = (count: number): string =>
  (count === 0 ? 'The room is open. Nobody has come in yet.' : count === 1 ? 'One friend is in the room.' : `${count} friends are in the room.`);

export function buildCrewHostPanel(crew: CrewView, summaries: readonly SlotSummary[], latestSlot: number | null): PanelBody<'crew_host'> {
  const host = crew.host;
  const hasRoom = host.phase === 'open' || host.phase === 'reconnecting';
  const latest = summaries.find((summary) => summary.slot === latestSlot);
  let status = '';
  let statusTone: Tone = 'info';
  let lines: string[] = [];
  let actions: ButtonModel[] = [];
  switch (host.phase) {
    case 'idle':
      lines = [
        'Open a room and send your friends the link. Up to four share the canoe.',
        'The game runs in this window. Keep it open while they play.',
      ];
      actions = [button('Open a room', { type: 'crew_open_room' })];
      break;
    case 'connecting':
      status = 'Connecting to the relay…';
      break;
    case 'open':
      status = friendsText(host.guests);
      statusTone = host.guests > 0 ? 'good' : 'info';
      break;
    case 'reconnecting':
      status = 'The line to the relay dropped. Trying again…';
      statusTone = 'warning';
      break;
    case 'failed':
      status = HOST_PROBLEM_TEXT[host.failure ?? 'unreachable'];
      statusTone = 'danger';
      actions = [button('Try again', { type: 'crew_open_room' })];
      break;
  }
  if (hasRoom && !crew.inGame) {
    lines = ['Send the link, then start your game. Friends board the moment it starts.'];
    actions = [
      button('Continue', { type: 'continue_game' }, latest !== undefined, latest ? `Slot ${latest.slot + 1}, day ${latest.day}` : 'No saved game yet'),
      button('New Game', { type: 'open_panel', panel: 'save_slots' }),
    ];
  } else if (hasRoom) {
    lines = ['Send the link. A friend who opens it boards your canoe.'];
  }
  return {
    id: 'crew_host',
    phase: host.phase,
    name: nameField(crew, host.phase === 'idle' || host.phase === 'failed'),
    status,
    statusTone,
    room: hasRoom ? {
      code: roomCodeText(host.code),
      link: host.link,
      copy: button(host.copied ? 'Copied' : 'Copy link', { type: 'crew_copied' }, true, host.copied ? 'Paste it to your friends' : null),
    } : null,
    lines,
    actions,
    stop: hasRoom ? button('Stop hosting', { type: 'crew_stop_hosting' })
      : host.phase === 'connecting' ? button('Cancel', { type: 'crew_stop_hosting' }) : null,
  };
}

export function buildCrewJoinPanel(crew: CrewView): PanelBody<'crew_join'> {
  const join = crew.join;
  const busy = join.phase === 'connecting' || join.phase === 'waiting' || join.phase === 'reconnecting' || join.phase === 'playing';
  const hosting = crew.host.phase !== 'idle' && crew.host.phase !== 'failed';
  let status = '';
  let statusTone: Tone = 'info';
  switch (join.phase) {
    case 'connecting':
      status = 'Connecting to the relay…';
      break;
    case 'waiting':
      status = join.hostHere ? 'Found the crew. Waiting for the host to start the game…' : 'Found the room. The host is not there right now. Waiting…';
      statusTone = join.hostHere ? 'good' : 'warning';
      break;
    case 'reconnecting':
      status = 'The line dropped. Trying again…';
      statusTone = 'warning';
      break;
    case 'playing':
      status = 'You are aboard.';
      statusTone = 'good';
      break;
    case 'failed':
      status = join.problem !== null ? JOIN_PROBLEM_TEXT[join.problem] : LEAVE_TEXT[join.leave ?? 'closed'];
      statusTone = join.problem === 'no-name' || join.problem === 'bad-code' ? 'warning' : 'danger';
      break;
    case 'idle':
      break;
  }
  return {
    id: 'crew_join',
    code: { field: 'code', label: 'Crew code', value: crew.code, maxLength: 9, placeholder: 'FHJ-K3M', enabled: !busy },
    name: nameField(crew, !busy),
    status,
    statusTone,
    lines: ['Type the code a friend sent you, or open their link. You board their canoe with your own pack and your own meters.'],
    join: button('Join', { type: 'crew_join' }, !busy && !hosting, hosting ? 'Stop hosting first' : null),
    cancel: busy ? button('Cancel', { type: 'crew_cancel_join' }) : null,
  };
}

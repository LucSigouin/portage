/**
 * The pick screen: who you are, one of four (Luc: "a character select screen for when you start a new game or if
 * you join a friend lobby. 4 totally different characters").
 *
 * It opens from two doors and no others: a new game (after its slot, and after the confirm when the slot holds a
 * game) and a join (after the name and the code). Nothing is started, saved or sent until the player presses its
 * one button. Back returns to the door, with whatever was typed there still there.
 *
 * This file is the screen in words and the little it has to decide. No DOM in here: `interface/cast.ts` is the
 * markup, `interface/cast-host.ts` lays the pictures in, and the session (`client/session.ts`) owns the doors.
 */
import { CAST, CHARACTER_IDS, isCharacterId } from '../../data/index.ts';
import type { CharacterId } from '../../data/index.ts';
import type { CrewView } from '../crewlobby.ts';
import type { InterfaceIntent } from '../intents.ts';
import type { ButtonModel } from './types.ts';

/** The door the screen was opened from: a new game in a slot, or a friend's crew. */
export type CastDoor = { kind: 'new_game'; slot: number } | { kind: 'join' };

/** The screen as the session holds it while it is open. */
export interface CastView {
  door: CastDoor;
  /** The card marked right now. */
  marked: CharacterId;
}

export interface CastCardModel {
  character: CharacterId;
  name: string;
  line: string;
  /** The big letter that stands in the picture's frame until there is a picture, and for good when there is none. */
  initial: string;
  marked: boolean;
  /** A click on the card marks it. */
  intent: InterfaceIntent;
}

/** The panel, without the title and the way out every panel has. */
export interface CastPanelBody {
  id: 'character_select';
  door: CastDoor['kind'];
  /** Where the pick leads, beside the title: the slot, or the crew and the name. */
  subtitle: string;
  /** What the four choices are, for someone who cannot see them. */
  groupLabel: string;
  /** The four cards, in the order of `CHARACTER_IDS`. */
  cards: CastCardModel[];
  /** One line under the cards. */
  note: string;
  /** The one button that starts or joins. It names the pick. */
  start: ButtonModel;
  /** The seat whose colour the pictures wear (`CastSketchRequest.seat`). */
  seat: number;
}

/** Where the last pick is kept in this browser, as the crew lobby keeps the name. */
export const CAST_PICK_SLOT = 'portage.cast.pick';

/** The seat a new game's player has. A guest's is not known before the host answers, and is asked for as this one. */
export const CAST_PICTURE_SEAT = 0;

/** Under the cards: what the pick is, and is not. */
export const CAST_NOTE = 'Only the look changes. Everyone paddles, carries and builds the same.';

interface PickStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The pick kept from last time, or the first of the cast: nothing kept, something else kept, or a browser that keeps nothing. */
export function keptCharacter(storage: PickStorage): CharacterId {
  try {
    const kept = storage.getItem(CAST_PICK_SLOT);
    return isCharacterId(kept) ? kept : CHARACTER_IDS[0];
  } catch {
    return CHARACTER_IDS[0];
  }
}

/** Keep the pick for next time. A browser that refuses the write is left alone: the first card is marked next time. */
export function keepCharacter(storage: PickStorage, character: CharacterId): void {
  try {
    storage.setItem(CAST_PICK_SLOT, character);
  } catch {
    // Nothing to do: the pick still goes on the player.
  }
}

/**
 * The card one to the left (`step` -1) or right (+1) of the marked one, round the ends: Left on the first is the last.
 */
export function neighbourCharacter(marked: CharacterId, step: -1 | 1): CharacterId {
  const count = CHARACTER_IDS.length;
  return CHARACTER_IDS[(CHARACTER_IDS.indexOf(marked) + step + count) % count]!;
}

/** "Start as The Trapper", "Join as The Trapper". */
export const castStartLabel = (door: CastDoor['kind'], character: CharacterId): string =>
  `${door === 'join' ? 'Join' : 'Start'} as ${CAST[character].name}`;

function subtitle(door: CastDoor, crew: CrewView | null): string {
  if (door.kind === 'new_game') return `A new game in slot ${door.slot + 1}`;
  const name = crew?.name.trim() ?? '';
  const code = crew?.code.trim() ?? '';
  return name !== '' && code !== '' ? `Joining crew ${code} as ${name}` : 'Joining a crew';
}

/** `crew` is the crew lobby's state, for the join door's words. */
export function buildCastPanel(cast: CastView, crew: CrewView | null = null): CastPanelBody {
  return {
    id: 'character_select',
    door: cast.door.kind,
    subtitle: subtitle(cast.door, crew),
    groupLabel: 'Who you are',
    cards: CHARACTER_IDS.map((character) => ({
      character,
      name: CAST[character].name,
      line: CAST[character].line,
      initial: CAST[character].name.replace(/^The\s+/, '').charAt(0),
      marked: character === cast.marked,
      intent: { type: 'cast_mark', character },
    })),
    note: CAST_NOTE,
    start: { label: castStartLabel(cast.door.kind, cast.marked), intent: { type: 'cast_confirm' }, enabled: true, note: null },
    seat: CAST_PICTURE_SEAT,
  };
}

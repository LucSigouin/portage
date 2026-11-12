/**
 * The top bar: the rooms of the workshop and the tools that already exist. A new room is one more row of
 * `ROOMS`; a new tool is one more row of `TOOLS`. The staged game screens come from the game's own list.
 */
import { SHOT_NAMES } from '../client/debug/parameters.ts';

export interface Room {
  id: string;
  label: string;
  href: string;
  note: string;
}

/**
 * A published copy of the workshop is built with VITE_PORTAGE_GAME set to where the live game is
 * (deploy/deploy-assets.sh passes '/portage/'). It stands alone: this page is its folder's front page, the
 * tools only the dev server has are left off, and the game screens open in the live game.
 */
const LIVE_GAME: string | undefined = import.meta.env.VITE_PORTAGE_GAME;
const GAME = LIVE_GAME ?? '/';

/** The rooms of the workshop. This page is the first. */
export const ROOMS: Room[] = [{ id: 'assets', label: 'Assets', href: LIVE_GAME === undefined ? '/viewer.html' : './', note: 'Every drawn thing in the game, alone' }];

/** The room this page is. */
export const THIS_ROOM = 'assets';

export interface Tool {
  label: string;
  href: string;
  note: string;
}

export const TOOLS: Tool[] = LIVE_GAME !== undefined ? [] : [
  { label: 'Sound lab', href: '/audio-lab.html', note: 'Hear every sound the game makes' },
  { label: 'Performance', href: '/?perf=1', note: 'The game with its frame-time readout' },
];

/** The game's staged screens (`?shot=<name>` on the game's address). */
export const SCREENS: Tool[] = SHOT_NAMES.map((name) => ({ label: name, href: `${GAME}?shot=${name}`, note: `The game staged at its ${name} screen` }));

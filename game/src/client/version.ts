/**
 * The version a player can read out to a friend: "1.0.185 · 931d4b0". The release, then the number of commits
 * the build was made from, then the commit itself. Set when the game is built (`vite.config.ts`).
 */

declare const __PORTAGE_VERSION__: string | undefined;

/** 'unknown' when the game was built without git, or runs with no build step at all. */
export const GAME_VERSION: string = typeof __PORTAGE_VERSION__ === 'string' && __PORTAGE_VERSION__ !== '' ? __PORTAGE_VERSION__ : 'unknown';

/** The words the Settings panel shows under its title. */
export function versionLine(version: string = GAME_VERSION): string {
  return `Version ${version}`;
}

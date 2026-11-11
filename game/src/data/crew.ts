/**
 * How each crew member is told apart, by player id. The look dresses them in these colours and the
 * HUD marks them with the same toque colour, so "the one in the blue coat" is the same person on
 * every screen. The labels are placeholders until players can type their own names.
 */
export interface CrewMark {
  label: string;
  coat: string;
  toque: string;
  legs: string;
}

export const CREW_MARKS: readonly CrewMark[] = [
  { label: 'Player 1', coat: '#d5a542', toque: '#a9483a', legs: '#57697b' },
  { label: 'Player 2', coat: '#55778f', toque: '#d5a542', legs: '#5d4b42' },
  { label: 'Player 3', coat: '#6d866b', toque: '#efe6cf', legs: '#4b4d57' },
  { label: 'Player 4', coat: '#cd7c5d', toque: '#6b8396', legs: '#57697b' },
];

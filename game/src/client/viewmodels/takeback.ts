/**
 * The note of a dropped stack offers to take it back (the master review of round 3, finding 2).
 *
 * The note "-9 Driftwood" carries one action: a button, and one key for the newest such note. Both send the same
 * `take_back` command, which names the drop by its number and nothing else: the rules decide (`sim/takeback.ts`).
 * The key is fixed, like the drop key: Z, the letter of "undo" on every keyboard.
 */
import type { ToastActionModel } from './types.ts';

/** The key that takes back the newest drop while its note stands. */
export const TAKE_BACK_KEY_CODE = 'KeyZ';
export const TAKE_BACK_LABEL = 'Take back';

/** The action on the note of drop `dropId`. `withKey`: this is the newest such note, so the key is its own. */
export function takeBackAction(dropId: number, withKey: boolean): ToastActionModel {
  return {
    label: TAKE_BACK_LABEL,
    keyCode: withKey ? TAKE_BACK_KEY_CODE : null,
    keyLabel: withKey ? 'Z' : '',
    intent: { type: 'command', command: { type: 'take_back', drop: dropId } },
  };
}

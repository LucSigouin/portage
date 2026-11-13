/**
 * A note that offers something: the button on the note of a dropped stack, and its key (finding 2 of the master
 * review of round 3). Pure, like `views.ts`: the words, the key and the intent all come from the model.
 *
 * The button stands on the note from the moment the note is written until it goes. Nothing about it moves.
 */
import './takeback.css';
import type { InterfaceIntent, ToastModel } from '../client/contracts.ts';
import { control, h } from './dom.ts';
import type { ViewNode } from './dom.ts';

type ToastAction = NonNullable<ToastModel['action']>;

/** The button of a note's offer: a key cap when the note has the key, and the words. Out of the Tab order: Tab is the game's. */
export function toastActionView(action: ToastAction): ViewNode {
  return control(h('button.iw-toast-act', {
    type: 'button', tabindex: -1, 'aria-label': action.keyLabel ? `${action.label} (${action.keyLabel})` : action.label,
  },
  action.keyLabel ? h('kbd.iw-toast-key', null, action.keyLabel) : null,
  h('span', null, action.label)), action.intent);
}

/** What a key press sends when a note on the screen offers that key, or null: the key is somebody else's. */
export function toastKeyIntent(toasts: readonly ToastModel[], keyCode: string): InterfaceIntent | null {
  for (let index = toasts.length - 1; index >= 0; index -= 1) {
    const action = toasts[index]!.action;
    if (action && action.keyCode === keyCode) return action.intent;
  }
  return null;
}

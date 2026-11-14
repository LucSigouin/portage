/** The full screen line of the lobby menu and the pause card (`client/fullscreen.ts`). */
import type { FullscreenView } from '../fullscreen.ts';
import type { ButtonModel } from './types.ts';

export const FULLSCREEN_LABEL = 'Full screen';
export const LEAVE_FULLSCREEN_LABEL = 'Leave full screen';

export const buildFullscreenButton = (view: FullscreenView): ButtonModel => ({
  label: view.active ? LEAVE_FULLSCREEN_LABEL : FULLSCREEN_LABEL, intent: { type: 'toggle_fullscreen' }, enabled: true, note: null,
});

/** A menu with the full screen line just under Settings. Without the API (`view` null) the menu is as it was. */
export function withFullscreenEntry(buttons: ButtonModel[], view: FullscreenView | null | undefined): ButtonModel[] {
  if (!view) return buttons;
  const settings = buttons.findIndex((entry) => entry.intent.type === 'open_panel' && entry.intent.panel === 'settings');
  const at = settings < 0 ? buttons.length : settings + 1;
  return [...buttons.slice(0, at), buildFullscreenButton(view), ...buttons.slice(at)];
}

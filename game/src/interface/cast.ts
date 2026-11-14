/**
 * The pick screen: four cards side by side, one of them marked, one button that starts or joins as the marked
 * one, and Back. Drawn on the lobby's paper, and nothing on it moves.
 *
 * The views are pure (`dom.ts`): every word comes from the model (`client/viewmodels/cast.ts`). The pictures are
 * not in the model. Each card leaves a frame for one, with a big letter standing in it, and `cast-host.ts` lays
 * the picture in when there is one. The frame is the same size either way, so a picture arriving moves nothing,
 * and a card with no picture is whole.
 *
 * The helpers at the end are the screen's keys. `interface.ts` calls them:
 * - Left and Right move the mark (round the ends), and the keyboard goes to the marked card.
 * - Enter presses the screen's one button. On Back it presses Back, and on a card that is not the marked one it
 *   marks that card: a second Enter starts.
 * - Tab walks card, card, card, card, button, Back. Esc is the session's, as on every panel: it goes back.
 */
import './cast.css';
import type { ButtonModel, InterfaceIntent, PanelModel } from '../client/contracts.ts';
import { control, h } from './dom.ts';
import type { ViewNode } from './dom.ts';
import { ICON } from './icons.ts';

type CastPanel = Extract<PanelModel, { id: 'character_select' }>;
type CastCard = CastPanel['cards'][number];

const buttonView = (button: ButtonModel, selector: string, key: string, more: Record<string, string> = {}): ViewNode =>
  control(h(selector, { key, type: 'button', disabled: !button.enabled, ...more }, h('span.iw-label', null, button.label)), button.intent);

/**
 * One of the four. A choice in a group of four: a screen reader hears its name, its line, and whether it is the
 * one marked. The marked card is told by more than colour: a full ink frame, and the tick at its corner.
 */
function cardView(card: CastCard): ViewNode {
  return control(h('button.cs-card', {
    key: card.character, type: 'button', role: 'radio', 'aria-checked': card.marked ? 'true' : 'false',
    'data-character': card.character, class: card.marked ? 'cs-marked' : '',
  },
  // The picture's frame. The letter stands in it; the picture, when there is one, is laid in the slot over it.
  h('span.cs-frame', { key: 'frame' },
    h('span.cs-initial', { key: 'initial', 'aria-hidden': 'true' }, card.initial),
    h('span.cs-slot', { key: 'slot', 'aria-hidden': 'true' })),
  // Always there, so marking a card changes no size: shown on the marked card only.
  h('i.iw-i.cs-tick', { key: 'tick', html: ICON.check, 'aria-hidden': 'true' }),
  h('b.cs-name', { key: 'name' }, card.name),
  h('span.cs-line', { key: 'line' }, card.line)), card.intent);
}

export function castView(panel: CastPanel): ViewNode[] {
  return [h('section.iw-panel.iw-paper.cs', { key: panel.id, class: `iw-panel-${panel.id} cs-door-${panel.door}`, role: 'dialog', 'aria-label': panel.title },
    h('i.iw-tape.iw-a'),
    h('i.iw-tape.iw-b'),
    h('header', { key: 'header' }, h('h2', null, panel.title), h('span.iw-sub', null, panel.subtitle)),
    h('div.cs-cards', { key: 'cards', role: 'radiogroup', 'aria-label': panel.groupLabel }, panel.cards.map(cardView)),
    h('p.cs-note', { key: 'note' }, panel.note),
    // In the order the keyboard walks them: the button that starts, then Back.
    h('footer.cs-foot', { key: 'footer' },
      buttonView(panel.start, 'button.iw-btn.iw-go.cs-start', 'start', { 'data-primary': '' }),
      buttonView(panel.close, 'button.iw-btn.cs-back', 'back')))];
}

// --- The keys ------------------------------------------------------------------------

/** Where the keyboard is on the screen: on one of the cards, on one of the two buttons, or on nothing. */
export type CastFocus = { on: 'card'; character: string } | { on: 'button' } | null;

/** What a key does on the screen: mark a card, press the one button, or nothing the screen decides. */
export type CastKeyAction = { type: 'mark'; intent: InterfaceIntent; character: string } | { type: 'press' } | { type: 'none' };

/**
 * Pure: the screen's answer to a key. Null when the key is not the screen's (Tab, Esc, Up and Down, letters).
 * A key held down does nothing: one press, one step, and a held Enter cannot start a game by itself.
 */
export function castKeyAction(panel: CastPanel, code: string, focus: CastFocus, repeat = false): CastKeyAction | null {
  if (code === 'ArrowLeft' || code === 'ArrowRight') {
    if (repeat) return { type: 'none' };
    const cards = panel.cards;
    const from = Math.max(0, cards.findIndex((card) => card.marked));
    const to = cards[(from + (code === 'ArrowLeft' ? -1 : 1) + cards.length) % cards.length]!;
    return { type: 'mark', intent: to.intent, character: to.character };
  }
  if (code === 'Enter' || code === 'NumpadEnter') {
    // On Back, or on the button itself: the press is that button's own.
    if (focus?.on === 'button') return null;
    // On a card that is not the marked one: the press marks it, as a click does.
    if (focus?.on === 'card' && !panel.cards.some((card) => card.marked && card.character === focus.character)) return null;
    return repeat ? { type: 'none' } : { type: 'press' };
  }
  return null;
}

/**
 * A key was pressed while the pick screen has the keyboard. True when the screen took it: the caller then lets
 * nothing else act on it.
 */
export function castKeyDown(surface: HTMLElement, panel: CastPanel, event: KeyboardEvent, emit: (intent: InterfaceIntent) => void): boolean {
  const target = event.target instanceof Element && surface.contains(event.target) ? event.target.closest('button') : null;
  const character = target?.dataset.character;
  const focus: CastFocus = !target ? null : character !== undefined ? { on: 'card', character } : { on: 'button' };
  const action = castKeyAction(panel, event.code, focus, event.repeat);
  if (!action) return false;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (action.type === 'mark') {
    emit(action.intent);
    surface.querySelector<HTMLElement>(`.cs-card[data-character="${action.character}"]`)?.focus();
  } else if (action.type === 'press') {
    surface.querySelector<HTMLButtonElement>('button[data-primary]:not([disabled])')?.click();
  }
  return true;
}

/** The screen just opened for a player steering by key: the keyboard starts on the marked card. */
export function focusMarkedCard(surface: HTMLElement | null): void {
  surface?.querySelector<HTMLElement>('.cs-card.cs-marked')?.focus();
}

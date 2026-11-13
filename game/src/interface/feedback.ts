/**
 * The Feedback card: three kinds to pick from, a box to write in, a line for
 * a name, the list of what is sent, and Send. Drawn on the same paper as the
 * crew cards, and like them nothing on it moves.
 *
 * A note is only ever text here. The views below are plain data (`dom.ts`),
 * and what a player typed goes into the page as a field's value or as a text
 * node, never as markup.
 *
 * The two helpers at the end are the only things this card needs from the
 * browser: which control was typed in, and where the caret goes when the
 * card opens. `interface.ts` calls them.
 */
import './feedback.css';
import type { ButtonModel, InterfaceIntent, PanelModel } from '../client/contracts.ts';
import { control, h } from './dom.ts';
import type { ViewNode } from './dom.ts';
import { ICON } from './icons.ts';

type FeedbackPanel = Extract<PanelModel, { id: 'feedback' }>;

const buttonView = (button: ButtonModel, selector: string, key: string, more: Record<string, string | boolean> = {}): ViewNode =>
  control(h(selector, { key, type: 'button', disabled: !button.enabled, ...more },
    h('span.iw-label', null, button.label),
    button.note ? h('small.iw-note', null, button.note) : null), button.intent);

function formView(panel: FeedbackPanel): ViewNode[] {
  return [
    h('div.iw-fb-kinds', { key: 'kinds', role: 'group', 'aria-label': 'Kind of note' },
      panel.kinds.map((kind) => buttonView(kind.button, 'button.iw-btn.iw-small.iw-fb-kind', kind.kind, {
        class: kind.picked ? 'iw-on' : '', 'aria-pressed': kind.picked ? 'true' : 'false', 'data-kind': kind.kind,
      }))),
    h('div.iw-fb-note', { key: 'note' },
      h('div.iw-fb-top', null,
        h('label.iw-l', { for: 'iw-feedback-note' }, panel.note.label),
        h('span.iw-fb-count', { 'data-feedback-count': '' }, panel.note.countText)),
      h('textarea.iw-text.iw-fb-box', {
        id: 'iw-feedback-note', 'data-feedback': 'note', value: panel.note.value, maxlength: panel.note.maxLength, rows: 5,
        placeholder: panel.note.placeholder, disabled: !panel.note.enabled, autocomplete: 'off', spellcheck: 'true',
      })),
    h('div.iw-row.iw-field.iw-fb-name', { key: 'name' },
      h('label.iw-l', { for: 'iw-feedback-name' }, panel.name.label),
      h('input.iw-text', {
        type: 'text', id: 'iw-feedback-name', 'data-feedback': 'name', value: panel.name.value, maxlength: panel.name.maxLength,
        placeholder: panel.name.placeholder, disabled: !panel.name.enabled, autocomplete: 'off', spellcheck: 'false',
      })),
    h('div.iw-fb-sent', { key: 'sent' },
      h('h3.iw-fb-heading', null, panel.sentHeading),
      h('ul', null, panel.sent.map((row) => h('li', { key: row.part, 'data-part': row.part }, h('span.iw-fb-what', null, `${row.label}: `), row.value))),
      h('p.iw-fb-nothing', null, panel.notSent)),
  ];
}

/** The Feedback card. In a build with no relay it is the one line that says feedback is off, and a way out. */
export function feedbackView(panel: FeedbackPanel): ViewNode[] {
  // Always there, so the card keeps its height when the words come and go.
  const status = h('p.iw-crew-status.iw-fb-status', { key: 'status', role: 'status', class: `iw-tone-${panel.statusTone}`, 'data-feedback-status': '' }, panel.status);
  return [h('section.iw-panel.iw-paper.iw-mid.iw-panel-crew.iw-panel-feedback', { key: panel.id, role: 'dialog', 'aria-label': panel.title },
    h('i.iw-tape.iw-a'),
    h('header', null, h('h2', null, panel.title)),
    h('div.iw-body', { key: 'body' }, panel.on ? formView(panel) : null),
    h('div.iw-cut', { key: 'cut', hidden: true, 'aria-hidden': 'true' },
      h('span.iw-cut-words', null, h('i.iw-i', { html: ICON.caret, 'aria-hidden': 'true' }), 'more below', h('i.iw-i', { html: ICON.caret, 'aria-hidden': 'true' }))),
    h('footer', { key: 'footer', class: 'iw-fb-foot' },
      status,
      h('div.iw-actions', null,
        panel.on ? buttonView(panel.send, 'button.iw-btn.iw-go', 'send', { 'data-primary': '' }) : null,
        buttonView(panel.close, 'button.iw-btn', 'close'))))];
}

/**
 * What was typed on the Feedback card, as the intent that carries it, or null
 * when the event came from any other control.
 */
export function feedbackInputIntent(target: EventTarget | null): InterfaceIntent | null {
  if (!(target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement)) return null;
  const field = target.dataset.feedback;
  return field === 'note' || field === 'name' ? { type: 'feedback_field', field, value: target.value } : null;
}

/** The card just opened: the caret goes in the box, ready to write. */
export function focusFeedbackNote(surface: HTMLElement | null): void {
  surface?.querySelector<HTMLTextAreaElement>('textarea[data-feedback="note"]:not([disabled])')?.focus();
}

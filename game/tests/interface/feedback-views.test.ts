/**
 * The Feedback card as the Ink & Wash interface draws it, without a DOM: every word of the model is on the
 * card, every control sends the model's intent, the box and the name line are marked for the interface, and
 * what a player typed is only ever a field's value or text, never markup.
 */
import { describe, expect, it } from 'vitest';
import type { FeedbackView } from '../../src/client/feedback.ts';
import { buildFeedbackPanel } from '../../src/client/viewmodels/index.ts';
import type { PanelModel } from '../../src/client/viewmodels/index.ts';
import { collectIntents, collectText } from '../../src/interface/dom.ts';
import type { ViewNode } from '../../src/interface/dom.ts';
import { ICON } from '../../src/interface/icons.ts';
import { panelView } from '../../src/interface/views.ts';

const frame = { title: 'Feedback', close: { label: 'Close', intent: { type: 'close_panel' as const }, enabled: true, note: null } };
const NASTY = '<img src=x onerror=alert(1)> <script>alert(2)</script> "quoted" & more';

const view = (change: Partial<FeedbackView> = {}): FeedbackView => ({
  on: true, phase: 'writing', kind: 'bug', note: '', name: '', version: '1.0.212 · abc1234',
  context: [
    { key: 'quest', label: 'Tracked quest', value: 'A proper edge' }, { key: 'island', label: 'Island', value: 'Mill Island' },
    { key: 'hull', label: 'Hull', value: 'Patched hull' }, { key: 'played', label: 'Time played', value: '1 h 12 min' },
    { key: 'crew', label: 'Crew', value: '2 players' }, { key: 'quality', label: 'Quality', value: 'Medium' },
  ],
  ...change,
});
const card = (change: Partial<FeedbackView> = {}): { panel: Extract<PanelModel, { id: 'feedback' }>; nodes: ViewNode[] } => {
  const panel = { ...frame, ...buildFeedbackPanel(view(change)) };
  return { panel, nodes: panelView(panel) };
};

function find(nodes: ViewNode[], test: (node: ViewNode) => boolean, into: ViewNode[] = []): ViewNode[] {
  for (const node of nodes) {
    if (test(node)) into.push(node);
    find(node.children, test, into);
  }
  return into;
}
const one = (nodes: ViewNode[], test: (node: ViewNode) => boolean): ViewNode => {
  const found = find(nodes, test);
  if (found.length !== 1) throw new Error(`found ${found.length}, not one`);
  return found[0]!;
};
const hasClass = (name: string) => (node: ViewNode): boolean => node.classes.split(' ').includes(name);

describe('the Feedback card', () => {
  it('shows three kinds, a box with its count, a name line, what is sent, and Send', () => {
    const { panel, nodes } = card({ note: 'The paddle sticks.', name: 'Sam', kind: 'idea' });
    const text = collectText(nodes);
    for (const words of ['Feedback', 'Bug', 'Idea', 'Other', 'Your note', '18 / 2,000', 'Your name', 'Sent with it', 'Send', 'Close']) expect(text, words).toContain(words);
    for (const line of panel.sent) expect(text).toContain(`${line.label}:  ${line.value}`);
    expect(text).toContain('Nothing else. No save, no crew code, and no address is kept with it.');

    const kinds = find(nodes, hasClass('iw-fb-kind'));
    expect(kinds.map((kind) => [kind.attributes['data-kind'], kind.attributes['aria-pressed'], hasClass('iw-on')(kind)]))
      .toEqual([['bug', 'false', false], ['idea', 'true', true], ['other', 'false', false]]);
    expect(kinds.map((kind) => kind.intent)).toEqual(panel.kinds.map((kind) => kind.button.intent));

    const box = one(nodes, (node) => node.tag === 'textarea');
    expect(box.attributes).toMatchObject({ 'data-feedback': 'note', value: 'The paddle sticks.', maxlength: 2000, disabled: false, id: 'iw-feedback-note' });
    const name = one(nodes, (node) => node.tag === 'input');
    expect(name.attributes).toMatchObject({ 'data-feedback': 'name', value: 'Sam', maxlength: 40, type: 'text' });
    // Each has its label.
    expect(find(nodes, (node) => node.tag === 'label').map((label) => label.attributes.for)).toEqual(['iw-feedback-note', 'iw-feedback-name']);

    const send = one(nodes, (node) => node.tag === 'button' && 'data-primary' in node.attributes);
    expect([send.intent, send.attributes.disabled]).toEqual([{ type: 'feedback_send' }, false]);
    expect(collectIntents(nodes)).toEqual([...panel.kinds.map((kind) => kind.button.intent), { type: 'feedback_send' }, { type: 'close_panel' }]);
  });

  it('never draws what was typed as markup: a note and a name are a field\'s value, and the list is text', () => {
    const { nodes } = card({ note: NASTY, name: NASTY.slice(0, 40) });
    // The only fixed markup on the card is the game's own drawn caret, twice, on the "more below" mark.
    const markup = find(nodes, (node) => node.html !== null);
    expect(markup.map((node) => node.html)).toEqual([ICON.caret, ICON.caret]);
    expect(one(nodes, (node) => node.tag === 'textarea').attributes.value).toBe(NASTY);
    expect(one(nodes, (node) => node.tag === 'textarea').children).toEqual([]);
    // The name comes back in the list of what is sent, as a text node.
    const nameLine = one(nodes, (node) => node.attributes['data-part'] === 'name');
    expect(nameLine.children.at(-1)).toMatchObject({ tag: '#text', text: NASTY.slice(0, 40) });
    expect(find(nodes, (node) => ['script', 'img', 'iframe', 'a'].includes(node.tag))).toEqual([]);
  });

  it('says how the send went in a status line that is always there, and locks the card while it sends', () => {
    const status = (change: Partial<FeedbackView>): ViewNode => one(card(change).nodes, (node) => 'data-feedback-status' in node.attributes);
    expect(collectText([status({})])).toBe('');
    expect(status({}).attributes.role).toBe('status');
    expect([collectText([status({ phase: 'sent' })]), status({ phase: 'sent' }).classes]).toEqual(['Sent. Thank you.', 'iw-crew-status iw-fb-status iw-tone-good']);
    expect(collectText([status({ phase: 'failed', note: 'x' })])).toMatch(/^Could not send\. Your note is still in the box/);
    expect(status({ phase: 'failed', note: 'x' }).classes).toContain('iw-tone-danger');

    const sending = card({ phase: 'sending', note: 'x' }).nodes;
    expect(collectText([one(sending, (node) => 'data-feedback-status' in node.attributes)])).toBe('Sending…');
    expect(find(sending, (node) => ['textarea', 'input'].includes(node.tag) || hasClass('iw-fb-kind')(node)).every((node) => node.attributes.disabled === true)).toBe(true);
    expect(one(sending, (node) => 'data-primary' in node.attributes).attributes.disabled).toBe(true);
    // A failed note is still in the box, and Send says "Send again".
    const failed = card({ phase: 'failed', note: 'The paddle sticks.' }).nodes;
    expect(one(failed, (node) => node.tag === 'textarea').attributes.value).toBe('The paddle sticks.');
    expect(collectText([one(failed, (node) => 'data-primary' in node.attributes)])).toBe('Send again');
  });

  it('in a build with no relay is one sentence and a way out: nothing to type in, nothing to send', () => {
    const { nodes } = card({ on: false });
    expect(collectText(nodes)).toBe('Feedback more below Feedback is off here. This copy of the game has no relay to carry a note. Close');
    expect(find(nodes, (node) => ['textarea', 'input'].includes(node.tag))).toEqual([]);
    expect(collectIntents(nodes)).toEqual([{ type: 'close_panel' }]);
  });
});

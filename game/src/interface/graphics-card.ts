/**
 * The graphics card note on the page (`client/viewmodels/graphicscard.ts` has the words and the rule).
 *
 * One drawing for both places: a slip of paper with a rust edge, a line in the serif and the rest in the hand.
 * On the main menu it is pinned over the scene, top right, clear of the menu's page: it pushes nothing.
 * On the join card it lies in the card, under its lines. It never moves, fades or closes.
 *
 * `withGraphicsCardWarning` wraps the game's interface the way `cast-host.ts` does. It asks once who draws the
 * game's picture, at the first frame, when the picture's canvas is on the page, and from then on hands every
 * frame on with the note added where it belongs.
 */
import type { GameInterface, InterfaceModel } from '../client/contracts.ts';
import { buildGraphicsCardNote, withGraphicsCardNote } from '../client/viewmodels/graphicscard.ts';
import type { GraphicsCardFacts, GraphicsCardNoteModel } from '../client/viewmodels/graphicscard.ts';
import { h } from './dom.ts';
import type { ViewNode } from './dom.ts';
import './graphics-card.css';

/** The note, or nothing. `role="note"`: read as an aside, never as an alarm that steals the focus. */
export function graphicsCardNoteView(note: GraphicsCardNoteModel | null | undefined): ViewNode | null {
  if (!note) return null;
  return h('aside.iw-card-note', { key: 'graphics-card', role: 'note', 'aria-label': 'Graphics card' },
    h('p.iw-card-note-title', null, note.title),
    note.lines.map((line, index) => h('p.iw-card-note-line', { key: `line-${index}` }, line)));
}

/** The interface, with the note on its menu and its join card when `facts` say so. `facts` is asked once. */
export function withGraphicsCardWarning<Inner extends GameInterface>(inner: Inner, facts: () => GraphicsCardFacts): Inner {
  const update = inner.update.bind(inner);
  let note: GraphicsCardNoteModel | null = null;
  let asked = false;
  inner.update = (model: InterfaceModel): void => {
    if (!asked) {
      asked = true;
      note = buildGraphicsCardNote(facts());
    }
    update(withGraphicsCardNote(model, note));
  };
  return inner;
}

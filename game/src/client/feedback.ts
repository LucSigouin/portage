/**
 * The feedback desk: what the Feedback panel holds (a kind, a note, a name,
 * how the sending went) and the one thing it does, which is send the note to
 * the relay's store (`net/feedback.ts`).
 *
 * Nothing typed is ever lost. Every change is written to this browser's
 * storage at once, and the note leaves the box only after the store said it
 * kept it. A note that could not be sent stays in the box and in the browser.
 *
 * It exists in every build. A game built without a relay has no address to
 * send to: the desk is then off, and the panel says so.
 *
 * No DOM in here. `main.ts` hands in the browser's `fetch` and its storage.
 */
import {
  FEEDBACK_KINDS, FEEDBACK_NAME_LENGTH, FEEDBACK_NOTE_LENGTH, postFeedback,
} from '../net/feedback.ts';
import type { FeedbackBody, FeedbackContextKey, FeedbackFetch, FeedbackKind } from '../net/feedback.ts';

export interface FeedbackStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** One line of "where you are", as the panel shows it and as it is sent. */
export interface FeedbackContextRow {
  key: FeedbackContextKey;
  label: string;
  value: string;
}

export interface FeedbackDeskOptions {
  /** Where notes go (`resolveFeedbackAddress`), or null in a game built without a relay. */
  address: string | null;
  /** The game's version, as Settings shows it. */
  version: string;
  fetch: FeedbackFetch;
  /** Where the note being written is kept between visits. */
  storage: FeedbackStorage;
  /** Where the player is, right now: the lines the panel lists and the note carries. */
  context: () => FeedbackContextRow[];
}

/**
 * `writing`: nothing sent yet, or typed in since. `sending`: waiting for the store.
 * `sent`: the store kept the note. `failed`: it did not, and the note is still in the box.
 * `off`: the relay answered that it takes no notes, or has no feedback address: the note is still in the box.
 */
export type FeedbackPhase = 'writing' | 'sending' | 'sent' | 'failed' | 'off';

export interface FeedbackView {
  /** False in a game built without a relay. */
  on: boolean;
  phase: FeedbackPhase;
  kind: FeedbackKind;
  note: string;
  name: string;
  version: string;
  context: FeedbackContextRow[];
}

/** Where the note being written is kept in this browser. */
export const FEEDBACK_DRAFT_SLOT = 'portage.feedback.draft';

// Control codes are not text. A line end and a tab stay in the note.
// eslint-disable-next-line no-control-regex
const NOT_NOTE_TEXT = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;
// eslint-disable-next-line no-control-regex
const NOT_LINE_TEXT = /[\u0000-\u001f\u007f-\u009f]/g;

const noteText = (value: string): string => value.replace(/\r\n?/g, '\n').replace(NOT_NOTE_TEXT, '').slice(0, FEEDBACK_NOTE_LENGTH);
const nameText = (value: string): string => value.replace(NOT_LINE_TEXT, ' ').slice(0, FEEDBACK_NAME_LENGTH);

export class FeedbackDesk {
  private readonly options: FeedbackDeskOptions;
  private phase: FeedbackPhase = 'writing';
  private kind: FeedbackKind = 'bug';
  private note = '';
  private name = '';

  constructor(options: FeedbackDeskOptions) {
    this.options = options;
    this.restore();
  }

  /** True when this build can send a note at all. */
  get on(): boolean {
    return this.options.address !== null;
  }

  view(): FeedbackView {
    return {
      on: this.on, phase: this.phase, kind: this.kind, note: this.note, name: this.name,
      version: this.options.version, context: this.options.context(),
    };
  }

  /** Exactly what a send would carry right now: the panel lists these parts, and `send` posts this. */
  body(): FeedbackBody {
    const context: FeedbackBody['context'] = {};
    for (const row of this.options.context()) context[row.key] = row.value;
    return { kind: this.kind, note: this.note.trim(), name: this.name.trim(), version: this.options.version, context };
  }

  setField(field: 'note' | 'name', value: string): void {
    if (this.phase === 'sending') return;
    if (field === 'note') this.note = noteText(value);
    else this.name = nameText(value);
    this.edited();
  }

  setKind(kind: FeedbackKind): void {
    if (this.phase === 'sending' || !FEEDBACK_KINDS.includes(kind)) return;
    this.kind = kind;
    this.edited();
  }

  /** True when there is something to send and somewhere to send it. */
  get canSend(): boolean {
    return this.on && this.phase !== 'sending' && this.note.trim() !== '';
  }

  /** Send the note. The returned promise is for tests: the panel follows `view()`. */
  async send(): Promise<void> {
    const address = this.options.address;
    if (address === null || !this.canSend) return;
    this.phase = 'sending';
    const answer = await postFeedback(address, this.body(), this.options.fetch);
    if (answer === 'kept') {
      // Only now does the note leave the box. The kind and the name stay for the next one.
      this.note = '';
      this.phase = 'sent';
    } else {
      // A relay that takes no notes is not a line that dropped: the panel says which (finding 3 of the master review).
      this.phase = answer === 'off' ? 'off' : 'failed';
    }
    this.keep();
  }

  /** Something was typed or picked: what the last send said no longer stands, and the draft is written down. */
  private edited(): void {
    this.phase = 'writing';
    this.keep();
  }

  private keep(): void {
    try {
      this.options.storage.setItem(FEEDBACK_DRAFT_SLOT, JSON.stringify({ kind: this.kind, note: this.note, name: this.name }));
    } catch {
      // A browser with no storage, or a full one: the note is still in the box.
    }
  }

  private restore(): void {
    try {
      const kept = JSON.parse(this.options.storage.getItem(FEEDBACK_DRAFT_SLOT) ?? 'null') as { kind?: unknown; note?: unknown; name?: unknown } | null;
      if (typeof kept !== 'object' || kept === null) return;
      if (typeof kept.note === 'string') this.note = noteText(kept.note);
      if (typeof kept.name === 'string') this.name = nameText(kept.name);
      if (FEEDBACK_KINDS.includes(kept.kind as FeedbackKind)) this.kind = kept.kind as FeedbackKind;
    } catch {
      // Nothing kept, or something unreadable: start with an empty box.
    }
  }
}

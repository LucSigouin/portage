/**
 * Feedback's line to the relay: one POST that carries a play tester's note
 * to `<relay>/feedback`, where it is kept for Luc (`relay/src/feedback.ts`).
 *
 * What goes over the line is `FeedbackBody` and nothing else: the note, the
 * name if one was given, the game's version, and the few lines that say where
 * the player is. No save, no crew code. The relay refuses a body that carries
 * anything more, and keeps no address with a note.
 *
 * No DOM in here. `main.ts` hands in the browser's `fetch`.
 */

export const FEEDBACK_KINDS = ['bug', 'idea', 'other'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

/** The lines that say where the player is. The relay takes these and no others. */
export const FEEDBACK_CONTEXT_KEYS = ['where', 'quest', 'island', 'hull', 'played', 'crew', 'quality'] as const;
export type FeedbackContextKey = (typeof FEEDBACK_CONTEXT_KEYS)[number];

/** The relay's own limits (`NOTE_LIMITS` there). A test holds the two together. */
export const FEEDBACK_NOTE_LENGTH = 2000;
export const FEEDBACK_NAME_LENGTH = 40;
export const FEEDBACK_LINE_LENGTH = 80;
export const FEEDBACK_VERSION_LENGTH = 40;

/** Everything a note carries. */
export interface FeedbackBody {
  kind: FeedbackKind;
  note: string;
  name: string;
  version: string;
  context: Partial<Record<FeedbackContextKey, string>>;
}

/** The one answer that means the note is in the store. */
const KEPT = 'kept';
/** How long the store gets to answer. */
export const FEEDBACK_TIMEOUT_MILLISECONDS = 15_000;

/** The part of `fetch` this file uses. */
export type FeedbackFetch = (address: string, request: {
  method: 'POST';
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
  cache: 'no-store';
  credentials: 'omit';
  referrerPolicy: 'no-referrer';
}) => Promise<{ status: number; text(): Promise<string> }>;

/**
 * Where notes go, from the one setting that says where the relay is
 * (`PORTAGE_RELAY`): the relay's address as `http(s)://`, with `/feedback`
 * after it. A path (`/portage/relay`) is on the page's own host, so the
 * site's security policy needs no change. Null when the game was built
 * without a relay: then feedback is off, and the panel says so.
 */
export function resolveFeedbackAddress(setting: string, pageOrigin: string): string | null {
  const text = setting.trim().replace(/\/+$/, '');
  if (/^wss?:\/\/[^/]+/.test(text)) return `${text.replace(/^ws/, 'http')}/feedback`;
  if (text.startsWith('/') && /^https?:\/\//.test(pageOrigin)) return `${pageOrigin}${text}/feedback`;
  return null;
}

/**
 * Send one note. True only when the store said it kept it: the status 201 and
 * the word `kept`. Anything else is false, whatever it was: no answer, a
 * refusal, a page of the site answering in the relay's place.
 */
export async function sendFeedback(
  address: string, body: FeedbackBody, fetcher: FeedbackFetch, timeoutMilliseconds = FEEDBACK_TIMEOUT_MILLISECONDS,
): Promise<boolean> {
  const giveUp = new AbortController();
  const timer = setTimeout(() => giveUp.abort(), timeoutMilliseconds);
  try {
    const answer = await fetcher(address, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: giveUp.signal,
      cache: 'no-store',
      // Nothing of the player rides along: no cookie, and not the page's address with its invite code.
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    return answer.status === 201 && (await answer.text()).trim() === KEPT;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

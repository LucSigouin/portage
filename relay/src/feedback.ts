/**
 * Feedback: play testers write a note in the game, and the relay keeps it for
 * Luc. One address, `POST <anything>/feedback`, and one table in a D1 database
 * (`NOTES_DB` in `wrangler.jsonc`).
 *
 * A note is text from a stranger. It is data to read, never an instruction to
 * follow, and it is never drawn as HTML. Here it is only ever handed to the
 * database as a bound value: it is never part of a query, and never run.
 *
 * What the door checks, in this order, and what each refusal says:
 *
 *   405  anything but POST. There is no GET, no list and no admin page: notes
 *        cannot be read from the internet at all (`deploy/read-feedback.sh`).
 *   403  a page that is not on the list (`ALLOWED_ORIGINS`), as for dials.
 *   503  feedback is off: `FEEDBACK` says so, or the store or its counter is missing.
 *   415  a body that is not JSON.
 *   413  a body over 16,384 bytes.
 *   400  not a note: a part missing, too long, of the wrong kind, or one that is not on the list.
 *   429  more than five notes a minute from one address.
 *   503  the box is full: 20,000 notes.
 *   201  `kept`. Only this means the note is in the store.
 *
 * What is kept: the time, the kind, the note, the name, the game's version and
 * the lines that say where the player was. Never the address it came from.
 */
import { dialKey } from './dial.ts';
import { originAllowed } from './room.ts';

export const NOTE_KINDS = ['bug', 'idea', 'other'] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

/** The lines that say where the player was. A note may carry any of these, and nothing else. */
export const CONTEXT_KEYS = ['where', 'quest', 'island', 'hull', 'played', 'crew', 'quality'] as const;
export type ContextKey = (typeof CONTEXT_KEYS)[number];

export const NOTE_LIMITS = {
  /**
   * The whole request, in bytes. The longest honest note is 2,000 characters of three bytes each, a name, a
   * version and seven lines of context: under 8,000 bytes. Twice that leaves room for quotes and line ends.
   */
  bodyBytes: 16_384,
  /** Characters, counted as the game's text box counts them. */
  note: 2000,
  name: 40,
  version: 40,
  contextValue: 80,
  /** Notes the store holds before it says it is full. Wiping the store starts the count again. */
  stored: 20_000,
} as const;

/**
 * How many notes one address may send. A person writes one or two a minute. Five covers a crew of four behind
 * one address who all write in the same minute, and one who sends twice. A script is held to 7,200 a day.
 * The two numbers must be the ones in `wrangler.jsonc`: a test holds them together.
 */
export const NOTES_PER_MINUTE = 5;
export const NOTE_WINDOW_SECONDS = 60;

/** The one answer that means the note is in the store. The game says "Sent" on these words and on nothing else. */
export const KEPT = 'kept';
export const WORDS = {
  notPost: 'this address takes notes only: POST',
  page: 'this page may not use the relay',
  off: 'feedback is off',
  notJson: 'a note is sent as application/json',
  tooLarge: 'too large: a note is 2,000 characters at most',
  tooMany: 'too many notes from this address: wait a minute',
  full: 'the box is full',
  failed: 'the note could not be kept',
} as const;

export interface Note {
  kind: NoteKind;
  note: string;
  name: string;
  version: string;
  context: Partial<Record<ContextKey, string>>;
}

export type ParsedNote = { ok: true; note: Note } | { ok: false; why: string };

// Characters that are not text: the control codes of ASCII and of Latin-1, and DEL.
// eslint-disable-next-line no-control-regex
const CONTROLS = /[\u0000-\u001f\u007f-\u009f]/g;
// The same, but a line end and a tab stay.
// eslint-disable-next-line no-control-regex
const CONTROLS_BUT_LINES = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

/** Text of many lines as plain text: line ends made alike, control codes taken out, no space around it. */
export const plainLines = (text: string): string => text.replace(/\r\n?/g, '\n').replace(CONTROLS_BUT_LINES, '').trim();
/** Text of one line as plain text: a control code or a line end becomes a space. */
export const plainLine = (text: string): string => text.replace(CONTROLS, ' ').trim();

const refuse = (why: string): ParsedNote => ({ ok: false, why });

/**
 * Read a request's body as a note. Everything a note may hold is named here: a part that is not on the list
 * refuses the whole note, so nothing the game did not say it sends can ride along.
 * Angle brackets, quotes, emoji and the like are text and stay as they are.
 */
export function parseNote(body: string): ParsedNote {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return refuse('not JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return refuse('not a note');
  const parts = parsed as Record<string, unknown>;
  for (const part of Object.keys(parts)) {
    if (!['kind', 'note', 'name', 'version', 'context'].includes(part)) return refuse(`a note has no part called ${plainLine(part).slice(0, 40)}`);
  }
  const kind = parts.kind;
  if (typeof kind !== 'string' || !(NOTE_KINDS as readonly string[]).includes(kind)) return refuse('the kind is bug, idea or other');
  if (typeof parts.note !== 'string') return refuse('the note is missing');
  const note = plainLines(parts.note);
  if (note === '') return refuse('the note is empty');
  if (note.length > NOTE_LIMITS.note) return refuse(`the note is over ${NOTE_LIMITS.note} characters`);
  if (parts.name !== undefined && typeof parts.name !== 'string') return refuse('the name is not text');
  const name = plainLine(parts.name ?? '');
  if (name.length > NOTE_LIMITS.name) return refuse(`the name is over ${NOTE_LIMITS.name} characters`);
  if (typeof parts.version !== 'string') return refuse('the version is missing');
  const version = plainLine(parts.version);
  if (version === '' || version.length > NOTE_LIMITS.version) return refuse('the version is empty or too long');
  const given = parts.context;
  if (typeof given !== 'object' || given === null || Array.isArray(given)) return refuse('the context is missing');
  const context: Partial<Record<ContextKey, string>> = {};
  for (const key of Object.keys(given)) {
    if (!(CONTEXT_KEYS as readonly string[]).includes(key)) return refuse(`the context has no line called ${plainLine(key).slice(0, 40)}`);
  }
  // Rebuilt in the list's order, so two notes from the same place are stored alike.
  for (const key of CONTEXT_KEYS) {
    const value = (given as Record<string, unknown>)[key];
    if (value === undefined) continue;
    if (typeof value !== 'string') return refuse(`the context line ${key} is not text`);
    const line = plainLine(value);
    if (line.length > NOTE_LIMITS.contextValue) return refuse(`the context line ${key} is over ${NOTE_LIMITS.contextValue} characters`);
    context[key] = line;
  }
  return { ok: true, note: { kind: kind as NoteKind, note, name, version, context } };
}

// --- The door ------------------------------------------------------------------------

/** What of the Worker's settings the feedback door reads. */
export interface NotesEnv {
  /** The store. Missing: feedback is off. */
  NOTES_DB?: D1Database;
  /** Counts notes per address. Cloudflare's rate limiting binding: its two numbers are in `wrangler.jsonc`. Missing: feedback is off. */
  NOTES?: RateLimit;
  /** `off` turns feedback off and keeps what is stored. Anything else, or nothing, leaves it on. */
  FEEDBACK?: string;
  ALLOWED_ORIGINS: string;
}

export const NOTES_TABLE = `CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  note TEXT NOT NULL,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  context TEXT NOT NULL
)`;

/** One statement: the note goes in only while the box is not full. The highest number is one look at the table's key, not a count of its rows. */
const KEEP = `INSERT INTO notes (at, kind, note, name, version, context)
  SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE (SELECT COALESCE(MAX(id), 0) FROM notes) < ?7`;

/** True when the address at the end of the path is the feedback one. The part before it is free, as for rooms. */
export const isFeedbackPath = (pathname: string): boolean => /(^|\/)feedback$/.test(pathname);

/** The body as text, or null when it is over the cap or is not UTF-8. It is never read past the cap. */
async function readCapped(request: Request, cap: number): Promise<{ text: string } | { refused: 'large' | 'bytes' }> {
  const declared = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > cap) return { refused: 'large' };
  const reader = request.body?.getReader();
  if (!reader) return { text: '' };
  const bytes = new Uint8Array(cap);
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.byteLength > cap) {
      void reader.cancel().catch(() => {});
      return { refused: 'large' };
    }
    bytes.set(value, size);
    size += value.byteLength;
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes.subarray(0, size)) };
  } catch {
    return { refused: 'bytes' };
  }
}

/** Put the note in the store. True when it is in, false when the box is full. Throws when the store fails. */
async function keep(store: D1Database, note: Note, at: string): Promise<boolean> {
  const statement = (): D1PreparedStatement =>
    store.prepare(KEEP).bind(at, note.kind, note.note, note.name, note.version, JSON.stringify(note.context), NOTE_LIMITS.stored);
  try {
    return (await statement().run()).meta.changes === 1;
  } catch (error) {
    // A new store has no table yet. The Worker makes it, once, so going live has no step that could be forgotten.
    if (!/no such table/i.test(String(error))) throw error;
    await store.prepare(NOTES_TABLE).run();
    return (await statement().run()).meta.changes === 1;
  }
}

/**
 * Answer a request to the feedback address. Every answer is plain text. A page on the list is told it may read
 * the answer (the relay may sit on another host than the game); no other page is.
 */
export async function answerFeedback(request: Request, env: NotesEnv, now: () => Date = () => new Date()): Promise<Response> {
  const origin = request.headers.get('Origin');
  const allowed = originAllowed(origin, env.ALLOWED_ORIGINS);
  const shared: Record<string, string> = allowed && origin !== null ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {};
  const answer = (words: string, status: number, more: Record<string, string> = {}): Response =>
    new Response(`${words}\n`, {
      status,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...shared, ...more },
    });

  // A browser on another host asks first whether it may send JSON here.
  if (request.method === 'OPTIONS') {
    if (!allowed) return answer(WORDS.page, 403);
    return new Response(null, {
      status: 204,
      headers: { ...shared, 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' },
    });
  }
  if (request.method !== 'POST') return answer(WORDS.notPost, 405, { allow: 'POST' });
  if (!allowed) return answer(WORDS.page, 403);
  const store = env.NOTES_DB;
  const counter = env.NOTES;
  if ((env.FEEDBACK ?? '').trim().toLowerCase() === 'off' || !store || !counter) return answer(WORDS.off, 503);
  if (!/^application\/json\s*(;|$)/i.test(request.headers.get('content-type') ?? '')) return answer(WORDS.notJson, 415);
  const body = await readCapped(request, NOTE_LIMITS.bodyBytes);
  if ('refused' in body) return body.refused === 'large' ? answer(WORDS.tooLarge, 413) : answer('not a note: not text', 400);
  const parsed = parseNote(body.text);
  if (!parsed.ok) return answer(`not a note: ${parsed.why}`, 400);
  // The limit, last at the door: only a note that would be written is counted. This computer is never limited,
  // as for dials. A counter that cannot be asked keeps the note out: a store of strangers' text is never left open.
  const key = dialKey(request.headers.get('CF-Connecting-IP'));
  if (key !== null) {
    let may: boolean;
    try {
      may = (await counter.limit({ key })).success;
    } catch {
      return answer(WORDS.off, 503);
    }
    if (!may) return answer(WORDS.tooMany, 429, { 'retry-after': String(NOTE_WINDOW_SECONDS) });
  }
  try {
    return (await keep(store, parsed.note, now().toISOString())) ? answer(KEPT, 201) : answer(WORDS.full, 503);
  } catch {
    return answer(WORDS.failed, 500);
  }
}

/**
 * Feedback: the line to the relay, the desk that holds a note, the words of the panel, and whole clients
 * (session, panels, interface model) sending a note through the relay's own door (`relay/src/feedback.ts`,
 * the code the Worker runs) into a stand-in store. What the panel says is sent is what is sent, and only that.
 */
import { describe, expect, it, vi } from 'vitest';
import { CONTEXT_KEYS, NOTE_KINDS, NOTE_LIMITS, WORDS, answerFeedback, parseNote } from '../../../relay/src/feedback.ts';
import type { NotesEnv } from '../../../relay/src/feedback.ts';
import { createApp } from '../../src/client/app.ts';
import { createSilentAudio } from '../../src/client/contracts.ts';
import type { ButtonModel, GameInterface, InterfaceModel, PanelModel, WorldView } from '../../src/client/contracts.ts';
import { FEEDBACK_DRAFT_SLOT, FeedbackDesk } from '../../src/client/feedback.ts';
import type { FeedbackContextRow } from '../../src/client/feedback.ts';
import type { InterfaceIntent } from '../../src/client/intents.ts';
import { PANEL_RULES } from '../../src/client/panels.ts';
import { GAME_VERSION } from '../../src/client/version.ts';
import { FEEDBACK_TEXT, buildFeedbackContext, buildFeedbackPanel } from '../../src/client/viewmodels/feedback.ts';
import { ISLANDS } from '../../src/data/index.ts';
import {
  FEEDBACK_CONTEXT_KEYS, FEEDBACK_KINDS, FEEDBACK_LINE_LENGTH, FEEDBACK_NAME_LENGTH, FEEDBACK_NOTE_LENGTH, FEEDBACK_TIMEOUT_MILLISECONDS,
  FEEDBACK_OFF_WORDS, FEEDBACK_VERSION_LENGTH, postFeedback, resolveFeedbackAddress, sendFeedback,
} from '../../src/net/feedback.ts';
import type { FeedbackAnswer, FeedbackBody, FeedbackFetch } from '../../src/net/feedback.ts';
import { createDefaultSettings } from '../../src/settings/index.ts';
import { createGame } from '../../src/sim/index.ts';
import { FakeStorage } from '../support.ts';

const ADDRESS = 'https://sigouin.net/portage/relay/feedback';
const BODY: FeedbackBody = { kind: 'bug', note: 'The paddle sticks.', name: 'Sam', version: '1.0.212 · abc1234', context: { where: 'The lobby, no game open', quality: 'Medium' } };

type Asked = { address: string; request: Parameters<FeedbackFetch>[1] };
/** A `fetch` that answers as told and writes down what it was asked. */
function answering(status: number, words: string): { fetch: FeedbackFetch; asked: Asked[] } {
  const asked: Asked[] = [];
  return { asked, fetch: async (address, request) => (asked.push({ address, request }), { status, text: async () => words }) };
}

describe('the line to the relay', () => {
  it('finds the feedback address from the one setting that says where the relay is', () => {
    expect(resolveFeedbackAddress('/portage/relay', 'https://sigouin.net')).toBe(ADDRESS);
    expect(resolveFeedbackAddress('/relay/', 'http://localhost:5220')).toBe('http://localhost:5220/relay/feedback');
    expect(resolveFeedbackAddress('wss://relay.example', 'https://sigouin.net')).toBe('https://relay.example/feedback');
    expect(resolveFeedbackAddress('ws://localhost:8793', 'http://localhost:5237')).toBe('http://localhost:8793/feedback');
    // No relay in the build: nowhere to send, and the panel says feedback is off.
    for (const none of ['', '  ', 'relay', 'https://relay.example']) expect(resolveFeedbackAddress(none, 'https://sigouin.net')).toBeNull();
  });

  it('says a note was sent only when the store said it kept it', async () => {
    const answers: [number, string, boolean][] = [
      [201, 'kept\n', true], [201, 'kept', true],
      [200, 'kept\n', false], [201, '<!doctype html><title>Portage</title>', false], [201, '', false], [204, '', false],
      [403, 'this page may not use the relay\n', false], [429, 'too many notes from this address: wait a minute\n', false],
      [503, 'feedback is off\n', false], [500, 'the note could not be kept\n', false], [404, 'not found\n', false],
    ];
    for (const [status, words, sent] of answers) expect(await sendFeedback(ADDRESS, BODY, answering(status, words).fetch), `${status} ${words}`).toBe(sent);
    expect(await sendFeedback(ADDRESS, BODY, async () => { throw new TypeError('Failed to fetch'); })).toBe(false);
    expect(await sendFeedback(ADDRESS, BODY, async () => ({ status: 201, text: async () => { throw new Error('cut off'); } }))).toBe(false);
  });

  it('tells a relay that takes no notes from a line that dropped (the master review, finding 3)', async () => {
    // The relay's own words for "off", held to the game's.
    expect(FEEDBACK_OFF_WORDS).toBe(WORDS.off);
    const answers: [number, string, FeedbackAnswer][] = [
      [201, 'kept\n', 'kept'],
      // Off: the relay says so, or has no feedback address at all (the live relay from before feedback: 404 "not found").
      [503, 'feedback is off\n', 'off'], [503, 'feedback is off', 'off'], [404, 'not found\n', 'off'], [404, '<!doctype html><title>Not found</title>', 'off'],
      // Everything else may pass: a full box, too many notes, a page that may not use the relay, a store that fell over.
      [503, 'the box is full\n', 'failed'], [503, '', 'failed'], [503, '<html>Service Unavailable</html>', 'failed'],
      [429, 'too many notes from this address: wait a minute\n', 'failed'], [403, 'this page may not use the relay\n', 'failed'],
      [500, 'the note could not be kept\n', 'failed'], [200, 'feedback is off\n', 'failed'], [201, 'feedback is off\n', 'failed'],
    ];
    for (const [status, words, answer] of answers) expect(await postFeedback(ADDRESS, BODY, answering(status, words).fetch), `${status} ${words}`).toBe(answer);
    expect(await postFeedback(ADDRESS, BODY, async () => { throw new TypeError('Failed to fetch'); })).toBe('failed');
    expect(await postFeedback(ADDRESS, BODY, async () => ({ status: 503, text: async () => { throw new Error('cut off'); } }))).toBe('failed');
  });

  it('gives up on a store that never answers', async () => {
    vi.useFakeTimers();
    try {
      let stopped = false;
      const silent: FeedbackFetch = (_address, request) => new Promise((_resolve, reject) => {
        request.signal.addEventListener('abort', () => {
          stopped = true;
          reject(new Error('aborted'));
        });
      });
      const sending = sendFeedback(ADDRESS, BODY, silent);
      await vi.advanceTimersByTimeAsync(FEEDBACK_TIMEOUT_MILLISECONDS - 1);
      expect(stopped).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await sending).toBe(false);
      expect(stopped).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('posts the note as JSON and lets nothing else of the browser ride along', async () => {
    const { fetch, asked } = answering(201, 'kept\n');
    await sendFeedback(ADDRESS, BODY, fetch);
    expect(asked).toHaveLength(1);
    const { address, request } = asked[0]!;
    expect(address).toBe(ADDRESS);
    expect({ ...request, signal: null }).toEqual({
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(BODY), signal: null,
      cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
    });
  });

  it('has the relay\'s own limits', () => {
    expect([...FEEDBACK_KINDS]).toEqual([...NOTE_KINDS]);
    expect([...FEEDBACK_CONTEXT_KEYS]).toEqual([...CONTEXT_KEYS]);
    expect([FEEDBACK_NOTE_LENGTH, FEEDBACK_NAME_LENGTH, FEEDBACK_LINE_LENGTH, FEEDBACK_VERSION_LENGTH])
      .toEqual([NOTE_LIMITS.note, NOTE_LIMITS.name, NOTE_LIMITS.contextValue, NOTE_LIMITS.version]);
    // The version a build shows fits the store's line for it.
    expect(GAME_VERSION.length).toBeLessThanOrEqual(NOTE_LIMITS.version);
    expect('1.0.99999 · 0123456789ab'.length).toBeLessThanOrEqual(NOTE_LIMITS.version);
  });
});

// --- The desk ---------------------------------------------------------------------------

const LOBBY: FeedbackContextRow[] = [{ key: 'where', label: 'Where you are', value: 'The lobby, no game open' }, { key: 'quality', label: 'Quality', value: 'Medium' }];

function desk(fetch: FeedbackFetch, options: { storage?: FakeStorage; address?: string | null } = {}): { desk: FeedbackDesk; storage: FakeStorage } {
  const storage = options.storage ?? new FakeStorage();
  return { storage, desk: new FeedbackDesk({ address: options.address === undefined ? ADDRESS : options.address, version: '1.0.212 · abc1234', fetch, storage, context: () => LOBBY }) };
}
const draft = (storage: FakeStorage): unknown => JSON.parse(storage.getItem(FEEDBACK_DRAFT_SLOT) ?? 'null');

describe('the feedback desk', () => {
  it('writes down what is typed at once, so a reload or a closed tab loses nothing', () => {
    const first = desk(answering(201, 'kept').fetch);
    first.desk.setKind('idea');
    first.desk.setField('note', 'A sail that can be reefed.\nSecond line.');
    first.desk.setField('name', 'Sam');
    expect(draft(first.storage)).toEqual({ kind: 'idea', note: 'A sail that can be reefed.\nSecond line.', name: 'Sam' });
    const again = desk(answering(201, 'kept').fetch, { storage: first.storage });
    expect(again.desk.view()).toMatchObject({ kind: 'idea', note: 'A sail that can be reefed.\nSecond line.', name: 'Sam', phase: 'writing', on: true });
    // A browser that will not store: the note is still in the box.
    const full = new FakeStorage();
    full.failWrites = true;
    const blocked = desk(answering(201, 'kept').fetch, { storage: full });
    blocked.desk.setField('note', 'still here');
    expect(blocked.desk.view().note).toBe('still here');
    // Something else under the same name in storage is not a draft.
    const odd = new FakeStorage();
    odd.setItem(FEEDBACK_DRAFT_SLOT, '{"kind":"praise","note":7,"name":["x"]}');
    expect(desk(answering(201, 'kept').fetch, { storage: odd }).desk.view()).toMatchObject({ kind: 'bug', note: '', name: '' });
    odd.setItem(FEEDBACK_DRAFT_SLOT, 'not json');
    expect(desk(answering(201, 'kept').fetch, { storage: odd }).desk.view().note).toBe('');
  });

  it('keeps a note to 2,000 characters and a name to 40, and takes out what is not text', () => {
    const { desk: writing } = desk(answering(201, 'kept').fetch);
    writing.setField('note', `${'x'.repeat(FEEDBACK_NOTE_LENGTH)}overflow`);
    expect(writing.view().note).toHaveLength(FEEDBACK_NOTE_LENGTH);
    writing.setField('note', 'line one\r\nline two\ttab\u0000\u001b[31m <b>bold</b>');
    expect(writing.view().note).toBe('line one\nline two\ttab[31m <b>bold</b>');
    writing.setField('name', `Sam\n${'y'.repeat(60)}`);
    expect(writing.view().name).toBe(`Sam ${'y'.repeat(FEEDBACK_NAME_LENGTH - 4)}`);
    writing.setKind('praise' as never);
    expect(writing.view().kind).toBe('bug');
  });

  it('empties the box only once the store said yes, and keeps the kind and the name for the next note', async () => {
    const { fetch, asked } = answering(201, 'kept\n');
    const { desk: sending, storage } = desk(fetch);
    sending.setKind('idea');
    sending.setField('note', '  A sail that can be reefed.  ');
    sending.setField('name', ' Sam ');
    expect(sending.canSend).toBe(true);
    const done = sending.send();
    // Until the store answers nothing is gone, and nothing can be changed or sent twice.
    expect(sending.view()).toMatchObject({ phase: 'sending', note: '  A sail that can be reefed.  ' });
    sending.setField('note', 'changed');
    sending.setKind('bug');
    expect(sending.canSend).toBe(false);
    await sending.send();
    await done;
    expect(asked).toHaveLength(1);
    expect(JSON.parse(asked[0]!.request.body)).toEqual({ kind: 'idea', note: 'A sail that can be reefed.', name: 'Sam', version: '1.0.212 · abc1234', context: { where: 'The lobby, no game open', quality: 'Medium' } });
    expect(sending.view()).toMatchObject({ phase: 'sent', note: '', kind: 'idea', name: ' Sam ' });
    expect(draft(storage)).toEqual({ kind: 'idea', note: '', name: ' Sam ' });
    // An empty box sends nothing.
    expect(sending.canSend).toBe(false);
    await sending.send();
    expect(asked).toHaveLength(1);
    // Typing again is a new note.
    sending.setField('note', 'x');
    expect(sending.view().phase).toBe('writing');
  });

  it('keeps the note in the box and in the browser when it could not be sent, however it failed', async () => {
    // A relay that says it is off, or has no feedback address, ends as `off`; the rest as `failed`. The note stays either way.
    const failures: [FeedbackFetch, 'off' | 'failed'][] = [
      [answering(503, 'feedback is off\n').fetch, 'off'], [answering(404, 'not found\n').fetch, 'off'],
      [answering(429, 'too many notes\n').fetch, 'failed'], [answering(200, '<html>the site\'s own page</html>').fetch, 'failed'],
      [async () => { throw new TypeError('Failed to fetch'); }, 'failed'],
    ];
    for (const [fetch, phase] of failures) {
      const { desk: failing, storage } = desk(fetch);
      failing.setField('note', 'The paddle sticks.');
      await failing.send();
      expect(failing.view()).toMatchObject({ phase, note: 'The paddle sticks.' });
      expect(draft(storage)).toMatchObject({ note: 'The paddle sticks.' });
      // It can be sent again as it stands, and a reload still has it.
      expect(failing.canSend).toBe(true);
      expect(desk(answering(201, 'kept').fetch, { storage }).desk.view().note).toBe('The paddle sticks.');
    }
  });

  it('is off in a game built without a relay: nothing is ever sent', async () => {
    const { fetch, asked } = answering(201, 'kept\n');
    const { desk: off } = desk(fetch, { address: null });
    off.setField('note', 'anyone there?');
    expect([off.on, off.canSend, off.view().on]).toEqual([false, false, false]);
    await off.send();
    expect(asked).toHaveLength(0);
    expect(off.view().phase).toBe('writing');
  });
});

// --- The words --------------------------------------------------------------------------

describe('the Feedback panel in words', () => {
  const view = (change: Partial<ReturnType<FeedbackDesk['view']>> = {}): ReturnType<FeedbackDesk['view']> => ({
    on: true, phase: 'writing', kind: 'bug', note: '', name: '', version: '1.0.212 · abc1234', context: LOBBY, ...change,
  });

  it('has a plain sentence for every way a send can end, and Send only when there is something to send', () => {
    const empty = buildFeedbackPanel(view());
    expect([empty.status, empty.send.label, empty.send.enabled, empty.send.note]).toEqual(['', 'Send', false, null]);
    expect(empty.note.countText).toBe('0 / 2,000');
    expect(empty.kinds.map((kind) => [kind.button.label, kind.picked])).toEqual([['Bug', true], ['Idea', false], ['Other', false]]);

    const typed = buildFeedbackPanel(view({ note: 'The paddle sticks.', kind: 'idea' }));
    expect([typed.status, typed.send.enabled, typed.send.note, typed.note.countText]).toEqual(['', true, null, '18 / 2,000']);
    expect(typed.kinds.map((kind) => kind.picked)).toEqual([false, true, false]);
    expect(buildFeedbackPanel(view({ note: '   \n ' })).send.enabled).toBe(false);
    expect(buildFeedbackPanel(view({ note: 'x'.repeat(2000) })).note.countText).toBe('2,000 / 2,000');

    const sending = buildFeedbackPanel(view({ note: 'x', phase: 'sending' }));
    expect([sending.status, sending.send.enabled, sending.note.enabled, sending.name.enabled, sending.kinds.some((kind) => kind.button.enabled)])
      .toEqual(['Sending…', false, false, false, false]);

    const sent = buildFeedbackPanel(view({ phase: 'sent' }));
    expect([sent.status, sent.statusTone, sent.send.enabled, sent.send.note]).toEqual(['Sent. Thank you.', 'good', false, null]);

    const failed = buildFeedbackPanel(view({ note: 'The paddle sticks.', phase: 'failed' }));
    expect(failed.status).toBe('Could not send. Your note is still in the box, and kept in this browser. Try again in a minute.');
    expect([failed.statusTone, failed.send.label, failed.send.enabled, failed.note.value]).toEqual(['danger', 'Send again', true, 'The paddle sticks.']);

    // The relay said it takes no notes: the "off" sentence, the note still there, and no "try again in a minute".
    const relayOff = buildFeedbackPanel(view({ note: 'The paddle sticks.', phase: 'off' }));
    expect(relayOff.status).toBe('Feedback is off here. The relay is not taking notes. Your note is still in the box, and kept in this browser.');
    expect(relayOff.status).not.toMatch(/again|minute/i);
    expect([relayOff.on, relayOff.statusTone, relayOff.send.label, relayOff.send.enabled, relayOff.note.value, relayOff.note.enabled])
      .toEqual([true, 'warning', 'Send again', true, 'The paddle sticks.', true]);

    const off = buildFeedbackPanel(view({ on: false }));
    expect([off.on, off.status, off.send.enabled, off.note.enabled]).toEqual([false, FEEDBACK_TEXT.off, false, false]);
    expect(off.status).toMatch(/^Feedback is off here\./);
  });

  it('says where the player is in six lines in a game and two in the lobby, each short enough for the store', () => {
    const settings = createDefaultSettings();
    settings.graphics.qualityPreset = 'ultra';
    expect(buildFeedbackContext(null, settings)).toEqual([
      { key: 'where', label: 'Where you are', value: 'The lobby, no game open' }, { key: 'quality', label: 'Quality', value: 'Ultra' },
    ]);
    const game = createGame(7, { crew: 3 });
    game.playedSeconds = 4330;
    const rows = buildFeedbackContext(game, settings, 1);
    expect(rows.map((row) => row.key)).toEqual(['quest', 'island', 'hull', 'played', 'crew', 'quality']);
    expect(rows.map((row) => row.label)).toEqual(['Tracked quest', 'Island', 'Hull', 'Time played', 'Crew', 'Quality']);
    const value = (key: string): string => rows.find((row) => row.key === key)!.value;
    expect([value('played'), value('crew'), value('quality')]).toEqual(['1 h 12 min', '3 players', 'Ultra']);
    expect(value('quest')).not.toBe('None');
    expect(value('hull').length).toBeGreaterThan(0);
    expect(buildFeedbackContext(createGame(7), settings).find((row) => row.key === 'crew')!.value).toBe('Alone');
    // Ashore it is the island's name. On the water it says so, with the region.
    const player = game.players[1]!;
    player.mode = 'foot';
    player.islandId = ISLANDS[0]!.id;
    expect(buildFeedbackContext(game, settings, 1).find((row) => row.key === 'island')!.value).toBe(ISLANDS[0]!.name);
    player.mode = 'canoe';
    expect(buildFeedbackContext(game, settings, 1).find((row) => row.key === 'island')!.value).toMatch(/^On the water, \S/);
    for (const row of [...rows, ...buildFeedbackContext(game, settings, 1)]) expect(row.value.length).toBeLessThanOrEqual(NOTE_LIMITS.contextValue);
  });
});

// --- Whole clients, through the relay's own door ---------------------------------------------

interface Row { at: string; kind: string; note: string; name: string; version: string; context: string }

/** The relay's door in front of a stand-in store: what the Worker would do with the request, in memory. */
function relayDoor(more: Partial<NotesEnv> = {}): { fetch: FeedbackFetch; rows: Row[]; bodies: string[]; headers: Record<string, string>[] } {
  const rows: Row[] = [];
  const bodies: string[] = [];
  const headers: Record<string, string>[] = [];
  const env: NotesEnv = {
    ALLOWED_ORIGINS: 'https://sigouin.net',
    NOTES: { limit: async () => ({ success: true }) },
    NOTES_DB: {
      prepare: () => {
        let bound: unknown[] = [];
        const statement = {
          bind: (...values: unknown[]) => ((bound = values), statement),
          run: async () => {
            const [at, kind, note, name, version, context] = bound as string[];
            rows.push({ at: at!, kind: kind!, note: note!, name: name!, version: version!, context: context! });
            return { meta: { changes: 1 } };
          },
        };
        return statement;
      },
    },
    ...more,
  };
  const fetch: FeedbackFetch = async (address, request) => {
    bodies.push(request.body);
    headers.push(request.headers);
    // A browser adds the page it is on. Nothing else is added here.
    const answer = await answerFeedback(new Request(address, { method: request.method, body: request.body, headers: { ...request.headers, Origin: 'https://sigouin.net' } }), env);
    return { status: answer.status, text: () => answer.text() };
  };
  return { fetch, rows, bodies, headers };
}

interface Client {
  desk: FeedbackDesk | null;
  storage: FakeStorage;
  model(): InterfaceModel;
  panel<Id extends PanelModel['id']>(id: Id): Extract<PanelModel, { id: Id }>;
  send(intent: InterfaceIntent): void;
  press(button: ButtonModel | null | undefined): void;
  key(code: string): void;
}

function client(fetch: FeedbackFetch | null, options: { address?: string | null; storage?: FakeStorage } = {}): Client {
  const models: InterfaceModel[] = [];
  const worldView: WorldView = {
    mount: () => {}, resize: () => {}, applyGraphicsSettings: () => {}, showStage: () => {}, sync: () => {}, handleEvents: () => {},
    render: () => {}, dispose: () => {},
  };
  const gameInterface: GameInterface = { mount: () => {}, update: (model) => void models.push(model), dispose: () => {} };
  const storage = options.storage ?? new FakeStorage();
  let seed = 0;
  const app = createApp({ worldView, gameInterface, audio: createSilentAudio(), storage, now: () => 5000, randomSeed: () => (seed += 1) });
  const session = app.session;
  // As `main.ts` makes it.
  const made = fetch ? new FeedbackDesk({
    address: options.address === undefined ? ADDRESS : options.address, version: '1.0.212 · abc1234', fetch, storage,
    context: () => buildFeedbackContext(session.game, session.settings, session.localPlayerId),
  }) : null;
  session.feedback = made;
  const self: Client = {
    desk: made, storage,
    model: () => {
      app.frame(0);
      return models.at(-1)!;
    },
    panel: (id) => {
      const panel = self.model().panel;
      if (panel?.id !== id) throw new Error(`the open panel is ${panel?.id ?? 'none'}, not ${id}`);
      return panel as Extract<PanelModel, { id: typeof id }>;
    },
    send: (intent) => session.handleIntent(intent),
    press: (button) => {
      if (!button) throw new Error('no such button');
      if (!button.enabled) throw new Error(`"${button.label}" is disabled`);
      session.handleIntent(button.intent);
    },
    key: (code) => {
      session.keyDown(code, false);
      session.keyUp(code);
    },
  };
  return self;
}

const labels = (buttons: ButtonModel[]): string[] => buttons.map((button) => button.label);
const named = (buttons: ButtonModel[], label: string): ButtonModel => buttons.find((button) => button.label === label)!;
/** Let the send's promises run to their end. */
const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
};

describe('Feedback in the menus', () => {
  it('is in the lobby above Credits and on the pause card above quitting, and opens from those two places only', () => {
    const each = client(relayDoor().fetch);
    expect(labels(each.model().lobby!.buttons)).toEqual(['Continue', 'New Game', 'Settings', 'How to Play', 'Feedback', 'Credits']);
    // The canoe sketch stands beside the lobby's last three lines (preview.css), where a line's side words would run: none of the three has any.
    expect(each.model().lobby!.buttons.slice(-3).map((button) => [button.label, button.note])).toEqual([['How to Play', null], ['Feedback', null], ['Credits', null]]);
    each.press(named(each.model().lobby!.buttons, 'Feedback'));
    expect(each.panel('feedback').title).toBe('Feedback');
    each.press(each.panel('feedback').close);
    expect(each.model().panel).toBeNull();

    each.send({ type: 'new_game', slot: 0 });
    // Not from the game itself: only from the pause card.
    each.send({ type: 'open_panel', panel: 'feedback' });
    expect(each.model().openPanels).not.toContain('feedback');
    each.send({ type: 'open_panel', panel: 'pause' });
    expect(labels(each.panel('pause').buttons)).toEqual(['Resume', 'Settings', 'How to Play', 'Feedback', 'Save and quit to the lobby']);
    expect(named(each.panel('pause').buttons, 'Feedback').note).toBeNull();
    each.press(named(each.panel('pause').buttons, 'Feedback'));
    expect(each.model().openPanels).toEqual(['pause', 'feedback']);
    // Esc goes back to the pause card, as from Settings.
    each.key('Escape');
    expect(each.model().openPanels).toEqual(['pause']);
    expect(PANEL_RULES.feedback).toMatchObject({ group: 'menu', parents: { lobby: ['root'], game: ['pause'] }, pausesSimulation: true });
  });

  it('types into the note and never into the game: no key written in the box opens a panel or closes the card', () => {
    const each = client(relayDoor().fetch);
    each.send({ type: 'new_game', slot: 0 });
    each.send({ type: 'open_panel', panel: 'pause' });
    each.press(named(each.panel('pause').buttons, 'Feedback'));
    // What the interface sends for each character typed (`feedbackInputIntent`), and the game's keys for the same letters.
    let typed = '';
    for (const letter of 'wasd qe bm i 12345') {
      typed += letter;
      each.send({ type: 'feedback_field', field: 'note', value: typed });
      expect(each.model().openPanels).toEqual(['pause', 'feedback']);
    }
    expect(each.panel('feedback').note.value).toBe('wasd qe bm i 12345');
    expect(each.panel('feedback').note.countText).toBe('18 / 2,000');
  });
});

describe('what the panel says is sent is what is sent, and only that', () => {
  /** Hold the panel's list against the request that went out and the row the store kept. */
  function compare(panel: Extract<PanelModel, { id: 'feedback' }>, typed: { note: string; name: string; kind: string }, body: string, row: Row): void {
    const sent = JSON.parse(body) as FeedbackBody;
    // The request has these five parts and no other.
    expect(Object.keys(sent)).toEqual(['kind', 'note', 'name', 'version', 'context']);
    // The list names every part of it, in order, and nothing that is not in it.
    expect(panel.sent.map((line) => line.part)).toEqual(['note', 'name', 'version', ...Object.keys(sent.context)]);
    const shown = (part: string): string => panel.sent.find((line) => line.part === part)!.value;
    expect(shown('note')).toBe(`the ${typed.kind} written above`);
    expect([sent.kind, sent.note]).toEqual([typed.kind, typed.note]);
    expect(shown('name')).toBe(typed.name === '' ? 'not given' : typed.name);
    expect(sent.name).toBe(typed.name);
    expect(shown('version')).toBe(sent.version);
    for (const [key, value] of Object.entries(sent.context)) expect(shown(key), key).toBe(value);
    // And the store kept that: the time, and the same five things.
    expect({ kind: row.kind, note: row.note, name: row.name, version: row.version, context: JSON.parse(row.context) }).toEqual(sent);
    expect(row.at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    expect(panel.notSent).toBe('Nothing else. No save, no crew code, and no address is kept with it.');
  }

  it('from the lobby: the note, the name, the version, that no game is open, and the quality level', async () => {
    const door = relayDoor();
    const each = client(door.fetch);
    each.press(named(each.model().lobby!.buttons, 'Feedback'));
    each.send({ type: 'feedback_kind', kind: 'idea' });
    each.send({ type: 'feedback_field', field: 'note', value: 'A sail that can be reefed.' });
    const before = each.panel('feedback');
    expect(before.sent.map((line) => `${line.label}: ${line.value}`)).toEqual([
      'The note: the idea written above', 'Your name: not given', 'Version: 1.0.212 · abc1234', 'Where you are: The lobby, no game open', 'Quality: High',
    ]);
    each.press(before.send);
    await settle();
    expect(each.panel('feedback').status).toBe('Sent. Thank you.');
    expect(each.panel('feedback').note.value).toBe('');
    expect(door.rows).toHaveLength(1);
    compare(before, { note: 'A sail that can be reefed.', name: '', kind: 'idea' }, door.bodies[0]!, door.rows[0]!);
    expect(door.headers[0]).toEqual({ 'content-type': 'application/json' });
  });

  it('from a game: the tracked quest, the island, the hull, the time played, the crew size and the quality level, and no more', async () => {
    const door = relayDoor();
    const each = client(door.fetch);
    each.send({ type: 'new_game', slot: 0 });
    each.send({ type: 'open_panel', panel: 'pause' });
    each.press(named(each.panel('pause').buttons, 'Feedback'));
    each.send({ type: 'feedback_field', field: 'note', value: 'The paddle sticks after a storm. <b>Really.</b>' });
    each.send({ type: 'feedback_field', field: 'name', value: 'Sam' });
    const before = each.panel('feedback');
    expect(before.sent.map((line) => line.label)).toEqual(['The note', 'Your name', 'Version', 'Tracked quest', 'Island', 'Hull', 'Time played', 'Crew', 'Quality']);
    each.press(before.send);
    await settle();
    expect(each.panel('feedback').status).toBe('Sent. Thank you.');
    expect(door.rows).toHaveLength(1);
    compare(before, { note: 'The paddle sticks after a storm. <b>Really.</b>', name: 'Sam', kind: 'bug' }, door.bodies[0]!, door.rows[0]!);
    // Nothing of the save is in it: the request is a few short lines, and the game's state is not among them.
    expect(door.bodies[0]!.length).toBeLessThan(600);
    expect(door.bodies[0]).not.toMatch(/seed|inventory|players|position|quests"|slot/);
    // What the store would refuse is never what the game sends: its own check takes the request whole.
    expect(parseNote(door.bodies[0]!)).toMatchObject({ ok: true });
  });

  it('says so, and keeps the note, when the store refuses: off, no store, a relay with no feedback address, or too many', async () => {
    const OFF = 'Feedback is off here. The relay is not taking notes. Your note is still in the box, and kept in this browser.';
    const LATER = 'Could not send. Your note is still in the box, and kept in this browser. Try again in a minute.';
    // A relay from before feedback: no such address, and its plain 404 (`relay/src/worker.ts`).
    const olderRelay: FeedbackFetch = async () => ({ status: 404, text: async () => 'not found\n' });
    const refusals: { door: ReturnType<typeof relayDoor>; fetch: FeedbackFetch; says: string }[] = [
      { FEEDBACK: 'off' }, { NOTES_DB: undefined }, { NOTES: undefined },
    ].map((more: Partial<NotesEnv>) => {
      const door = relayDoor(more);
      return { door, fetch: door.fetch, says: OFF };
    });
    refusals.push({ door: relayDoor(), fetch: olderRelay, says: OFF });
    const busy = relayDoor({ NOTES: { limit: async () => ({ success: false }) } });
    refusals.push({ door: busy, fetch: busy.fetch, says: LATER });
    for (const { door, fetch, says } of refusals) {
      const each = client(fetch);
      each.press(named(each.model().lobby!.buttons, 'Feedback'));
      each.send({ type: 'feedback_field', field: 'note', value: 'The paddle sticks.' });
      each.press(each.panel('feedback').send);
      await settle();
      const after = each.panel('feedback');
      expect(after.status).toBe(says);
      expect([after.note.value, after.send.label, after.send.enabled]).toEqual(['The paddle sticks.', 'Send again', true]);
      expect(door.rows).toHaveLength(0);
      // The same browser, opened again: the note is in the box.
      const again = client(relayDoor().fetch, { storage: each.storage });
      again.press(named(again.model().lobby!.buttons, 'Feedback'));
      expect(again.panel('feedback').note.value).toBe('The paddle sticks.');
    }
  });

  it('a relay that was off and is switched on takes the same note on the next press', async () => {
    let on = false;
    const door = relayDoor();
    const each = client(async (address, request) => (on ? door.fetch(address, request) : { status: 503, text: async () => 'feedback is off\n' }));
    each.press(named(each.model().lobby!.buttons, 'Feedback'));
    each.send({ type: 'feedback_field', field: 'note', value: 'The paddle sticks.' });
    each.press(each.panel('feedback').send);
    await settle();
    expect(each.panel('feedback').status).toMatch(/^Feedback is off here\. The relay is not taking notes\./);
    on = true;
    each.press(each.panel('feedback').send);
    await settle();
    expect(each.panel('feedback').status).toBe('Sent. Thank you.');
    expect(door.rows).toHaveLength(1);
    // Typing after an "off" clears the sentence, as it does after any other ending.
    each.send({ type: 'feedback_field', field: 'note', value: 'One more.' });
    expect(each.panel('feedback').status).toBe('');
  });

  it('in a game built without a relay the entry is still there, and the panel says feedback is off', async () => {
    const door = relayDoor();
    const each = client(door.fetch, { address: resolveFeedbackAddress('', 'http://localhost:5220') });
    expect(labels(each.model().lobby!.buttons)).toContain('Feedback');
    each.press(named(each.model().lobby!.buttons, 'Feedback'));
    const panel = each.panel('feedback');
    expect([panel.on, panel.status, panel.send.enabled]).toEqual([false, 'Feedback is off here. This copy of the game has no relay to carry a note.', false]);
    each.send({ type: 'feedback_field', field: 'note', value: 'hello?' });
    each.send({ type: 'feedback_send' });
    await settle();
    expect(door.bodies).toHaveLength(0);
  });
});

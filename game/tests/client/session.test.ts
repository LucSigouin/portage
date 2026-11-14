import { describe, expect, it } from 'vitest';
import { Session } from '../../src/client/session.ts';
import type { SessionSignal, StepDriver } from '../../src/client/session.ts';
import { SAVE_KEY_PREFIX, deserialize } from '../../src/save/index.ts';
import { SETTINGS_KEY } from '../../src/settings/index.ts';
import { FIXED_STEP, NEUTRAL_INPUT, islandLanding } from '../../src/sim/index.ts';
import type { GameState } from '../../src/sim/index.ts';
import { FakeStorage, give, standOn } from '../support.ts';

interface Harness {
  session: Session;
  storage: FakeStorage;
  signals: SessionSignal[];
  /** Advance the wall clock, milliseconds. */
  wait(milliseconds: number): void;
  notices(): string[];
  sounds(): string[];
}

function harness(storage = new FakeStorage()): Harness {
  let clock = 1_000_000;
  let seed = 100;
  const session = new Session({ storage, now: () => clock, randomSeed: () => (seed += 1) });
  const signals: SessionSignal[] = [];
  session.subscribe((signal) => signals.push(signal));
  return {
    session, storage, signals,
    wait: (milliseconds) => {
      clock += milliseconds;
    },
    notices: () => signals.flatMap((signal) => (signal.type === 'notice' ? [signal.text] : [])),
    sounds: () => signals.flatMap((signal) => (signal.type === 'interface_sound' ? [signal.sound] : [])),
  };
}

const savedState = (storage: FakeStorage, slot: number): GameState => {
  const result = deserialize(storage.getItem(`${SAVE_KEY_PREFIX}${slot}`));
  if (!result.ok) throw new Error(`slot ${slot}: ${result.reason}`);
  return result.state;
};

/** A storage that counts the writes tried on the save slots, the refused ones too. */
class CountingStorage extends FakeStorage {
  saveTries = 0;

  override setItem(key: string, value: string): void {
    if (key.startsWith(SAVE_KEY_PREFIX)) this.saveTries += 1;
    super.setItem(key, value);
  }
}

/** What a refused save says, by hand or by itself. */
const SAVE_REFUSED = 'Could not save: the browser refused the write.';

/** Every note about a refused save, whole: the words and the tone. */
const refusedNotes = (h: Harness): SessionSignal[] =>
  h.signals.filter((signal) => signal.type === 'notice' && signal.text === SAVE_REFUSED);

/** Queue an event in the running game, as the rules would: the next frame drains it. */
function queue(session: Session, event: GameState['events'][number]): void {
  session.game!.events.push(event);
}

/** Run frames of 1/60 s. */
function frames(session: Session, seconds: number): void {
  for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += FIXED_STEP) session.advance(FIXED_STEP, 0);
}

/** Put the canoe just off Home Knoll's beach, bow toward it, so one press of E lands. */
function nearShore(state: GameState): void {
  const landing = islandLanding('home_knoll');
  state.canoe.position = { x: landing.shore.x, y: 0, z: landing.shore.z - 2 };
  state.canoe.heading = landing.bearing;
  state.canoe.speed = 0;
  state.players[0].position = { ...state.canoe.position };
}

describe('lobby and save slots', () => {
  it('starts in the lobby with default settings and a backdrop that keeps moving', () => {
    const { session } = harness();
    expect(session.screen).toBe('lobby');
    expect(session.game).toBeNull();
    expect(session.settings.audio.master).toBe(0.8);
    expect(session.latestSlot()).toBeNull();
    const before = session.backdrop.time;
    expect(session.advance(0.2, 0)).toEqual([]);
    expect(session.backdrop.time).toBeCloseTo(before + 0.2);
    expect(session.backdrop.events).toEqual([]);
    expect(session.activeState).toBe(session.backdrop);
  });

  it('keeps the backdrop afloat however long the lobby stays open', () => {
    const { session } = harness();
    const start = session.backdrop.time;
    // An hour in the lobby. A plain new game would have swamped within two minutes.
    for (let elapsed = 0; elapsed < 3600; elapsed += 0.25) session.advance(0.25, 0);
    const backdrop = session.backdrop;
    expect(backdrop.statistics.fails).toBe(0);
    expect(backdrop.players[0].mode).toBe('canoe');
    expect(backdrop.canoe.beached).toBe(false);
    expect(backdrop.canoe.waterLevel).toBeLessThan(5);
    expect(backdrop.players[0].thirst).toBeGreaterThan(30);
    expect(backdrop.time).toBeCloseTo(start + 3600, 0); // the clock runs on through every reset
  });

  it('starts a new game in a slot with a fresh seed each time, and saves it at once', () => {
    const { session, storage, signals } = harness();
    session.handleIntent({ type: 'new_game', slot: 1 });
    // The pick screen first (`tests/client/cast.test.ts`): the game starts from its button.
    expect(session.screen).toBe('lobby');
    session.handleIntent({ type: 'cast_confirm' });
    expect(session.screen).toBe('game');
    expect(session.slot).toBe(1);
    const first = session.game!;
    expect(savedState(storage, 1).seed).toBe(first.seed);
    expect(signals.map((signal) => signal.type)).toEqual(expect.arrayContaining(['screen_changed', 'game_started', 'saved']));

    session.handleIntent({ type: 'quit_to_lobby' });
    session.handleIntent({ type: 'answer_confirm', accepted: true });
    session.handleIntent({ type: 'new_game', slot: 2 });
    session.handleIntent({ type: 'cast_confirm' });
    expect(session.game!.seed).not.toBe(first.seed);
    expect(session.slotSummaries().map((summary) => summary.empty)).toEqual([true, false, false]);
    expect(session.newGame(3)).toBe(false); // there is no fourth slot
  });

  it('continues the newest save and loads any slot, restoring the state exactly', () => {
    const h = harness();
    const { session } = h;
    session.newGame(0);
    frames(session, 2);
    h.wait(60_000);
    session.quitToLobby();
    session.newGame(2);
    session.keyDown('KeyR'); // bail, so this game is visibly different
    frames(session, 3);
    session.keyUp('KeyR');
    const played = JSON.parse(JSON.stringify(session.game)) as GameState;
    h.wait(60_000);
    session.quitToLobby();
    expect(session.screen).toBe('lobby');
    expect(session.latestSlot()).toBe(2);

    session.handleIntent({ type: 'continue_game' });
    expect(session.slot).toBe(2);
    expect(session.game).toEqual({ ...played, events: [] });

    session.quitToLobby();
    session.handleIntent({ type: 'load_game', slot: 0 });
    expect(session.slot).toBe(0);
    expect(session.game!.playedSeconds).toBeCloseTo(2, 1);
  });

  it('refuses to load an empty or broken slot, and says so', () => {
    const h = harness();
    expect(h.session.loadGame(1)).toBe(false);
    expect(h.session.continueGame()).toBe(false);
    h.storage.setItem(`${SAVE_KEY_PREFIX}1`, '{not json');
    expect(h.session.loadGame(1)).toBe(false);
    expect(h.session.screen).toBe('lobby');
    expect(h.notices()).toEqual(['That slot is empty.', 'That save cannot be read.']);
    expect(h.sounds()).toContain('error');
  });

  it('asks before deleting a save, and before starting over a slot that holds a game', () => {
    const h = harness();
    const { session, storage } = h;
    session.newGame(0);
    const original = savedState(storage, 0).seed;
    session.quitToLobby();

    session.handleIntent({ type: 'new_game', slot: 0 });
    expect(session.screen).toBe('lobby'); // nothing happened yet
    expect(session.panels.confirm).toEqual({ type: 'overwrite_save', slot: 0 });
    session.handleIntent({ type: 'answer_confirm', accepted: false });
    expect(savedState(storage, 0).seed).toBe(original);

    session.handleIntent({ type: 'delete_save', slot: 0 });
    expect(storage.getItem(`${SAVE_KEY_PREFIX}0`)).not.toBeNull();
    session.handleIntent({ type: 'answer_confirm', accepted: true });
    expect(storage.getItem(`${SAVE_KEY_PREFIX}0`)).toBeNull();
    expect(session.slotSummaries()[0].empty).toBe(true);

    session.newGame(0);
    const replaced = savedState(storage, 0).seed;
    session.quitToLobby();
    session.handleIntent({ type: 'new_game', slot: 0 });
    session.handleIntent({ type: 'answer_confirm', accepted: true });
    // Yes to starting over leads to the pick screen: the old game is still in the slot until its button is pressed.
    expect(session.screen).toBe('lobby');
    expect(savedState(storage, 0).seed).toBe(replaced);
    session.handleIntent({ type: 'cast_confirm' });
    expect(session.screen).toBe('game');
    expect(savedState(storage, 0).seed).not.toBe(replaced);
    expect(savedState(storage, 0).seed).not.toBe(original);
  });

  it('saves and returns to the lobby on quit, after a confirm', () => {
    const { session, storage } = harness();
    session.newGame(1);
    frames(session, 1);
    session.handleIntent({ type: 'quit_to_lobby' });
    expect(session.screen).toBe('game');
    expect(session.paused).toBe(true); // the confirm dialog pauses
    session.handleIntent({ type: 'answer_confirm', accepted: true });
    expect(session.screen).toBe('lobby');
    expect(session.game).toBeNull();
    expect(savedState(storage, 1).playedSeconds).toBeCloseTo(1, 1);
  });
});

describe('autosave', () => {
  it('saves when the engine asks: on landing', () => {
    const h = harness();
    const { session, storage } = h;
    session.newGame(0);
    nearShore(session.game!);
    session.keyDown('KeyF'); // the interact key follows selectInteractable: here it lands
    session.keyUp('KeyF');
    expect(session.game!.players[0].mode).toBe('foot');
    expect(savedState(storage, 0).players[0].mode).toBe('canoe'); // not yet: the event is still queued
    const events = session.advance(FIXED_STEP, 0);
    expect(events.map((event) => event.type)).toContain('autosave_requested');
    expect(savedState(storage, 0).players[0].mode).toBe('foot');
    expect(h.signals).toContainEqual({ type: 'saved', slot: 0, reason: 'landing' });
  });

  it('saves on the timer from the settings, and not at all when it is off', () => {
    const h = harness();
    const { session, storage } = h;
    session.handleIntent({ type: 'change_setting', setting: 'gameplay.autosaveIntervalSeconds', value: 60 });
    session.newGame(0);
    const timerSaves = (): number => h.signals.filter((signal) => signal.type === 'saved' && signal.reason === 'timer').length;
    frames(session, 59);
    expect(timerSaves()).toBe(0);
    frames(session, 2);
    expect(timerSaves()).toBe(1);
    expect(savedState(storage, 0).playedSeconds).toBeGreaterThan(59);

    // Turning it off applies to the running game.
    session.updateSettings({ ...session.settings, gameplay: { ...session.settings.gameplay, autosaveIntervalSeconds: 0 } });
    frames(session, 200);
    expect(timerSaves()).toBe(1);
  });

  it('a browser that dies takes little with it: the knife just made and the quest just completed are in the save', () => {
    const h = harness();
    const { session, storage } = h;
    // No timer at all, to show these two saves do not lean on it.
    session.handleIntent({ type: 'change_setting', setting: 'gameplay.autosaveIntervalSeconds', value: 0 });
    session.newGame(0);
    const saves = (): string[] => h.signals.flatMap((signal) => (signal.type === 'saved' ? [signal.reason] : []));
    expect(saves()).toEqual(['manual']);
    expect(savedState(storage, 0).tools).toEqual(['bailing_can']);

    // Minutes of play, and nothing has asked for a save.
    frames(session, 30);
    give(session.game!, 'stone', 2);
    give(session.game!, 'driftwood', 1);
    give(session.game!, 'fiber', 2);
    expect(saves()).toEqual(['manual']);
    // The knife is made, as from the crafting panel.
    session.handleIntent({ type: 'command', command: { type: 'craft', recipeId: 'stone_knife', count: 1 } });
    expect(savedState(storage, 0).tools, 'not yet: the event is still queued').toEqual(['bailing_can']);
    session.advance(FIXED_STEP, 0);
    expect(saves()).toEqual(['manual', 'tool']);
    expect(savedState(storage, 0).tools).toEqual(['bailing_can', 'stone_knife']);

    // The first quest completes: bailed dry, then ashore on Home Knoll.
    session.game!.canoe.waterLevel = 0;
    standOn(session.game!, 'home_knoll');
    const events: string[] = [];
    for (let frame = 0; frame < 30; frame += 1) events.push(...session.advance(FIXED_STEP, 0).map((event) => event.type));
    expect(events).toContain('quest_completed');
    expect(saves()).toEqual(['manual', 'tool', 'quest']);
    expect(savedState(storage, 0).quests.bail_out.status).toBe('completed');

    // The browser dies here: no page-close save, nothing more. Another session on the same storage has it all.
    const played = session.game!.playedSeconds;
    const after = harness(storage);
    expect(after.session.continueGame()).toBe(true);
    expect(after.session.game!.tools).toEqual(['bailing_can', 'stone_knife']);
    expect(after.session.game!.quests.bail_out.status).toBe('completed');
    expect(after.session.game!.quests.first_haul.status).toBe('active');
    // What is lost is the half second since the quest completed, not the minutes since the last landing.
    expect(played - after.session.game!.playedSeconds).toBeGreaterThanOrEqual(0);
    expect(played - after.session.game!.playedSeconds).toBeLessThan(0.5);
  });

  it('never writes a save for a staged game', () => {
    const h = harness();
    const donor = harness();
    donor.session.newGame(0);
    h.session.adoptGame(donor.session.game!);
    nearShore(h.session.game!);
    h.session.dispatch({ type: 'disembark' });
    frames(h.session, 1);
    expect(h.session.slot).toBeNull();
    expect(h.session.saveNow()).toBe(false);
    expect([...h.storage.entries.keys()].filter((key) => key.startsWith(SAVE_KEY_PREFIX))).toEqual([]);
  });
});

describe('a save the browser refuses', () => {
  /** A game in slot 0, saved once, autosaving every `interval` seconds (0: timer off). */
  function playing(interval: number): Harness & { storage: CountingStorage; saves(): string[] } {
    const storage = new CountingStorage();
    const h = harness(storage);
    h.session.handleIntent({ type: 'change_setting', setting: 'gameplay.autosaveIntervalSeconds', value: interval });
    h.session.newGame(0);
    expect(storage.saveTries).toBe(1);
    return { ...h, storage, saves: () => h.signals.flatMap((signal) => (signal.type === 'saved' ? [signal.reason] : [])) };
  }

  it('says so once when the autosave is refused, in the hand save\'s words, and waits a full interval before each new try', () => {
    const h = playing(60);
    const { session, storage } = h;
    storage.failWrites = true;
    frames(session, 59);
    expect(storage.saveTries).toBe(1);
    expect(refusedNotes(h)).toEqual([]);
    // The timer runs out, the write is refused: one note.
    frames(session, 2);
    expect(storage.saveTries).toBe(2);
    expect(refusedNotes(h)).toEqual([{ type: 'notice', text: SAVE_REFUSED, tone: 'danger' }]);
    // 57 more seconds, 3,420 frames: not one more try, not one more note.
    frames(session, 57);
    expect(storage.saveTries).toBe(2);
    // Then one try an interval, and still the one note for the whole stretch.
    frames(session, 4);
    expect(storage.saveTries).toBe(3);
    frames(session, 120);
    expect(storage.saveTries).toBe(5);
    expect(refusedNotes(h)).toHaveLength(1);
    expect(h.saves()).toEqual(['manual']);
    // The hand save says the very same thing.
    expect(session.saveNow()).toBe(false);
    expect(refusedNotes(h)).toEqual(Array(2).fill({ type: 'notice', text: SAVE_REFUSED, tone: 'danger' }));
  });

  it('a later save that works ends the stretch without a word, and a new refusal speaks again', () => {
    const h = playing(60);
    const { session, storage } = h;
    storage.failWrites = true;
    frames(session, 61);
    expect(refusedNotes(h)).toHaveLength(1);
    // The browser takes writes again: the next try saves, as any timed save does.
    storage.failWrites = false;
    frames(session, 61);
    expect(h.saves()).toEqual(['manual', 'timer']);
    expect(savedState(storage, 0).playedSeconds).toBeGreaterThan(119);
    frames(session, 30);
    expect(refusedNotes(h)).toHaveLength(1);
    expect(h.notices()).toEqual([SAVE_REFUSED]);
    // A second bad stretch: one note more, and one only.
    storage.failWrites = true;
    frames(session, 31);
    expect(refusedNotes(h)).toHaveLength(2);
    frames(session, 120);
    expect(refusedNotes(h)).toHaveLength(2);
    expect(h.saves()).toEqual(['manual', 'timer']);
  });

  it('a tool gained in a bad stretch tries at once and adds no second note', () => {
    const h = playing(60);
    const { session, storage } = h;
    storage.failWrites = true;
    frames(session, 61);
    expect(storage.saveTries).toBe(2);
    queue(session, { type: 'item_gained', itemId: 'pry_bar', count: 1, container: 'belt', playerId: 0 });
    session.advance(FIXED_STEP, 0);
    expect(storage.saveTries).toBe(3);
    expect(refusedNotes(h)).toHaveLength(1);
    // That refusal restarts the clock: the next timed try is a full interval after it.
    frames(session, 58);
    expect(storage.saveTries).toBe(3);
    frames(session, 3);
    expect(storage.saveTries).toBe(4);
    expect(refusedNotes(h)).toHaveLength(1);
  });

  it('with timed autosave off: one note, and no new try until the next quest, tool, landing or sleep', () => {
    const h = playing(0);
    const { session, storage } = h;
    storage.failWrites = true;
    // The knife is made, as from the crafting panel: that save is refused.
    give(session.game!, 'stone', 2);
    give(session.game!, 'driftwood', 1);
    give(session.game!, 'fiber', 2);
    session.handleIntent({ type: 'command', command: { type: 'craft', recipeId: 'stone_knife', count: 1 } });
    session.advance(FIXED_STEP, 0);
    expect(storage.saveTries).toBe(2);
    expect(refusedNotes(h)).toEqual([{ type: 'notice', text: SAVE_REFUSED, tone: 'danger' }]);
    expect(h.saves()).toEqual(['manual']);
    // Two minutes of play, 7,200 frames: nothing tried, nothing more said.
    // (Not longer: left alone, this game completes its first quest at 160 s, and that is a moment that tries.)
    frames(session, 120);
    expect(storage.saveTries).toBe(2);
    expect(refusedNotes(h)).toHaveLength(1);
    // The next such moment tries again. Same stretch: no second note.
    queue(session, { type: 'item_gained', itemId: 'pry_bar', count: 1, container: 'belt', playerId: 0 });
    session.advance(FIXED_STEP, 0);
    expect(storage.saveTries).toBe(3);
    expect(refusedNotes(h)).toHaveLength(1);
    // One that works ends the stretch, and is reported as it always was.
    storage.failWrites = false;
    queue(session, { type: 'autosave_requested', reason: 'landing' });
    session.advance(FIXED_STEP, 0);
    expect(h.saves()).toEqual(['manual', 'landing']);
    expect(savedState(storage, 0).tools).toEqual(['bailing_can', 'stone_knife']);
    frames(session, 5);
    expect(refusedNotes(h)).toHaveLength(1);
    // A new refusal after it speaks again.
    storage.failWrites = true;
    queue(session, { type: 'autosave_requested', reason: 'sleeping' });
    session.advance(FIXED_STEP, 0);
    expect(storage.saveTries).toBe(5);
    expect(refusedNotes(h)).toHaveLength(2);
  });

  it('a refused hand save speaks every time, as before, and an autosave refused after it says nothing more', () => {
    const h = playing(60);
    const { session, storage } = h;
    storage.failWrites = true;
    expect(session.saveNow()).toBe(false);
    expect(session.saveNow()).toBe(false);
    expect(refusedNotes(h)).toHaveLength(2);
    // The timer's own refusal, in the same stretch: the player has been told.
    frames(session, 61);
    expect(storage.saveTries).toBe(4);
    expect(refusedNotes(h)).toHaveLength(2);
    // A hand save that works ends the stretch.
    storage.failWrites = false;
    expect(session.saveNow()).toBe(true);
    expect(h.saves()).toEqual(['manual', 'manual']);
    storage.failWrites = true;
    frames(session, 61);
    expect(storage.saveTries).toBe(6);
    expect(refusedNotes(h)).toHaveLength(3);
    expect(refusedNotes(h)).toEqual(Array(3).fill({ type: 'notice', text: SAVE_REFUSED, tone: 'danger' }));
  });

  it('a game loaded after a bad stretch is told afresh, once', () => {
    const h = playing(60);
    const { session, storage } = h;
    storage.failWrites = true;
    session.quitToLobby();
    expect(refusedNotes(h)).toHaveLength(1); // the save on quitting, refused
    expect(session.loadGame(0)).toBe(true);
    frames(session, 61);
    expect(refusedNotes(h)).toHaveLength(2);
    frames(session, 61);
    expect(refusedNotes(h)).toHaveLength(2);
  });

  it('a game with no slot writes nothing and is told nothing, whatever the browser refuses', () => {
    const storage = new CountingStorage();
    const h = harness(storage);
    const donor = harness();
    donor.session.newGame(0);
    h.session.handleIntent({ type: 'change_setting', setting: 'gameplay.autosaveIntervalSeconds', value: 60 });
    h.session.adoptGame(donor.session.game!);
    storage.failWrites = true;
    queue(h.session, { type: 'autosave_requested', reason: 'landing' });
    frames(h.session, 61);
    expect(h.session.saveNow()).toBe(false);
    h.session.pageClosing();
    expect(storage.saveTries).toBe(0);
    expect(h.notices()).toEqual([]);
    expect(h.signals.filter((signal) => signal.type === 'saved')).toEqual([]);
  });
});

describe('settings', () => {
  it('saves every change and loads it back in the next session', () => {
    const h = harness();
    h.session.handleIntent({ type: 'change_setting', setting: 'audio.master', value: 0.3 });
    h.session.handleIntent({ type: 'change_setting', setting: 'accessibility.patternedMeters', value: true });
    expect(JSON.parse(h.storage.getItem(SETTINGS_KEY)!).audio.master).toBe(0.3);
    expect(h.signals.filter((signal) => signal.type === 'settings_changed')).toHaveLength(2);
    const next = harness(h.storage);
    expect(next.session.settings.audio.master).toBe(0.3);
    expect(next.session.settings.accessibility.patternedMeters).toBe(true);
  });

  it('applies the difficulty to the running game and to new and loaded ones', () => {
    const { session } = harness();
    session.newGame(0);
    expect(session.game!.difficulty).toBe('standard');
    session.handleIntent({ type: 'change_setting', setting: 'gameplay.difficulty', value: 'relaxed' });
    expect(session.game!.difficulty).toBe('relaxed');
    session.quitToLobby();
    session.newGame(1);
    expect(session.game!.difficulty).toBe('relaxed');
    session.updateSettings({ ...session.settings, gameplay: { ...session.settings.gameplay, difficulty: 'standard' } });
    session.quitToLobby();
    session.loadGame(0); // saved as relaxed, before the setting went back
    expect(session.game!.difficulty).toBe('standard');
  });

  it('rebinds a key from the settings screen and reports the conflict', () => {
    const h = harness();
    const { session } = h;
    session.handleIntent({ type: 'open_panel', panel: 'settings' });
    session.handleIntent({ type: 'select_settings_tab', tab: 'controls' });
    session.handleIntent({ type: 'begin_rebind', action: 'paddle', slot: 0 });
    expect(session.input.capture).toEqual({ action: 'paddle', slot: 0 });
    session.keyDown('KeyF');
    session.keyUp('KeyF');
    expect(session.input.capture).toBeNull();
    expect(session.settings.controls.keyBindings.paddle).toEqual(['KeyF', 'ArrowUp']);
    expect(session.settings.controls.keyBindings.interact).toEqual([]);
    expect(session.bindingNotice).toBe('Paddle is now F. Land / interact / scavenge / board lost that key.');
    expect(JSON.parse(h.storage.getItem(SETTINGS_KEY)!).controls.keyBindings.paddle).toEqual(['KeyF', 'ArrowUp']);
    expect(session.isOpen('settings')).toBe(true); // the captured key did not close or open anything

    // Esc cancels a capture without closing the panel.
    session.handleIntent({ type: 'begin_rebind', action: 'bail', slot: 0 });
    session.keyDown('Escape');
    expect(session.input.capture).toBeNull();
    expect(session.isOpen('settings')).toBe(true);
    expect(session.settings.controls.keyBindings.bail).toEqual(['KeyR']);

    // The new binding drives the game.
    session.handleIntent({ type: 'close_panel' });
    session.newGame(0);
    session.keyDown('KeyF');
    frames(session, 2);
    expect(session.game!.canoe.speed).toBeGreaterThan(0.5);
  });

  it('clears one key, and resets them all after a confirm', () => {
    const { session } = harness();
    session.handleIntent({ type: 'clear_binding', action: 'paddle', slot: 1 });
    expect(session.settings.controls.keyBindings.paddle).toEqual(['KeyW']);
    session.handleIntent({ type: 'reset_key_bindings' });
    expect(session.settings.controls.keyBindings.paddle).toEqual(['KeyW']);
    session.handleIntent({ type: 'answer_confirm', accepted: true });
    expect(session.settings.controls.keyBindings.paddle).toEqual(['KeyW', 'ArrowUp']);
  });
});

describe('pausing', () => {
  it('freezes the simulation while a full panel or the pause menu is open', () => {
    const { session } = harness();
    session.newGame(0);
    frames(session, 1);
    const time = session.game!.time;
    session.keyDown('Tab');
    expect(session.isOpen('inventory')).toBe(true);
    expect(session.paused).toBe(true);
    frames(session, 5);
    expect(session.game!.time).toBe(time);
    expect(session.simulatedSeconds).toBe(0);
    session.keyDown('Escape'); // closes the inventory
    expect(session.paused).toBe(false);
    session.keyDown('Escape'); // now pauses
    expect(session.isOpen('pause')).toBe(true);
    frames(session, 5);
    expect(session.game!.time).toBe(time);
    session.handleIntent({ type: 'resume' });
    frames(session, 1);
    expect(session.game!.time).toBeCloseTo(time + 1, 5);
  });

  it('pauses, lets go of the keys and saves when the tab is hidden', () => {
    const { session, storage } = harness();
    session.newGame(0);
    session.keyDown('KeyW');
    frames(session, 2);
    const time = session.game!.time;
    session.setHidden(true);
    expect(session.paused).toBe(true);
    expect(savedState(storage, 0).playedSeconds).toBeCloseTo(2, 1);
    frames(session, 5);
    expect(session.game!.time).toBe(time);
    session.setHidden(false);
    frames(session, 5);
    // The W that was held when the tab went away is no longer held.
    expect(Math.abs(session.game!.canoe.speed)).toBeLessThan(0.3);
  });

  it('keeps the world moving during a conversation and ends it on Esc', () => {
    const { session } = harness();
    session.newGame(0);
    const game = session.game!;
    standOn(game, 'orchard_hill');
    game.players[0].dialogue = { npcId: 'odile', nodeId: 'hub' };
    session.advance(FIXED_STEP, 0);
    expect(session.isOpen('dialogue')).toBe(true);
    expect(session.paused).toBe(false);
    const time = game.time;
    frames(session, 1);
    expect(game.time).toBeCloseTo(time + 1, 5);
    session.keyDown('Escape');
    expect(game.players[0].dialogue).toBeNull();
    session.advance(FIXED_STEP, 0);
    expect(session.isOpen('dialogue')).toBe(false);
  });

  it('holds a staged shot still when frozen', () => {
    const { session } = harness();
    session.newGame(0);
    session.frozen = true;
    const time = session.game!.time;
    frames(session, 2);
    expect(session.game!.time).toBe(time);
  });
});

describe('keys and commands', () => {
  it('drives the canoe from the keyboard, and not while a panel is open', () => {
    const { session } = harness();
    session.newGame(0);
    session.keyDown('KeyW');
    frames(session, 2);
    expect(session.game!.canoe.speed).toBeGreaterThan(0.5);
    expect(session.lastInput.paddle).toBe(1);
    session.keyUp('KeyW');

    session.keyDown('KeyM');
    expect(session.isOpen('map')).toBe(true);
    expect(session.inputSnapshot()).toBeNull();
    session.keyDown('KeyL'); // would toggle the lantern
    expect(session.game!.events).toEqual([]);
  });

  it('opens the boat\'s menu on B afloat and beached, and says nothing about it', () => {
    const h = harness();
    const { session } = h;
    session.newGame(0);
    session.keyDown('KeyB');
    expect(session.isOpen('canoe_builder')).toBe(true);
    expect(h.notices()).toEqual([]);
    expect(h.sounds().at(-1)).toBe('open');
    session.keyDown('KeyB');
    expect(session.isOpen('canoe_builder')).toBe(false);
    standOn(session.game!, 'home_knoll');
    session.keyDown('KeyB');
    expect(session.isOpen('canoe_builder')).toBe(true);
    expect(h.sounds().at(-1)).toBe('open');
  });

  it('turns a refused command into a notice that names what is missing', () => {
    const h = harness();
    const { session } = h;
    session.newGame(0);
    standOn(session.game!, 'home_knoll');
    session.handleIntent({ type: 'command', command: { type: 'upgrade_hull' } });
    expect(h.notices()).toEqual(['Needs 2 more pitch, 3 more birch bark.']);
    give(session.game!, 'pitch', 2);
    give(session.game!, 'birch_bark', 3);
    session.handleIntent({ type: 'command', command: { type: 'upgrade_hull' } });
    expect(session.game!.canoe.hullTier).toBe(1);
    expect(h.notices()).toHaveLength(1);
    expect(h.sounds().at(-1)).toBe('click');
    // Quiet probes (the bot's) raise nothing.
    expect(session.dispatch({ type: 'sleep' }, true).ok).toBe(false);
    expect(h.notices()).toHaveLength(1);
  });

  it('opens the credits when the Beacon is lit', () => {
    const { session } = harness();
    session.newGame(0);
    session.keyDown('Tab');
    session.game!.flags.beacon_lit = true;
    session.game!.events.push({ type: 'game_completed' });
    session.advance(FIXED_STEP, 0);
    expect(session.panels.stack).toEqual(['credits']);
    expect(session.paused).toBe(true);
    session.keyDown('Escape');
    expect(session.paused).toBe(false); // free play
  });
});

describe('a step driver (the bot)', () => {
  it('feeds one input per fixed step at the time scale, then hands the keys back', () => {
    const h = harness();
    const { session } = h;
    session.newGame(0);
    let asked = 0;
    const driver: StepDriver = {
      next: () => {
        asked += 1;
        return asked <= 240 ? { ...NEUTRAL_INPUT, paddle: 1 } : null;
      },
    };
    session.attachDriver(driver);
    session.timeScale = 8;
    expect(session.hasDriver).toBe(true);
    const tick = session.game!.tick;
    session.keyDown('KeyS'); // the player's keys are ignored while the bot drives
    session.advance(1 / 60, 0);
    expect(session.game!.tick - tick).toBe(8);
    expect(session.simulatedSeconds).toBeCloseTo(8 * FIXED_STEP);
    expect(session.lastInput.paddle).toBe(1);
    for (let frame = 1; frame < 30; frame += 1) session.advance(1 / 60, 0);
    expect(session.game!.tick - tick).toBe(240);
    expect(session.hasDriver).toBe(true); // it has not been asked for step 241 yet
    session.advance(1 / 60, 0);
    expect(session.hasDriver).toBe(false);
    expect(h.signals).toContainEqual({ type: 'driver_finished' });
    expect(session.game!.canoe.speed).toBeGreaterThan(1.5);
    // The keys come back at normal speed, and the S pressed during the replay is not stuck down.
    expect(session.timeScale).toBe(1);
    frames(session, 1);
    expect(session.game!.tick - tick).toBe(300);
    expect(session.lastInput.paddle).toBe(0);
    expect(session.game!.canoe.speed).toBeGreaterThan(0);
    // Paused, the driver is not asked at all.
    asked = 0;
    session.attachDriver(driver);
    session.keyDown('Escape');
    frames(session, 1);
    expect(asked).toBe(0);
  });
});

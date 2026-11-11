import { describe, expect, it } from 'vitest';
import {
  SAVE_KEY_PREFIX, SAVE_SLOT_COUNT, SAVE_VERSION, createAutosaver, createSaveStore, deserialize, serialize,
} from '../src/save/index.ts';
import type { SaveMigration } from '../src/save/index.ts';
import { dispatch, hashState } from '../src/sim/index.ts';
import { FakeStorage, give, newGame, run, standOn, teleportToCamp } from './support.ts';

/** A game with some history in it. */
function playedGame() {
  const state = newGame(11);
  run(state, { bail: true }, 20);
  run(state, { paddle: 1 }, 32);
  if (!dispatch(state, { type: 'disembark' }).ok) throw new Error('staging: did not reach Home Knoll');
  give(state, 'driftwood', 5);
  run(state, { moveY: 1, moveX: 0.3 }, 3);
  state.events = [];
  return state;
}

describe('serialize and deserialize', () => {
  it('round-trips a game exactly', () => {
    const state = playedGame();
    const text = serialize(state, 123456);
    const loaded = deserialize(text);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.savedAt).toBe(123456);
    expect(loaded.migratedFrom).toBeNull();
    expect(loaded.state).toEqual(state);
    expect(hashState(loaded.state)).toBe(hashState(state));
    expect(JSON.parse(text).version).toBe(SAVE_VERSION);
  });

  it('does not save queued events', () => {
    const state = playedGame();
    state.events.push({ type: 'boarded' });
    const loaded = deserialize(serialize(state, 0));
    expect(loaded.ok && loaded.state.events).toEqual([]);
    expect(state.events).toHaveLength(1); // the live game keeps its queue
  });

  it('reports why a save cannot be loaded, and never throws', () => {
    expect(deserialize(null)).toEqual({ ok: false, reason: 'empty' });
    expect(deserialize('')).toEqual({ ok: false, reason: 'empty' });
    expect(deserialize('{not json')).toEqual({ ok: false, reason: 'corrupt' });
    expect(deserialize('42')).toEqual({ ok: false, reason: 'corrupt' });
    expect(deserialize(JSON.stringify({ version: SAVE_VERSION, savedAt: 1, state: { seed: 1 } }))).toEqual({ ok: false, reason: 'corrupt' });
    expect(deserialize(JSON.stringify({ version: SAVE_VERSION + 1, savedAt: 1, state: {} }))).toEqual({ ok: false, reason: 'from_newer_version' });
    expect(deserialize(JSON.stringify({ version: 0, savedAt: 1, state: {} }))).toEqual({ ok: false, reason: 'no_migration' });
  });

  it('migrates an old save forward through the hook', () => {
    const state = playedGame();
    const old = JSON.parse(serialize(state, 5));
    old.version = SAVE_VERSION - 1;
    old.state.clock = old.state.time; // pretend the field was once called something else
    delete old.state.time;
    const migrations: Record<number, SaveMigration> = {
      [SAVE_VERSION - 1]: (envelope) => {
        const previous = envelope.state as Record<string, unknown>;
        const { clock, ...rest } = previous;
        return { ...envelope, version: SAVE_VERSION, state: { ...rest, time: clock } };
      },
    };
    const loaded = deserialize(JSON.stringify(old), migrations);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.migratedFrom).toBe(SAVE_VERSION - 1);
    expect(loaded.state.time).toBe(state.time);
    expect(loaded.state.version).toBe(SAVE_VERSION);
    // A migration that does not move the version forward is refused rather than looping.
    const stuck = deserialize(JSON.stringify(old), { [SAVE_VERSION - 1]: (envelope) => envelope });
    expect(stuck).toEqual({ ok: false, reason: 'no_migration' });
  });
});

describe('save store', () => {
  it('keeps three slots in storage', () => {
    const storage = new FakeStorage();
    const store = createSaveStore(storage, () => 1000);
    expect(SAVE_SLOT_COUNT).toBe(3);
    expect(store.list().map((slot) => slot.empty)).toEqual([true, true, true]);
    expect(store.latestSlot()).toBeNull();
    const state = playedGame();
    expect(store.save(1, state)).toBe(true);
    expect([...storage.entries.keys()]).toEqual([`${SAVE_KEY_PREFIX}1`]);
    const loaded = store.load(1);
    expect(loaded.ok && loaded.state).toEqual(state);
    expect(store.load(0)).toEqual({ ok: false, reason: 'empty' });
    expect(store.save(3, state)).toBe(false);
    expect(store.save(-1, state)).toBe(false);
    expect(store.load(7)).toEqual({ ok: false, reason: 'empty' });
  });

  it('summarises slots for the lobby and finds the newest', () => {
    const storage = new FakeStorage();
    let clock = 1000;
    const store = createSaveStore(storage, () => clock);
    const early = newGame(1);
    const late = playedGame();
    late.time += 3 * 1440;
    store.save(0, early);
    clock = 5000;
    store.save(2, late);
    storage.setItem(`${SAVE_KEY_PREFIX}1`, 'garbage');
    const [first, second, third] = store.list();
    expect(first).toMatchObject({ slot: 0, empty: false, corrupt: false, savedAt: 1000, day: 1, mainQuestId: 'bail_out', difficulty: 'standard' });
    expect(second).toMatchObject({ slot: 1, empty: false, corrupt: true });
    expect(third).toMatchObject({ slot: 2, savedAt: 5000, day: 4, mainQuestId: 'first_haul' });
    expect(third.playedSeconds).toBeCloseTo(late.playedSeconds, 6);
    expect(store.latestSlot()).toBe(2);
    store.remove(2);
    expect(store.latestSlot()).toBe(0);
    expect(store.list()[2].empty).toBe(true);
  });

  it('survives storage that refuses to write', () => {
    const storage = new FakeStorage();
    storage.failWrites = true;
    const store = createSaveStore(storage, () => 1);
    expect(store.save(0, newGame())).toBe(false);
    expect(store.list()[0].empty).toBe(true);
  });
});

describe('autosave', () => {
  it('saves on landing, on sleeping, and on the timer', () => {
    const storage = new FakeStorage();
    const store = createSaveStore(storage, () => 1);
    const autosaver = createAutosaver(store, 0, 120);
    const state = newGame();
    expect(autosaver.update(state, [], 1)).toBeNull();
    expect(store.load(0).ok).toBe(false);

    state.canoe.waterLevel = 0;
    run(state, { paddle: 1 }, 32);
    state.events = [];
    expect(dispatch(state, { type: 'disembark' }).ok).toBe(true);
    expect(autosaver.update(state, state.events, 1 / 60)).toBe('landing');
    const landed = store.load(0);
    expect(landed.ok && landed.state.player.mode).toBe('foot');

    standOn(state, 'home_knoll');
    teleportToCamp(state, 'home_knoll');
    state.time = 23 * 60;
    state.events = [];
    dispatch(state, { type: 'sleep' });
    expect(autosaver.update(state, state.events, 1 / 60)).toBe('sleeping');

    expect(autosaver.update(state, [], 119)).toBeNull();
    expect(autosaver.update(state, [], 1.1)).toBe('timer');
    expect(autosaver.update(state, [], 60)).toBeNull(); // the timer restarted
  });

  it('turns the timer off at interval 0 and reports nothing when the save fails', () => {
    const storage = new FakeStorage();
    const store = createSaveStore(storage, () => 1);
    const autosaver = createAutosaver(store, 0, 0);
    const state = newGame();
    expect(autosaver.update(state, [], 10_000)).toBeNull();
    autosaver.setIntervalSeconds(60);
    expect(autosaver.update(state, [], 1)).toBe('timer');
    storage.failWrites = true;
    expect(autosaver.update(state, [{ type: 'autosave_requested', reason: 'landing' }], 1)).toBeNull();
  });
});

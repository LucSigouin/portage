import { describe, expect, it } from 'vitest';
import {
  SAVE_KEY_PREFIX, SAVE_SLOT_COUNT, SAVE_VERSION, createAutosaver, createSaveStore, deserialize, serialize,
} from '../src/save/index.ts';
import type { SaveMigration } from '../src/save/index.ts';
import { FIXED_STEP, NEUTRAL_INPUT, bearingDifference, dispatch, hashState, step } from '../src/sim/index.ts';
import { TUNING } from '../src/data/index.ts';
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

describe('old saves', () => {
  // Real version 1 saves, written by the solo build (commit 329521e) before the crew existed:
  // afloat ten seconds into a new game, ashore fifteen minutes in, and with the Beacon lit.
  const fixtures = import.meta.glob<string>('./fixtures/save-v1-*.json', { eager: true, query: '?raw', import: 'default' });
  const fixture = (name: string): string => fixtures[`./fixtures/save-v1-${name}.json`];

  it('has the three real version 1 saves to test with', () => {
    expect(Object.keys(fixtures).sort()).toEqual([
      './fixtures/save-v1-afloat.json', './fixtures/save-v1-ashore.json', './fixtures/save-v1-endgame.json',
    ]);
    for (const text of Object.values(fixtures)) {
      const old = JSON.parse(text);
      expect(old.version).toBe(1);
      expect(old.state.player).toBeTypeOf('object');
      expect(old.state.players).toBeUndefined();
    }
  });

  it('loads a solo save as a crew of one: the player becomes player 0 and keeps everything', () => {
    for (const name of ['afloat', 'ashore', 'endgame']) {
      const old = JSON.parse(fixture(name)).state;
      const loaded = deserialize(fixture(name));
      expect(loaded.ok, name).toBe(true);
      if (!loaded.ok) return;
      expect(loaded.migratedFrom).toBe(1);
      expect(loaded.savedAt).toBe(1762819200000);
      const state = loaded.state;
      expect(state.version).toBe(SAVE_VERSION);
      expect(state.players).toHaveLength(1);
      const player = state.players[0];
      const { keyItems, tools, harvest, interactWasHeld, ...solo } = old.player;
      // Every field the old player had is still on player 0, untouched...
      expect(player).toMatchObject(solo);
      // ...except the hold-to-scavenge state, which went with the hold.
      expect(harvest).toBeNull();
      expect(interactWasHeld).toBe(false);
      expect(Object.keys(player)).not.toContain('harvest');
      expect(Object.keys(player)).not.toContain('interactWasHeld');
      // It has exactly the shape of a player in a new game.
      expect(Object.keys(player).sort()).toEqual(Object.keys(newGame().players[0]).sort());
      expect(player).toMatchObject({ id: 0, paddling: false, bailing: false, asleep: false, dialogue: old.dialogue });
      expect(player.seat).toBe(old.player.mode === 'canoe' ? 0 : null);
      // The key items and the tools moved to the crew. Nothing of the old shape is left behind.
      expect(state.keyItems).toEqual(keyItems);
      expect(state.tools).toEqual(tools);
      expect(tools).toContain('bailing_can');
      expect(Object.keys(player)).not.toContain('tools');
      expect('player' in state).toBe(false);
      expect('dialogue' in state).toBe(false);
      // Everything shared is exactly as it was saved.
      for (const key of ['seed', 'randomState', 'tick', 'time', 'playedSeconds', 'canoe', 'weather', 'nodes', 'quests',
        'trackedQuestId', 'flags', 'discoveredIslands', 'bottlesFound', 'respawnCampIslandId', 'pendingRewards', 'statistics'] as const) {
        expect(state[key], `${name} ${key}`).toEqual(old[key]);
      }
      // And it saves again as a current save that loads without a migration.
      const again = deserialize(serialize(state, 7));
      expect(again.ok && again.migratedFrom).toBeNull();
      expect(again.ok && again.state).toEqual(state);
    }
    expect(JSON.parse(fixture('endgame')).state.player.keyItems).toEqual({ beacon_bearing: 1 });
    expect(JSON.parse(fixture('ashore')).state.player.backpack.length).toBeGreaterThan(0);
  });

  it('plays on from a migrated save', () => {
    const afloat = deserialize(fixture('afloat'));
    const ashore = deserialize(fixture('ashore'));
    if (!afloat.ok || !ashore.ok) throw new Error('fixture did not load');
    const before = { ...afloat.state.canoe.position };
    run(afloat.state, { paddle: 1 }, 5);
    expect(Math.hypot(afloat.state.canoe.position.x - before.x, afloat.state.canoe.position.z - before.z)).toBeGreaterThan(5);
    expect(afloat.state.players[0].position).toEqual(afloat.state.canoe.position);
    const walker = ashore.state.players[0];
    const stood = { ...walker.position };
    run(ashore.state, { moveX: 1, moveY: 1 }, 2);
    expect(Math.hypot(walker.position.x - stood.x, walker.position.z - stood.z)).toBeGreaterThan(1);
    expect(ashore.state.players[0].hunger).toBeLessThan(JSON.parse(fixture('ashore')).state.player.hunger);
  });

  it('opens an old save from a slot, and lists it in the lobby', () => {
    const storage = new FakeStorage();
    storage.setItem(`${SAVE_KEY_PREFIX}0`, fixture('ashore'));
    const store = createSaveStore(storage, () => 1000);
    const loaded = store.load(0);
    expect(loaded.ok && loaded.state.tools).toEqual(['bailing_can', 'stone_knife', 'hatchet']);
    expect(store.list()[0]).toMatchObject({ empty: false, corrupt: false, mainQuestId: 'ribs_and_rails' });
  });
});

describe('saves from before the wind swung', () => {
  // A real version 3 save written by commit 8db9b32, before the wind's bearing eased: twelve minutes
  // in, ashore on Home Knoll, in rain, 102 seconds before the next weather. Its weather has no `windTurn`.
  const fixtures = import.meta.glob<string>('./fixtures/save-v3-*.json', { eager: true, query: '?raw', import: 'default' });
  const text = fixtures['./fixtures/save-v3-ashore.json'];

  it('has the real save to test with, and it has no wind turn in it', () => {
    expect(Object.keys(fixtures)).toEqual(['./fixtures/save-v3-ashore.json']);
    const old = JSON.parse(text);
    expect(old.version).toBe(3);
    expect(old.state.weather.windDirection).toBeCloseTo(-2.4535, 4);
    expect('windTurn' in old.state.weather).toBe(false);
  });

  it('loads it exactly as it was saved, with no migration to run', () => {
    const loaded = deserialize(text);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.migratedFrom).toBeNull();
    expect(loaded.state).toEqual({ ...JSON.parse(text).state, version: SAVE_VERSION });
    expect(serialize(loaded.state, 1762819200000) + '\n').toBe(text);
  });

  it('plays on: the wind holds its bearing, then swings at the next weather instead of jumping', () => {
    const loaded = deserialize(text);
    if (!loaded.ok) throw new Error('the version 3 save did not load');
    const state = loaded.state;
    const bearing = state.weather.windDirection;
    run(state, {}, 100);
    expect(state.weather.windDirection).toBe(bearing);
    expect(state.weather.windTurn ?? 0).toBe(0);
    let widest = 0;
    let changed = false;
    for (let index = 0; index < 20 / FIXED_STEP; index += 1) {
      const before = state.weather.windDirection;
      step(state, NEUTRAL_INPUT, FIXED_STEP);
      changed ||= state.events.some((event) => event.type === 'weather_changed');
      state.events = [];
      expect(Number.isFinite(state.weather.windDirection)).toBe(true);
      widest = Math.max(widest, Math.abs(bearingDifference(state.weather.windDirection, before)));
    }
    expect(changed).toBe(true);
    expect(state.weather.windDirection).not.toBe(bearing);
    expect(widest).toBeLessThanOrEqual(TUNING.weather.windTurnPerSecond * FIXED_STEP + 1e-9);
    expect(state.weather.windTurn).toBe(0);
    // Saved now, it carries the new number and loads again the same.
    const again = deserialize(serialize(state, 9));
    expect(again.ok && again.state).toEqual(state);
  });
});

describe('crew saves', () => {
  it('round-trips a game with four players exactly', () => {
    const state = newGame(11, { crew: 4 });
    const inputs = [{ bail: true }, { paddle: 1 }, { steer: 0.2 }, { paddle: 1, powerStroke: true }]
      .map((input) => ({ ...NEUTRAL_INPUT, ...input }));
    run(state, { bail: true }, 20);
    run(state, { paddle: 1 }, 32);
    expect(dispatch(state, { type: 'disembark' }, 2).ok).toBe(true);
    expect(dispatch(state, { type: 'disembark' }, 0).ok).toBe(true);
    state.players[2].backpack.push({ itemId: 'driftwood', count: 5 });
    state.tools.push('hatchet');
    state.players[1].selectedTool = 'hatchet';
    state.players[3].selectedTool = 'hatchet';
    state.keyItems.lens = 1;
    for (let index = 0; index < 120; index += 1) step(state, [{ ...NEUTRAL_INPUT, moveX: 1 }, undefined, { ...NEUTRAL_INPUT, moveY: 1 }], FIXED_STEP);
    state.events = [];
    expect(state.players.map((player) => player.mode)).toEqual(['foot', 'canoe', 'foot', 'canoe']);

    const loaded = deserialize(serialize(state, 99));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.migratedFrom).toBeNull();
    expect(loaded.state).toEqual(state);
    expect(hashState(loaded.state)).toBe(hashState(state));
    expect(loaded.state.players.map((player) => player.id)).toEqual([0, 1, 2, 3]);
    // One belt for the crew, and each player's own tool in hand.
    expect(loaded.state.tools).toEqual(['bailing_can', 'hatchet']);
    expect(loaded.state.players.map((player) => player.selectedTool)).toEqual([null, 'hatchet', null, 'hatchet']);
    // The loaded game carries on exactly as the one that never stopped.
    for (let index = 0; index < 600; index += 1) {
      step(state, inputs, FIXED_STEP);
      step(loaded.state, inputs, FIXED_STEP);
    }
    expect(hashState(loaded.state)).toBe(hashState(state));
  });

  it('refuses a save with no players in it', () => {
    const broken = JSON.parse(serialize(newGame(3), 1));
    broken.state.players = [];
    expect(deserialize(JSON.stringify(broken))).toEqual({ ok: false, reason: 'corrupt' });
    delete broken.state.players;
    expect(deserialize(JSON.stringify(broken))).toEqual({ ok: false, reason: 'corrupt' });
  });

  it('refuses a save with no crew tool belt, such as one from before the tools were shared', () => {
    const old = JSON.parse(serialize(newGame(3, { crew: 2 }), 1));
    for (const player of old.state.players) player.tools = old.state.tools;
    delete old.state.tools;
    expect(deserialize(JSON.stringify(old))).toEqual({ ok: false, reason: 'corrupt' });
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
    expect(landed.ok && landed.state.players[0].mode).toBe('foot');

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

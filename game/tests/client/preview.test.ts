/**
 * Which canoe the lobby shows (Luc's bugfix list, Round 2: "on the loading screen is there a way it can preview
 * your boats look from the last save you played?"; Round 4: it drifts in the scene behind the menu): the canoe of
 * the save played last, in every case the brief names. No save, the last of several slots, a save from each older
 * build, a broken save.
 */
import { describe, expect, it } from 'vitest';
import { lastPlayedDress, savedDress } from '../../src/client/preview.ts';
import { ATTACHMENT_IDS } from '../../src/data/index.ts';
import { SAVE_KEY_PREFIX, createSaveStore, deserialize, serialize } from '../../src/save/index.ts';
import type { SaveStore } from '../../src/save/index.ts';
import type { CanoeState, GameState } from '../../src/sim/index.ts';
import { FakeStorage, newGame } from '../support.ts';

const fixtures = import.meta.glob<string>('../fixtures/save-*.json', { eager: true, query: '?raw', import: 'default' });

/** A store with a clock that moves a second with every save. */
function storeOn(storage: FakeStorage): SaveStore {
  let clock = 1_000;
  return createSaveStore(storage, () => (clock += 1_000));
}

const dressOf = (store: SaveStore) => lastPlayedDress(store.latestSlot(), (slot) => store.load(slot));

/** A game with a canoe of its own. */
function gameWith(change: (canoe: CanoeState, state: GameState) => void, seed = 7): GameState {
  const state = newGame(seed);
  change(state.canoe, state);
  return state;
}

describe('no save', () => {
  it('shows no saved canoe: the scene keeps its own', () => {
    expect(dressOf(storeOn(new FakeStorage()))).toBeNull();
    expect(lastPlayedDress(null, () => { throw new Error('nothing to read'); })).toBeNull();
  });
});

describe('several slots', () => {
  it('shows the canoe of the slot played last: the one Continue opens', () => {
    const store = storeOn(new FakeStorage());
    store.save(0, gameWith((canoe) => { canoe.hullTier = 1; }));
    store.save(2, gameWith((canoe) => { canoe.hullTier = 3; canoe.attachments = ['mast_sail', 'rudder']; canoe.sailRaised = true; }));
    store.save(1, gameWith((canoe) => { canoe.hullTier = 2; canoe.attachments = ['outrigger_port', 'lantern_mast']; canoe.lanternLit = true; }));
    expect(store.latestSlot()).toBe(1);
    expect(dressOf(store)).toEqual({ hullTier: 2, attachments: ['outrigger_port', 'lantern_mast'], sailRaised: false, lanternLit: true, rainProgress: 0 });

    // Play slot 2 again: it is the last now, and the canoe is its canoe.
    store.save(2, gameWith((canoe) => { canoe.hullTier = 3; canoe.attachments = ['mast_sail', 'rudder']; canoe.sailRaised = true; }));
    expect(dressOf(store)).toEqual({ hullTier: 3, attachments: ['mast_sail', 'rudder'], sailRaised: true, lanternLit: false, rainProgress: 0 });
  });
});

describe('the canoe as saved', () => {
  it('keeps the hull, every attachment in the order built, the sail, the lantern and the pail; and nothing of where it was', () => {
    const store = storeOn(new FakeStorage());
    const built = ['outrigger_port', 'workbench', 'mast_sail', 'rudder', 'cargo_rack', 'firebox', 'lantern_mast', 'rain_catcher'] as CanoeState['attachments'];
    store.save(0, gameWith((canoe) => {
      canoe.hullTier = 3;
      canoe.attachments = built;
      canoe.sailRaised = true;
      canoe.lanternLit = true;
      canoe.rainProgress = 0.4;
      canoe.beached = true;
      canoe.position = { x: 812, y: 0.4, z: -377 };
      canoe.heading = 2.2;
      canoe.waterLevel = 64;
    }));
    const dress = dressOf(store)!;
    expect(dress).toEqual({ hullTier: 3, attachments: built, sailRaised: true, lanternLit: true, rainProgress: 0.4 });
    expect(Object.keys(dress).sort()).toEqual(['attachments', 'hullTier', 'lanternLit', 'rainProgress', 'sailRaised']);
  });

  it('leaves out an attachment this build does not know, and one named twice', () => {
    expect(savedDress({ ...newGame(7).canoe, hullTier: 2, attachments: ['rudder', 'steam_engine', 'mast_sail', 'rudder', 7, null] })!.attachments).toEqual(['rudder', 'mast_sail']);
    expect(savedDress({ ...newGame(7).canoe, attachments: [...ATTACHMENT_IDS] })!.attachments).toEqual(ATTACHMENT_IDS);
  });

  it('a pail that is not a share from 0 to 1 is held to one, and one that is no number is empty', () => {
    const pail = (rainProgress: unknown): number => savedDress({ ...newGame(7).canoe, rainProgress })!.rainProgress;
    expect([pail(0.25), pail(7), pail(-3), pail(Number.NaN), pail('full'), pail(undefined)]).toEqual([0.25, 1, 0, 0, 0, 0]);
  });
});

describe('a save from an older build', () => {
  const names = Object.keys(fixtures).sort();

  it('finds the fixtures: three from live builds, three of version 1, one of version 3', () => {
    expect(names).toEqual([
      '../fixtures/save-live-seed3-min008.json', '../fixtures/save-live-seed3-min030.json', '../fixtures/save-live-seed7-min100.json',
      '../fixtures/save-v1-afloat.json', '../fixtures/save-v1-ashore.json', '../fixtures/save-v1-endgame.json', '../fixtures/save-v3-ashore.json',
    ]);
  });

  for (const name of names) {
    it(`${name.split('/').pop()} shows: its own hull and attachments, as saved`, () => {
      const text = fixtures[name]!;
      const saved = (JSON.parse(text) as { state: { canoe: CanoeState } }).state.canoe;
      const storage = new FakeStorage();
      storage.setItem(`${SAVE_KEY_PREFIX}1`, text);
      expect(dressOf(storeOn(storage))).toEqual({
        hullTier: saved.hullTier, attachments: saved.attachments, sailRaised: saved.sailRaised, lanternLit: saved.lanternLit,
        rainProgress: saved.rainProgress ?? 0,
      });
    });
  }
});

describe('a broken save', () => {
  const good = serialize(gameWith((canoe) => { canoe.hullTier = 2; }), 500);
  const withCanoe = (canoe: unknown): string => {
    const envelope = JSON.parse(good) as { state: Record<string, unknown> };
    envelope.state.canoe = canoe;
    return JSON.stringify(envelope);
  };
  const broken: [string, string][] = [
    ['cut short', good.slice(0, good.length / 2)],
    ['not a save', 'not a save at all'],
    ['from a newer build', good.replace(/^\{"version":\d+/, '{"version":99')],
    ['with no canoe in it', withCanoe(null)],
  ];

  for (const [what, text] of broken) {
    it(`${what}: no saved canoe, nothing thrown`, () => {
      const storage = new FakeStorage();
      storage.setItem(`${SAVE_KEY_PREFIX}0`, text);
      const store = storeOn(storage);
      expect(() => dressOf(store)).not.toThrow();
      expect(dressOf(store)).toBeNull();
      // Even asked for that very slot, as if it were the one Continue opens.
      expect(lastPlayedDress(0, (slot) => store.load(slot))).toBeNull();
    });
  }

  const undrawable: [string, unknown][] = [
    ['a hull this build does not have', { ...newGame(7).canoe, hullTier: 9 }],
    ['a hull that is not a whole number', { ...newGame(7).canoe, hullTier: 1.5 }],
    ['a hull that is not a number', { ...newGame(7).canoe, hullTier: 'long' }],
    ['attachments that are not a list', { ...newGame(7).canoe, attachments: 'mast_sail' }],
  ];
  for (const [what, canoe] of undrawable) {
    it(`a save that loads but holds ${what}: no saved canoe, nothing thrown`, () => {
      const storage = new FakeStorage();
      storage.setItem(`${SAVE_KEY_PREFIX}0`, withCanoe(canoe));
      const store = storeOn(storage);
      // It loads: the save layer only asks that there is a canoe.
      expect(deserialize(withCanoe(canoe)).ok).toBe(true);
      expect(store.latestSlot()).toBe(0);
      expect(() => dressOf(store)).not.toThrow();
      expect(dressOf(store)).toBeNull();
      expect(savedDress(canoe)).toBeNull();
    });
  }

  it('a slot that cannot be read at all (the reader throws): no saved canoe, nothing thrown', () => {
    const read = (): unknown => lastPlayedDress(0, () => { throw new Error('storage is gone'); });
    expect(read).not.toThrow();
    expect(read()).toBeNull();
    expect(lastPlayedDress(0, () => ({ ok: false, reason: 'corrupt' }))).toBeNull();
  });

  it('the newest save broken and an older one good: the older one is shown, the one Continue opens', () => {
    const storage = new FakeStorage();
    const store = storeOn(storage);
    store.save(1, gameWith((canoe) => { canoe.hullTier = 1; canoe.attachments = ['rudder']; }));
    storage.setItem(`${SAVE_KEY_PREFIX}2`, '{"version":3,"savedAt":99999999,"state":{"seed":1');
    expect(store.latestSlot()).toBe(1);
    expect(dressOf(store)).toMatchObject({ hullTier: 1, attachments: ['rudder'] });
  });
});

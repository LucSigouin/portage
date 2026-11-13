/**
 * The lobby's canoe preview, the part that decides (Luc's bugfix list, Round 2: "on the loading screen is there a
 * way it can preview your boats look from the last save you played?"): which canoe is shown and what is said
 * under it, in every case the brief names. No save, the last of several slots, a save from each older build,
 * a broken save. And when the one picture is drawn.
 */
import { describe, expect, it } from 'vitest';
import type { GameInterface, InterfaceModel } from '../../src/client/contracts.ts';
import {
  FIRST_DRAW_FRAME, SETTLE_MILLISECONDS, STARTER_CAPTION, drawDue, pixelNudge, posedCanoe, previewCaption, previewModel, previewSubject,
  sketchPixels, starterSubject,
} from '../../src/client/preview.ts';
import { buildLobbyModel } from '../../src/client/viewmodels/index.ts';
import { ATTACHMENT_IDS, HULL_TIERS } from '../../src/data/index.ts';
import { withCanoePreview } from '../../src/interface/preview-host.ts';
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

const subjectOf = (store: SaveStore) => previewSubject(store.list(), store.latestSlot(), (slot) => store.load(slot));

/** A game with a canoe of its own. */
function gameWith(change: (canoe: CanoeState, state: GameState) => void, seed = 7): GameState {
  const state = newGame(seed);
  change(state.canoe, state);
  return state;
}

describe('no save', () => {
  it('shows the leaky canoe a new game starts with, and says "Your canoe awaits"', () => {
    const subject = subjectOf(storeOn(new FakeStorage()));
    expect(subject).not.toBeNull();
    expect(subject!.kind).toBe('starter');
    expect(subject!.slot).toBeNull();
    expect(subject!.caption).toBe('Your canoe awaits');
    expect(subject!.caption).toBe(STARTER_CAPTION);
    expect(subject!.state.canoe.hullTier).toBe(newGame(3).canoe.hullTier);
    expect(subject!.state.canoe.hullTier).toBe(0);
    expect(subject!.state.canoe.attachments).toEqual([]);
    expect(subject!.key).toBe(starterSubject().key);
  });
});

describe('several slots', () => {
  it('shows the canoe of the slot played last: the one Continue opens', () => {
    const storage = new FakeStorage();
    const store = storeOn(storage);
    store.save(0, gameWith((canoe) => { canoe.hullTier = 1; }));
    store.save(2, gameWith((canoe) => { canoe.hullTier = 3; canoe.attachments = ['mast_sail', 'rudder']; canoe.sailRaised = true; }));
    store.save(1, gameWith((canoe, state) => { canoe.hullTier = 2; canoe.attachments = ['outrigger_port', 'lantern_mast']; canoe.lanternLit = true; state.time = 2.5 * 1440; state.playedSeconds = 4_320; }));
    expect(store.latestSlot()).toBe(1);
    const subject = subjectOf(store)!;
    expect(subject.kind).toBe('save');
    expect(subject.slot).toBe(1);
    expect(subject.state.canoe.hullTier).toBe(2);
    expect(subject.state.canoe.attachments).toEqual(['outrigger_port', 'lantern_mast']);
    expect(subject.state.canoe.lanternLit).toBe(true);
    expect(subject.state.canoe.sailRaised).toBe(false);
    expect(subject.caption).toBe('Ribbed canoe, day 3, 1 h 12 min played');
    expect(subject.caption).toBe(`${HULL_TIERS[2].name}, day ${store.list()[1].day}, 1 h 12 min played`);
    expect(subject.label).toContain('slot 2');

    // Play slot 2 again: it is the last now, and the picture is its canoe.
    store.save(2, gameWith((canoe) => { canoe.hullTier = 3; canoe.attachments = ['mast_sail', 'rudder']; canoe.sailRaised = true; }));
    const after = subjectOf(store)!;
    expect(after.slot).toBe(2);
    expect(after.state.canoe.hullTier).toBe(3);
    expect(after.state.canoe.sailRaised).toBe(true);
    expect(after.key).not.toBe(subject.key);
  });

  it('says the hull by name, the day and the time played, as the save list counts them', () => {
    const store = storeOn(new FakeStorage());
    store.save(0, gameWith((canoe, state) => { canoe.hullTier = 1; state.time = 2 * 1440 + 30; state.playedSeconds = 1_805; }));
    const summary = store.list()[0];
    expect(subjectOf(store)!.caption).toBe(`Patched canoe, day ${summary.day}, 30 min played`);
    expect(summary.day).toBe(3);
    expect(previewCaption(0, 0, 20)).toBe('Leaky canoe, day 1, under a minute played');
    expect(previewCaption(3, 5 * 1440, 6_000)).toBe('Long canoe, day 6, 1 h 40 min played');
  });
});

describe('the canoe as saved, posed for its picture', () => {
  it('keeps the hull, every attachment in the order built, the sail and the lantern; and stands it level, dry, at the origin', () => {
    const store = storeOn(new FakeStorage());
    const built = ['outrigger_port', 'workbench', 'mast_sail', 'rudder', 'cargo_rack', 'firebox', 'lantern_mast'] as CanoeState['attachments'];
    store.save(0, gameWith((canoe) => {
      canoe.hullTier = 3;
      canoe.attachments = built;
      canoe.sailRaised = true;
      canoe.lanternLit = true;
      canoe.beached = true;
      canoe.position = { x: 812, y: 0.4, z: -377 };
      canoe.heading = 2.2;
      canoe.pitch = 0.1;
      canoe.roll = -0.2;
      canoe.speed = 3;
      canoe.waterLevel = 64;
    }));
    const canoe = subjectOf(store)!.state.canoe;
    expect(canoe).toMatchObject({ hullTier: 3, attachments: built, sailRaised: true, lanternLit: true, beached: true });
    expect(canoe).toMatchObject({ position: { x: 0, y: 0, z: 0 }, heading: 0, pitch: 0, roll: 0, speed: 0, waterLevel: 0 });
  });

  it('puts nobody aboard: one person, ashore', () => {
    const store = storeOn(new FakeStorage());
    store.save(0, newGame(7, { crew: 4 }));
    const players = subjectOf(store)!.state.players;
    expect(players).toHaveLength(1);
    expect(players[0]).toMatchObject({ mode: 'foot', seat: null, paddling: false, bailing: false, asleep: false });
  });

  it('the key follows the canoe and nothing else: another attachment or the sail changes it, the place and the clock do not', () => {
    const key = (change: (canoe: CanoeState, state: GameState) => void): string => {
      const store = storeOn(new FakeStorage());
      store.save(0, gameWith(change));
      return subjectOf(store)!.key;
    };
    const plain = key((canoe) => { canoe.hullTier = 2; canoe.attachments = ['mast_sail']; });
    expect(key((canoe, state) => { canoe.hullTier = 2; canoe.attachments = ['mast_sail']; canoe.position = { x: 5, y: 0, z: 9 }; canoe.heading = 1; state.time = 9_000; state.playedSeconds = 777; })).toBe(plain);
    expect(key((canoe) => { canoe.hullTier = 2; canoe.attachments = ['mast_sail', 'rudder']; })).not.toBe(plain);
    expect(key((canoe) => { canoe.hullTier = 2; canoe.attachments = ['mast_sail']; canoe.sailRaised = true; })).not.toBe(plain);
    expect(key((canoe) => { canoe.hullTier = 3; canoe.attachments = ['mast_sail']; })).not.toBe(plain);
    // Anything a later build adds to the canoe is in the key too, so its picture is drawn again.
    expect(key((canoe) => { canoe.hullTier = 2; canoe.attachments = ['mast_sail']; (canoe as unknown as Record<string, unknown>).chests = 2; })).not.toBe(plain);
  });

  it('leaves out an attachment this build does not know, and one named twice', () => {
    const canoe = posedCanoe({ ...newGame(7).canoe, hullTier: 2, attachments: ['rudder', 'steam_engine', 'mast_sail', 'rudder', 7, null] })!;
    expect(canoe.attachments).toEqual(['rudder', 'mast_sail']);
    expect(posedCanoe({ ...newGame(7).canoe, attachments: [...ATTACHMENT_IDS] })!.attachments).toEqual(ATTACHMENT_IDS);
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
    it(`${name.split('/').pop()} previews: its own hull and attachments, as saved`, () => {
      const text = fixtures[name]!;
      const saved = (JSON.parse(text) as { state: { canoe: CanoeState; time: number; playedSeconds: number } }).state;
      const storage = new FakeStorage();
      storage.setItem(`${SAVE_KEY_PREFIX}1`, text);
      const subject = subjectOf(storeOn(storage));
      expect(subject).not.toBeNull();
      expect(subject!.kind).toBe('save');
      expect(subject!.slot).toBe(1);
      expect(subject!.state.canoe.hullTier).toBe(saved.canoe.hullTier);
      expect(subject!.state.canoe.attachments).toEqual(saved.canoe.attachments);
      expect(subject!.state.canoe.sailRaised).toBe(saved.canoe.sailRaised);
      expect(subject!.state.canoe.lanternLit).toBe(saved.canoe.lanternLit);
      expect(subject!.caption).toBe(previewCaption(saved.canoe.hullTier, saved.time, saved.playedSeconds));
      expect(subject!.caption.startsWith(HULL_TIERS[saved.canoe.hullTier].name)).toBe(true);
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
    it(`${what}: no picture, nothing thrown, and the starter canoe is not shown in its place`, () => {
      const storage = new FakeStorage();
      storage.setItem(`${SAVE_KEY_PREFIX}0`, text);
      const store = storeOn(storage);
      expect(() => subjectOf(store)).not.toThrow();
      expect(subjectOf(store)).toBeNull();
    });
  }

  const undrawable: [string, unknown][] = [
    ['a hull this build does not have', { ...newGame(7).canoe, hullTier: 9 }],
    ['a hull that is not a whole number', { ...newGame(7).canoe, hullTier: 1.5 }],
    ['a hull that is not a number', { ...newGame(7).canoe, hullTier: 'long' }],
    ['attachments that are not a list', { ...newGame(7).canoe, attachments: 'mast_sail' }],
  ];
  for (const [what, canoe] of undrawable) {
    it(`a save that loads but holds ${what}: no picture, nothing thrown`, () => {
      const storage = new FakeStorage();
      storage.setItem(`${SAVE_KEY_PREFIX}0`, withCanoe(canoe));
      const store = storeOn(storage);
      // It loads: the save layer only asks that there is a canoe.
      expect(deserialize(withCanoe(canoe)).ok).toBe(true);
      expect(() => subjectOf(store)).not.toThrow();
      expect(subjectOf(store)).toBeNull();
      expect(posedCanoe(canoe)).toBeNull();
    });
  }

  it('a slot that cannot be read at all (the reader throws): no picture, nothing thrown', () => {
    const store = storeOn(new FakeStorage());
    store.save(0, newGame(7));
    const subject = (): unknown => previewSubject(store.list(), 0, () => { throw new Error('storage is gone'); });
    expect(subject).not.toThrow();
    expect(subject()).toBeNull();
    expect(previewSubject(store.list(), 0, () => ({ ok: false, reason: 'corrupt' }))).toBeNull();
  });

  it('the newest save broken and an older one good: the older one is shown, the one Continue opens', () => {
    const storage = new FakeStorage();
    const store = storeOn(storage);
    store.save(1, gameWith((canoe) => { canoe.hullTier = 1; }));
    storage.setItem(`${SAVE_KEY_PREFIX}2`, '{"version":3,"savedAt":99999999,"state":{"seed":1');
    expect(store.latestSlot()).toBe(1);
    const subject = subjectOf(store)!;
    expect(subject.slot).toBe(1);
    expect(subject.state.canoe.hullTier).toBe(1);
  });
});

describe('the lobby model carries the preview, and the game screen does not', () => {
  /** An interface that only remembers what it was given. */
  function recorder(): GameInterface & { models: InterfaceModel[] } {
    const models: InterfaceModel[] = [];
    return { models, mount: () => {}, update: (model) => void models.push(model), dispose: () => {} };
  }
  const model = (store: SaveStore | null): InterfaceModel => ({
    screen: store ? 'lobby' : 'game', uiScale: 1, patternedMeters: false, paused: false,
    lobby: store ? buildLobbyModel(store.list(), store.latestSlot()) : null,
    hud: null, toasts: [], panel: null, openPanels: [], confirm: null, built: null, debug: null,
  } as unknown as InterfaceModel);

  it('adds the words to the lobby, reads the save once, and reads it again only when the saves change', () => {
    const storage = new FakeStorage();
    const store = storeOn(storage);
    store.save(0, gameWith((canoe) => { canoe.hullTier = 2; }));
    let listed = store.list();
    let loads = 0;
    let draws = 0;
    const inner = recorder();
    const wrapped = withCanoePreview(inner, {
      slotSummaries: () => listed,
      latestSlot: () => store.latestSlot(),
      load: (slot) => { loads += 1; return store.load(slot); },
      draw: () => { draws += 1; return null; },
    });
    for (let frame = 0; frame < 5; frame += 1) wrapped.update(model(store));
    expect(inner.models).toHaveLength(5);
    expect(inner.models[4].lobby!.preview).toEqual({ kind: 'save', caption: 'Ribbed canoe, day 1, under a minute played', label: expect.stringContaining('slot 1') as unknown as string });
    expect(loads).toBe(1);
    expect(wrapped.preview.report()).toMatchObject({ shown: 'save', caption: 'Ribbed canoe, day 1, under a minute played', draws: 0, picture: null });

    // In a game there is no lobby, and nothing is read however often the game saves.
    listed = store.list();
    wrapped.update(model(null));
    expect(inner.models[5].lobby).toBeNull();
    expect(loads).toBe(1);

    // Back in the lobby after playing: the saves changed, so the canoe is read again.
    store.save(0, gameWith((canoe) => { canoe.hullTier = 3; }));
    listed = store.list();
    wrapped.update(model(store));
    wrapped.update(model(store));
    expect(loads).toBe(2);
    expect(inner.models[7].lobby!.preview!.caption).toBe('Long canoe, day 1, under a minute played');
    // Never mounted on a page: nothing was drawn.
    expect(draws).toBe(0);
  });

  it('a broken save: the lobby model has no preview at all, and every button is as it was', () => {
    const storage = new FakeStorage();
    storage.setItem(`${SAVE_KEY_PREFIX}0`, 'not a save at all');
    const store = storeOn(storage);
    const inner = recorder();
    const wrapped = withCanoePreview(inner, {
      slotSummaries: () => store.list(), latestSlot: () => store.latestSlot(), load: (slot) => store.load(slot), draw: () => null,
    });
    expect(() => wrapped.update(model(store))).not.toThrow();
    expect(inner.models[0].lobby!.preview).toBeUndefined();
    expect(inner.models[0].lobby!.buttons).toEqual(buildLobbyModel(store.list(), store.latestSlot()).buttons);
    expect(wrapped.preview.report()).toMatchObject({ shown: null, caption: null, draws: 0 });
  });

  it('no save: the lobby model says "Your canoe awaits"', () => {
    const store = storeOn(new FakeStorage());
    const inner = recorder();
    withCanoePreview(inner, {
      slotSummaries: () => store.list(), latestSlot: () => store.latestSlot(), load: (slot) => store.load(slot), draw: () => null,
    }).update(model(store));
    expect(inner.models[0].lobby!.preview).toMatchObject({ kind: 'starter', caption: 'Your canoe awaits' });
    expect(previewModel(starterSubject())).toEqual(inner.models[0].lobby!.preview);
  });
});

describe('when the one picture is drawn', () => {
  const size = { width: 354, height: 256 };
  const base = { frame: 10, wantedKey: 'a', size, drawn: null, failedKey: null, sizeChangedAt: 0, now: 5_000 };

  it('never before the third frame of the page: the first one times the chip', () => {
    expect(FIRST_DRAW_FRAME).toBe(3);
    expect(drawDue({ ...base, frame: 1 })).toBe(false);
    expect(drawDue({ ...base, frame: 2 })).toBe(false);
    expect(drawDue({ ...base, frame: 3 })).toBe(true);
  });

  it('once: a picture of this canoe at this size is not drawn again', () => {
    expect(drawDue({ ...base, drawn: { key: 'a', ...size } })).toBe(false);
    expect(drawDue({ ...base, frame: 100_000, now: 9e9, drawn: { key: 'a', ...size } })).toBe(false);
  });

  it('again at once for another canoe, and for another size only when the size has held still', () => {
    expect(drawDue({ ...base, drawn: { key: 'b', ...size } })).toBe(true);
    const resized = { ...base, drawn: { key: 'a', width: 252, height: 182 } };
    expect(drawDue({ ...resized, sizeChangedAt: 5_000 - SETTLE_MILLISECONDS + 1 })).toBe(false);
    expect(drawDue({ ...resized, sizeChangedAt: 5_000 - SETTLE_MILLISECONDS })).toBe(true);
  });

  it('not at all with no canoe, no frame on the page, or a canoe that could not be drawn', () => {
    expect(drawDue({ ...base, wantedKey: null })).toBe(false);
    expect(drawDue({ ...base, size: null })).toBe(false);
    expect(drawDue({ ...base, failedKey: 'a' })).toBe(false);
    expect(drawDue({ ...base, failedKey: 'b' })).toBe(true);
  });
});

describe('sharp at the size shown', () => {
  it('the picture has as many pixels as its frame has on the screen, never more', () => {
    expect(sketchPixels(353.74, 256.2, 1)).toEqual({ width: 353, height: 256 });
    // On a 2x screen: a whole number of CSS pixels (251 by 182), so every browser lays it on whole screen pixels.
    expect(sketchPixels(251.6, 182.2, 2)).toEqual({ width: 502, height: 364 });
    expect(sketchPixels(267.93, 200.9, 2)).toEqual({ width: 534, height: 400 });
    expect(sketchPixels(282.4, 204.8, 1.25)).toEqual({ width: 352, height: 255 });
    expect(sketchPixels(341, 256, 1.5)).toEqual({ width: 511, height: 384 });
    expect(sketchPixels(200, 100, Number.NaN)).toEqual({ width: 200, height: 100 });
    expect(sketchPixels(0, 0, 1)).toBeNull();
    expect(sketchPixels(10, 300, 1)).toBeNull();
    expect(sketchPixels(9_000, 300, 1)).toEqual({ width: 2048, height: 300 });
  });

  it('the nudge puts a corner on a whole screen pixel, by the shortest way', () => {
    expect(pixelNudge(-387, 1)).toBeCloseTo(0, 10);
    expect(pixelNudge(-387.123, 1)).toBeCloseTo(0.123, 10);
    expect(pixelNudge(-387.7, 1)).toBeCloseTo(-0.3, 10);
    // Half screen pixels on a 2x screen, and a 1.25x screen.
    expect(pixelNudge(10.3, 2)).toBeCloseTo(0.2, 10);
    expect((10.3 + pixelNudge(10.3, 2)) * 2).toBeCloseTo(21, 10);
    expect((-200.33 + pixelNudge(-200.33, 1.25)) * 1.25).toBeCloseTo(Math.round(-200.33 * 1.25), 10);
    for (const at of [-512.49, -0.5, 0.25, 77.77]) expect(Math.abs(pixelNudge(at, 1))).toBeLessThanOrEqual(0.5);
  });
});

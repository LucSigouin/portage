/**
 * The canoe in the scene behind the main menu (Luc, Round 4: "the video portion where its floating around can you
 * put it there?"): it is the canoe of the save played last, it drifts exactly as the scene's own canoe always
 * did, and reading the save for it never writes to it.
 */
import { describe, expect, it } from 'vitest';
import { BACKDROP_RESET_SECONDS, Session } from '../../src/client/session.ts';
import { ATTACHMENT_IDS, HULL_TIERS } from '../../src/data/index.ts';
import { SAVE_KEY_PREFIX, createSaveStore, serialize } from '../../src/save/index.ts';
import { hashState } from '../../src/sim/index.ts';
import type { CanoeState, GameState } from '../../src/sim/index.ts';
import { FakeStorage, newGame } from '../support.ts';

const fixtures = import.meta.glob<string>('../fixtures/save-live-*.json', { eager: true, query: '?raw', import: 'default' });

/** A storage that counts every write and every delete it is asked for. */
class WatchedStorage extends FakeStorage {
  writes: string[] = [];

  override setItem(key: string, value: string): void {
    this.writes.push(`set ${key}`);
    super.setItem(key, value);
  }

  override removeItem(key: string): void {
    this.writes.push(`remove ${key}`);
    super.removeItem(key);
  }
}

function sessionOn(storage: FakeStorage): Session {
  let clock = 1_000_000;
  let seed = 100;
  return new Session({ storage, now: () => (clock += 1_000), randomSeed: () => (seed += 1) });
}

/** A storage holding one save in `slot`: a new game with this canoe. */
function storageWith(change: (canoe: CanoeState, state: GameState) => void, slot = 0): WatchedStorage {
  const storage = new WatchedStorage();
  const state = newGame(7);
  change(state.canoe, state);
  createSaveStore(storage, () => 5_000).save(slot, state);
  storage.writes = [];
  return storage;
}

/** The fullest canoe a hull can carry: everything built, the sail up, the lantern lit, the pail half full. */
const fullest = (hullTier: number) => (canoe: CanoeState): void => {
  canoe.hullTier = hullTier;
  canoe.attachments = [...ATTACHMENT_IDS];
  canoe.sailRaised = true;
  canoe.lanternLit = true;
  canoe.rainProgress = 0.5;
};

/** Lobby frames of `frameSeconds` for `seconds`. */
function lobby(session: Session, seconds: number, frameSeconds = 1 / 60): void {
  for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += frameSeconds) session.advance(frameSeconds, 0);
}

/** What the look reads off a canoe that is not where it is or how it sits. */
const dressOn = (canoe: CanoeState) => ({
  hullTier: canoe.hullTier, attachments: canoe.attachments, sailRaised: canoe.sailRaised, lanternLit: canoe.lanternLit, rainProgress: canoe.rainProgress,
});

/** Where a canoe is and how it sits: what the rules moved. */
const poseOf = (canoe: CanoeState) => ({
  position: { ...canoe.position }, heading: canoe.heading, speed: canoe.speed, pitch: canoe.pitch, roll: canoe.roll,
  waterLevel: canoe.waterLevel, beached: canoe.beached,
});

/** The scene's own canoe, as it has always been: the patched hull, bare. */
const TODAY = { hullTier: 1, attachments: [], sailRaised: false, lanternLit: false, rainProgress: 0 };

describe('the canoe behind the menu is the one of the save played last', () => {
  it('wears the saved hull, everything built on it, the sail and the lantern as saved, from the first frame', () => {
    const session = sessionOn(storageWith((canoe) => {
      canoe.hullTier = 3;
      canoe.attachments = ['outrigger_port', 'mast_sail', 'rudder', 'lantern_mast', 'rain_catcher'];
      canoe.sailRaised = true;
      canoe.lanternLit = true;
      canoe.rainProgress = 0.75;
    }));
    session.advance(1 / 60, 0);
    expect(dressOn(session.backdrop.canoe)).toEqual({
      hullTier: 3, attachments: ['outrigger_port', 'mast_sail', 'rudder', 'lantern_mast', 'rain_catcher'], sailRaised: true, lanternLit: true, rainProgress: 0.75,
    });
    expect(session.activeState).toBe(session.backdrop);
    lobby(session, 5);
    expect(session.backdrop.canoe.hullTier).toBe(3);
    expect(session.backdrop.canoe.sailRaised).toBe(true);
  });

  for (const [name, text] of Object.entries(fixtures).sort()) {
    it(`${name.split('/').pop()}: a save from a live build is shown with its own hull and attachments`, () => {
      const saved = (JSON.parse(text) as { state: { canoe: CanoeState } }).state.canoe;
      const storage = new WatchedStorage();
      storage.entries.set(`${SAVE_KEY_PREFIX}1`, text);
      const session = sessionOn(storage);
      lobby(session, 1);
      expect(dressOn(session.backdrop.canoe)).toEqual({
        hullTier: saved.hullTier, attachments: saved.attachments, sailRaised: saved.sailRaised, lanternLit: saved.lanternLit, rainProgress: saved.rainProgress ?? 0,
      });
    });
  }

  it('the slot played last, of several: the one Continue opens', () => {
    const storage = new WatchedStorage();
    let clock = 1_000;
    const store = createSaveStore(storage, () => (clock += 1_000));
    const save = (slot: number, hullTier: number): void => {
      const state = newGame(7);
      state.canoe.hullTier = hullTier;
      store.save(slot, state);
    };
    save(0, 1);
    save(2, 3);
    save(1, 2);
    const session = sessionOn(storage);
    lobby(session, 1);
    expect(session.latestSlot()).toBe(1);
    expect(session.backdrop.canoe.hullTier).toBe(2);
  });
});

describe('no save, or a save that cannot be shown: the scene keeps its own canoe, as it always was', () => {
  it('no save: the patched hull, bare and dry', () => {
    const session = sessionOn(new WatchedStorage());
    lobby(session, 2);
    expect(dressOn(session.backdrop.canoe)).toEqual(TODAY);
    expect(session.backdrop.canoe.waterLevel).toBe(0);
    expect(session.backdropCanoe.dress).toBeNull();
  });

  const good = serialize(newGame(7), 500);
  const withCanoe = (canoe: unknown): string => {
    const envelope = JSON.parse(good) as { state: Record<string, unknown> };
    envelope.state.canoe = canoe;
    return JSON.stringify(envelope);
  };
  const broken: [string, string][] = [
    ['a save cut short', good.slice(0, good.length / 2)],
    ['something that is not a save', 'not a save at all'],
    ['a save from a newer build', good.replace(/^\{"version":\d+/, '{"version":99')],
    ['a save with no canoe in it', withCanoe(null)],
    ['a hull this build cannot draw', withCanoe({ ...newGame(7).canoe, hullTier: 9, attachments: ['mast_sail'], sailRaised: true })],
    ['attachments that are not a list', withCanoe({ ...newGame(7).canoe, hullTier: 3, attachments: 'mast_sail' })],
  ];
  for (const [what, text] of broken) {
    it(`${what}: the scene's own canoe, and nothing thrown`, () => {
      const storage = new WatchedStorage();
      storage.entries.set(`${SAVE_KEY_PREFIX}0`, text);
      const session = sessionOn(storage);
      expect(() => lobby(session, 2)).not.toThrow();
      expect(dressOn(session.backdrop.canoe)).toEqual(TODAY);
      expect(session.backdrop.statistics.fails).toBe(0);
      // And the text in the slot is as it was: a broken save is not tidied away.
      expect(storage.entries.get(`${SAVE_KEY_PREFIX}0`)).toBe(text);
      expect(storage.writes).toEqual([]);
    });
  }
});

describe('as calm as it always was: the rules never see the saved canoe', () => {
  /** A lobby with nothing saved, stepped the same way: the scene as it was before this. */
  function sideBySide(storage: WatchedStorage, seconds: number, frameSeconds: number, check: (dressed: Session, plain: Session) => void, every = 60): void {
    const dressed = sessionOn(storage);
    const plain = sessionOn(new WatchedStorage());
    let frame = 0;
    for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += frameSeconds) {
      dressed.advance(frameSeconds, 0);
      plain.advance(frameSeconds, 0);
      frame += 1;
      if (frame % every === 0) check(dressed, plain);
    }
    check(dressed, plain);
  }

  for (const hull of HULL_TIERS) {
    it(`the ${hull.name.toLowerCase()} with everything built and its sail up drifts exactly as the scene's own canoe, for 600 s and over the fresh staging`, () => {
      let far = 0;
      let checks = 0;
      const start = { x: 12, z: 1040 };
      sideBySide(storageWith(fullest(hull.tier)), BACKDROP_RESET_SECONDS + 30, 0.25, (dressed, plain) => {
        checks += 1;
        expect(dressed.backdrop.canoe.hullTier).toBe(hull.tier);
        expect(dressed.backdrop.canoe.sailRaised).toBe(true);
        // To the last digit: where it is, how it sits, the water aboard.
        expect(poseOf(dressed.backdrop.canoe)).toEqual(poseOf(plain.backdrop.canoe));
        expect(dressed.backdrop.time).toBe(plain.backdrop.time);
        expect(dressed.backdrop.canoe.waterLevel).toBe(0);
        expect(dressed.backdrop.canoe.beached).toBe(false);
        far = Math.max(far, Math.hypot(dressed.backdrop.canoe.position.x - start.x, dressed.backdrop.canoe.position.z - start.z));
      }, 40);
      expect(checks).toBeGreaterThan(60);
      // It neither sails away nor stays put: the drift the lobby always had, under 20 m in the 600 s.
      expect(far).toBeGreaterThan(15);
      expect(far).toBeLessThan(20);
    });
  }

  it('under the dress the state is the scene\'s own, bit for bit, at 60 frames a second', () => {
    const dressed = sessionOn(storageWith(fullest(3)));
    const plain = sessionOn(new WatchedStorage());
    for (let frame = 1; frame <= 60 * 45; frame += 1) {
      dressed.advance(1 / 60, 0);
      plain.advance(1 / 60, 0);
      if (frame % 300 !== 0) continue;
      const under = dressed.backdropCanoe.undressed(dressed.backdrop);
      expect(dressOn(under.canoe)).toEqual(TODAY);
      expect(hashState(under)).toBe(hashState(plain.backdrop));
      // And the copy is a copy: the scene still wears the saved canoe.
      expect(dressed.backdrop.canoe.hullTier).toBe(3);
    }
  });

  it('a leaky hull takes no water, a raised sail gives no speed, and nobody goes hungry faster', () => {
    const session = sessionOn(storageWith((canoe) => {
      canoe.hullTier = 0;
      canoe.attachments = ['mast_sail'];
      canoe.sailRaised = true;
      canoe.waterLevel = 80;
    }));
    lobby(session, 240, 0.25);
    const backdrop = session.backdrop;
    expect(backdrop.canoe.hullTier).toBe(0);
    expect(backdrop.canoe.waterLevel).toBe(0);
    expect(Math.abs(backdrop.canoe.speed)).toBeLessThan(0.05);
    expect(backdrop.statistics.fails).toBe(0);
    expect(backdrop.events).toEqual([]);
  });

  it('staged afresh after 600 s, the new scene wears the saved canoe on its first frame, and the clock runs on', () => {
    const session = sessionOn(storageWith(fullest(2)));
    lobby(session, BACKDROP_RESET_SECONDS - 1, 0.25);
    const before = session.backdrop;
    const clock = before.time;
    lobby(session, 2, 0.25);
    expect(session.backdrop).not.toBe(before);
    expect(session.backdrop.playedSeconds).toBeLessThan(2);
    expect(session.backdrop.time).toBeCloseTo(clock + 2, 5);
    expect(dressOn(session.backdrop.canoe)).toMatchObject({ hullTier: 2, sailRaised: true, lanternLit: true });
    expect(session.backdrop.canoe.attachments).toEqual(ATTACHMENT_IDS);
  });

  it('a hidden tab steps nothing, and the scene still wears the saved canoe', () => {
    const session = sessionOn(storageWith(fullest(3)));
    lobby(session, 1);
    session.setHidden(true);
    const tick = session.backdrop.tick;
    lobby(session, 1);
    expect(session.backdrop.tick).toBe(tick);
    expect(session.backdrop.canoe.hullTier).toBe(3);
    session.setHidden(false);
    lobby(session, 1);
    expect(session.backdrop.tick).toBeGreaterThan(tick);
    expect(session.backdrop.canoe.hullTier).toBe(3);
  });
});

describe('reading the save for the scene never writes to it', () => {
  it('ten minutes in the lobby: not one write, not one delete, and the save is the same text', () => {
    const storage = storageWith(fullest(3));
    const text = storage.entries.get(`${SAVE_KEY_PREFIX}0`);
    const session = sessionOn(storage);
    lobby(session, BACKDROP_RESET_SECONDS + 10, 0.25);
    expect(storage.writes).toEqual([]);
    expect(storage.entries.get(`${SAVE_KEY_PREFIX}0`)).toBe(text);
  });

  it('the save is read once, and again only when the saves change', () => {
    const storage = storageWith(fullest(3), 1);
    const session = sessionOn(storage);
    lobby(session, 5);
    expect(session.backdropCanoe.reads).toBe(1);
    // A save deleted: read again, and with nothing left the scene has its own canoe back.
    session.deleteSave(1);
    lobby(session, 1);
    expect(session.backdropCanoe.reads).toBe(2);
    expect(dressOn(session.backdrop.canoe)).toEqual(TODAY);
    lobby(session, 5);
    expect(session.backdropCanoe.reads).toBe(2);
  });
});

describe('starting and continuing from the lobby behave as they did', () => {
  it('Continue opens the save as it was saved, untouched by the scene', () => {
    const storage = storageWith((canoe) => {
      fullest(3)(canoe);
      canoe.position = { x: 40, y: 0, z: 900 };
      canoe.waterLevel = 12;
    });
    const session = sessionOn(storage);
    lobby(session, 3);
    expect(session.continueGame()).toBe(true);
    const game = session.game!;
    expect(game).not.toBe(session.backdrop);
    expect(game.canoe.position).toMatchObject({ x: 40, z: 900 });
    expect(game.canoe.waterLevel).toBe(12);
    expect(game.canoe.attachments).toEqual(ATTACHMENT_IDS);
    // The game's own lists are its own: the scene's dress shares nothing with them.
    expect(game.canoe.attachments).not.toBe(session.backdrop.canoe.attachments);
  });

  it('a new game starts with the leaky canoe, whatever the scene shows; and back in the lobby the scene shows the canoe just played', () => {
    const session = sessionOn(storageWith(fullest(3)));
    lobby(session, 3);
    expect(session.newGame(1)).toBe(true);
    const game = session.game!;
    expect(dressOn(game.canoe)).toEqual({ hullTier: 0, attachments: [], sailRaised: false, lanternLit: false, rainProgress: 0 });
    game.canoe.hullTier = 2;
    game.canoe.attachments = ['rudder'];
    const scene = session.backdrop.playedSeconds;
    lobby(session, 2);
    // The scene waits while a game is on.
    expect(session.backdrop.playedSeconds).toBe(scene);
    session.quitToLobby();
    lobby(session, 1);
    expect(dressOn(session.backdrop.canoe)).toMatchObject({ hullTier: 2, attachments: ['rudder'], sailRaised: false });
    expect(session.backdropCanoe.reads).toBe(2);
  });
});

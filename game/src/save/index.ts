/**
 * Saves: versioned JSON, three slots in a `Storage`-shaped store, and an
 * autosaver (on landing, on sleeping, and on a timer). No DOM in here: pass
 * `window.localStorage` in from the client, or a fake in tests.
 */
import { MAIN_QUESTS } from '../data/quests.ts';
import { TUNING } from '../data/tuning.ts';
import { STATE_VERSION } from '../sim/index.ts';
import type { GameEvent, GameState } from '../sim/index.ts';

/** Version of the save envelope and of the GameState inside it. */
export const SAVE_VERSION = STATE_VERSION;
export const SAVE_SLOT_COUNT = 3;
export const SAVE_KEY_PREFIX = 'portage.save.';

/** The part of `Storage` the save layer uses. `localStorage` fits. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SaveEnvelope {
  version: number;
  /** Milliseconds since the epoch, from the clock passed to the store. */
  savedAt: number;
  state: GameState;
}

/**
 * Migrations, keyed by the version they upgrade FROM. Each takes a parsed
 * envelope at that version and returns one at the next version. Add an entry
 * whenever `STATE_VERSION` is bumped.
 */
export type SaveMigration = (envelope: { version: number; savedAt: number; state: unknown }) =>
  { version: number; savedAt: number; state: unknown };

export const SAVE_MIGRATIONS: Record<number, SaveMigration> = {};

export type LoadFailure = 'empty' | 'corrupt' | 'from_newer_version' | 'no_migration';

export type LoadResult =
  | { ok: true; state: GameState; savedAt: number; migratedFrom: number | null }
  | { ok: false; reason: LoadFailure };

/** Turn a state into a save string. Queued events are not saved. */
export function serialize(state: GameState, savedAt: number): string {
  const envelope: SaveEnvelope = { version: SAVE_VERSION, savedAt, state: { ...state, events: [] } };
  return JSON.stringify(envelope);
}

function looksLikeState(value: unknown): value is GameState {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.seed === 'number' && typeof candidate.time === 'number'
    && typeof candidate.player === 'object' && candidate.player !== null
    && typeof candidate.canoe === 'object' && candidate.canoe !== null
    && typeof candidate.quests === 'object' && candidate.quests !== null
    && Array.isArray(candidate.events);
}

/** Parse a save string, migrating old versions forward. Never throws. */
export function deserialize(
  text: string | null,
  migrations: Record<number, SaveMigration> = SAVE_MIGRATIONS,
): LoadResult {
  if (text === null || text === '') return { ok: false, reason: 'empty' };
  let envelope: { version: number; savedAt: number; state: unknown };
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) return { ok: false, reason: 'corrupt' };
    const candidate = parsed as Record<string, unknown>;
    if (typeof candidate.version !== 'number' || !('state' in candidate)) return { ok: false, reason: 'corrupt' };
    envelope = {
      version: candidate.version,
      savedAt: typeof candidate.savedAt === 'number' ? candidate.savedAt : 0,
      state: candidate.state,
    };
  } catch {
    return { ok: false, reason: 'corrupt' };
  }
  if (envelope.version > SAVE_VERSION) return { ok: false, reason: 'from_newer_version' };
  const migratedFrom = envelope.version < SAVE_VERSION ? envelope.version : null;
  while (envelope.version < SAVE_VERSION) {
    const migrate = migrations[envelope.version];
    if (!migrate) return { ok: false, reason: 'no_migration' };
    const before = envelope.version;
    envelope = migrate(envelope);
    if (envelope.version <= before) return { ok: false, reason: 'no_migration' };
  }
  if (!looksLikeState(envelope.state)) return { ok: false, reason: 'corrupt' };
  envelope.state.version = SAVE_VERSION;
  return { ok: true, state: envelope.state, savedAt: envelope.savedAt, migratedFrom };
}

export interface SlotSummary {
  slot: number;
  empty: boolean;
  /** True when something is stored but cannot be loaded. */
  corrupt: boolean;
  savedAt: number;
  day: number;
  playedSeconds: number;
  /** Id of the main quest in progress, or null when the Beacon is lit. */
  mainQuestId: string | null;
  difficulty: string;
}

export interface SaveStore {
  save(slot: number, state: GameState): boolean;
  load(slot: number): LoadResult;
  remove(slot: number): void;
  /** One summary per slot, for the lobby. */
  list(): SlotSummary[];
  /** Slot with the newest save, or null when all are empty. */
  latestSlot(): number | null;
}

const validSlot = (slot: number): boolean => Number.isInteger(slot) && slot >= 0 && slot < SAVE_SLOT_COUNT;

/**
 * A three-slot save store over anything shaped like `localStorage`.
 * `now` is the wall clock for the "saved at" stamp; inject one in tests.
 */
export function createSaveStore(storage: StorageLike, now: () => number = () => Date.now()): SaveStore {
  const key = (slot: number): string => `${SAVE_KEY_PREFIX}${slot}`;

  const load = (slot: number): LoadResult => {
    if (!validSlot(slot)) return { ok: false, reason: 'empty' };
    try {
      return deserialize(storage.getItem(key(slot)));
    } catch {
      return { ok: false, reason: 'corrupt' };
    }
  };

  const summarise = (slot: number): SlotSummary => {
    const result = load(slot);
    const blank: SlotSummary = {
      slot, empty: true, corrupt: false, savedAt: 0, day: 0, playedSeconds: 0, mainQuestId: null, difficulty: '',
    };
    if (!result.ok) return { ...blank, empty: result.reason === 'empty', corrupt: result.reason !== 'empty' };
    const state = result.state;
    return {
      slot, empty: false, corrupt: false, savedAt: result.savedAt,
      day: Math.floor(state.time / TUNING.time.daySeconds) + 1,
      playedSeconds: state.playedSeconds,
      mainQuestId: MAIN_QUESTS.find((quest) => state.quests[quest.id]?.status === 'active')?.id ?? null,
      difficulty: state.difficulty,
    };
  };

  return {
    save(slot, state) {
      if (!validSlot(slot)) return false;
      try {
        storage.setItem(key(slot), serialize(state, now()));
        return true;
      } catch {
        // Storage full or blocked. The game carries on unsaved.
        return false;
      }
    },
    load,
    remove(slot) {
      if (validSlot(slot)) storage.removeItem(key(slot));
    },
    list() {
      return Array.from({ length: SAVE_SLOT_COUNT }, (_, slot) => summarise(slot));
    },
    latestSlot() {
      const filled = this.list().filter((summary) => !summary.empty && !summary.corrupt);
      if (filled.length === 0) return null;
      return filled.reduce((newest, summary) => (summary.savedAt > newest.savedAt ? summary : newest)).slot;
    },
  };
}

export interface Autosaver {
  /**
   * Call once per frame with the events drained that frame and the real
   * frame time. Saves on landing, on sleeping, and when the timer runs out.
   * Returns the reason when it saved, otherwise null.
   */
  update(state: GameState, events: readonly GameEvent[], frameSeconds: number): 'landing' | 'sleeping' | 'timer' | null;
  /** Change the timer. 0 turns timed autosave off. */
  setIntervalSeconds(seconds: number): void;
}

/** Autosave into one slot. `intervalSeconds` comes from the gameplay settings. */
export function createAutosaver(store: SaveStore, slot: number, intervalSeconds: number): Autosaver {
  let interval = intervalSeconds;
  let sinceSave = 0;
  return {
    update(state, events, frameSeconds) {
      sinceSave += frameSeconds;
      let reason: 'landing' | 'sleeping' | 'timer' | null = null;
      for (const event of events) {
        if (event.type === 'autosave_requested') reason = event.reason;
      }
      if (reason === null && interval > 0 && sinceSave >= interval) reason = 'timer';
      if (reason === null) return null;
      if (!store.save(slot, state)) return null;
      sinceSave = 0;
      return reason;
    },
    setIntervalSeconds(seconds) {
      interval = seconds;
    },
  };
}

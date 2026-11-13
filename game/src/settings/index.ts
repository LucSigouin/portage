/**
 * Settings: a typed schema with defaults, load and save, and the key-binding
 * map. Covers every option in the brief's settings list. No UI and no DOM in
 * here: pass `window.localStorage` in from the client.
 */
import type { Difficulty } from '../data/types.ts';

/** 2: F is the main action key and L the lantern; the hold-or-toggle scavenging option is gone. */
export const SETTINGS_VERSION = 2;
export const SETTINGS_KEY = 'portage.settings';

/** The part of `Storage` the settings layer uses. */
export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Everything a key can be bound to. The client turns held keys into
 * `StepInput` and pressed keys into commands or panel toggles.
 */
export type InputAction =
  // canoe
  | 'paddle' | 'backPaddle' | 'autoPaddle' | 'steerPort' | 'steerStarboard' | 'powerStroke' | 'bail' | 'lantern' | 'sail'
  // on foot
  | 'moveForward' | 'moveBack' | 'moveLeft' | 'moveRight' | 'run'
  // both
  | 'interact'
  // panels
  | 'inventory' | 'craft' | 'canoeBuilder' | 'questLog' | 'map' | 'pause'
  // tool hotbar
  | 'tool1' | 'tool2' | 'tool3' | 'tool4' | 'tool5';

export const INPUT_ACTIONS: InputAction[] = [
  'paddle', 'backPaddle', 'autoPaddle', 'steerPort', 'steerStarboard', 'powerStroke', 'bail', 'lantern', 'sail',
  'moveForward', 'moveBack', 'moveLeft', 'moveRight', 'run',
  'interact',
  'inventory', 'craft', 'canoeBuilder', 'questLog', 'map', 'pause',
  'tool1', 'tool2', 'tool3', 'tool4', 'tool5',
];

/** Actions that are live at the same time. A key may repeat across contexts, not within one. */
export type InputContext = 'canoe' | 'foot' | 'always';

export const ACTION_CONTEXT: Record<InputAction, InputContext> = {
  paddle: 'canoe', backPaddle: 'canoe', autoPaddle: 'canoe', steerPort: 'canoe', steerStarboard: 'canoe', powerStroke: 'canoe',
  bail: 'canoe', lantern: 'canoe', sail: 'canoe',
  moveForward: 'foot', moveBack: 'foot', moveLeft: 'foot', moveRight: 'foot', run: 'foot',
  interact: 'always',
  inventory: 'always', craft: 'always', canoeBuilder: 'always', questLog: 'always', map: 'always', pause: 'always',
  tool1: 'always', tool2: 'always', tool3: 'always', tool4: 'always', tool5: 'always',
};

export const ACTION_LABELS: Record<InputAction, string> = {
  paddle: 'Paddle', backPaddle: 'Back-paddle', autoPaddle: 'Auto-paddle (on and off)', steerPort: 'Steer to port', steerStarboard: 'Steer to starboard',
  powerStroke: 'Power stroke', bail: 'Bail (hold)', lantern: 'Lantern', sail: 'Raise or lower sail',
  moveForward: 'Walk forward', moveBack: 'Walk back', moveLeft: 'Walk left', moveRight: 'Walk right', run: 'Run',
  interact: 'Land / interact / scavenge / board',
  inventory: 'Inventory', craft: 'Crafting', canoeBuilder: 'Canoe builder', questLog: 'Quest log', map: 'Map',
  pause: 'Pause',
  tool1: 'Tool 1', tool2: 'Tool 2', tool3: 'Tool 3', tool4: 'Tool 4', tool5: 'Tool 5',
};

/** Action to `KeyboardEvent.code` values. Up to two keys per action. */
export type KeyBindings = Record<InputAction, string[]>;

export const MAXIMUM_KEYS_PER_ACTION = 2;

export const DEFAULT_KEY_BINDINGS: Readonly<KeyBindings> = Object.freeze({
  paddle: ['KeyW', 'ArrowUp'],
  backPaddle: ['KeyS', 'ArrowDown'],
  autoPaddle: ['KeyQ'],
  steerPort: ['KeyA', 'ArrowLeft'],
  steerStarboard: ['KeyD', 'ArrowRight'],
  powerStroke: ['ShiftLeft', 'ShiftRight'],
  bail: ['KeyR'],
  lantern: ['KeyL'],
  sail: ['KeyV'],
  moveForward: ['KeyW', 'ArrowUp'],
  moveBack: ['KeyS', 'ArrowDown'],
  moveLeft: ['KeyA', 'ArrowLeft'],
  moveRight: ['KeyD', 'ArrowRight'],
  run: ['ShiftLeft', 'ShiftRight'],
  interact: ['KeyF'],
  inventory: ['Tab'],
  craft: ['KeyC'],
  canoeBuilder: ['KeyB'],
  questLog: ['KeyJ'],
  map: ['KeyM'],
  pause: ['Escape'],
  tool1: ['Digit1'],
  tool2: ['Digit2'],
  tool3: ['Digit3'],
  tool4: ['Digit4'],
  tool5: ['Digit5'],
});

export type QualityPreset = 'low' | 'medium' | 'high' | 'ultra';
export type ShadowQuality = 'off' | 'low' | 'high';
export type WaterDetail = 'low' | 'medium' | 'high';
/** The card at a new place (`client/viewmodels/arrival.ts`): its ink drawn in, written whole with no motion, or not shown. */
export type ArrivalCards = 'animated' | 'still' | 'off';

export interface Settings {
  version: number;
  audio: {
    /** All volumes 0 to 1. */
    master: number;
    music: number;
    effects: number;
    ambience: number;
  };
  graphics: {
    qualityPreset: QualityPreset;
    /** 0.5 to 2: share of the device pixel resolution. */
    renderScale: number;
    shadows: ShadowQuality;
    waterDetail: WaterDetail;
    /** Vertical field of view, degrees. */
    fieldOfView: number;
    /** Frames per second. 0 = uncapped. */
    fpsCap: number;
    showFps: boolean;
  };
  controls: {
    keyBindings: KeyBindings;
    /** 0.1 to 3. */
    mouseSensitivity: number;
    invertY: boolean;
    cameraAutoCentre: boolean;
  };
  gameplay: {
    difficulty: Difficulty;
    /** Seconds between timed autosaves. 0 = no timer: only on landing, sleeping, a quest completed and a new tool. */
    autosaveIntervalSeconds: number;
    hints: boolean;
  };
  accessibility: {
    /** 0.75 to 1.5. */
    uiScale: number;
    reduceCameraMotion: boolean;
    patternedMeters: boolean;
    /** Animated unless the player says otherwise. A browser that asks for less motion starts on Still (`loadSettings`). */
    arrivalCards: ArrivalCards;
  };
}

export function cloneKeyBindings(bindings: Readonly<KeyBindings>): KeyBindings {
  const copy = {} as KeyBindings;
  for (const action of INPUT_ACTIONS) copy[action] = [...bindings[action]];
  return copy;
}

/** A fresh settings object with every default. */
export function createDefaultSettings(): Settings {
  return {
    version: SETTINGS_VERSION,
    audio: { master: 0.8, music: 0.6, effects: 0.8, ambience: 0.7 },
    graphics: {
      qualityPreset: 'high', renderScale: 1, shadows: 'high', waterDetail: 'high',
      fieldOfView: 60, fpsCap: 60, showFps: false,
    },
    controls: {
      keyBindings: cloneKeyBindings(DEFAULT_KEY_BINDINGS),
      mouseSensitivity: 1, invertY: false, cameraAutoCentre: true,
    },
    gameplay: { difficulty: 'standard', autosaveIntervalSeconds: 300, hints: true },
    accessibility: { uiScale: 1, reduceCameraMotion: false, patternedMeters: false, arrivalCards: 'animated' },
  };
}

/** Allowed values and ranges, for sliders and pickers. */
export const SETTINGS_LIMITS = {
  volume: { minimum: 0, maximum: 1 },
  renderScale: { minimum: 0.5, maximum: 2 },
  fieldOfView: { minimum: 45, maximum: 100 },
  fpsCaps: [0, 30, 60, 90, 120, 144],
  mouseSensitivity: { minimum: 0.1, maximum: 3 },
  autosaveIntervals: [0, 60, 120, 300, 600],
  uiScale: { minimum: 0.75, maximum: 1.5 },
  qualityPresets: ['low', 'medium', 'high', 'ultra'] as QualityPreset[],
  shadows: ['off', 'low', 'high'] as ShadowQuality[],
  waterDetail: ['low', 'medium', 'high'] as WaterDetail[],
  difficulties: ['relaxed', 'standard'] as Difficulty[],
  arrivalCards: ['animated', 'still', 'off'] as ArrivalCards[],
} as const;

/** What each quality preset sets the detailed graphics options to. */
export const QUALITY_PRESETS: Record<QualityPreset, Pick<Settings['graphics'], 'renderScale' | 'shadows' | 'waterDetail'>> = {
  low: { renderScale: 0.75, shadows: 'off', waterDetail: 'low' },
  medium: { renderScale: 1, shadows: 'low', waterDetail: 'medium' },
  high: { renderScale: 1, shadows: 'high', waterDetail: 'high' },
  ultra: { renderScale: 1.5, shadows: 'high', waterDetail: 'high' },
};

/** Apply a quality preset to the detailed graphics options. Returns a new object. */
export function applyQualityPreset(settings: Settings, preset: QualityPreset): Settings {
  return { ...settings, graphics: { ...settings.graphics, ...QUALITY_PRESETS[preset], qualityPreset: preset } };
}

const numberIn = (value: unknown, minimum: number, maximum: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;

const oneOf = <Option>(value: unknown, options: readonly Option[], fallback: Option): Option =>
  options.includes(value as Option) ? (value as Option) : fallback;

const flag = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);

const record = (value: unknown): Record<string, unknown> =>
  (typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {});

function sanitizeKeyBindings(value: unknown): KeyBindings {
  const source = record(value);
  const bindings = cloneKeyBindings(DEFAULT_KEY_BINDINGS);
  for (const action of INPUT_ACTIONS) {
    const keys = source[action];
    if (!Array.isArray(keys)) continue;
    const cleaned = keys.filter((key): key is string => typeof key === 'string' && key.length > 0);
    bindings[action] = [...new Set(cleaned)].slice(0, MAXIMUM_KEYS_PER_ACTION);
  }
  return giveNewActionsTheirKeys(source, bindings);
}

/**
 * Bindings stored before an action existed have no keys for it, so it takes its default. A default key the player
 * has already given to something it would clash with stays theirs: the new action is left for them to bind.
 */
function giveNewActionsTheirKeys(source: Record<string, unknown>, bindings: KeyBindings): KeyBindings {
  if (Object.keys(source).length === 0) return bindings;
  for (const action of INPUT_ACTIONS) {
    if (Array.isArray(source[action])) continue;
    bindings[action] = bindings[action].filter((keyCode) => findBindingConflicts(bindings, action, keyCode).length === 0);
  }
  return bindings;
}

/** The defaults that changed in version 2: what each action was, and what it is now. */
const MOVED_DEFAULTS: readonly { action: InputAction; from: string; to: string }[] = [
  { action: 'lantern', from: 'KeyF', to: 'KeyL' },
  { action: 'interact', from: 'KeyE', to: 'KeyF' },
];

/**
 * Bindings stored by a version 1 build: an action still on its old default
 * moves to the new one. A key the player chose stays, and so does an old
 * default whose new key the player has given to something else.
 */
function moveOldDefaults(bindings: KeyBindings): KeyBindings {
  let next = bindings;
  for (const { action, from, to } of MOVED_DEFAULTS) {
    const untouched = next[action].length === 1 && next[action][0] === from;
    if (!untouched || findBindingConflicts(next, action, to).length > 0) continue;
    next = { ...next, [action]: [to] };
  }
  return next;
}

/**
 * Build valid settings from anything: stored JSON from an older build, a
 * partial object, or junk. Unknown fields are dropped, missing or invalid
 * ones take their default, numbers are clamped to their range.
 */
export function sanitizeSettings(value: unknown): Settings {
  const defaults = createDefaultSettings();
  const source = record(value);
  const audio = record(source.audio);
  const graphics = record(source.graphics);
  const controls = record(source.controls);
  const gameplay = record(source.gameplay);
  const accessibility = record(source.accessibility);
  const limits = SETTINGS_LIMITS;
  // Stored settings carry the version that wrote them. With none, they are from before versions mattered.
  const storedVersion = typeof source.version === 'number' ? source.version : 1;
  const keyBindings = sanitizeKeyBindings(controls.keyBindings);
  const volume = (input: unknown, fallback: number): number => numberIn(input, limits.volume.minimum, limits.volume.maximum, fallback);
  return {
    version: SETTINGS_VERSION,
    audio: {
      master: volume(audio.master, defaults.audio.master),
      music: volume(audio.music, defaults.audio.music),
      effects: volume(audio.effects, defaults.audio.effects),
      ambience: volume(audio.ambience, defaults.audio.ambience),
    },
    graphics: {
      qualityPreset: oneOf(graphics.qualityPreset, limits.qualityPresets, defaults.graphics.qualityPreset),
      renderScale: numberIn(graphics.renderScale, limits.renderScale.minimum, limits.renderScale.maximum, defaults.graphics.renderScale),
      shadows: oneOf(graphics.shadows, limits.shadows, defaults.graphics.shadows),
      waterDetail: oneOf(graphics.waterDetail, limits.waterDetail, defaults.graphics.waterDetail),
      fieldOfView: numberIn(graphics.fieldOfView, limits.fieldOfView.minimum, limits.fieldOfView.maximum, defaults.graphics.fieldOfView),
      fpsCap: oneOf(graphics.fpsCap, limits.fpsCaps, defaults.graphics.fpsCap),
      showFps: flag(graphics.showFps, defaults.graphics.showFps),
    },
    controls: {
      keyBindings: storedVersion < 2 && controls.keyBindings !== undefined ? moveOldDefaults(keyBindings) : keyBindings,
      mouseSensitivity: numberIn(controls.mouseSensitivity, limits.mouseSensitivity.minimum, limits.mouseSensitivity.maximum, defaults.controls.mouseSensitivity),
      invertY: flag(controls.invertY, defaults.controls.invertY),
      cameraAutoCentre: flag(controls.cameraAutoCentre, defaults.controls.cameraAutoCentre),
    },
    gameplay: {
      difficulty: oneOf(gameplay.difficulty, limits.difficulties, defaults.gameplay.difficulty),
      autosaveIntervalSeconds: oneOf(gameplay.autosaveIntervalSeconds, limits.autosaveIntervals, defaults.gameplay.autosaveIntervalSeconds),
      hints: flag(gameplay.hints, defaults.gameplay.hints),
    },
    accessibility: {
      uiScale: numberIn(accessibility.uiScale, limits.uiScale.minimum, limits.uiScale.maximum, defaults.accessibility.uiScale),
      reduceCameraMotion: flag(accessibility.reduceCameraMotion, defaults.accessibility.reduceCameraMotion),
      patternedMeters: flag(accessibility.patternedMeters, defaults.accessibility.patternedMeters),
      arrivalCards: oneOf(accessibility.arrivalCards, limits.arrivalCards, defaults.accessibility.arrivalCards),
    },
  };
}

/** What the browser says about its user, for the settings nobody has chosen yet. */
export interface SettingsEnvironment {
  /** The browser asks for less motion (`prefers-reduced-motion`). */
  reducedMotion?: boolean;
}

/** True when what was stored carries the player's own choice of arrival cards. */
const choseArrivalCards = (stored: unknown): boolean =>
  SETTINGS_LIMITS.arrivalCards.includes(record(record(stored).accessibility).arrivalCards as ArrivalCards);

/**
 * Load settings. Anything missing, broken or unreadable falls back to defaults.
 * The arrival cards start on Still in a browser that asks for less motion, until the player picks for themselves.
 */
export function loadSettings(storage: SettingsStorage, environment: SettingsEnvironment = {}): Settings {
  let stored: unknown = null;
  let settings = createDefaultSettings();
  try {
    const text = storage.getItem(SETTINGS_KEY);
    if (text) {
      stored = JSON.parse(text);
      settings = sanitizeSettings(stored);
    }
  } catch {
    stored = null;
    settings = createDefaultSettings();
  }
  if (environment.reducedMotion === true && !choseArrivalCards(stored)) settings.accessibility.arrivalCards = 'still';
  return settings;
}

/** Save settings. Returns false when storage refuses. */
export function saveSettings(storage: SettingsStorage, settings: Settings): boolean {
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(sanitizeSettings(settings)));
    return true;
  } catch {
    return false;
  }
}

const contextsClash = (first: InputContext, second: InputContext): boolean =>
  first === second || first === 'always' || second === 'always';

/** Actions already using a key that would clash with `action` in play. */
export function findBindingConflicts(bindings: KeyBindings, action: InputAction, keyCode: string): InputAction[] {
  return INPUT_ACTIONS.filter((other) => other !== action && bindings[other].includes(keyCode)
    && contextsClash(ACTION_CONTEXT[action], ACTION_CONTEXT[other]));
}

/**
 * Bind a key to an action in one of its slots. The key is taken away from any
 * action it would clash with; those actions are returned so the UI can say so.
 */
export function rebindKey(
  bindings: KeyBindings,
  action: InputAction,
  slot: number,
  keyCode: string,
): { bindings: KeyBindings; unbound: InputAction[] } {
  const next = cloneKeyBindings(bindings);
  const unbound = findBindingConflicts(next, action, keyCode);
  for (const other of unbound) next[other] = next[other].filter((code) => code !== keyCode);
  const keys = next[action].filter((code) => code !== keyCode);
  const index = Math.max(0, Math.min(MAXIMUM_KEYS_PER_ACTION - 1, slot));
  if (index >= keys.length) keys.push(keyCode);
  else keys[index] = keyCode;
  next[action] = keys.slice(0, MAXIMUM_KEYS_PER_ACTION);
  return { bindings: next, unbound };
}

/** Remove one key from an action. */
export function clearBinding(bindings: KeyBindings, action: InputAction, slot: number): KeyBindings {
  const next = cloneKeyBindings(bindings);
  next[action] = next[action].filter((_, index) => index !== slot);
  return next;
}

/** The action a key triggers in a context, or null. */
export function actionForKey(bindings: KeyBindings, keyCode: string, context: 'canoe' | 'foot'): InputAction | null {
  return INPUT_ACTIONS.find((action) => bindings[action].includes(keyCode)
    && (ACTION_CONTEXT[action] === context || ACTION_CONTEXT[action] === 'always')) ?? null;
}

/** Actions left with no key at all. The controls panel should flag these. */
export function unboundActions(bindings: KeyBindings): InputAction[] {
  return INPUT_ACTIONS.filter((action) => bindings[action].length === 0);
}

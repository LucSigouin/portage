import { describe, expect, it } from 'vitest';
import {
  ACTION_CONTEXT, ACTION_LABELS, DEFAULT_KEY_BINDINGS, INPUT_ACTIONS, QUALITY_PRESETS, SETTINGS_KEY, SETTINGS_LIMITS, SETTINGS_VERSION, actionForKey, applyQualityPreset, clearBinding, cloneKeyBindings, createDefaultSettings, findBindingConflicts, loadSettings, rebindKey, sanitizeSettings, saveSettings, unboundActions,
} from '../src/settings/index.ts';
import { FakeStorage } from './support.ts';

describe('settings schema', () => {
  it('covers every option in the brief', () => {
    const settings = createDefaultSettings();
    expect(Object.keys(settings.audio).sort()).toEqual(['ambience', 'effects', 'master', 'music']);
    expect(Object.keys(settings.graphics).sort()).toEqual(
      ['fieldOfView', 'fpsCap', 'qualityPreset', 'renderScale', 'shadows', 'showFps', 'waterDetail'],
    );
    expect(Object.keys(settings.controls).sort()).toEqual(['cameraAutoCentre', 'invertY', 'keyBindings', 'mouseSensitivity']);
    expect(Object.keys(settings.gameplay).sort()).toEqual(['autosaveIntervalSeconds', 'difficulty', 'hints']);
    expect(Object.keys(settings.accessibility).sort()).toEqual(['patternedMeters', 'reduceCameraMotion', 'uiScale']);
    expect(settings.gameplay.difficulty).toBe('standard');
    expect(SETTINGS_LIMITS.difficulties).toEqual(['relaxed', 'standard']);
    // Scavenging takes one press: the hold-or-toggle option is gone.
    expect(JSON.stringify(settings)).not.toContain('scavenge');
    expect(Object.keys(SETTINGS_LIMITS)).not.toContain('scavengeModes');
    expect(sanitizeSettings(settings)).toEqual(settings); // the defaults are themselves valid
  });

  it('binds the brief\'s default keys, with a label and a context for every action', () => {
    const keys = DEFAULT_KEY_BINDINGS;
    expect(keys.paddle[0]).toBe('KeyW');
    expect(keys.backPaddle[0]).toBe('KeyS');
    expect([keys.steerPort[0], keys.steerStarboard[0]]).toEqual(['KeyA', 'KeyD']);
    expect(keys.powerStroke[0]).toBe('ShiftLeft');
    expect(keys.bail).toEqual(['KeyR']);
    // F is the main action key (land, interact, scavenge, board). The lantern is on L.
    expect(keys.interact).toEqual(['KeyF']);
    expect(keys.lantern).toEqual(['KeyL']);
    expect(ACTION_LABELS.interact).not.toMatch(/hold/i);
    expect([keys.moveForward[0], keys.moveBack[0], keys.moveLeft[0], keys.moveRight[0]]).toEqual(['KeyW', 'KeyS', 'KeyA', 'KeyD']);
    expect(keys.run[0]).toBe('ShiftLeft');
    expect([keys.inventory, keys.craft, keys.canoeBuilder, keys.questLog, keys.map, keys.pause].flat())
      .toEqual(['Tab', 'KeyC', 'KeyB', 'KeyJ', 'KeyM', 'Escape']);
    expect([keys.tool1, keys.tool2, keys.tool3, keys.tool4, keys.tool5].flat())
      .toEqual(['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5']);
    for (const action of INPUT_ACTIONS) {
      expect(keys[action].length, action).toBeGreaterThan(0);
      expect(ACTION_LABELS[action].length, action).toBeGreaterThan(2);
      expect(['canoe', 'foot', 'always']).toContain(ACTION_CONTEXT[action]);
    }
    expect(unboundActions(cloneKeyBindings(keys))).toEqual([]);
    // No two actions that are live together share a default key.
    for (const action of INPUT_ACTIONS) {
      for (const key of keys[action]) expect(findBindingConflicts(cloneKeyBindings(keys), action, key), `${action} ${key}`).toEqual([]);
    }
  });
});

describe('load and save', () => {
  it('round-trips through storage', () => {
    const storage = new FakeStorage();
    expect(loadSettings(storage)).toEqual(createDefaultSettings());
    const settings = createDefaultSettings();
    settings.audio.music = 0.25;
    settings.gameplay.difficulty = 'relaxed';
    settings.accessibility.patternedMeters = true;
    settings.controls.keyBindings.bail = ['KeyQ'];
    settings.controls.keyBindings.interact = ['KeyE']; // a player may still choose E
    expect(saveSettings(storage, settings)).toBe(true);
    expect(storage.entries.has(SETTINGS_KEY)).toBe(true);
    expect(loadSettings(storage)).toEqual(settings);
    storage.failWrites = true;
    expect(saveSettings(storage, settings)).toBe(false);
  });

  it('falls back to defaults on anything broken, and repairs what it can', () => {
    const storage = new FakeStorage();
    storage.setItem(SETTINGS_KEY, '{oops');
    expect(loadSettings(storage)).toEqual(createDefaultSettings());
    storage.setItem(SETTINGS_KEY, JSON.stringify({
      audio: { master: 7, music: -3, effects: 'loud' },
      graphics: { qualityPreset: 'potato', renderScale: 9, fieldOfView: 10, fpsCap: 61, showFps: 'yes' },
      controls: { mouseSensitivity: Number.NaN, keyBindings: { bail: ['KeyQ', 'KeyQ', 42, 'KeyZ', 'KeyX'], paddle: 'KeyW', nonsense: ['KeyP'] } },
      gameplay: { difficulty: 'nightmare', autosaveIntervalSeconds: 7 },
      accessibility: { uiScale: 0.1, scavengeMode: 'toggle', patternedMeters: true },
      somethingFromTheFuture: true,
    }));
    const settings = loadSettings(storage);
    const defaults = createDefaultSettings();
    expect(settings.audio).toEqual({ master: 1, music: 0, effects: defaults.audio.effects, ambience: defaults.audio.ambience });
    expect(settings.graphics).toMatchObject({ qualityPreset: 'high', renderScale: 2, fieldOfView: 45, fpsCap: 60, showFps: false });
    expect(settings.controls.mouseSensitivity).toBe(1);
    expect(settings.controls.keyBindings.bail).toEqual(['KeyQ', 'KeyZ']);
    expect(settings.controls.keyBindings.paddle).toEqual(defaults.controls.keyBindings.paddle);
    expect(Object.keys(settings.controls.keyBindings).sort()).toEqual([...INPUT_ACTIONS].sort());
    expect(settings.gameplay).toMatchObject({ difficulty: 'standard', autosaveIntervalSeconds: 300 });
    expect(settings.accessibility).toEqual({ uiScale: 0.75, reduceCameraMotion: false, patternedMeters: true }); // the old scavenge option is dropped
    expect(settings).not.toHaveProperty('somethingFromTheFuture');
    expect(sanitizeSettings(null)).toEqual(defaults);
  });

  it('applies a quality preset to the detailed options', () => {
    const low = applyQualityPreset(createDefaultSettings(), 'low');
    expect(low.graphics).toMatchObject({ qualityPreset: 'low', ...QUALITY_PRESETS.low });
    expect(low.graphics.fieldOfView).toBe(60);
  });
});

describe('settings stored by the build before F became the main key', () => {
  // Real version 1 settings, written by the solo build (commit 329521e).
  const fixtures = import.meta.glob<string>('./fixtures/settings-v1-*.json', { eager: true, query: '?raw', import: 'default' });
  const loadOld = (name: string): ReturnType<typeof loadSettings> => {
    const storage = new FakeStorage();
    storage.setItem(SETTINGS_KEY, fixtures[`./fixtures/settings-v1-${name}.json`]);
    return loadSettings(storage);
  };
  const oldBindings = (name: string): Record<string, string[]> =>
    JSON.parse(fixtures[`./fixtures/settings-v1-${name}.json`]).controls.keyBindings;

  it('has three real version 1 settings to test with, all on the old keys', () => {
    expect(Object.keys(fixtures)).toHaveLength(3);
    expect(SETTINGS_VERSION).toBe(2);
    expect(oldBindings('default')).toMatchObject({ interact: ['KeyE'], lantern: ['KeyF'] });
    for (const text of Object.values(fixtures)) expect(JSON.parse(text).version).toBe(1);
  });

  it('moves untouched old defaults to the new keys: F acts, L is the lantern', () => {
    const settings = loadOld('default');
    expect(settings).toEqual(createDefaultSettings());
    expect(settings.controls.keyBindings.interact).toEqual(['KeyF']);
    expect(settings.controls.keyBindings.lantern).toEqual(['KeyL']);
    expect(actionForKey(settings.controls.keyBindings, 'KeyF', 'canoe')).toBe('interact');
    expect(actionForKey(settings.controls.keyBindings, 'KeyF', 'foot')).toBe('interact');
    expect(actionForKey(settings.controls.keyBindings, 'KeyE', 'foot')).toBeNull();
  });

  it('keeps a key the player chose, and still moves the default beside it', () => {
    const settings = loadOld('chosen-interact');
    expect(settings.controls.keyBindings.interact).toEqual(['KeyG']); // their choice
    expect(settings.controls.keyBindings.bail).toEqual(['KeyQ']);
    expect(settings.controls.keyBindings.lantern).toEqual(['KeyL']); // was still the old default
    expect(settings.audio.music).toBe(0.25);
    expect(settings.accessibility).toEqual({ uiScale: 1, reduceCameraMotion: false, patternedMeters: false });
  });

  it('leaves an old default alone when the player has given its new key to something else', () => {
    const settings = loadOld('f-taken');
    // F is their Bail key, so interact stays on E rather than taking it away.
    expect(settings.controls.keyBindings.bail).toEqual(['KeyF']);
    expect(settings.controls.keyBindings.interact).toEqual(['KeyE']);
    expect(settings.controls.keyBindings.sail).toEqual(['KeyL']);
    expect(settings.controls.keyBindings.lantern).toEqual([]);
    expect(findBindingConflicts(settings.controls.keyBindings, 'interact', 'KeyE')).toEqual([]);
  });

  it('moves them once: saved again they are version 2, and a later choice of E sticks', () => {
    const storage = new FakeStorage();
    storage.setItem(SETTINGS_KEY, fixtures['./fixtures/settings-v1-default.json']);
    const settings = loadSettings(storage);
    settings.controls.keyBindings = rebindKey(settings.controls.keyBindings, 'interact', 0, 'KeyE').bindings;
    saveSettings(storage, settings);
    expect(JSON.parse(storage.getItem(SETTINGS_KEY)!).version).toBe(2);
    expect(loadSettings(storage).controls.keyBindings.interact).toEqual(['KeyE']);
  });
});

describe('rebinding', () => {
  it('takes a key away from an action it would clash with', () => {
    const { bindings, unbound } = rebindKey(cloneKeyBindings(DEFAULT_KEY_BINDINGS), 'bail', 0, 'KeyL');
    expect(bindings.bail).toEqual(['KeyL']);
    expect(unbound).toEqual(['lantern']);
    expect(bindings.lantern).toEqual([]);
    expect(unboundActions(bindings)).toEqual(['lantern']);
  });

  it('lets canoe and on-foot actions share a key, but not with an always-on action', () => {
    const shared = rebindKey(cloneKeyBindings(DEFAULT_KEY_BINDINGS), 'run', 0, 'KeyR'); // bail is canoe-only
    expect(shared.unbound).toEqual([]);
    expect(shared.bindings.bail).toEqual(['KeyR']);
    expect(actionForKey(shared.bindings, 'KeyR', 'canoe')).toBe('bail');
    expect(actionForKey(shared.bindings, 'KeyR', 'foot')).toBe('run');
    const clash = rebindKey(cloneKeyBindings(DEFAULT_KEY_BINDINGS), 'run', 0, 'KeyF'); // interact is always on
    expect(clash.unbound).toEqual(['interact']);
  });

  it('fills the second slot, replaces a slot, and clears one', () => {
    let bindings = cloneKeyBindings(DEFAULT_KEY_BINDINGS);
    bindings = rebindKey(bindings, 'interact', 1, 'Space').bindings;
    expect(bindings.interact).toEqual(['KeyF', 'Space']);
    bindings = rebindKey(bindings, 'interact', 0, 'Enter').bindings;
    expect(bindings.interact).toEqual(['Enter', 'Space']);
    bindings = clearBinding(bindings, 'interact', 0);
    expect(bindings.interact).toEqual(['Space']);
    expect(actionForKey(bindings, 'Space', 'canoe')).toBe('interact');
    expect(actionForKey(bindings, 'KeyF', 'canoe')).toBeNull();
    expect(DEFAULT_KEY_BINDINGS.interact).toEqual(['KeyF']); // the defaults are never touched
  });
});

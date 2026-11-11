/** The settings panel: five tabs of rows, key rebinding, and how a changed row lands in the settings. */
import {
  ACTION_CONTEXT, ACTION_LABELS, INPUT_ACTIONS, MAXIMUM_KEYS_PER_ACTION, SETTINGS_LIMITS, applyQualityPreset,
  sanitizeSettings,
} from '../../settings/index.ts';
import type { InputAction, QualityPreset, Settings } from '../../settings/index.ts';
import type { SettingId, SettingValue } from '../intents.ts';
import { SETTINGS_TABS } from '../panels.ts';
import type { SettingsTabId } from '../panels.ts';
import { capitalise, keyLabel } from './format.ts';
import type { BindingRowModel, ButtonModel, PanelModel, SettingRowModel } from './types.ts';

type SettingsBody = Omit<Extract<PanelModel, { id: 'settings' }>, 'title' | 'close'>;

export const SETTINGS_TAB_LABELS: Readonly<Record<SettingsTabId, string>> = {
  audio: 'Audio', graphics: 'Graphics', controls: 'Controls', gameplay: 'Gameplay', accessibility: 'Accessibility',
};

const percent = (value: number): string => `${Math.round(value * 100)}%`;

function slider(
  setting: SettingId, label: string, value: number, range: { minimum: number; maximum: number }, step: number, valueText: string,
): SettingRowModel {
  return { kind: 'slider', setting, label, value, minimum: range.minimum, maximum: range.maximum, step, valueText };
}

function choice<Option extends SettingValue>(
  setting: SettingId, label: string, value: Option, options: readonly Option[], name: (option: Option) => string,
): SettingRowModel {
  return {
    kind: 'choice', setting, label, value, valueText: name(value),
    options: options.map((option) => ({ value: option, label: name(option) })),
  };
}

const toggle = (setting: SettingId, label: string, value: boolean): SettingRowModel => ({
  kind: 'toggle', setting, label, value, valueText: value ? 'On' : 'Off',
});

const word = (value: string): string => capitalise(value);

/** The rows of one tab, in display order. */
export function settingsRows(settings: Settings, tab: SettingsTabId): SettingRowModel[] {
  const limits = SETTINGS_LIMITS;
  switch (tab) {
    case 'audio':
      return [
        slider('audio.master', 'Master volume', settings.audio.master, limits.volume, 0.05, percent(settings.audio.master)),
        slider('audio.music', 'Music', settings.audio.music, limits.volume, 0.05, percent(settings.audio.music)),
        slider('audio.effects', 'Effects', settings.audio.effects, limits.volume, 0.05, percent(settings.audio.effects)),
        slider('audio.ambience', 'Ambience', settings.audio.ambience, limits.volume, 0.05, percent(settings.audio.ambience)),
      ];
    case 'graphics':
      return [
        choice('graphics.qualityPreset', 'Quality preset', settings.graphics.qualityPreset, limits.qualityPresets, word),
        slider('graphics.renderScale', 'Render scale', settings.graphics.renderScale, limits.renderScale, 0.05, percent(settings.graphics.renderScale)),
        choice('graphics.shadows', 'Shadows', settings.graphics.shadows, limits.shadows, word),
        choice('graphics.waterDetail', 'Water detail', settings.graphics.waterDetail, limits.waterDetail, word),
        slider('graphics.fieldOfView', 'Field of view', settings.graphics.fieldOfView, limits.fieldOfView, 1, `${Math.round(settings.graphics.fieldOfView)} degrees`),
        choice('graphics.fpsCap', 'Frame rate cap', settings.graphics.fpsCap, limits.fpsCaps, (cap) => (cap === 0 ? 'Uncapped' : `${cap} fps`)),
        toggle('graphics.showFps', 'Show frame rate', settings.graphics.showFps),
      ];
    case 'controls':
      return [
        slider('controls.mouseSensitivity', 'Mouse sensitivity', settings.controls.mouseSensitivity, limits.mouseSensitivity, 0.1, `${settings.controls.mouseSensitivity.toFixed(1)}x`),
        toggle('controls.invertY', 'Invert vertical look', settings.controls.invertY),
        toggle('controls.cameraAutoCentre', 'Camera swings back behind the heading', settings.controls.cameraAutoCentre),
      ];
    case 'gameplay':
      return [
        choice('gameplay.difficulty', 'Difficulty', settings.gameplay.difficulty, limits.difficulties,
          (difficulty) => (difficulty === 'relaxed' ? 'Relaxed (meters drain 40% slower)' : 'Standard')),
        choice('gameplay.autosaveIntervalSeconds', 'Autosave', settings.gameplay.autosaveIntervalSeconds, limits.autosaveIntervals,
          (seconds) => (seconds === 0 ? 'On landing and sleeping only' : `Every ${seconds / 60} min, and on landing and sleeping`)),
        toggle('gameplay.hints', 'Show hints', settings.gameplay.hints),
      ];
    case 'accessibility':
      return [
        slider('accessibility.uiScale', 'Interface size', settings.accessibility.uiScale, limits.uiScale, 0.05, percent(settings.accessibility.uiScale)),
        toggle('accessibility.reduceCameraMotion', 'Reduce camera motion', settings.accessibility.reduceCameraMotion),
        toggle('accessibility.patternedMeters', 'Patterned meters', settings.accessibility.patternedMeters),
        choice('accessibility.scavengeMode', 'Scavenging', settings.accessibility.scavengeMode, limits.scavengeModes,
          (mode) => (mode === 'hold' ? 'Hold the key' : 'Press once to start, again to stop')),
      ];
  }
}

const CONTEXT_LABELS = { canoe: 'Canoe', foot: 'On foot', always: 'Always' } as const;

/** One row per bindable action, two key slots each. */
export function bindingRows(settings: Settings, capture: { action: InputAction; slot: number } | null): BindingRowModel[] {
  const bindings = settings.controls.keyBindings;
  return INPUT_ACTIONS.map((action) => ({
    action,
    label: ACTION_LABELS[action],
    contextLabel: CONTEXT_LABELS[ACTION_CONTEXT[action]],
    slots: Array.from({ length: MAXIMUM_KEYS_PER_ACTION }, (_, slot) => {
      const keyCode = bindings[action][slot];
      return {
        slot,
        keyLabel: keyCode === undefined ? null : keyLabel(keyCode),
        capturing: capture !== null && capture.action === action && capture.slot === slot,
        rebind: { type: 'begin_rebind' as const, action, slot },
        clear: keyCode === undefined ? null : { type: 'clear_binding' as const, action, slot },
      };
    }),
    unbound: bindings[action].length === 0,
  }));
}

export function buildSettingsPanel(
  settings: Settings,
  tab: SettingsTabId,
  capture: { action: InputAction; slot: number } | null,
  bindingNotice: string,
): SettingsBody {
  const onControls = tab === 'controls';
  const resetBindings: ButtonModel = {
    label: 'Reset keys to defaults', intent: { type: 'reset_key_bindings' }, enabled: true, note: null,
  };
  return {
    id: 'settings',
    tabs: SETTINGS_TABS.map((entry) => ({
      tab: entry, label: SETTINGS_TAB_LABELS[entry], selected: entry === tab,
      intent: { type: 'select_settings_tab', tab: entry },
    })),
    rows: settingsRows(settings, tab),
    bindings: onControls ? bindingRows(settings, capture) : [],
    bindingNotice: !onControls ? '' : capture
      ? `Press a key for ${ACTION_LABELS[capture.action]}. Esc cancels.`
      : bindingNotice,
    resetBindings: onControls ? resetBindings : null,
  };
}

/**
 * A copy of the settings with one value changed. A quality preset also sets
 * the detailed options it stands for. The result is sanitised, so an
 * out-of-range or wrong-typed value falls back instead of corrupting the save.
 */
export function applySettingChange(settings: Settings, setting: SettingId, value: SettingValue): Settings {
  if (setting === 'graphics.qualityPreset') {
    return SETTINGS_LIMITS.qualityPresets.includes(value as QualityPreset)
      ? sanitizeSettings(applyQualityPreset(settings, value as QualityPreset))
      : settings;
  }
  const [group, key] = setting.split('.') as [keyof Settings, string];
  const current = settings[group] as unknown as Record<string, unknown>;
  // A value of the wrong type is ignored: sanitising would silently reset it to the default.
  if (typeof current[key] !== typeof value) return settings;
  return sanitizeSettings({ ...settings, [group]: { ...current, [key]: value } });
}

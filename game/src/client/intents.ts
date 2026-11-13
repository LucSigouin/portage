/**
 * Everything the DOM UI can ask for. The UI holds no rules: it renders the
 * interface model and emits one of these when the player clicks or types.
 * The session decides what each intent does.
 */
import type { InputAction } from '../settings/index.ts';
import type { Command } from '../sim/index.ts';
import type { PanelId, SettingsTabId } from './panels.ts';

/** Panels the UI may ask to open. Dialogue and confirm dialogs open by themselves. */
export type OpenablePanelId = Exclude<PanelId, 'dialogue' | 'confirm'>;

/** Dotted path of one settings value, for example `audio.master`. */
export type SettingId =
  | 'audio.master' | 'audio.music' | 'audio.effects' | 'audio.ambience'
  | 'graphics.qualityPreset' | 'graphics.renderScale' | 'graphics.shadows' | 'graphics.waterDetail'
  | 'graphics.fieldOfView' | 'graphics.fpsCap' | 'graphics.showFps'
  | 'controls.mouseSensitivity' | 'controls.invertY' | 'controls.cameraAutoCentre'
  | 'gameplay.difficulty' | 'gameplay.autosaveIntervalSeconds' | 'gameplay.hints'
  | 'accessibility.uiScale' | 'accessibility.reduceCameraMotion' | 'accessibility.patternedMeters';

export type SettingValue = number | boolean | string;

export type InterfaceSound = 'hover' | 'click' | 'open' | 'close' | 'error' | 'tab';

export type InterfaceIntent =
  // panels
  | { type: 'open_panel'; panel: OpenablePanelId }
  | { type: 'close_panel' }
  | { type: 'resume' }
  | { type: 'select_settings_tab'; tab: SettingsTabId }
  | { type: 'answer_confirm'; accepted: boolean }
  // the rules engine
  | { type: 'command'; command: Command }
  // settings
  | { type: 'change_setting'; setting: SettingId; value: SettingValue }
  | { type: 'begin_rebind'; action: InputAction; slot: number }
  | { type: 'cancel_rebind' }
  | { type: 'clear_binding'; action: InputAction; slot: number }
  | { type: 'reset_key_bindings' }
  // save slots
  | { type: 'continue_game' }
  | { type: 'new_game'; slot: number }
  | { type: 'load_game'; slot: number }
  | { type: 'delete_save'; slot: number }
  | { type: 'quit_to_lobby' }
  // the crew lobby (a game built with a relay address)
  | { type: 'crew_field'; field: 'name' | 'code'; value: string }
  | { type: 'crew_open_room' }
  | { type: 'crew_stop_hosting' }
  | { type: 'crew_copied' }
  | { type: 'crew_join' }
  | { type: 'crew_cancel_join' }
  // the Feedback panel (feedback.ts)
  | { type: 'feedback_field'; field: 'note' | 'name'; value: string }
  | { type: 'feedback_kind'; kind: 'bug' | 'idea' | 'other' }
  | { type: 'feedback_send' }
  // the built view (builtview.ts): a click gives the screen back before its two seconds are up
  | { type: 'end_built_view' }
  // feedback only: the pointer moved onto a control
  | { type: 'hover' };

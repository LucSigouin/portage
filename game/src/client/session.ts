/**
 * The session: lobby or game, the running `GameState`, the save slot it
 * autosaves into, the settings, the open panels and the input layer. It
 * turns key presses and UI intents into commands, panel changes and settings
 * changes, and steps the simulation once per frame unless something pauses it.
 *
 * No DOM in here. `main.ts` passes in `localStorage`; tests pass a fake.
 */
import { MAIN_QUESTS, TUNING } from '../data/index.ts';
import { SAVE_SLOT_COUNT, createAutosaver, createSaveStore } from '../save/index.ts';
import type { Autosaver, SaveStore, SlotSummary, StorageLike } from '../save/index.ts';
import {
  DEFAULT_KEY_BINDINGS, ACTION_LABELS, clearBinding, cloneKeyBindings, loadSettings, saveSettings,
} from '../settings/index.ts';
import type { InputAction, Settings, SettingsStorage } from '../settings/index.ts';
import {
  FIXED_STEP, NEUTRAL_INPUT, createGame, dispatch, drainEvents, playerOf, selectInteractable, step,
} from '../sim/index.ts';
import type { Command, CommandResult, GameEvent, GameState, PlayerId, StepInput } from '../sim/index.ts';
import { InputController } from './input.ts';
import type { InputOutcome, InputSnapshot } from './input.ts';
import type { InterfaceIntent, InterfaceSound } from './intents.ts';
import {
  allowsGameplayInput, createPanelState, isPanelOpen, pausesSimulation, reducePanels,
} from './panels.ts';
import type { ConfirmAction, PanelAction, PanelEffect, PanelId, PanelState, ScreenId } from './panels.ts';
import { failureText, keyLabel, refusalText } from './viewmodels/format.ts';
import { applySettingChange } from './viewmodels/settings.ts';
import type { Tone } from './viewmodels/types.ts';

export type SessionStorage = StorageLike & SettingsStorage;

export interface SessionOptions {
  storage: SessionStorage;
  /** Wall clock in milliseconds, for the "saved at" stamps. */
  now?: () => number;
  /** A fresh seed for each new game: same valley, different loot and weather. */
  randomSeed?: () => number;
}

/** Something that supplies player 0's input for each fixed step in place of the keyboard: the bot. */
export interface StepDriver {
  /** Input for the next 1/60 s step, or null when it has nothing more to do. */
  next(): StepInput | null;
}

/** Things the rest of the client reacts to. */
export type SessionSignal =
  | { type: 'settings_changed'; settings: Settings }
  | { type: 'screen_changed'; screen: ScreenId }
  /** A game was started, loaded or staged: snap the camera, clear the toasts. */
  | { type: 'game_started'; slot: number | null }
  | { type: 'notice'; text: string; tone: Tone }
  | { type: 'interface_sound'; sound: InterfaceSound }
  | { type: 'saved'; slot: number; reason: 'landing' | 'sleeping' | 'timer' | 'manual' }
  | { type: 'driver_finished' };

/** The seed the lobby backdrop plays on. */
export const BACKDROP_SEED = 20261110;

/** The backdrop is staged afresh this often, so nobody starves or swamps behind the title. */
export const BACKDROP_RESET_SECONDS = 600;

/**
 * The scene behind the lobby: a new game with the hull patched and dry, so
 * it drifts off Home Knoll for as long as the lobby is open. `time` carries
 * the world clock over a reset, so the light does not jump.
 */
function createBackdrop(time?: number): GameState {
  const state = createGame(BACKDROP_SEED);
  state.canoe.hullTier = 1;
  state.canoe.waterLevel = 0;
  if (time !== undefined) state.time = time;
  drainEvents(state);
  return state;
}

/** Most fixed steps one frame may run. Keeps a very fast replay from freezing the page. */
export const MAXIMUM_STEPS_PER_FRAME = 2400;

const defaultRandomSeed = (): number => Math.floor(Math.random() * 0x7fffffff);

export class Session {
  settings: Settings;
  panels: PanelState = createPanelState('lobby');
  /** The game being played, or null in the lobby. */
  game: GameState | null = null;
  /**
   * The player this screen plays: the keys drive them, commands are theirs and
   * the view-models are built for them. Always 0 until the networking step.
   */
  localPlayerId: PlayerId = 0;
  /** Players in a new game, 1 to 4 (`?crew=N`). The extra ones sit idle. */
  crewSize = 1;
  /** The slot the game autosaves into. Null for a staged game that never saves. */
  slot: number | null = null;
  /** The scene behind the lobby: a game nobody plays. */
  backdrop: GameState = createBackdrop();
  readonly input: InputController;
  /** True while the tab is hidden. */
  hidden = false;
  /** Debug: hold the simulation still for a staged shot. */
  frozen = false;
  /** Debug: simulated seconds per real second. */
  timeScale = 1;
  /** Seconds the simulation advanced in the last `advance`. */
  simulatedSeconds = 0;
  /** The input the last step ran with. */
  lastInput: StepInput = { ...NEUTRAL_INPUT };
  /** What the last rebind did, for the controls tab. */
  bindingNotice = '';

  private readonly store: SaveStore;
  private readonly storage: SessionStorage;
  private readonly now: () => number;
  private readonly randomSeed: () => number;
  private autosaver: Autosaver | null = null;
  private driver: StepDriver | null = null;
  private driverCarry = 0;
  private summaries: SlotSummary[] | null = null;
  private readonly listeners = new Set<(signal: SessionSignal) => void>();

  constructor(options: SessionOptions) {
    this.storage = options.storage;
    this.now = options.now ?? (() => Date.now());
    this.randomSeed = options.randomSeed ?? defaultRandomSeed;
    this.store = createSaveStore(options.storage, this.now);
    this.settings = loadSettings(options.storage);
    this.input = new InputController({
      keyBindings: this.settings.controls.keyBindings,
      scavengeMode: this.settings.accessibility.scavengeMode,
      mouseSensitivity: this.settings.controls.mouseSensitivity,
      invertY: this.settings.controls.invertY,
    });
  }

  // --- Reading ----------------------------------------------------------------

  get screen(): ScreenId {
    return this.panels.screen;
  }

  /** The state to draw: the game, or the lobby backdrop. */
  get activeState(): GameState {
    return this.game ?? this.backdrop;
  }

  /** True while the simulation does not advance. */
  get paused(): boolean {
    if (this.hidden) return true;
    return this.screen === 'game' && (this.frozen || pausesSimulation(this.panels));
  }

  get hasDriver(): boolean {
    return this.driver !== null;
  }

  /** One summary per save slot. Cached; refreshed after every write. */
  slotSummaries(): SlotSummary[] {
    this.summaries ??= this.store.list();
    return this.summaries;
  }

  /** The slot with the newest save, or null. */
  latestSlot(): number | null {
    const filled = this.slotSummaries().filter((summary) => !summary.empty && !summary.corrupt);
    if (filled.length === 0) return null;
    return filled.reduce((newest, summary) => (summary.savedAt > newest.savedAt ? summary : newest)).slot;
  }

  wallClock(): number {
    return this.now();
  }

  subscribe(listener: (signal: SessionSignal) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private signal(signal: SessionSignal): void {
    for (const listener of this.listeners) listener(signal);
  }

  private notice(text: string, tone: Tone = 'info'): void {
    this.signal({ type: 'notice', text, tone });
  }

  private sound(sound: InterfaceSound): void {
    this.signal({ type: 'interface_sound', sound });
  }

  // --- Games and save slots ---------------------------------------------------

  /** Start a new game in a slot, replacing whatever was there. */
  newGame(slot: number): boolean {
    if (!Number.isInteger(slot) || slot < 0 || slot >= SAVE_SLOT_COUNT) return false;
    const state = createGame(this.randomSeed(), { difficulty: this.settings.gameplay.difficulty, crew: this.crewSize });
    this.enterGame(state, slot);
    this.saveNow();
    return true;
  }

  /** Load a slot. False, with a notice, when it is empty or unreadable. */
  loadGame(slot: number): boolean {
    const result = this.store.load(slot);
    if (!result.ok) {
      this.notice(result.reason === 'empty' ? 'That slot is empty.' : 'That save cannot be read.', 'warning');
      this.sound('error');
      return false;
    }
    this.enterGame(result.state, slot);
    return true;
  }

  /** Load the newest save. */
  continueGame(): boolean {
    const slot = this.latestSlot();
    return slot !== null && this.loadGame(slot);
  }

  deleteSave(slot: number): void {
    this.store.remove(slot);
    this.summaries = null;
  }

  /** Put a prepared state in play without a save slot. For the bot and staged shots. */
  adoptGame(state: GameState): void {
    this.enterGame(state, null);
  }

  private enterGame(state: GameState, slot: number | null): void {
    this.game = state;
    this.slot = slot;
    this.driver = null;
    this.driverCarry = 0;
    this.frozen = false;
    this.autosaver = slot === null ? null : createAutosaver(this.store, slot, this.settings.gameplay.autosaveIntervalSeconds);
    // The difficulty setting is global: it follows the player into every save.
    if (state.difficulty !== this.settings.gameplay.difficulty) {
      dispatch(state, { type: 'set_difficulty', difficulty: this.settings.gameplay.difficulty });
    }
    this.input.releaseAll();
    this.applyPanels({ type: 'show_screen', screen: 'game' });
    this.signal({ type: 'screen_changed', screen: 'game' });
    this.signal({ type: 'game_started', slot });
  }

  /** Save the running game into its slot right now. */
  saveNow(): boolean {
    if (!this.game || this.slot === null) return false;
    const saved = this.store.save(this.slot, this.game);
    this.summaries = null;
    if (saved) this.signal({ type: 'saved', slot: this.slot, reason: 'manual' });
    else this.notice('Could not save: the browser refused the write.', 'danger');
    return saved;
  }

  /** Save and go back to the lobby. */
  quitToLobby(): void {
    this.saveNow();
    this.game = null;
    this.slot = null;
    this.autosaver = null;
    this.driver = null;
    this.frozen = false;
    this.input.releaseAll();
    this.applyPanels({ type: 'show_screen', screen: 'lobby' });
    this.signal({ type: 'screen_changed', screen: 'lobby' });
  }

  /** The tab was hidden or shown. Hiding pauses, releases every key and saves. */
  setHidden(hidden: boolean): void {
    if (hidden === this.hidden) return;
    this.hidden = hidden;
    if (hidden) {
      this.input.releaseAll();
      if (this.game && this.slot !== null) this.saveNow();
    }
  }

  // --- Driving ----------------------------------------------------------------

  /** Hand the controls to a driver (the bot). It plays until it returns null. */
  attachDriver(driver: StepDriver | null): void {
    this.driver = driver;
    this.driverCarry = 0;
    this.input.releaseAll();
  }

  /**
   * One frame. Steps the simulation unless paused, then drains its events
   * once and returns them for the app to fan out. `cameraYaw` is the bearing
   * the camera looks along, for camera-relative walking.
   */
  advance(frameSeconds: number, cameraYaw: number): GameEvent[] {
    this.simulatedSeconds = 0;
    if (!this.game) {
      if (this.backdrop.playedSeconds >= BACKDROP_RESET_SECONDS) this.backdrop = createBackdrop(this.backdrop.time);
      if (!this.hidden) step(this.backdrop, NEUTRAL_INPUT, frameSeconds);
      drainEvents(this.backdrop);
      return [];
    }
    const game = this.game;
    if (!this.paused) {
      const seconds = frameSeconds * this.timeScale;
      if (this.driver) this.stepWithDriver(game, seconds);
      else this.stepWithKeys(game, seconds, cameraYaw);
    }
    const events = drainEvents(game);
    this.applyPanels({ type: 'sync_dialogue', open: playerOf(game, this.localPlayerId).dialogue !== null }, true);
    if (events.some((event) => event.type === 'game_completed')) {
      this.applyPanels({ type: 'close_all' }, true);
      this.applyPanels({ type: 'open', panel: 'credits' });
    }
    const reason = this.autosaver?.update(game, events, frameSeconds) ?? null;
    if (reason !== null && this.slot !== null) {
      this.summaries = null;
      this.signal({ type: 'saved', slot: this.slot, reason });
    }
    return events;
  }

  private stepWithKeys(game: GameState, seconds: number, cameraYaw: number): void {
    const input = this.input.sample(this.inputSnapshot(), cameraYaw);
    this.lastInput = input;
    const before = game.playedSeconds;
    let remaining = seconds;
    const inputs = this.crewInput(input, this.localPlayerId);
    while (remaining > 1e-9) {
      const chunk = Math.min(remaining, TUNING.maximumFrameSeconds);
      step(game, inputs, chunk);
      remaining -= chunk;
    }
    this.simulatedSeconds = game.playedSeconds - before;
  }

  /** One player's input as a crew's: everyone else holds still. */
  private crewInput(input: StepInput, playerId: PlayerId): (StepInput | undefined)[] {
    const inputs: (StepInput | undefined)[] = [];
    inputs[playerId] = input;
    return inputs;
  }

  private stepWithDriver(game: GameState, seconds: number): void {
    this.driverCarry += seconds;
    let steps = 0;
    while (this.driverCarry >= FIXED_STEP && steps < MAXIMUM_STEPS_PER_FRAME && this.driver) {
      const input = this.driver.next();
      if (input === null) {
        // Hand the game back to the player: normal speed, no key left held.
        this.driver = null;
        this.driverCarry = 0;
        this.timeScale = 1;
        this.lastInput = { ...NEUTRAL_INPUT };
        this.input.releaseAll();
        this.signal({ type: 'driver_finished' });
        break;
      }
      this.lastInput = input;
      step(game, input, FIXED_STEP);
      this.driverCarry -= FIXED_STEP;
      steps += 1;
      // A panel that pauses (the credits) stops the replay on the spot.
      if (game.events.some((event) => event.type === 'game_completed')) break;
    }
    if (steps === MAXIMUM_STEPS_PER_FRAME) this.driverCarry = 0;
    this.simulatedSeconds = steps * FIXED_STEP;
  }

  // --- Commands ---------------------------------------------------------------

  /**
   * Send a command to the rules engine. The one door for the keyboard, the UI
   * and the bot. A refusal becomes a notice saying what is missing, unless
   * `quiet` (the bot probes with commands it expects to be refused).
   */
  dispatch(command: Command, quiet = false): CommandResult {
    if (!this.game) return { ok: false, reason: 'unknown_id', missing: null };
    const result = dispatch(this.game, command, this.localPlayerId);
    if (!result.ok && !quiet) {
      this.notice(failureText(result.reason, result.missing), 'warning');
      this.sound('error');
    }
    return result;
  }

  // --- Keys -------------------------------------------------------------------

  /** What the input layer needs from the game, or null when keys do not drive it. */
  inputSnapshot(): InputSnapshot | null {
    const game = this.game;
    if (!game || this.driver || this.paused || !allowsGameplayInput(this.panels)) return null;
    const player = playerOf(game, this.localPlayerId);
    return {
      mode: player.mode,
      interactable: selectInteractable(game, this.localPlayerId),
      sailRaised: game.canoe.sailRaised,
      tools: player.tools,
      selectedTool: player.selectedTool,
    };
  }

  keyDown(keyCode: string, repeat = false): void {
    for (const outcome of this.input.keyDown(keyCode, repeat, this.inputSnapshot())) this.applyOutcome(outcome);
  }

  keyUp(keyCode: string): void {
    this.input.keyUp(keyCode);
  }

  /** The window lost focus: let go of every key. */
  blur(): void {
    this.input.releaseAll();
  }

  private applyOutcome(outcome: InputOutcome): void {
    switch (outcome.type) {
      case 'command':
        this.dispatch(outcome.command);
        break;
      case 'toggle_panel':
        if (this.screen === 'game') this.applyPanels({ type: 'toggle', panel: outcome.panel });
        break;
      case 'escape':
        this.applyPanels({ type: 'escape' });
        break;
      case 'rebind_cancelled':
        this.bindingNotice = '';
        this.sound('close');
        break;
      case 'rebound': {
        const lost = outcome.unbound.map((action) => ACTION_LABELS[action]);
        this.bindingNotice = `${ACTION_LABELS[outcome.action]} is now ${keyLabel(outcome.keyCode)}.`
          + (lost.length > 0 ? ` ${lost.join(', ')} lost that key.` : '');
        this.updateSettings({ ...this.settings, controls: { ...this.settings.controls, keyBindings: outcome.bindings } });
        this.sound('click');
        break;
      }
    }
  }

  // --- Panels -----------------------------------------------------------------

  private panelContext(): { canoeBeached: boolean } {
    return { canoeBeached: this.game?.canoe.beached ?? false };
  }

  private applyPanels(action: PanelAction, quiet = false): void {
    const result = reducePanels(this.panels, action, this.panelContext());
    const opened = result.state.stack.length > this.panels.stack.length;
    this.panels = result.state;
    if (opened) this.input.releaseAll();
    for (const effect of result.effects) this.applyPanelEffect(effect, quiet);
  }

  private applyPanelEffect(effect: PanelEffect, quiet: boolean): void {
    switch (effect.type) {
      case 'opened':
        if (!quiet) this.sound('open');
        break;
      case 'closed':
        if (effect.panel === 'settings') this.input.cancelCapture();
        if (!quiet) this.sound('close');
        break;
      case 'tab_changed':
        this.input.cancelCapture();
        this.sound('tab');
        break;
      case 'refused':
        this.notice(refusalText(effect.reason), 'warning');
        this.sound('error');
        break;
      case 'end_dialogue':
        this.dispatch({ type: 'end_dialogue' });
        break;
      case 'confirmed':
        this.carryOut(effect.action);
        break;
    }
  }

  private carryOut(action: ConfirmAction): void {
    switch (action.type) {
      case 'delete_save':
        this.deleteSave(action.slot);
        this.notice(`Slot ${action.slot + 1} deleted.`);
        break;
      case 'overwrite_save':
        this.newGame(action.slot);
        break;
      case 'quit_to_lobby':
        this.quitToLobby();
        break;
      case 'reset_key_bindings':
        this.bindingNotice = 'Every key is back to its default.';
        this.updateSettings({
          ...this.settings,
          controls: { ...this.settings.controls, keyBindings: cloneKeyBindings(DEFAULT_KEY_BINDINGS) },
        });
        break;
    }
  }

  /** True when a panel is open, by id. */
  isOpen(panel: PanelId): boolean {
    return isPanelOpen(this.panels, panel);
  }

  // --- Intents from the UI ----------------------------------------------------

  handleIntent(intent: InterfaceIntent): void {
    switch (intent.type) {
      case 'hover':
        this.sound('hover');
        break;
      case 'open_panel':
        this.applyPanels({ type: 'open', panel: intent.panel });
        break;
      case 'close_panel':
        this.applyPanels({ type: 'close' });
        break;
      case 'resume':
        this.applyPanels({ type: 'close_all' });
        break;
      case 'select_settings_tab':
        this.applyPanels({ type: 'select_settings_tab', tab: intent.tab });
        break;
      case 'answer_confirm':
        this.applyPanels({ type: 'answer_confirm', accepted: intent.accepted });
        break;
      case 'command':
        if (this.dispatch(intent.command).ok) this.sound('click');
        break;
      case 'change_setting':
        this.updateSettings(applySettingChange(this.settings, intent.setting, intent.value));
        this.sound('click');
        break;
      case 'begin_rebind':
        this.bindingNotice = '';
        this.input.beginCapture(intent.action, intent.slot);
        this.sound('click');
        break;
      case 'cancel_rebind':
        this.input.cancelCapture();
        break;
      case 'clear_binding':
        this.clearKey(intent.action, intent.slot);
        break;
      case 'reset_key_bindings':
        this.applyPanels({ type: 'ask_confirm', action: { type: 'reset_key_bindings' } });
        break;
      case 'continue_game':
        if (this.continueGame()) this.sound('click');
        break;
      case 'new_game': {
        const summary = this.slotSummaries().find((entry) => entry.slot === intent.slot);
        if (summary && !summary.empty) this.applyPanels({ type: 'ask_confirm', action: { type: 'overwrite_save', slot: intent.slot } });
        else if (this.newGame(intent.slot)) this.sound('click');
        break;
      }
      case 'load_game':
        if (this.loadGame(intent.slot)) this.sound('click');
        break;
      case 'delete_save':
        this.applyPanels({ type: 'ask_confirm', action: { type: 'delete_save', slot: intent.slot } });
        break;
      case 'quit_to_lobby':
        this.applyPanels({ type: 'ask_confirm', action: { type: 'quit_to_lobby' } });
        break;
    }
  }

  private clearKey(action: InputAction, slot: number): void {
    this.bindingNotice = `${ACTION_LABELS[action]} lost a key.`;
    this.updateSettings({
      ...this.settings,
      controls: { ...this.settings.controls, keyBindings: clearBinding(this.settings.controls.keyBindings, action, slot) },
    });
    this.sound('click');
  }

  // --- Settings ---------------------------------------------------------------

  /** Replace the settings: save them and apply them everywhere they reach. */
  updateSettings(settings: Settings): void {
    this.settings = settings;
    saveSettings(this.storage, settings);
    this.input.configure({
      keyBindings: settings.controls.keyBindings,
      scavengeMode: settings.accessibility.scavengeMode,
      mouseSensitivity: settings.controls.mouseSensitivity,
      invertY: settings.controls.invertY,
    });
    this.autosaver?.setIntervalSeconds(settings.gameplay.autosaveIntervalSeconds);
    if (this.game && this.game.difficulty !== settings.gameplay.difficulty) {
      dispatch(this.game, { type: 'set_difficulty', difficulty: settings.gameplay.difficulty });
    }
    this.signal({ type: 'settings_changed', settings });
  }

  /** "Quest 5 of 12: A proper edge", for the pause menu. */
  progressText(): string {
    if (!this.game) return '';
    const quest = MAIN_QUESTS.find((definition) => this.game?.quests[definition.id].status === 'active');
    return quest ? `Quest ${quest.order} of ${MAIN_QUESTS.length}: ${quest.name}` : 'The Beacon is lit. Free play.';
  }
}

/**
 * The session: lobby or game, the running `GameState`, the save slot it
 * autosaves into, the settings, the open panels and the input layer. It
 * turns key presses and UI intents into commands, panel changes and settings
 * changes, and steps the simulation once per frame unless something pauses it.
 *
 * No DOM in here. `main.ts` passes in `localStorage`; tests pass a fake.
 */
import { MAIN_QUESTS, TUNING } from '../data/index.ts';
import type { StationId } from '../data/index.ts';
import { SAVE_SLOT_COUNT, createAutosaver, createSaveStore } from '../save/index.ts';
import type { AutosaveReason, Autosaver, SaveStore, SlotSummary, StorageLike } from '../save/index.ts';
import {
  DEFAULT_KEY_BINDINGS, ACTION_LABELS, clearBinding, cloneKeyBindings, loadSettings, saveSettings,
} from '../settings/index.ts';
import type { InputAction, Settings, SettingsStorage } from '../settings/index.ts';
import {
  FIXED_STEP, NEUTRAL_INPUT, beltOf, connectedPlayers, createGame, dispatch, drainEvents, playerOf, selectInteractable,
  setConnected, setPlayerName, step,
} from '../sim/index.ts';
import type { Command, CommandResult, GameEvent, GameState, PlayerId, StepInput } from '../sim/index.ts';
import { standClear } from '../sim/index.ts';
import { BackdropCanoe } from './backdrop.ts';
import { BUILT_VIEW_FRAME_CAP, BUILT_VIEW_SECONDS, BUILT_VIEW_WAIT_SECONDS, builtPieceOf, isBuildCommand, showsPiece } from './builtview.ts';
import type { BuiltPiece, BuiltView } from './builtview.ts';
import { InputController } from './input.ts';
import type { InputOutcome, InputSnapshot } from './input.ts';
import type { InterfaceIntent, InterfaceSound } from './intents.ts';
import {
  allowsGameplayInput, createPanelState, isPanelOpen, pausesSimulation, reducePanels, topPanel,
} from './panels.ts';
import type { ConfirmAction, PanelAction, PanelEffect, PanelId, PanelState, ScreenId } from './panels.ts';
import { failureText, keyLabel, refusalText } from './viewmodels/format.ts';
import { partMovedText } from './viewmodels/inventory.ts';
import { GuestLink, HostLink } from '../net/index.ts';
import type { Transport } from '../net/index.ts';
import type { CrewLobby } from './crewlobby.ts';
import type { FeedbackDesk } from './feedback.ts';
import { HOST_BACK_TEXT, JOIN_PROBLEM_TEXT, LEAVE_TEXT } from './viewmodels/crew.ts';
import { applySettingChange } from './viewmodels/settings.ts';
import type { Tone } from './viewmodels/types.ts';
import { boatOpensOn } from './viewmodels/stations.ts';
import { stationDoor } from './viewmodels/handcraft.ts';

export type SessionStorage = StorageLike & SettingsStorage;

export interface SessionOptions {
  storage: SessionStorage;
  /** Wall clock in milliseconds, for the "saved at" stamps. */
  now?: () => number;
  /** A fresh seed for each new game: same valley, different loot and weather. */
  randomSeed?: () => number;
  /** The browser asks for less motion: the arrival cards start on Still (`loadSettings`). */
  reducedMotion?: boolean;
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
  | { type: 'saved'; slot: number; reason: AutosaveReason | 'manual' }
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

/** What the player is told when the browser refuses a save: storage full or blocked. */
const SAVE_REFUSED_TEXT = 'Could not save: the browser refused the write.';

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
  /** Players in a new game, 1 to 4 (`?crew=N`). The extra ones are away stand-ins. */
  crewSize = 1;
  /** The player whose browser runs a shared game. Null while the game is not shared. */
  hostId: PlayerId | null = null;
  /** The name this screen's player goes by in a shared game. Empty: the crew mark's label. */
  playerName = '';
  /**
   * Set this to share every game this session plays. It is called with a fresh
   * link each time a game starts: hand the link every wire a guest arrives on
   * (`link.accept(transport)`).
   */
  onShare: ((link: HostLink) => void) | null = null;
  /** The link to the guests while this session hosts. */
  host: HostLink | null = null;
  /** The link to the host while this session is a guest. Then `game` is the host's state, a beat behind, and nothing here changes it. */
  guest: GuestLink | null = null;
  /** True while this session is a guest in a game and has had no word from the host for a moment: a note stands on the screen. */
  hostQuiet = false;
  /**
   * The crew lobby: hosting a room on the relay and joining one. Null in a game
   * built without a relay address: then the lobby has no crew entries and none of it runs.
   */
  crew: CrewLobby | null = null;
  /** The feedback desk: a play tester's note for Luc (`feedback.ts`). Null until `main.ts` makes one: then the panel does not open. */
  feedback: FeedbackDesk | null = null;
  /** The slot the game autosaves into. Null for a staged game that never saves. */
  slot: number | null = null;
  /** The scene behind the lobby: a game nobody plays. */
  backdrop: GameState = createBackdrop();
  /** The canoe that scene shows: the one of the save played last, worn over the scene's own (`backdrop.ts`). */
  readonly backdropCanoe = new BackdropCanoe();
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
  /**
   * The built view, while it holds the screen: the player just built this piece from the canoe builder, the panel
   * has stepped aside and the canoe is shown still, framed, for two seconds (`builtview.ts`). Null the rest of the time.
   */
  builtView: BuiltView | null = null;

  private readonly store: SaveStore;
  private readonly storage: SessionStorage;
  private readonly now: () => number;
  private readonly randomSeed: () => number;
  private autosaver: Autosaver | null = null;
  /**
   * True from a refused save until the next save that works. An autosave
   * refused in that stretch says nothing more: the player has been told.
   */
  private saveRefused = false;
  private driver: StepDriver | null = null;
  private driverCarry = 0;
  /** A piece the player has asked to build from the panel, until the state shows it: then the built view begins. */
  private builtWanted: { piece: BuiltPiece; seconds: number } | null = null;
  private summaries: SlotSummary[] | null = null;
  private readonly listeners = new Set<(signal: SessionSignal) => void>();

  constructor(options: SessionOptions) {
    this.storage = options.storage;
    this.now = options.now ?? (() => Date.now());
    this.randomSeed = options.randomSeed ?? defaultRandomSeed;
    this.store = createSaveStore(options.storage, this.now);
    this.settings = loadSettings(options.storage, { reducedMotion: options.reducedMotion === true });
    this.input = new InputController({
      keyBindings: this.settings.controls.keyBindings,
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

  /** True while two or more players are playing (not away): then nothing pauses the game. */
  get crewed(): boolean {
    return this.game !== null && connectedPlayers(this.game).length >= 2;
  }

  /**
   * True while the simulation does not advance. Alone, a hidden tab and every
   * full panel pause it. With a crew playing nothing does: the panels open
   * over a world that keeps running.
   */
  get paused(): boolean {
    if (this.screen === 'game' && this.frozen) return true;
    if (this.crewed) return false;
    if (this.hidden) return true;
    return this.screen === 'game' && pausesSimulation(this.panels);
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
    this.onlyLocalPlayerPresent(state);
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
    // A save from a shared game: the others are not here now. They keep their place for when they are.
    this.onlyLocalPlayerPresent(result.state);
    // A save from before a thing was solid may have someone standing in it: they step clear (Luc, Round 4).
    standClear(result.state);
    this.enterGame(result.state, slot);
    return true;
  }

  /** Everyone but the player this screen plays is away, until someone joins as them. */
  private onlyLocalPlayerPresent(state: GameState): void {
    for (const player of state.players) setConnected(state, player.id, player.id === playerOf(state, this.localPlayerId).id, true);
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
    // A game of this session's own: no longer anyone's guest, and the old game's guests are let go.
    if (this.guest) this.leaveHost();
    this.stopSharing();
    this.game = state;
    this.slot = slot;
    this.driver = null;
    this.driverCarry = 0;
    this.frozen = false;
    this.endBuiltView();
    this.autosaver = slot === null ? null : createAutosaver(this.store, slot, this.settings.gameplay.autosaveIntervalSeconds);
    this.saveRefused = false;
    // The difficulty setting is global: it follows the player into every save.
    if (state.difficulty !== this.settings.gameplay.difficulty) {
      dispatch(state, { type: 'set_difficulty', difficulty: this.settings.gameplay.difficulty });
    }
    this.share();
    this.input.releaseAll();
    this.applyPanels({ type: 'show_screen', screen: 'game' });
    this.signal({ type: 'screen_changed', screen: 'game' });
    this.signal({ type: 'game_started', slot });
  }

  /**
   * Share the game on the screen, if `onShare` is set and it is not shared
   * already. Every new game does this by itself; call it after setting
   * `onShare` in the middle of one.
   */
  share(): void {
    const game = this.game;
    if (!game || !this.onShare || this.host || this.guest) return;
    if (this.playerName !== '') setPlayerName(game, this.localPlayerId, this.playerName);
    this.host = new HostLink({ game, hostPlayerId: this.localPlayerId });
    this.hostId = this.localPlayerId;
    this.onShare(this.host);
  }

  /** Tell the player something in a note. */
  announce(text: string, tone: Tone = 'info'): void {
    this.notice(text, tone);
  }

  /** Save the running game into its slot right now. */
  saveNow(): boolean {
    if (!this.game || this.slot === null) return false;
    const saved = this.store.save(this.slot, this.game);
    this.summaries = null;
    this.saveRefused = !saved;
    if (saved) this.signal({ type: 'saved', slot: this.slot, reason: 'manual' });
    else this.notice(SAVE_REFUSED_TEXT, 'danger');
    return saved;
  }

  /** Stop sharing the game: every guest is told, and their players stay in the game, away. */
  stopSharing(): void {
    this.host?.close();
    this.host = null;
    this.hostId = null;
  }

  /**
   * Join someone else's game over `transport`. This session becomes a guest:
   * it sends its keys and its commands and shows the host's state. It stays in
   * the lobby until the host answers.
   */
  joinGame(transport: Transport, options: { name: string; key: string }): GuestLink {
    if (this.game) this.quitToLobby();
    this.guest?.close();
    this.guest = new GuestLink(transport, options);
    return this.guest;
  }

  /**
   * The page is going. A guest says so to the host; a host tells its guests
   * and saves, with their players away.
   */
  pageClosing(): void {
    this.guest?.close();
    this.stopSharing();
    this.crew?.pageClosing();
    this.saveNow();
  }

  /** A guest goes back to the lobby: the wire is closed and nothing of the host's game is kept. */
  private leaveHost(): void {
    this.guest?.close();
    this.guest = null;
    this.hostQuiet = false;
    this.hostId = null;
    this.localPlayerId = 0;
    if (!this.game) return;
    this.game = null;
    this.input.releaseAll();
    this.applyPanels({ type: 'show_screen', screen: 'lobby' });
    this.signal({ type: 'screen_changed', screen: 'lobby' });
  }

  /** Save and go back to the lobby. */
  quitToLobby(): void {
    if (this.guest) {
      this.leaveHost();
      return;
    }
    // The guests are away from here on, and saved as away.
    this.stopSharing();
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
      // Nobody is looking: the built view is over.
      this.endBuiltView();
      this.input.releaseAll();
      if (this.game && this.slot !== null) this.saveNow();
    } else {
      // A guest hidden for a while may have been marked away: ask straight back in.
      this.guest?.knock();
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
    this.followBuiltView(frameSeconds);
    if (this.guest) return this.advanceAsGuest(this.guest, frameSeconds, cameraYaw);
    if (!this.game) {
      this.driftBackdrop(frameSeconds);
      return [];
    }
    const game = this.game;
    if (!this.paused) {
      const seconds = frameSeconds * this.timeScale;
      if (this.driver) this.stepWithDriver(game, seconds);
      else this.stepWithKeys(game, seconds, cameraYaw);
    }
    const events = drainEvents(game);
    // The guests get the frame's events and, about 15 times a second, the state.
    this.host?.afterFrame(events, frameSeconds);
    this.followEvents(game, events);
    const reason = this.autosaver?.update(game, events, frameSeconds) ?? null;
    if (reason !== null && this.slot !== null) {
      this.summaries = null;
      this.saveRefused = false;
      this.signal({ type: 'saved', slot: this.slot, reason });
    } else if (this.autosaver?.refused && !this.saveRefused) {
      // Said once for the whole bad stretch, in the hand save's words. The autosaver waits a full interval before the clock tries again.
      this.saveRefused = true;
      this.notice(SAVE_REFUSED_TEXT, 'danger');
    }
    return events;
  }

  /** The lobby's backdrop drifts on; it is staged afresh now and then. */
  private driftBackdrop(frameSeconds: number): void {
    if (this.backdrop.playedSeconds >= BACKDROP_RESET_SECONDS) this.backdrop = createBackdrop(this.backdrop.time);
    this.backdropCanoe.drift(this.backdrop, this, this.store, frameSeconds, this.hidden);
  }

  /** What the panels do by themselves: the conversation follows the local player's talk, the credits follow the Beacon. */
  private followEvents(game: GameState, events: readonly GameEvent[]): void {
    this.applyPanels({ type: 'sync_dialogue', open: playerOf(game, this.localPlayerId).dialogue !== null }, true);
    if (events.some((event) => event.type === 'game_completed')) {
      this.applyPanels({ type: 'close_all' }, true);
      this.applyPanels({ type: 'open', panel: 'credits' });
    }
  }

  /**
   * One frame as a guest. Nothing is stepped here: the keys go to the host,
   * and the game is whatever the host last said, drawn a beat behind and
   * smoothed. Hands the look, the HUD and the sound what a solo frame does:
   * a state, the frame's events, the local player.
   */
  private advanceAsGuest(guest: GuestLink, frameSeconds: number, cameraYaw: number): GameEvent[] {
    guest.update(frameSeconds);
    if (guest.status === 'refused' || guest.status === 'closed') {
      const reason = guest.leaveReason ?? 'closed';
      // When it was the line that went and not the host's doing, the crew lobby knows why.
      const lineFailure = this.crew?.guestEnded(guest.leaveReason) ?? null;
      this.leaveHost();
      this.notice(lineFailure !== null ? JOIN_PROBLEM_TEXT[lineFailure] : LEAVE_TEXT[reason], 'warning');
    }
    const view = this.guest?.status === 'playing' ? this.guest.view() : null;
    if (!view) {
      this.driftBackdrop(frameSeconds);
      return [];
    }
    // No word from the host: a note stands on the screen for as long as that lasts. When it ends, say so once.
    if (guest.hostQuiet !== this.hostQuiet) {
      this.hostQuiet = guest.hostQuiet;
      if (!this.hostQuiet && this.game !== null) this.notice(HOST_BACK_TEXT, 'good');
    }
    const arrived = this.game === null || this.localPlayerId !== guest.playerId;
    const playedBefore = this.game?.playedSeconds ?? view.playedSeconds;
    this.game = view;
    this.localPlayerId = guest.playerId;
    this.hostId = guest.hostId;
    if (arrived) {
      this.slot = null;
      this.autosaver = null;
      this.driver = null;
      this.frozen = false;
      this.input.releaseAll();
      this.applyPanels({ type: 'show_screen', screen: 'game' });
      this.signal({ type: 'screen_changed', screen: 'game' });
      this.signal({ type: 'game_started', slot: null });
    }
    this.simulatedSeconds = Math.max(0, Math.min(0.25, view.playedSeconds - playedBefore));

    const input = this.input.sample(this.inputSnapshot(), cameraYaw);
    this.lastInput = input;
    guest.sendInput(input);
    // The keys just walked this guest's own figure: draw it, and aim the camera, where it is now and not a frame late.
    const walked = guest.view() ?? view;
    this.game = walked;

    for (const outcome of guest.takeResults()) {
      const result = outcome.result;
      // The host would not build it: there is nothing to show.
      if (!result.ok && isBuildCommand(outcome.command)) this.builtWanted = null;
      const toldByEvent = outcome.command.type === 'scavenge' && !result.ok && result.reason === 'missing_requirements';
      const partMoved = outcome.quiet ? null : partMovedText(outcome.command, result);
      if (partMoved) this.notice(partMoved, 'warning');
      if (!result.ok && !outcome.quiet && !toldByEvent) {
        this.notice(failureText(result.reason, result.missing), 'warning');
        this.sound('error');
      }
    }
    const events = guest.takeEvents();
    this.followEvents(walked, events);
    return events;
  }

  private stepWithKeys(game: GameState, seconds: number, cameraYaw: number): void {
    const input = this.input.sample(this.inputSnapshot(), cameraYaw);
    this.lastInput = input;
    const before = game.playedSeconds;
    let remaining = seconds;
    const inputs = this.host ? this.host.crewInput(input, this.localPlayerId) : this.crewInput(input, this.localPlayerId);
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
      step(game, this.host ? this.host.crewInput(input, 0) : input, FIXED_STEP);
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
    if (this.guest) {
      // The host runs it. Its answer comes back in a later frame; a refusal is told then.
      this.guest.sendCommand(command, quiet);
      if (!quiet) this.wantBuiltView(command, false);
      return { ok: true, gained: [], spent: [] };
    }
    const result = dispatch(this.game, command, this.localPlayerId);
    if (result.ok && !quiet) this.wantBuiltView(command, true);
    // A node that needs a tool says so itself, with a `harvest_blocked` event: no second notice.
    const toldByEvent = command.type === 'scavenge' && !result.ok && result.reason === 'missing_requirements';
    const partMoved = quiet ? null : partMovedText(command, result);
    if (partMoved) this.notice(partMoved, 'warning');
    if (!result.ok && !quiet && !toldByEvent) {
      this.notice(failureText(result.reason, result.missing), 'warning');
      this.sound('error');
    }
    return result;
  }

  // --- The built view ---------------------------------------------------------

  /**
   * The player asked to build something. If it came from the canoe builder, and by their own hand, the built view
   * is due as soon as the state shows the piece: at once here, a beat later on a guest (`done` false: the host has
   * yet to run it). The bot's builds, a staged game's and a crewmate's take nobody's screen.
   */
  private wantBuiltView(command: Command, done: boolean): void {
    const game = this.game;
    if (!game || this.driver) return;
    const piece = builtPieceOf(command, game, done);
    if (!piece) return;
    this.builtWanted = { piece, seconds: BUILT_VIEW_WAIT_SECONDS };
    // Dropped again at once unless the canoe builder is the panel on top.
    this.followBuiltView(0);
  }

  /** Once a frame: begin the built view when its piece shows, run its clock, and end it when its time or its panel is gone. */
  private followBuiltView(frameSeconds: number): void {
    const atBuilder = this.game !== null && this.screen === 'game' && topPanel(this.panels) === 'canoe_builder' && !this.hidden;
    if (!atBuilder) {
      this.builtWanted = null;
      this.endBuiltView();
      return;
    }
    const wanted = this.builtWanted;
    if (wanted && this.game) {
      if (showsPiece(this.game, wanted.piece)) {
        this.builtWanted = null;
        this.builtView = { piece: wanted.piece, secondsLeft: BUILT_VIEW_SECONDS };
        this.input.releaseAll();
        return;
      }
      wanted.seconds -= frameSeconds;
      if (wanted.seconds <= 0) this.builtWanted = null;
    }
    if (!this.builtView) return;
    this.builtView.secondsLeft -= Math.min(frameSeconds, BUILT_VIEW_FRAME_CAP);
    if (this.builtView.secondsLeft <= 0) this.endBuiltView();
  }

  /** Give the screen back: the panel, the HUD and the camera are as they were. */
  endBuiltView(): void {
    this.builtView = null;
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
      tools: beltOf(game, player),
      selectedTool: player.selectedTool,
    };
  }

  keyDown(keyCode: string, repeat = false): void {
    if (this.builtView) {
      // Any key gives the screen back at once, and does nothing else. A key still held down from before does not count.
      if (!repeat) this.endBuiltView();
      return;
    }
    // Aboard with the inventory open, the auto-paddle key still switches the paddle (the master review, finding 2).
    // With the pointer on a tile the key is the drop key, and the interface keeps it: it never gets here.
    const game = this.game;
    if (!repeat && game && !this.driver && !this.frozen && this.screen === 'game' && topPanel(this.panels) === 'inventory'
      && playerOf(game, this.localPlayerId).mode === 'canoe') {
      const switched = this.input.autoPaddleKeyInInventory(keyCode);
      if (switched) return void this.applyOutcome(switched);
    }
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
      case 'use_station':
        if (this.screen === 'game') this.openStation(outcome.station);
        break;
      case 'escape':
        this.applyPanels({ type: 'escape' });
        break;
      case 'auto_paddle':
        this.autoPaddleNotice(outcome.on);
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

  /** The note for the auto-paddle going on or off, with the keys as they are bound. */
  private autoPaddleNotice(on: boolean): void {
    const bindings = this.settings.controls.keyBindings;
    const keys = [bindings.autoPaddle[0], bindings.paddle[0], bindings.backPaddle[0]].filter((keyCode) => keyCode !== undefined).map(keyLabel);
    const stop = keys.length > 1 ? `${keys.slice(0, -1).join(', ')} or ${keys.at(-1)}` : keys[0] ?? 'a paddle key';
    this.notice(on ? `Paddling on. ${stop} to stop.` : 'Paddling off.');
  }

  // --- Panels -----------------------------------------------------------------

  private panelContext(): Parameters<typeof reducePanels>[2] {
    return { canoeBeached: this.game?.canoe.beached ?? false, boatOpensOn: this.game ? boatOpensOn(this.game, this.localPlayerId) : 'builder' };
  }

  /**
   * The interact key at a station: its own menu. A camp's station opens in the crafting panel, a part on the canoe
   * in the boat's menu. With no such station in reach (the rules said there was one) the crafting panel opens.
   */
  private openStation(stationId: StationId): void {
    const door = this.game ? stationDoor(this.game, this.localPlayerId, stationId) : null;
    this.applyPanels({ type: 'open', panel: door?.panel ?? 'crafting' });
    if (door?.panel === 'crafting') this.applyPanels({ type: 'select_craft_tab', tab: door.tab });
    if (door?.panel === 'canoe_builder') this.applyPanels({ type: 'select_boat_tab', tab: door.tab });
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
        // The crew panels belong to the crew lobby: without one they do not open.
        if ((intent.panel === 'crew_host' || intent.panel === 'crew_join') && !this.crew) break;
        if (intent.panel === 'feedback' && !this.feedback) break;
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
      case 'select_boat_tab':
        if (this.panels.boatTab !== intent.tab) this.sound('tab');
        this.applyPanels({ type: 'select_boat_tab', tab: intent.tab });
        break;
      case 'select_craft_tab':
        if ((this.panels.craftTab ?? 'hands') !== intent.tab) this.sound('tab');
        this.applyPanels({ type: 'select_craft_tab', tab: intent.tab });
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
      case 'end_built_view':
        this.endBuiltView();
        break;
      case 'feedback_field':
        this.feedback?.setField(intent.field, intent.value);
        break;
      case 'feedback_kind':
        this.feedback?.setKind(intent.kind);
        this.sound('tab');
        break;
      case 'feedback_send':
        if (!this.feedback?.canSend) break;
        void this.feedback.send();
        this.sound('click');
        break;
      case 'crew_field':
        this.crew?.setField(intent.field, intent.value);
        break;
      case 'crew_open_room':
        if (!this.crew) break;
        this.crew.openRoom();
        this.sound('click');
        break;
      case 'crew_stop_hosting':
        if (!this.crew) break;
        this.crew.stopHosting();
        this.sound('close');
        break;
      case 'crew_copied':
        if (!this.crew) break;
        this.crew.markCopied();
        this.sound('click');
        break;
      case 'crew_join':
        if (!this.crew) break;
        this.crew.join();
        this.sound('click');
        break;
      case 'crew_cancel_join':
        if (!this.crew) break;
        this.crew.cancelJoin();
        this.sound('close');
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
      mouseSensitivity: settings.controls.mouseSensitivity,
      invertY: settings.controls.invertY,
    });
    this.autosaver?.setIntervalSeconds(settings.gameplay.autosaveIntervalSeconds);
    // A guest's difficulty setting is for their own games: the host's game keeps the host's.
    if (this.game && !this.guest && this.game.difficulty !== settings.gameplay.difficulty) {
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

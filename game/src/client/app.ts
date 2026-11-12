/**
 * The app: wires the session, the camera and the toasts to a world view, a
 * UI and a sound engine, and runs one frame at a time. No DOM in here, so
 * the whole frame can run in a test with fakes; `main.ts` adds the browser.
 */
import { FIXED_STEP, eventsFor, selectTrackedQuestTarget } from '../sim/index.ts';
import type { GameState } from '../sim/index.ts';
import { ChaseCamera, lobbyCameraPose, subjectFromState, surfaceFromState } from './camera.ts';
import type { CameraOptions, CameraPose } from './camera.ts';
import type { AudioEngine, FrameInfo, GameInterface, StageName, WorldView } from './contracts.ts';
import type { FrameStats } from './loop.ts';
import { coversPlayView } from './panels.ts';
import { Session } from './session.ts';
import type { SessionOptions, SessionSignal } from './session.ts';
import { ToastQueue, buildInterfaceModel, toastsForPlayer } from './viewmodels/index.ts';
import type { InterfaceModel } from './viewmodels/index.ts';

export interface AppOptions extends SessionOptions {
  worldView: WorldView;
  gameInterface: GameInterface;
  audio: AudioEngine;
  /** Frame timing for the fps readout. Omit to never show one. */
  stats?: () => FrameStats;
  /** Show the fps readout whatever the settings say (`&fps=1`). */
  forceFrameRate?: boolean;
}

type AudioScene = Parameters<AudioEngine['setScene']>[0];

export class App {
  readonly session: Session;
  readonly camera = new ChaseCamera();
  readonly toasts = new ToastQueue();
  /** Extra lines for the debug readout, asked for every frame: the bot's status, the staged shot. */
  debugSource: (() => string[]) | null = null;
  /** The last model handed to the UI. */
  lastModel: InterfaceModel | null = null;
  /** The last camera pose handed to the world view. */
  lastPose: CameraPose | null = null;

  private readonly worldView: WorldView;
  private readonly gameInterface: GameInterface;
  private readonly audio: AudioEngine;
  private readonly stats: (() => FrameStats) | null;
  private readonly forceFrameRate: boolean;
  private elapsedSeconds = 0;
  /** Seconds the lobby's backdrop has stepped: the clock its camera circles on. */
  private lobbySeconds = 0;
  private audioScene: AudioScene | null = null;
  private stage: StageName | null = null;
  private snapCamera = true;

  constructor(options: AppOptions) {
    this.worldView = options.worldView;
    this.gameInterface = options.gameInterface;
    this.audio = options.audio;
    this.stats = options.stats ?? null;
    this.forceFrameRate = options.forceFrameRate ?? false;
    this.session = new Session(options);
    this.session.subscribe((signal) => this.onSignal(signal));
    this.audio.setVolumes(this.session.settings.audio);
    this.worldView.applyGraphicsSettings(this.session.settings.graphics);
  }

  private onSignal(signal: SessionSignal): void {
    switch (signal.type) {
      case 'settings_changed':
        this.audio.setVolumes(signal.settings.audio);
        this.worldView.applyGraphicsSettings(signal.settings.graphics);
        break;
      case 'screen_changed':
        this.toasts.clear();
        break;
      case 'game_started':
        this.snapCamera = true;
        break;
      case 'notice':
        this.toasts.add({ text: signal.text, tone: signal.tone });
        break;
      case 'interface_sound':
        this.audio.playInterface(signal.sound);
        break;
      case 'saved':
        if (signal.reason !== 'manual') this.toasts.add({ text: 'Game saved', tone: 'info' });
        break;
      case 'driver_finished':
        break;
    }
  }

  private cameraOptions(): CameraOptions {
    const settings = this.session.settings;
    return {
      fieldOfView: settings.graphics.fieldOfView,
      autoCentre: settings.controls.cameraAutoCentre,
      reduceMotion: settings.accessibility.reduceCameraMotion,
    };
  }

  /**
   * The camera moves with the world. `steppedSeconds` is the time the rules stepped the drawn state
   * this frame: the camera eases by that much, so a frame with no step moves neither the canoe nor
   * the camera, and a frame with two steps moves both by two.
   */
  private updateCamera(state: GameState, frameSeconds: number, steppedSeconds: number): CameraPose {
    const session = this.session;
    const cameraInput = session.input.takeCameraInput();
    const surface = surfaceFromState(state);
    if (session.screen === 'lobby') {
      // The slow circle turns on the backdrop's own steps, not on the frames.
      this.lobbySeconds += steppedSeconds;
      return lobbyCameraPose(state.canoe.position, this.lobbySeconds, this.cameraOptions(), surface);
    }
    // A frozen game does not swing the camera round: only the mouse moves it.
    const subject = {
      ...subjectFromState(state, session.lastInput, session.localPlayerId),
      ...(session.paused ? { moving: false } : {}),
    };
    if (this.snapCamera) {
      this.camera.snapBehind(subject);
      this.snapCamera = false;
    }
    // While the rules run here, follow on the time they stepped: the camera and the canoe advance together,
    // and a fast replay does not outrun the camera. A frozen game steps nothing: the camera settles on real
    // time and the mouse still turns it. A guest's view is placed between the host's states on frame time.
    const steppedHere = !session.paused && session.guest === null;
    const followSeconds = steppedHere ? steppedSeconds : Math.max(frameSeconds, session.simulatedSeconds);
    return this.camera.update(subject, cameraInput, this.cameraOptions(), surface, followSeconds);
  }

  /** The stage and the audio scene follow the screen, the pause state and the credits. */
  private followScene(): void {
    const session = this.session;
    const credits = session.screen === 'game' && session.isOpen('credits');
    const stage: StageName = session.screen === 'lobby' ? 'lobby' : credits ? 'credits' : 'game';
    if (stage !== this.stage) {
      this.stage = stage;
      this.worldView.showStage(stage);
    }
    const scene: AudioScene = stage === 'game' && session.paused ? 'paused' : stage;
    if (scene !== this.audioScene) {
      this.audioScene = scene;
      this.audio.setScene(scene);
    }
  }

  /**
   * One frame. `frameSeconds` is the time it stands for, already clamped. `dueSeconds` is the gap
   * the loop meant it to have (what the screen and the frame-rate cap allow), handed on to the look.
   */
  frame(frameSeconds: number, dueSeconds?: number): void {
    const session = this.session;
    this.elapsedSeconds += frameSeconds;

    // Step, then drain the events once and fan them out. The sound is the local
    // player's; the toasts are theirs plus the crew's news (a new tool is everyone's);
    // the world shows what everyone did.
    const stateBefore = session.activeState;
    const tickBefore = stateBefore.tick;
    const events = session.advance(frameSeconds, this.camera.yaw);
    const state = session.activeState;
    // The time the rules stepped the state that is about to be drawn. A state swapped this frame
    // (a new game, a guest's view, a fresh backdrop) has no steps to count: it gets the frame's time.
    const steppedSeconds = state === stateBefore ? Math.max(0, state.tick - tickBefore) * FIXED_STEP : frameSeconds;
    const ownEvents = eventsFor(events, session.localPlayerId);
    this.followScene();
    this.audio.handleEvents(ownEvents);
    this.audio.update(state, frameSeconds, session.localPlayerId);
    this.toasts.addAll(toastsForPlayer(events, state, session.localPlayerId));
    this.toasts.update(frameSeconds);

    const frame: FrameInfo = {
      frameSeconds,
      ...(dueSeconds === undefined ? {} : { dueSeconds }),
      simulatedSeconds: session.simulatedSeconds,
      elapsedSeconds: this.elapsedSeconds,
      paused: session.paused,
      panelOpen: coversPlayView(session.panels),
      trackedQuestTarget: session.game ? selectTrackedQuestTarget(session.game)?.position ?? null : null,
    };
    const pose = this.updateCamera(state, frameSeconds, steppedSeconds);
    this.lastPose = pose;
    this.worldView.sync(state, frame);
    this.worldView.handleEvents(events);
    this.worldView.render(pose);

    const showFrameRate = this.stats !== null && (this.forceFrameRate || session.settings.graphics.showFps);
    const stats = this.stats?.();
    const debugLines = this.debugSource?.() ?? [];
    this.lastModel = buildInterfaceModel({
      panels: session.panels,
      settings: session.settings,
      game: session.game,
      playerId: session.localPlayerId,
      hostId: session.hostId,
      hostQuiet: session.hostQuiet,
      paused: session.paused,
      cameraYaw: this.camera.yaw,
      toasts: this.toasts.models(),
      slots: session.slotSummaries(),
      latestSlot: session.latestSlot(),
      currentSlot: session.slot,
      now: session.wallClock(),
      capture: session.input.capture,
      bindingNotice: session.bindingNotice,
      progressText: session.progressText(),
      crew: session.crew?.view() ?? null,
      debug: showFrameRate || debugLines.length > 0 ? {
        showFrameRate,
        framesPerSecond: Math.round(stats?.framesPerSecond ?? 0),
        frameMilliseconds: Math.round((stats?.frameMilliseconds ?? 0) * 10) / 10,
        workMilliseconds: Math.round((stats?.workMilliseconds ?? 0) * 10) / 10,
        lines: debugLines,
      } : null,
    });
    this.gameInterface.update(this.lastModel);
  }

  /**
   * A frame nobody sees: a hidden tab that hosts a shared game. The game and
   * the guests go on; nothing is drawn. The notes it made are there to read
   * when the tab comes back.
   */
  frameUnseen(frameSeconds: number): void {
    const session = this.session;
    const events = session.advance(frameSeconds, this.camera.yaw);
    this.toasts.addAll(toastsForPlayer(events, session.activeState, session.localPlayerId));
  }

  /** The tab was hidden or shown: pause and save, and quiet the sound. */
  setHidden(hidden: boolean): void {
    this.session.setHidden(hidden);
    if (hidden) this.audio.suspend();
    else this.audio.resume();
  }

  dispose(): void {
    this.worldView.dispose();
    this.gameInterface.dispose();
    this.audio.dispose();
  }
}

export function createApp(options: AppOptions): App {
  return new App(options);
}

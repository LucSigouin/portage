/**
 * The app: wires the session, the camera and the toasts to a world view, a
 * UI and a sound engine, and runs one frame at a time. No DOM in here, so
 * the whole frame can run in a test with fakes; `main.ts` adds the browser.
 */
import type { GameState } from '../sim/index.ts';
import { ChaseCamera, lobbyCameraPose, subjectFromState, surfaceFromState } from './camera.ts';
import type { CameraOptions, CameraPose } from './camera.ts';
import type { AudioEngine, FrameInfo, GameInterface, StageName, WorldView } from './contracts.ts';
import type { FrameStats } from './loop.ts';
import { Session } from './session.ts';
import type { SessionOptions, SessionSignal } from './session.ts';
import { ToastQueue, buildInterfaceModel, toastsFromEvents } from './viewmodels/index.ts';
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

  private updateCamera(state: GameState, frameSeconds: number): CameraPose {
    const session = this.session;
    const cameraInput = session.input.takeCameraInput();
    const surface = surfaceFromState(state);
    if (session.screen === 'lobby') {
      return lobbyCameraPose(state.canoe.position, this.elapsedSeconds, this.cameraOptions(), surface);
    }
    // A frozen game does not swing the camera round: only the mouse moves it.
    const subject = { ...subjectFromState(state, session.lastInput), ...(session.paused ? { moving: false } : {}) };
    if (this.snapCamera) {
      this.camera.snapBehind(subject);
      this.snapCamera = false;
    }
    // Follow on simulated time when it runs faster than real time, so a fast replay does not outrun the camera.
    const followSeconds = Math.max(frameSeconds, session.simulatedSeconds);
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

  /** One frame. `frameSeconds` is real time since the last one, already clamped. */
  frame(frameSeconds: number): void {
    const session = this.session;
    this.elapsedSeconds += frameSeconds;

    // Step, then drain the events once and fan them out.
    const events = session.advance(frameSeconds, this.camera.yaw);
    const state = session.activeState;
    this.followScene();
    this.audio.handleEvents(events);
    this.audio.update(state, frameSeconds);
    this.toasts.addAll(toastsFromEvents(events, state));
    this.toasts.update(frameSeconds);

    const frame: FrameInfo = {
      frameSeconds,
      simulatedSeconds: session.simulatedSeconds,
      elapsedSeconds: this.elapsedSeconds,
      paused: session.paused,
    };
    const pose = this.updateCamera(state, frameSeconds);
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

/**
 * The contracts between the client core and the parts the art round builds.
 *
 * The client core owns time, input, the session, the panels and the camera
 * pose. It never touches Three.js or the DOM. Three things plug into it:
 *
 * - `WorldView`: the 3D look. Owns the renderer, the scene, materials and
 *   post-processing. Draws the state it is given through the camera it is given.
 * - `GameInterface`: the DOM UI. Draws the interface model it is given and
 *   reports clicks as typed intents.
 * - `AudioEngine`: the sound. Shipped by `src/audio/`.
 *
 * The game has a crew of one to four players. This screen plays one of them,
 * the local player (`Session.localPlayerId`): the keys drive them, the
 * interface model is built for them, and the sound and the toasts get their
 * events plus the crew-wide ones. The world view gets every event, and reads
 * the players through `crewOf(state)` in `look/crew.ts`.
 *
 * None of them holds game rules or changes game state. To swap the greybox
 * for the real thing, implement the interface and pass it to `createApp` in
 * `src/main.ts`. Nothing else changes.
 *
 * ## One frame, in order
 *
 * 1. The session steps the simulation (unless paused) and drains its events once.
 * 2. `audio.handleEvents(ownEvents)`, then `audio.update(state, frameSeconds, localPlayerId)`.
 * 3. `worldView.sync(state, frame)`, then `worldView.handleEvents(events)`.
 * 4. `worldView.render(cameraPose)`.
 * 5. `gameInterface.update(model)`.
 *
 * ## Conventions (from the rules engine)
 *
 * Metres, seconds, radians. Y up, water rest level y = 0, north is -z, east
 * is +x. A bearing is 0 at north and grows clockwise; for Three.js use
 * `object.rotation.y = -heading`. Canoe space: origin at the hull centre on
 * the waterline, bow toward -z, starboard +x.
 */
import type { AudioEngine } from '../audio/index.ts';
import type { Settings } from '../settings/index.ts';
import type { GameEvent, GameState, Vector3 } from '../sim/index.ts';
import type { CameraPose } from './camera.ts';
import type { InterfaceIntent } from './intents.ts';
import type { InterfaceModel } from './viewmodels/types.ts';

export type { CameraPose } from './camera.ts';
export type { InterfaceIntent, InterfaceSound, OpenablePanelId, SettingId, SettingValue } from './intents.ts';
export type { PanelId, ScreenId, SettingsTabId } from './panels.ts';
export type * from './viewmodels/types.ts';

/** Timing for one frame. */
export interface FrameInfo {
  /** Real seconds since the last frame, clamped. Use it for effects that run while paused. */
  frameSeconds: number;
  /** Seconds the simulation advanced this frame. 0 while paused. */
  simulatedSeconds: number;
  /** Real seconds since the app started. For idle motion: flags, smoke, the lobby. */
  elapsedSeconds: number;
  /** True while the simulation is frozen: a full panel, the pause menu, a hidden tab. */
  paused: boolean;
  /**
   * True while a panel or a menu covers the play view: inventory, map, pause,
   * settings and the rest. A conversation does not count, the world shows
   * through it. The look may spend less on a view nobody can see.
   */
  panelOpen: boolean;
  /**
   * Where the tracked quest sends the crew next, in world space, for a mark
   * in the view. Null in the lobby, when its next step has no place, or when
   * the place is not charted yet (`selectTrackedQuestTarget`).
   */
  trackedQuestTarget: Vector3 | null;
}

/**
 * What the world is being shown for.
 * - `lobby`: the backdrop behind the title. The state is a game nobody plays.
 * - `game`: live play, and staged still shots of it.
 * - `credits`: the Beacon is lit and the credits are up.
 */
export type StageName = 'lobby' | 'game' | 'credits';

/**
 * The 3D look.
 *
 * It reads positions from the `GameState` and heights from the shared world
 * functions in `src/sim/index.ts` (`waveHeight` with `WAVE_TABLE`,
 * `terrainHeight`, `attachmentTransformForHull`), so the canoe sits on the
 * water it draws. It never calls `step` or `dispatch` and never writes to
 * the state. It does not own a clock: all motion comes from `state.time` and
 * the `FrameInfo`.
 */
export interface WorldView {
  /** Create the renderer and scene inside `container`. Called once. */
  mount(container: HTMLElement): void;
  /** The container changed size. `pixelRatio` is the device pixel ratio. */
  resize(width: number, height: number, pixelRatio: number): void;
  /** Apply render scale, shadows and water detail. Called at start and on every change. */
  applyGraphicsSettings(graphics: Settings['graphics']): void;
  /** Switch what the scene is dressed for. Called when the screen changes. */
  showStage(stage: StageName): void;
  /** Once per frame: move everything to where `state` says it is. */
  sync(state: GameState, frame: FrameInfo): void;
  /** Once per frame, after `sync`: one-shot effects such as splashes and puffs. */
  handleEvents(events: readonly GameEvent[]): void;
  /** Once per frame, last: draw through this camera. */
  render(camera: CameraPose): void;
  dispose(): void;
}

/**
 * The DOM UI.
 *
 * It renders the `InterfaceModel` and nothing else: every label, count and
 * "needs 3 more plank" arrives ready-made, and every button carries the
 * intent to send back. It holds no game rules and no panel logic. Which
 * panel is open, what Esc does and what pauses the game live in the session.
 */
export interface GameInterface {
  /** Build the UI inside `root`. `emit` takes every intent the player produces. Called once. */
  mount(root: HTMLElement, emit: (intent: InterfaceIntent) => void): void;
  /** Once per frame: show this model. Expect a new object every time; diff as needed. */
  update(model: InterfaceModel): void;
  dispose(): void;
}

/**
 * The sound engine: `AudioEngine` from `src/audio/index.ts`, made with
 * `createAudioEngine()`. The app calls, per frame, `handleEvents(events)`
 * then `update(state, frameSeconds, localPlayerId)`; `setScene` when the screen, the pause
 * state or the credits change; `setVolumes` at start and on every settings
 * change; `playInterface` for UI sounds; `suspend` and `resume` with the
 * tab's visibility. `unlock()` is called from the first key press or click.
 */
export type { AudioEngine } from '../audio/index.ts';

/** An `AudioEngine` that makes no sound. For tests, and for a browser with no WebAudio. */
export function createSilentAudio(): AudioEngine {
  return {
    unlock: async () => {},
    setVolumes: () => {},
    handleEvents: () => {},
    update: () => {},
    playInterface: () => {},
    setScene: () => {},
    suspend: () => {},
    resume: () => {},
    dispose: () => {},
  };
}

/**
 * Keyboard and mouse to simulation intent, through the key bindings in the
 * settings. No DOM types in here: the browser glue in `main.ts` forwards key
 * codes and pointer deltas, and tests call the same methods with plain values.
 *
 * - `keyDown` returns the discrete outcomes of a press: a command for the
 *   rules engine, a panel toggle, an Esc, or the result of a rebind capture.
 * - `sample` returns the held state as a `StepInput`, once per frame.
 * - `takeCameraInput` returns the orbit and zoom since the last call.
 */
import type { ToolId } from '../data/index.ts';
import { actionForKey, cloneKeyBindings, rebindKey } from '../settings/index.ts';
import type { InputAction, KeyBindings } from '../settings/index.ts';
import { NEUTRAL_INPUT } from '../sim/index.ts';
import type { Command, Interactable, StepInput } from '../sim/index.ts';
import type { PanelId } from './panels.ts';

/** What the input layer reads from the game to resolve a press. */
export interface InputSnapshot {
  mode: 'canoe' | 'foot';
  /** `selectInteractable(state)`. */
  interactable: Interactable | null;
  sailRaised: boolean;
  /** The tool belt, in hotbar order. */
  tools: readonly ToolId[];
  selectedTool: ToolId | null;
}

export type InputOutcome =
  | { type: 'command'; command: Command }
  | { type: 'toggle_panel'; panel: PanelId }
  | { type: 'escape' }
  /** A rebind capture took a key. `unbound` lists the actions that lost it. */
  | { type: 'rebound'; action: InputAction; slot: number; keyCode: string; bindings: KeyBindings; unbound: InputAction[] }
  | { type: 'rebind_cancelled' }
  /** The auto-paddle went on or off (Luc's list, line 14). */
  | { type: 'auto_paddle'; on: boolean };

export interface InputOptions {
  keyBindings: KeyBindings;
  /** 0.1 to 3. Scales orbit speed. */
  mouseSensitivity: number;
  invertY: boolean;
}

/** Orbit and zoom gathered since the last frame. */
export interface CameraInput {
  /** Radians to add to the bearing the camera looks along. */
  yawDelta: number;
  /** Radians to add to the camera's elevation. */
  pitchDelta: number;
  /** Positive zooms out. One wheel notch is about 0.1. */
  zoomDelta: number;
  dragging: boolean;
}

const PANEL_FOR_ACTION: Partial<Record<InputAction, PanelId>> = {
  inventory: 'inventory', craft: 'crafting', canoeBuilder: 'canoe_builder', questLog: 'quest_log', map: 'map',
};

const TOOL_SLOT_FOR_ACTION: Partial<Record<InputAction, number>> = {
  tool1: 0, tool2: 1, tool3: 2, tool4: 3, tool5: 4,
};

/** Radians of orbit per pixel of drag at sensitivity 1. */
export const ORBIT_RADIANS_PER_PIXEL = 0.005;
/** Zoom per unit of wheel delta (a notch is about 100). */
export const ZOOM_PER_WHEEL_UNIT = 0.001;

export class InputController {
  private options: InputOptions;
  private readonly held = new Set<string>();
  private captureTarget: { action: InputAction; slot: number } | null = null;
  private dragging = false;
  private yawDelta = 0;
  private pitchDelta = 0;
  private zoomDelta = 0;
  /** Paddling forward on its own: Q starts it, Q again, a paddle key or leaving the canoe stops it. */
  private autoPaddling = false;
  /**
   * The jump key: `pressed` from the press until the next sample (so a tap between two frames still jumps), then
   * `held` while it stays down. Only a press made on foot, with the keys driving the game, counts: a key already
   * down when a panel closes is no jump.
   */
  private jumpKey: 'up' | 'pressed' | 'held' = 'up';

  constructor(options: InputOptions) {
    this.options = { ...options, keyBindings: cloneKeyBindings(options.keyBindings) };
  }

  configure(options: Partial<InputOptions>): void {
    this.options = { ...this.options, ...options };
    if (options.keyBindings) this.options.keyBindings = cloneKeyBindings(options.keyBindings);
  }

  get keyBindings(): KeyBindings {
    return this.options.keyBindings;
  }

  // --- Rebinding ------------------------------------------------------------

  /** The action and slot waiting for a key, or null. */
  get capture(): { action: InputAction; slot: number } | null {
    return this.captureTarget;
  }

  /** The next key pressed is bound to this action and slot. Esc cancels. */
  beginCapture(action: InputAction, slot: number): void {
    this.captureTarget = { action, slot };
    this.releaseAll();
  }

  cancelCapture(): void {
    this.captureTarget = null;
  }

  // --- Keys -----------------------------------------------------------------

  /** True when the key means something to the game, so the browser default should be stopped. */
  handlesKey(keyCode: string): boolean {
    if (this.captureTarget) return true;
    return keyCode === 'Escape' || actionForKey(this.options.keyBindings, keyCode, 'canoe') !== null
      || actionForKey(this.options.keyBindings, keyCode, 'foot') !== null;
  }

  /**
   * A key went down. `snapshot` is null when the keys do not drive the game
   * (the lobby, or any open panel): then only the panel keys and Esc act.
   */
  keyDown(keyCode: string, repeat: boolean, snapshot: InputSnapshot | null): InputOutcome[] {
    if (this.captureTarget) {
      if (repeat) return [];
      const { action, slot } = this.captureTarget;
      this.captureTarget = null;
      if (keyCode === 'Escape') return [{ type: 'rebind_cancelled' }];
      const { bindings, unbound } = rebindKey(this.options.keyBindings, action, slot, keyCode);
      this.options.keyBindings = bindings;
      return [{ type: 'rebound', action, slot, keyCode, bindings: cloneKeyBindings(bindings), unbound }];
    }
    if (repeat) return [];
    this.held.add(keyCode);

    const bindings = this.options.keyBindings;
    const action = actionForKey(bindings, keyCode, snapshot?.mode ?? 'foot');
    if (action === 'pause') return [{ type: 'escape' }];
    // Esc always backs out when the player has left Pause unbound.
    if (action === null) return keyCode === 'Escape' && bindings.pause.length === 0 ? [{ type: 'escape' }] : [];
    const panel = PANEL_FOR_ACTION[action];
    if (panel) return [{ type: 'toggle_panel', panel }];
    if (!snapshot) return [];
    const autoPaddle = this.autoPaddleKey(action, snapshot);
    if (autoPaddle) return [autoPaddle];

    switch (action) {
      case 'jump':
        if (snapshot.mode === 'foot') this.jumpKey = 'pressed';
        return [];
      case 'interact':
        if (!snapshot.interactable) return [];
        // At a bench the key opens the crafting panel, as the crafting key does.
        if (snapshot.interactable.kind === 'bench') return [{ type: 'toggle_panel', panel: 'crafting' }];
        // Land, board, talk, sleep, scavenge, pick up: one press, one command.
        return [{ type: 'command', command: snapshot.interactable.command }];
      case 'lantern':
        return [{ type: 'command', command: { type: 'toggle_lantern' } }];
      case 'sail':
        return [{ type: 'command', command: { type: 'set_sail', raised: !snapshot.sailRaised } }];
      default: {
        const toolSlot = TOOL_SLOT_FOR_ACTION[action];
        if (toolSlot === undefined) return [];
        const toolId = snapshot.tools[toolSlot];
        if (toolId === undefined) return [];
        return [{ type: 'command', command: { type: 'select_tool', toolId: snapshot.selectedTool === toolId ? null : toolId } }];
      }
    }
  }

  /** True while the canoe is paddled forward on its own. */
  get autoPaddle(): boolean {
    return this.autoPaddling;
  }

  /** Q toggles the auto-paddle aboard; a paddle key, forward or back, stops it. Null when the key is not about it. */
  private autoPaddleKey(action: InputAction, snapshot: InputSnapshot): InputOutcome | null {
    if (action === 'autoPaddle') {
      if (snapshot.mode !== 'canoe') return null;
      this.autoPaddling = !this.autoPaddling;
      return { type: 'auto_paddle', on: this.autoPaddling };
    }
    if (this.autoPaddling && (action === 'paddle' || action === 'backPaddle')) {
      this.autoPaddling = false;
      return { type: 'auto_paddle', on: false };
    }
    return null;
  }

  keyUp(keyCode: string): void {
    this.held.delete(keyCode);
  }

  /** Window blur, a panel opening, the tab hiding: let go of everything. */
  releaseAll(): void {
    this.held.clear();
    this.dragging = false;
    this.jumpKey = 'up';
  }

  isHeld(action: InputAction): boolean {
    return this.options.keyBindings[action].some((keyCode) => this.held.has(keyCode));
  }

  /** The held keys as intent for this frame. `snapshot` null gives a neutral input. */
  sample(snapshot: InputSnapshot | null, cameraYaw: number): StepInput {
    // The jump key counts once sampled on foot: a press is good for this frame, then only while the key stays down.
    const jump = snapshot !== null && snapshot.mode === 'foot' && (this.jumpKey === 'pressed' || (this.jumpKey === 'held' && this.isHeld('jump')));
    this.jumpKey = jump && this.isHeld('jump') ? 'held' : 'up';
    if (!snapshot) return { ...NEUTRAL_INPUT, cameraYaw };
    const axis = (positive: InputAction, negative: InputAction): number =>
      (this.isHeld(positive) ? 1 : 0) - (this.isHeld(negative) ? 1 : 0);
    const input: StepInput = { ...NEUTRAL_INPUT, cameraYaw };
    // Ashore, the auto-paddle is over: it does not come back on at the next boarding.
    if (snapshot.mode !== 'canoe') this.autoPaddling = false;
    if (snapshot.mode === 'canoe') {
      input.paddle = axis('paddle', 'backPaddle') || (this.autoPaddling ? 1 : 0);
      input.steer = axis('steerStarboard', 'steerPort');
      input.powerStroke = this.isHeld('powerStroke');
      input.bail = this.isHeld('bail');
    } else {
      input.moveX = axis('moveRight', 'moveLeft');
      input.moveY = axis('moveForward', 'moveBack');
      input.run = this.isHeld('run');
      if (jump) input.jump = true;
    }
    return input;
  }

  // --- Mouse ----------------------------------------------------------------

  pointerDown(): void {
    this.dragging = true;
  }

  pointerUp(): void {
    this.dragging = false;
  }

  /** Pointer movement in pixels. Only orbits while a button is held. */
  pointerMove(deltaX: number, deltaY: number): void {
    if (!this.dragging) return;
    const scale = ORBIT_RADIANS_PER_PIXEL * this.options.mouseSensitivity;
    this.yawDelta += deltaX * scale;
    this.pitchDelta += deltaY * scale * (this.options.invertY ? -1 : 1);
  }

  wheel(deltaY: number): void {
    this.zoomDelta += deltaY * ZOOM_PER_WHEEL_UNIT;
  }

  takeCameraInput(): CameraInput {
    const input = { yawDelta: this.yawDelta, pitchDelta: this.pitchDelta, zoomDelta: this.zoomDelta, dragging: this.dragging };
    this.yawDelta = 0;
    this.pitchDelta = 0;
    this.zoomDelta = 0;
    return input;
  }
}

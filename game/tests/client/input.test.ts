import { describe, expect, it } from 'vitest';
import { InputController, ORBIT_RADIANS_PER_PIXEL, ZOOM_PER_WHEEL_UNIT } from '../../src/client/input.ts';
import type { InputOptions, InputSnapshot } from '../../src/client/input.ts';
import { DEFAULT_KEY_BINDINGS, cloneKeyBindings } from '../../src/settings/index.ts';
import type { Interactable } from '../../src/sim/index.ts';

const controller = (options: Partial<InputOptions> = {}): InputController => new InputController({
  keyBindings: cloneKeyBindings(DEFAULT_KEY_BINDINGS), mouseSensitivity: 1, invertY: false, ...options,
});

const snapshot = (overrides: Partial<InputSnapshot> = {}): InputSnapshot => ({
  mode: 'canoe', interactable: null, sailRaised: false, tools: ['bailing_can', 'stone_knife'], selectedTool: null, ...overrides,
});

const node = (nodeId = 'driftwood_1', actionIndex = 0, available = true): Interactable => ({
  kind: 'node', nodeId, name: 'Driftwood pile', prompt: 'Gather: Driftwood pile', actionIndex,
  available, missing: null, command: { type: 'scavenge' }, distance: 1,
});

const board: Interactable = { kind: 'board', name: 'Canoe', prompt: 'Board the canoe', command: { type: 'board' }, distance: 1 };

describe('keys to simulation intent', () => {
  it('maps the default canoe keys onto paddle, steer, power stroke and bail', () => {
    const input = controller();
    const canoe = snapshot();
    input.keyDown('KeyW', false, canoe);
    input.keyDown('KeyD', false, canoe);
    input.keyDown('ShiftLeft', false, canoe);
    expect(input.sample(canoe, 0.5)).toMatchObject({ paddle: 1, steer: 1, powerStroke: true, bail: false, moveX: 0, moveY: 0, cameraYaw: 0.5 });
    input.keyUp('KeyW');
    input.keyDown('KeyS', false, canoe);
    input.keyDown('KeyA', false, canoe);
    input.keyDown('KeyR', false, canoe);
    // D and A cancel out; S back-paddles.
    expect(input.sample(canoe, 0)).toMatchObject({ paddle: -1, steer: 0, bail: true });
  });

  it('reads the same keys as walking on foot, and takes the second key of each action', () => {
    const input = controller();
    const foot = snapshot({ mode: 'foot' });
    input.keyDown('ArrowUp', false, foot);
    input.keyDown('KeyA', false, foot);
    input.keyDown('ShiftRight', false, foot);
    expect(input.sample(foot, 1.2)).toMatchObject({ moveY: 1, moveX: -1, run: true, paddle: 0, steer: 0, powerStroke: false, cameraYaw: 1.2 });
  });

  it('gives a neutral input when the keys do not drive the game', () => {
    const input = controller();
    input.keyDown('KeyW', false, snapshot());
    expect(input.sample(null, 0.3)).toMatchObject({ paddle: 0, steer: 0, moveX: 0, moveY: 0, cameraYaw: 0.3 });
  });

  it('lets go of every key on blur', () => {
    const input = controller();
    const canoe = snapshot({ interactable: node() });
    input.keyDown('KeyW', false, canoe);
    input.keyDown('KeyR', false, canoe);
    input.pointerDown();
    expect(input.sample(canoe, 0)).toMatchObject({ paddle: 1, bail: true });
    input.releaseAll();
    expect(input.sample(canoe, 0)).toMatchObject({ paddle: 0, bail: false });
    input.pointerMove(50, 0);
    expect(input.takeCameraInput()).toMatchObject({ yawDelta: 0, dragging: false });
  });
});

describe('the interact key', () => {
  it('is F by default, and the lantern is L', () => {
    expect(DEFAULT_KEY_BINDINGS.interact).toEqual(['KeyF']);
    expect(DEFAULT_KEY_BINDINGS.lantern).toEqual(['KeyL']);
    const input = controller();
    const canoe = snapshot();
    expect(input.keyDown('KeyL', false, canoe)).toEqual([{ type: 'command', command: { type: 'toggle_lantern' } }]);
    expect(input.keyDown('KeyF', false, canoe)).toEqual([]); // nothing to act on, and no lantern
    expect(input.keyDown('KeyE', false, canoe)).toEqual([]); // E does nothing any more
  });

  it('dispatches the command an interactable carries, once per press: land, board, talk, sleep', () => {
    const input = controller();
    const foot = snapshot({ mode: 'foot', interactable: board });
    expect(input.keyDown('KeyF', false, foot)).toEqual([{ type: 'command', command: { type: 'board' } }]);
    expect(input.keyDown('KeyF', true, foot)).toEqual([]); // key repeat
    const land: Interactable = { kind: 'land', name: 'Shore', prompt: 'Land', command: { type: 'disembark' }, distance: 0 };
    input.keyUp('KeyF');
    expect(input.keyDown('KeyF', false, snapshot({ interactable: land }))).toEqual([{ type: 'command', command: { type: 'disembark' } }]);
  });

  it('scavenges a node with one press: no holding, and holding does not repeat it', () => {
    const input = controller();
    const foot = snapshot({ mode: 'foot', interactable: node() });
    expect(input.keyDown('KeyF', false, foot)).toEqual([{ type: 'command', command: { type: 'scavenge' } }]);
    // Still down: the browser's key repeat sends nothing more, and the step input carries no scavenging.
    expect(input.keyDown('KeyF', true, foot)).toEqual([]);
    expect(Object.keys(input.sample(foot, 0))).not.toContain('interactHeld');
    input.keyUp('KeyF');
    // The next press scavenges again (the node's other action, or what was left behind).
    expect(input.keyDown('KeyF', false, foot)).toEqual([{ type: 'command', command: { type: 'scavenge' } }]);
    // Nothing in reach: the press does nothing.
    input.keyUp('KeyF');
    expect(input.keyDown('KeyF', false, snapshot({ mode: 'foot' }))).toEqual([]);
  });

  it('does not scavenge with the press that boarded the canoe', () => {
    const input = controller();
    expect(input.keyDown('KeyF', false, snapshot({ mode: 'foot', interactable: board }))).toHaveLength(1);
    // Still holding F, now aboard beside a fishing spot: only key repeats arrive, and they do nothing.
    const aboard = snapshot({ mode: 'canoe', interactable: node('fishing_1') });
    expect(input.keyDown('KeyF', true, aboard)).toEqual([]);
    input.keyUp('KeyF');
    expect(input.keyDown('KeyF', false, aboard)).toEqual([{ type: 'command', command: { type: 'scavenge' } }]);
  });

  it('follows a rebind: the new key acts, the old one does not', () => {
    const bindings = cloneKeyBindings(DEFAULT_KEY_BINDINGS);
    bindings.interact = ['KeyG'];
    const input = controller({ keyBindings: bindings });
    const foot = snapshot({ mode: 'foot', interactable: node() });
    expect(input.keyDown('KeyF', false, foot)).toEqual([]);
    expect(input.keyDown('KeyG', false, foot)).toEqual([{ type: 'command', command: { type: 'scavenge' } }]);
  });
});

describe('discrete presses', () => {
  it('toggles panels and backs out on the panel keys, with or without the game listening', () => {
    const input = controller();
    for (const snap of [snapshot(), null]) {
      expect(input.keyDown('Tab', false, snap)).toEqual([{ type: 'toggle_panel', panel: 'inventory' }]);
      expect(input.keyDown('KeyC', false, snap)).toEqual([{ type: 'toggle_panel', panel: 'crafting' }]);
      expect(input.keyDown('KeyB', false, snap)).toEqual([{ type: 'toggle_panel', panel: 'canoe_builder' }]);
      expect(input.keyDown('KeyJ', false, snap)).toEqual([{ type: 'toggle_panel', panel: 'quest_log' }]);
      expect(input.keyDown('KeyM', false, snap)).toEqual([{ type: 'toggle_panel', panel: 'map' }]);
      expect(input.keyDown('Escape', false, snap)).toEqual([{ type: 'escape' }]);
    }
  });

  it('ignores game keys while a panel has the keyboard', () => {
    const input = controller();
    expect(input.keyDown('KeyF', false, null)).toEqual([]);
    expect(input.keyDown('KeyE', false, null)).toEqual([]);
    expect(input.keyDown('Digit1', false, null)).toEqual([]);
  });

  it('sends lantern, sail and tool keys as commands', () => {
    const input = controller();
    expect(input.keyDown('KeyL', false, snapshot())).toEqual([{ type: 'command', command: { type: 'toggle_lantern' } }]);
    expect(input.keyDown('KeyV', false, snapshot())).toEqual([{ type: 'command', command: { type: 'set_sail', raised: true } }]);
    expect(input.keyDown('KeyV', false, snapshot({ sailRaised: true }))).toEqual([{ type: 'command', command: { type: 'set_sail', raised: false } }]);
    expect(input.keyDown('Digit2', false, snapshot())).toEqual([{ type: 'command', command: { type: 'select_tool', toolId: 'stone_knife' } }]);
    // The same key again puts the tool away; an empty slot does nothing.
    expect(input.keyDown('Digit2', false, snapshot({ selectedTool: 'stone_knife' })))
      .toEqual([{ type: 'command', command: { type: 'select_tool', toolId: null } }]);
    expect(input.keyDown('Digit4', false, snapshot())).toEqual([]);
    // Lantern is a canoe key: on foot L means nothing.
    expect(input.keyDown('KeyL', false, snapshot({ mode: 'foot' }))).toEqual([]);
  });

  it('reports which keys the game uses, so the browser default can be stopped', () => {
    const input = controller();
    expect(input.handlesKey('Tab')).toBe(true);
    expect(input.handlesKey('KeyW')).toBe(true);
    expect(input.handlesKey('Escape')).toBe(true);
    expect(input.handlesKey('KeyQ')).toBe(true); // the auto-paddle
    expect(input.handlesKey('KeyZ')).toBe(false);
  });
});

describe('rebinding', () => {
  it('binds the next key pressed and reports the actions that lost it', () => {
    const input = controller();
    input.beginCapture('paddle', 0);
    expect(input.capture).toEqual({ action: 'paddle', slot: 0 });
    // E is Interact, which is live everywhere, so it clashes with a canoe key.
    const outcomes = input.keyDown('KeyF', false, null);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ type: 'rebound', action: 'paddle', slot: 0, keyCode: 'KeyF', unbound: ['interact'] });
    expect(input.capture).toBeNull();
    expect(input.keyBindings.paddle).toEqual(['KeyF', 'ArrowUp']);
    expect(input.keyBindings.interact).toEqual([]);

    // The new key paddles; the old one no longer does.
    const canoe = snapshot();
    input.keyDown('KeyF', false, canoe);
    expect(input.sample(canoe, 0).paddle).toBe(1);
    input.keyUp('KeyF');
    input.keyDown('KeyW', false, canoe);
    expect(input.sample(canoe, 0).paddle).toBe(0);
  });

  it('keeps a key shared across contexts: W can paddle and walk', () => {
    const input = controller();
    input.beginCapture('moveForward', 1);
    const [outcome] = input.keyDown('KeyI', false, null);
    expect(outcome).toMatchObject({ type: 'rebound', unbound: [] });
    expect(input.keyBindings.moveForward).toEqual(['KeyW', 'KeyI']);
    expect(input.keyBindings.paddle).toEqual(['KeyW', 'ArrowUp']);
  });

  it('swallows the captured key and cancels on Esc', () => {
    const input = controller();
    input.beginCapture('lantern', 0);
    // Tab would open the inventory; while capturing it is just a key.
    const [outcome] = input.keyDown('Tab', false, snapshot());
    expect(outcome.type).toBe('rebound');
    expect(input.sample(snapshot(), 0)).toMatchObject({ paddle: 0 });

    input.beginCapture('lantern', 0);
    expect(input.keyDown('Escape', false, null)).toEqual([{ type: 'rebind_cancelled' }]);
    expect(input.capture).toBeNull();
    expect(input.keyBindings.lantern).toEqual(['Tab']);
  });

  it('keeps Esc working as "back" when Pause has no key at all', () => {
    const bindings = cloneKeyBindings(DEFAULT_KEY_BINDINGS);
    bindings.pause = [];
    const input = controller({ keyBindings: bindings });
    expect(input.keyDown('Escape', false, null)).toEqual([{ type: 'escape' }]);
    // Bound to something else, Esc does that instead.
    bindings.lantern = ['Escape'];
    const rebound = controller({ keyBindings: bindings });
    expect(rebound.keyDown('Escape', false, snapshot())).toEqual([{ type: 'command', command: { type: 'toggle_lantern' } }]);
  });
});

describe('the mouse', () => {
  it('orbits only while a button is down, scaled by the sensitivity', () => {
    const input = controller({ mouseSensitivity: 2 });
    input.pointerMove(100, 100);
    expect(input.takeCameraInput()).toEqual({ yawDelta: 0, pitchDelta: 0, zoomDelta: 0, dragging: false });
    input.pointerDown();
    input.pointerMove(100, -40);
    const drag = input.takeCameraInput();
    expect(drag.yawDelta).toBeCloseTo(100 * ORBIT_RADIANS_PER_PIXEL * 2);
    expect(drag.pitchDelta).toBeCloseTo(-40 * ORBIT_RADIANS_PER_PIXEL * 2);
    expect(drag.dragging).toBe(true);
    // Taken once: the next frame starts from zero.
    expect(input.takeCameraInput()).toMatchObject({ yawDelta: 0, pitchDelta: 0 });
    input.pointerUp();
    expect(input.takeCameraInput().dragging).toBe(false);
  });

  it('honours invert Y and the wheel', () => {
    const input = controller({ invertY: true });
    input.pointerDown();
    input.pointerMove(0, 30);
    input.wheel(200);
    const taken = input.takeCameraInput();
    expect(taken.pitchDelta).toBeCloseTo(-30 * ORBIT_RADIANS_PER_PIXEL);
    expect(taken.zoomDelta).toBeCloseTo(200 * ZOOM_PER_WHEEL_UNIT);
    input.configure({ invertY: false });
    input.pointerMove(0, 30);
    expect(input.takeCameraInput().pitchDelta).toBeCloseTo(30 * ORBIT_RADIANS_PER_PIXEL);
  });
});

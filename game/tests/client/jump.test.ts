/**
 * The jump on whole clients (Luc's list, Round 3: "character need to jump"): Space on foot, a key that can be rebound
 * and is listed in How to Play; no jump aboard or with a panel open; and a camera that does not hop.
 */
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/client/app.ts';
import type { App } from '../../src/client/app.ts';
import { ChaseCamera, subjectFromState, surfaceFromState } from '../../src/client/camera.ts';
import type { CameraOptions, CameraPose } from '../../src/client/camera.ts';
import { createSilentAudio } from '../../src/client/contracts.ts';
import type { GameInterface, InterfaceModel, WorldView } from '../../src/client/contracts.ts';
import { InputController } from '../../src/client/input.ts';
import type { CameraInput, InputSnapshot } from '../../src/client/input.ts';
import { buildHowToPlayPanel } from '../../src/client/viewmodels/menus.ts';
import { bindingRows } from '../../src/client/viewmodels/settings.ts';
import { NPCS } from '../../src/data/dialogue.ts';
import { createLoopbackPair } from '../../src/net/index.ts';
import type { HostLink } from '../../src/net/index.ts';
import { ACTION_CONTEXT, ACTION_LABELS, DEFAULT_KEY_BINDINGS, INPUT_ACTIONS, actionForKey, cloneKeyBindings, createDefaultSettings, rebindKey, sanitizeSettings } from '../../src/settings/index.ts';
import { FIXED_STEP, LEAP_AIR_STEPS, NEUTRAL_INPUT, airborne, drainEvents, leapHeight, step, terrainHeight } from '../../src/sim/index.ts';
import type { GameState, StepInput } from '../../src/sim/index.ts';
import { FakeStorage, floatCanoeAt, newGame, standOn, teleport } from '../support.ts';

interface Client {
  app: App;
  models: InterfaceModel[];
}

function client(): Client {
  const models: InterfaceModel[] = [];
  const worldView: WorldView = {
    mount: () => {}, resize: () => {}, applyGraphicsSettings: () => {}, showStage: () => {},
    sync: () => {}, handleEvents: () => {}, render: () => {}, dispose: () => {},
  };
  const gameInterface: GameInterface = { mount: () => {}, update: (model) => void models.push(model), dispose: () => {} };
  const app = createApp({ worldView, gameInterface, audio: createSilentAudio(), storage: new FakeStorage(), now: () => 5000, randomSeed: () => 42 });
  return { app, models };
}

function frames(app: App, count: number): void {
  for (let frame = 0; frame < count; frame += 1) app.frame(FIXED_STEP);
}

/** Home Knoll, on open ground, the first quest done, a sky that holds. */
function ashoreGame(): GameState {
  const game = newGame(7);
  standOn(game, 'home_knoll');
  teleport(game, 'home_knoll', -2.5, 1150);
  game.players[0].heading = 0;
  game.weather.secondsRemaining = 99999;
  game.quests.bail_out.status = 'completed';
  game.quests.first_haul.status = 'active';
  drainEvents(game);
  return game;
}

const controller = (): InputController => new InputController({ keyBindings: cloneKeyBindings(DEFAULT_KEY_BINDINGS), mouseSensitivity: 1, invertY: false });
const snapshot = (mode: 'canoe' | 'foot'): InputSnapshot => ({ mode, interactable: null, sailRaised: false, tools: [], selectedTool: null });

describe('the jump key', () => {
  it('is Space, an action of its own, on foot only, with a row in Settings and in How to Play', () => {
    expect(DEFAULT_KEY_BINDINGS.jump).toEqual(['Space']);
    expect(INPUT_ACTIONS).toContain('jump');
    expect(ACTION_CONTEXT.jump).toBe('foot');
    expect(ACTION_LABELS.jump).toBe('Jump');
    const settings = createDefaultSettings();
    expect(actionForKey(settings.controls.keyBindings, 'Space', 'foot')).toBe('jump');
    expect(actionForKey(settings.controls.keyBindings, 'Space', 'canoe')).toBeNull();
    // Space was free: no other action lost a key to it.
    for (const action of INPUT_ACTIONS) if (action !== 'jump') expect(settings.controls.keyBindings[action]).not.toContain('Space');
    const onFoot = buildHowToPlayPanel(settings).sections.find((section) => section.heading === 'On foot')!;
    expect(onFoot.controls).toContainEqual({ label: 'Jump', keys: 'Space' });
    const row = bindingRows(settings, null).find((each) => each.action === 'jump')!;
    expect(row).toMatchObject({ label: 'Jump', contextLabel: 'On foot' });
    expect(row.slots[0]).toMatchObject({ slot: 0, keyLabel: 'Space' });
  });

  it('can be rebound, and How to Play follows; settings stored before it existed get Space, unless Space is theirs already', () => {
    const settings = createDefaultSettings();
    const { bindings, unbound } = rebindKey(settings.controls.keyBindings, 'jump', 0, 'KeyG');
    expect(unbound).toEqual([]);
    expect(actionForKey(bindings, 'KeyG', 'foot')).toBe('jump');
    expect(actionForKey(bindings, 'Space', 'foot')).toBeNull();
    const page = buildHowToPlayPanel({ ...settings, controls: { ...settings.controls, keyBindings: bindings } });
    expect(page.sections.flatMap((section) => section.controls)).toContainEqual({ label: 'Jump', keys: 'G' });
    // The rebound key jumps, Space no longer does.
    const input = new InputController({ keyBindings: bindings, mouseSensitivity: 1, invertY: false });
    input.keyDown('Space', false, snapshot('foot'));
    expect(input.sample(snapshot('foot'), 0).jump).toBeUndefined();
    input.keyDown('KeyG', false, snapshot('foot'));
    expect(input.sample(snapshot('foot'), 0).jump).toBe(true);

    const stored = JSON.parse(JSON.stringify(createDefaultSettings()));
    const { jump: _none, ...before } = stored.controls.keyBindings;
    expect(sanitizeSettings({ ...stored, controls: { ...stored.controls, keyBindings: before } }).controls.keyBindings.jump).toEqual(['Space']);
    const taken = sanitizeSettings({ ...stored, controls: { ...stored.controls, keyBindings: { ...before, run: ['Space'] } } }).controls.keyBindings;
    expect(taken.run).toEqual(['Space']);
    expect(taken.jump).toEqual([]);
  });

  it('a press is a jump in the next sample, however short the tap; held, it stays down; let go, it is up', () => {
    const input = controller();
    expect(input.sample(snapshot('foot'), 0)).toEqual({ ...NEUTRAL_INPUT });
    // Down and up again between two frames: the frame still gets it, once.
    input.keyDown('Space', false, snapshot('foot'));
    input.keyUp('Space');
    expect(input.sample(snapshot('foot'), 0).jump).toBe(true);
    expect(input.sample(snapshot('foot'), 0).jump).toBeUndefined();
    // Held: down in every sample until it comes up. Key repeats are nothing new.
    input.keyDown('Space', false, snapshot('foot'));
    expect(input.sample(snapshot('foot'), 0).jump).toBe(true);
    input.keyDown('Space', true, snapshot('foot'));
    expect(input.sample(snapshot('foot'), 0).jump).toBe(true);
    input.keyUp('Space');
    expect(input.sample(snapshot('foot'), 0).jump).toBeUndefined();
    // With the walk keys it rides along with them.
    input.keyDown('KeyW', false, snapshot('foot'));
    input.keyDown('Space', false, snapshot('foot'));
    expect(input.sample(snapshot('foot'), 1.5)).toEqual({ ...NEUTRAL_INPUT, moveY: 1, cameraYaw: 1.5, jump: true });
    expect(input.handlesKey('Space')).toBe(true);
    expect(input.keyDown('Space', false, snapshot('foot'))).toEqual([]);
  });

  it('is no jump aboard, none with a panel open, and none from a key that was already down when the panel closed', () => {
    const input = controller();
    // Aboard: Space is not bound there at all.
    input.keyDown('Space', false, snapshot('canoe'));
    expect(input.sample(snapshot('canoe'), 0)).toEqual({ ...NEUTRAL_INPUT });
    input.keyUp('Space');
    // A panel open (the keys do not drive the game): nothing, and Space still down when it closes is not a press.
    input.keyDown('Space', false, null);
    expect(input.sample(null, 0)).toEqual({ ...NEUTRAL_INPUT });
    expect(input.sample(snapshot('foot'), 0).jump).toBeUndefined();
    expect(input.sample(snapshot('foot'), 0).jump).toBeUndefined();
    input.keyUp('Space');
    // Pressed on foot, then a panel opens before the frame: the press is dropped, not kept for later.
    input.keyDown('Space', false, snapshot('foot'));
    input.releaseAll();
    expect(input.sample(snapshot('foot'), 0).jump).toBeUndefined();
    // Stepping aboard with the key down: no jump, and none on stepping ashore again while it is still down.
    input.keyDown('Space', false, snapshot('foot'));
    expect(input.sample(snapshot('foot'), 0).jump).toBe(true);
    expect(input.sample(snapshot('canoe'), 0).jump).toBeUndefined();
    expect(input.sample(snapshot('foot'), 0).jump).toBeUndefined();
  });
});

describe('Space on a whole client', () => {
  it('jumps on foot: off the ground on the frame after the press, down half a second later, one jump for a held key', () => {
    const solo = client();
    const game = ashoreGame();
    solo.app.session.adoptGame(game);
    frames(solo.app, 6);
    expect(game.players[0].leap).toBeUndefined();
    solo.app.session.keyDown('Space');
    const tall: number[] = [];
    for (let count = 0; count < 120; count += 1) {
      frames(solo.app, 1);
      tall.push(leapHeight(game.players[0].leap));
    }
    expect(tall[0]).toBeGreaterThan(0.1);
    expect(Math.max(...tall)).toBeCloseTo(0.9, 9);
    expect(tall.filter((height) => height > 0)).toHaveLength(LEAP_AIR_STEPS - 1);
    solo.app.session.keyUp('Space');
    frames(solo.app, 2);
    expect(game.players[0].leap).toBeUndefined();
  });

  it('does nothing aboard, in the pause menu, in the inventory, asleep or in a talk', () => {
    // Aboard.
    const afloat = client();
    const water = newGame(7);
    floatCanoeAt(water, 200, 1300, 0);
    water.weather.secondsRemaining = 99999;
    afloat.app.session.adoptGame(water);
    afloat.app.session.keyDown('Space');
    frames(afloat.app, 30);
    expect(JSON.stringify(water.players)).not.toContain('leap');
    expect(afloat.app.session.lastInput.jump).toBeUndefined();

    // A panel open: Esc (pause), Tab (inventory).
    for (const opener of ['Escape', 'Tab']) {
      const solo = client();
      const game = ashoreGame();
      solo.app.session.adoptGame(game);
      frames(solo.app, 6);
      solo.app.session.keyDown(opener);
      solo.app.session.keyUp(opener);
      solo.app.session.keyDown('Space');
      frames(solo.app, 30);
      expect(game.players[0].leap, opener).toBeUndefined();
      // Closing it with Space still down is no jump either.
      solo.app.session.keyDown(opener);
      solo.app.session.keyUp(opener);
      frames(solo.app, 30);
      expect(game.players[0].leap, opener).toBeUndefined();
      solo.app.session.keyUp('Space');
      // And then a press jumps.
      solo.app.session.keyDown('Space');
      frames(solo.app, 2);
      expect(airborne(game.players[0].leap), opener).toBe(true);
    }

    // Asleep, and in a talk.
    for (const hold of [{ asleep: true }, { dialogue: { npcId: 'odile' as const, nodeId: Object.keys(NPCS.odile.nodes)[0]! } }]) {
      const solo = client();
      const game = ashoreGame();
      Object.assign(game.players[0], hold);
      solo.app.session.adoptGame(game);
      frames(solo.app, 6);
      solo.app.session.keyDown('Space');
      frames(solo.app, 30);
      expect(game.players[0].leap).toBeUndefined();
    }
  });

  it('a guest\'s Space: on its own screen the next frame, in the host\'s game a beat later, and seen on the host\'s screen', () => {
    const game = ashoreGame();
    const host = client();
    const guest = client();
    let link: HostLink | null = null;
    host.app.session.playerName = 'Luc';
    host.app.session.onShare = (made) => {
      link = made;
    };
    host.app.session.adoptGame(game);
    const pair = createLoopbackPair({ delay: 0.03 });
    link!.accept(pair.host);
    guest.app.session.joinGame(pair.guest, { name: 'Sam', key: 'key-sam-0123456789' });
    const tick = (count: number): void => {
      for (let frame = 0; frame < count; frame += 1) {
        pair.advance(FIXED_STEP);
        host.app.frame(FIXED_STEP);
        guest.app.frame(FIXED_STEP);
      }
    };
    tick(120);
    // Both ashore, side by side.
    for (const [index, player] of game.players.entries()) {
      const x = -2.5 + index * 1.2;
      Object.assign(player, { mode: 'foot', seat: null, islandId: 'home_knoll', position: { x, y: terrainHeight(x, 1150), z: 1150 } });
    }
    tick(120);
    const mine = () => guest.app.session.game!.players[1]!;
    expect(mine().mode).toBe('foot');
    guest.app.session.keyDown('Space');
    tick(1);
    // On the guest's own screen at once.
    expect(leapHeight(mine().leap)).toBeGreaterThan(0.1);
    guest.app.session.keyUp('Space');
    let hostTop = 0;
    let ownTop = 0;
    for (let count = 0; count < 90; count += 1) {
      tick(1);
      hostTop = Math.max(hostTop, leapHeight(game.players[1]!.leap));
      ownTop = Math.max(ownTop, leapHeight(mine().leap));
    }
    expect(ownTop).toBeCloseTo(0.9, 9);
    expect(hostTop).toBeCloseTo(0.9, 9);
    expect(game.players[1]!.leap).toBeUndefined();
    expect(mine().leap).toBeUndefined();
    // The host jumps: the guest's screen shows it.
    host.app.session.keyDown('Space');
    let seen = 0;
    for (let count = 0; count < 90; count += 1) {
      tick(1);
      seen = Math.max(seen, leapHeight(guest.app.session.game!.players[0]!.leap));
    }
    host.app.session.keyUp('Space');
    expect(seen).toBeGreaterThan(0.85);
  });
});

describe('the camera does not hop', () => {
  const OPTIONS: CameraOptions = { fieldOfView: 60, autoCentre: true, reduceMotion: false };
  const STILL: CameraInput = { yawDelta: 0, pitchDelta: 0, zoomDelta: 0, dragging: false };

  /** The camera's pose after each step of the rules, on the game's own ground and water. */
  function filmed(keys: (count: number) => Partial<StepInput>, steps: number): { poses: CameraPose[]; top: number } {
    const game = ashoreGame();
    const camera = new ChaseCamera();
    const poses: CameraPose[] = [];
    let top = 0;
    for (let count = 0; count < steps; count += 1) {
      const input = { ...NEUTRAL_INPUT, ...keys(count) };
      step(game, input, FIXED_STEP);
      top = Math.max(top, leapHeight(game.players[0].leap));
      poses.push(camera.update(subjectFromState(game, input), STILL, OPTIONS, surfaceFromState(game), FIXED_STEP));
    }
    return { poses, top };
  }

  it('standing: through a whole jump the camera and what it looks at do not move at all', () => {
    const { poses, top } = filmed((count) => ({ jump: count >= 10 && count < 13 }), 80);
    expect(top).toBeCloseTo(0.9, 9);
    for (const pose of poses) expect(pose).toEqual(poses[0]);
    console.log(`JUMP camera, standing jump of ${top.toFixed(2)} m: camera height ${poses[0]!.position.y.toFixed(4)} m on all ${poses.length} frames, look-at height ${poses[0]!.target.y.toFixed(4)} m`);
  });

  it('walking and running: the camera through a jump is the camera of the same walk without one, frame for frame', () => {
    for (const run of [false, true]) {
      const walk = (): Partial<StepInput> => ({ moveY: 1, cameraYaw: 0, run });
      const jumped = filmed((count) => ({ ...walk(), jump: count >= 60 && count < 63 }), 150);
      const walked = filmed(walk, 150);
      expect(jumped.top).toBeCloseTo(0.9, 9);
      expect(walked.top).toBe(0);
      expect(jumped.poses).toEqual(walked.poses);
    }
  });

  it('on a whole client too: the pose handed to the picture does not change while the figure is in the air', () => {
    const solo = client();
    const game = ashoreGame();
    solo.app.session.adoptGame(game);
    frames(solo.app, 30);
    expect(solo.app.lastPose).not.toBeNull();
    const before = structuredClone(solo.app.lastPose);
    solo.app.session.keyDown('Space');
    let top = 0;
    for (let count = 0; count < 60; count += 1) {
      frames(solo.app, 1);
      top = Math.max(top, leapHeight(game.players[0].leap));
      expect(solo.app.lastPose).toEqual(before);
    }
    expect(top).toBeCloseTo(0.9, 9);
  });
});

/**
 * The built view: building from the canoe builder steps the panel aside and holds one still, framed view of the
 * canoe for two seconds, then gives the screen back. Checked here with no browser: when it begins and for whom,
 * what ends it, that the camera pose is one pose and frames the canoe, and that the screen comes back as it was.
 */
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/client/app.ts';
import type { App } from '../../src/client/app.ts';
import {
  BUILT_VIEW_FIELD, BUILT_VIEW_FILL, BUILT_VIEW_RISE, BUILT_VIEW_SECONDS, builtPieceOf, builtViewPose, builtViewSide, builtWords, framedPoints, hullBounds,
  showsPiece,
} from '../../src/client/builtview.ts';
import type { CanoeBounds } from '../../src/client/builtview.ts';
import { surfaceFromState } from '../../src/client/camera.ts';
import type { CameraPose } from '../../src/client/camera.ts';
import { createSilentAudio } from '../../src/client/contracts.ts';
import type { FrameInfo, GameInterface, InterfaceModel, WorldView } from '../../src/client/contracts.ts';
import { ATTACHMENTS, HULL_TIERS } from '../../src/data/index.ts';
import { builtView } from '../../src/interface/views.ts';
import { createLoopbackPair } from '../../src/net/index.ts';
import type { HostLink } from '../../src/net/index.ts';
import { FIXED_STEP, addPlayer, attachmentTransformForHull, dispatch, drainEvents, setConnected } from '../../src/sim/index.ts';
import type { GameState } from '../../src/sim/index.ts';
import { FakeStorage, give, newGame, standOn } from '../support.ts';

interface Client { app: App; models: InterfaceModel[]; poses: CameraPose[]; frames: FrameInfo[]; bounds: { value: CanoeBounds | null } }

function client(): Client {
  const models: InterfaceModel[] = [];
  const poses: CameraPose[] = [];
  const frames: FrameInfo[] = [];
  const bounds: { value: CanoeBounds | null } = { value: null };
  const worldView: WorldView = {
    mount: () => {}, resize: () => {}, applyGraphicsSettings: () => {}, showStage: () => {},
    sync: (_state, frame) => void frames.push(frame), handleEvents: () => {},
    render: (pose) => void poses.push(pose), canoeBounds: () => bounds.value, dispose: () => {},
  };
  const gameInterface: GameInterface = { mount: () => {}, update: (model) => void models.push(model), dispose: () => {} };
  const app = createApp({ worldView, gameInterface, audio: createSilentAudio(), storage: new FakeStorage(), now: () => 5000, randomSeed: () => 42 });
  return { app, models, poses, frames, bounds };
}

/** Beached on Home Knoll, standing at the bow, with what the patched hull costs in the canoe. */
function readyToPatch(crew = 1): GameState {
  const game = newGame(7, { crew });
  standOn(game, 'home_knoll');
  for (const { itemId, count } of HULL_TIERS[1].cost) give(game, itemId, count, 'cargo');
  drainEvents(game);
  return game;
}

/** The same, on the ribbed hull with what a cargo rack and a fishing rig cost. */
function readyToFit(): GameState {
  const game = newGame(7);
  game.canoe.hullTier = 2;
  standOn(game, 'home_knoll');
  for (const attachmentId of ['cargo_rack', 'fishing_rig'] as const) {
    for (const { itemId, count } of ATTACHMENTS[attachmentId].cost) give(game, itemId, count, 'cargo');
    for (const toolId of ATTACHMENTS[attachmentId].tools) give(game, toolId);
  }
  drainEvents(game);
  return game;
}

/** A game on the screen with the canoe builder open. */
function atBuilder(game: GameState): Client {
  const made = client();
  made.app.session.adoptGame(game);
  made.app.frame(FIXED_STEP);
  made.app.session.handleIntent({ type: 'open_panel', panel: 'canoe_builder' });
  made.app.frame(FIXED_STEP);
  expect(made.app.session.panels.stack).toEqual(['canoe_builder']);
  return made;
}

const run = (app: App, seconds: number, frame = FIXED_STEP): void => {
  for (let passed = 0; passed < seconds - 1e-9; passed += frame) app.frame(frame);
};

describe('the built view begins when the player builds from the canoe builder', () => {
  it('holds the screen for two seconds, with the panel still open behind it and the game still frozen', () => {
    const { app, models } = atBuilder(readyToPatch());
    const session = app.session;
    session.handleIntent({ type: 'command', command: { type: 'upgrade_hull' } });
    expect(session.game!.canoe.hullTier).toBe(1);
    expect(session.builtView).toEqual({ piece: { kind: 'hull', tier: 1 }, secondsLeft: BUILT_VIEW_SECONDS });
    // About two seconds: Luc's number.
    expect(BUILT_VIEW_SECONDS).toBeGreaterThanOrEqual(1.8);
    expect(BUILT_VIEW_SECONDS).toBeLessThanOrEqual(2.5);
    expect(session.panels.stack).toEqual(['canoe_builder']);
    expect(session.paused).toBe(true);
    run(app, BUILT_VIEW_SECONDS - 0.2);
    expect(session.builtView).not.toBeNull();
    // The model says what was built, in the builder's own words, and keeps the panel it will give back.
    expect(models.at(-1)!.built).toEqual({
      kicker: 'Hull rebuilt', title: 'Patched canoe', text: HULL_TIERS[1].description, hint: 'Any key', dismiss: { type: 'end_built_view' },
    });
    expect(models.at(-1)!.panel?.id).toBe('canoe_builder');
    run(app, 0.3);
    expect(session.builtView).toBeNull();
    expect(models.at(-1)!.built).toBeNull();
    expect(session.panels.stack).toEqual(['canoe_builder']);
  });

  it('shows an attachment by its own name', () => {
    const { app, models } = atBuilder(readyToFit());
    app.session.handleIntent({ type: 'command', command: { type: 'build_attachment', attachmentId: 'cargo_rack' } });
    expect(app.session.builtView?.piece).toEqual({ kind: 'attachment', attachmentId: 'cargo_rack' });
    app.frame(FIXED_STEP);
    expect(models.at(-1)!.built).toMatchObject({ kicker: 'Built', title: 'Cargo rack', text: ATTACHMENTS.cargo_rack.description });
  });

  it('a long frame as it begins takes a tenth of a second off its clock, not the whole view', () => {
    const { app } = atBuilder(readyToPatch());
    app.session.handleIntent({ type: 'command', command: { type: 'upgrade_hull' } });
    app.frame(1.5);
    expect(app.session.builtView?.secondsLeft).toBeCloseTo(BUILT_VIEW_SECONDS - 0.1, 5);
  });

  it('does not begin for a build that was refused, for the bot\'s builds, or for one made with no panel open', () => {
    // Refused: nothing to pay with.
    const poor = newGame(7);
    standOn(poor, 'home_knoll');
    const refused = atBuilder(poor);
    refused.app.session.handleIntent({ type: 'command', command: { type: 'upgrade_hull' } });
    expect(refused.app.session.game!.canoe.hullTier).toBe(0);
    run(refused.app, 0.5);
    expect(refused.app.session.builtView).toBeNull();

    // The bot sends its commands quietly through the same door.
    const bot = atBuilder(readyToPatch());
    expect(bot.app.session.dispatch({ type: 'upgrade_hull' }, true).ok).toBe(true);
    run(bot.app, 0.5);
    expect(bot.app.session.builtView).toBeNull();

    // No panel: a build nobody pressed a button for.
    const bare = client();
    bare.app.session.adoptGame(readyToPatch());
    bare.app.frame(FIXED_STEP);
    expect(bare.app.session.dispatch({ type: 'upgrade_hull' }).ok).toBe(true);
    run(bare.app, 0.5);
    expect(bare.app.session.builtView).toBeNull();
  });
});

describe('the built view ends', () => {
  const building = (): Client => {
    const made = atBuilder(readyToPatch());
    made.app.session.handleIntent({ type: 'command', command: { type: 'upgrade_hull' } });
    run(made.app, 0.4);
    expect(made.app.session.builtView).not.toBeNull();
    return made;
  };

  it('at once on any key, and the key does nothing else', () => {
    for (const key of ['Escape', 'KeyB', 'Tab', 'Space', 'KeyW', 'ShiftLeft']) {
      const { app } = building();
      app.session.keyDown(key);
      expect(app.session.builtView, key).toBeNull();
      // Esc did not also close the panel, B did not also toggle it, Tab did not open the inventory.
      expect(app.session.panels.stack, key).toEqual(['canoe_builder']);
      app.session.keyUp(key);
      app.frame(FIXED_STEP);
      expect(app.session.panels.stack, key).toEqual(['canoe_builder']);
    }
    // The next Esc is the session's again.
    const { app } = building();
    app.session.keyDown('Escape');
    app.session.keyUp('Escape');
    app.session.keyDown('Escape');
    expect(app.session.panels.stack).toEqual([]);
  });

  it('not on a key that was already held down when it began', () => {
    const { app } = building();
    app.session.keyDown('Enter', true);
    expect(app.session.builtView).not.toBeNull();
  });

  it('at once on a click: the interface sends `end_built_view`', () => {
    const { app, models } = building();
    app.session.handleIntent(models.at(-1)!.built!.dismiss);
    expect(app.session.builtView).toBeNull();
    expect(app.session.panels.stack).toEqual(['canoe_builder']);
  });

  it('when the tab is hidden, and when the game is left', () => {
    const hidden = building();
    hidden.app.setHidden(true);
    expect(hidden.app.session.builtView).toBeNull();
    const left = building();
    left.app.session.quitToLobby();
    left.app.frame(FIXED_STEP);
    expect(left.app.session.builtView).toBeNull();
  });
});

describe('the built view is a cut to one still pose, and a cut back', () => {
  it('hands the look one pose for as long as it lasts, then the chase camera\'s pose from before, unchanged', () => {
    const made = atBuilder(readyToPatch());
    const { app, poses, frames } = made;
    // The player has turned the camera their own way: that is the view to come back to.
    app.camera.setOrbit({ yaw: 1.1, pitch: 0.52, distance: 6.5 });
    run(app, 0.5);
    const before = poses.at(-1)!;
    made.bounds.value = { min: { x: -0.5, y: -0.15, z: -2.5 }, max: { x: 0.5, y: 0.9, z: 2.5 }, aspect: 16 / 9 };
    app.session.handleIntent({ type: 'command', command: { type: 'upgrade_hull' } });
    const from = poses.length;
    run(app, BUILT_VIEW_SECONDS - 0.2);
    const held = poses.slice(from);
    expect(held.length).toBeGreaterThan(60);
    // One pose: the very first frame is already it (a cut, no travel), and every frame after is the same.
    for (const pose of held) expect(pose).toEqual(held[0]);
    expect(held[0]).not.toEqual(before);
    expect(held[0]).toEqual(builtViewPose(app.session.game!, { kind: 'hull', tier: 1 }, made.bounds.value, surfaceFromState(app.session.game!)));
    // Through its own lens, not the game's.
    expect(held[0].fieldOfView).toBe(BUILT_VIEW_FIELD);
    expect(before.fieldOfView).not.toBe(BUILT_VIEW_FIELD);
    // The look is told no panel covers the view while it lasts.
    expect(frames.slice(from).every((frame) => frame.panelOpen === false && frame.paused)).toBe(true);
    run(app, 0.4);
    expect(app.session.builtView).toBeNull();
    // Cut back: the first frame after is the view the player left, to the last digit.
    expect(poses.at(-1)).toEqual(before);
    expect(frames.at(-1)!.panelOpen).toBe(true);
  });

  it('does not let the mouse turn the held view, nor leave the chase camera turned when it ends', () => {
    const made = atBuilder(readyToPatch());
    const { app, poses } = made;
    app.camera.setOrbit({ yaw: -0.4, pitch: 0.2, distance: 11 });
    run(app, 0.3);
    const before = poses.at(-1)!;
    app.session.handleIntent({ type: 'command', command: { type: 'upgrade_hull' } });
    app.frame(FIXED_STEP);
    const held = poses.at(-1)!;
    // A drag and a turn of the wheel while it is held.
    app.session.input.pointerDown();
    app.session.input.pointerMove(240, 90);
    app.session.input.wheel(300);
    app.session.input.pointerUp();
    app.frame(FIXED_STEP);
    expect(poses.at(-1)).toEqual(held);
    app.session.keyDown('Space');
    app.frame(FIXED_STEP);
    expect(poses.at(-1)).toEqual(before);
  });

  it('puts the notes away while it lasts: their clocks wait, and they have their full time after it', () => {
    const { app, models } = atBuilder(readyToPatch());
    app.session.handleIntent({ type: 'command', command: { type: 'upgrade_hull' } });
    app.frame(FIXED_STEP);
    // The build's own notes: the hull, and whatever the quests made of it.
    const told = models.at(-1)!.toasts;
    expect(told.length).toBeGreaterThan(0);
    expect(told.every((toast) => toast.life === 1)).toBe(true);
    run(app, BUILT_VIEW_SECONDS - 0.2);
    expect(app.session.builtView).not.toBeNull();
    expect(models.at(-1)!.toasts).toEqual(told);
    // Given back, the notes run down as notes do.
    run(app, 1.7);
    expect(app.session.builtView).toBeNull();
    const later = models.at(-1)!.toasts;
    expect(later.map((toast) => toast.id)).toEqual(told.map((toast) => toast.id));
    expect(later.every((toast) => toast.life < 1 && toast.life >= 0.5)).toBe(true);
  });
});

describe('the pose frames the canoe', () => {
  const surface = { ground: () => -5, water: () => 0 };
  /** Where a world point lands in the frame: -1 to 1 each way, and its depth in front of the eye. */
  const project = (pose: CameraPose, aspect: number, point: { x: number; y: number; z: number }): { x: number; y: number; depth: number } => {
    const sub = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
    const dot = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number => a.x * b.x + a.y * b.y + a.z * b.z;
    const cross = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
    const unit = (a: { x: number; y: number; z: number }) => ({ x: a.x / Math.hypot(a.x, a.y, a.z), y: a.y / Math.hypot(a.x, a.y, a.z), z: a.z / Math.hypot(a.x, a.y, a.z) });
    const forward = unit(sub(pose.target, pose.position));
    const right = unit(cross(forward, { x: 0, y: 1, z: 0 }));
    const up = cross(right, forward);
    const offset = sub(point, pose.position);
    const depth = dot(offset, forward);
    const tan = Math.tan((pose.fieldOfView * Math.PI) / 360);
    return { x: dot(offset, right) / (depth * tan * aspect), y: dot(offset, up) / (depth * tan), depth };
  };
  /** Points in canoe space, in the world. */
  const inWorld = (state: GameState, points: { x: number; y: number; z: number }[]): { x: number; y: number; z: number }[] => {
    const { heading, position } = state.canoe;
    return points.map(({ x, y, z }) => ({ x: position.x + x * Math.cos(heading) - z * Math.sin(heading), y: position.y + y, z: position.z + x * Math.sin(heading) + z * Math.cos(heading) }));
  };

  for (const [name, box] of [
    ['the bare hull', { min: { x: -0.45, y: -0.15, z: -2.45 }, max: { x: 0.45, y: 0.5, z: 2.45 }, aspect: 16 / 9 }],
    ['the long canoe with a mast and both outriggers', { min: { x: -2.1, y: -0.2, z: -3.4 }, max: { x: 2.1, y: 3.6, z: 3.3 }, aspect: 16 / 9 }],
    ['the same in a tall window', { min: { x: -2.1, y: -0.2, z: -3.4 }, max: { x: 2.1, y: 3.6, z: 3.3 }, aspect: 0.8 }],
  ] as const) {
    it(`keeps all of ${name} inside the frame, fills it, and leaves the bottom for the slip`, () => {
      const state = readyToPatch();
      const pose = builtViewPose(state, { kind: 'hull', tier: 1 }, box, surface);
      // What is framed is the canoe and whoever stands by it: here the player, at the bow.
      const seen = inWorld(state, framedPoints(state, box)).map((corner) => project(pose, box.aspect, corner));
      for (const point of seen) expect(point.depth).toBeGreaterThan(0.5);
      const [left, right] = [Math.min(...seen.map((point) => point.x)), Math.max(...seen.map((point) => point.x))];
      const [bottom, top] = [Math.min(...seen.map((point) => point.y)), Math.max(...seen.map((point) => point.y))];
      // In the middle of the frame from side to side, and a little above the middle: the slip is under it.
      expect((left + right) / 2).toBeCloseTo(0, 1);
      expect((bottom + top) / 2).toBeCloseTo(2 * BUILT_VIEW_RISE, 1);
      // Inside the share of the frame it may fill, and filling it one way or the other: framed, not far off.
      expect((right - left) / 2).toBeLessThanOrEqual(BUILT_VIEW_FILL.width + 0.02);
      expect((top - bottom) / 2).toBeLessThanOrEqual(BUILT_VIEW_FILL.height + 0.02);
      expect(Math.max((right - left) / (2 * BUILT_VIEW_FILL.width), (top - bottom) / (2 * BUILT_VIEW_FILL.height))).toBeGreaterThan(0.95);
      // Nothing of the canoe in the bottom fifth of the frame, where its name is written, nor against the top.
      expect(bottom).toBeGreaterThan(-0.6);
      expect(top).toBeLessThan(0.9);
    });
  }

  it('stands astern of the canoe, off the quarter, above the water, and looks down at it', () => {
    const state = readyToPatch();
    const { heading, position } = state.canoe;
    const pose = builtViewPose(state, { kind: 'hull', tier: 1 }, null, surface);
    // How far ahead of the hull's middle the eye is, along the heading: well astern.
    const ahead = (pose.position.x - position.x) * Math.sin(heading) - (pose.position.z - position.z) * Math.cos(heading);
    const across = (pose.position.x - position.x) * Math.cos(heading) + (pose.position.z - position.z) * Math.sin(heading);
    expect(ahead).toBeLessThan(-2);
    expect(Math.abs(across)).toBeGreaterThan(1.5);
    expect(pose.position.y).toBeGreaterThan(1);
    expect(pose.position.y).toBeGreaterThan(pose.target.y);
    // Far enough off that the near end of the hull does not swell: no nearer than the hull is long.
    expect(Math.hypot(pose.position.x - position.x, pose.position.z - position.z)).toBeGreaterThan(HULL_TIERS[0].dimensions.length);
  });

  it('keeps its eye above the water and the ground, wherever it has to stand', () => {
    const state = readyToPatch();
    const low = builtViewPose(state, { kind: 'hull', tier: 1 }, null, { ground: () => -5, water: () => 0 });
    const flooded = builtViewPose(state, { kind: 'hull', tier: 1 }, null, { ground: () => -5, water: () => 6 });
    const hill = builtViewPose(state, { kind: 'hull', tier: 1 }, null, { ground: () => 9, water: () => 0 });
    expect(low.position.y).toBeGreaterThan(0.35);
    expect(flooded.position.y).toBeCloseTo(6.35, 5);
    expect(hill.position.y).toBeCloseTo(9.35, 5);
    expect([flooded.position.x, flooded.position.z]).toEqual([low.position.x, low.position.z]);
  });

  it('looks at a piece from its own side, and otherwise from the side the player is not standing on', () => {
    const state = readyToFit();
    const side = (attachmentId: 'outrigger_port' | 'outrigger_starboard' | 'fishing_rig'): number => {
      const pose = builtViewPose(state, { kind: 'attachment', attachmentId }, null, surface);
      const { heading, position } = state.canoe;
      return Math.sign((pose.position.x - position.x) * Math.cos(heading) + (pose.position.z - position.z) * Math.sin(heading));
    };
    // Starboard is +x in canoe space.
    expect(attachmentTransformForHull('outrigger_starboard', 2).position[0]).toBeGreaterThan(0);
    expect(side('outrigger_starboard')).toBe(1);
    expect(side('outrigger_port')).toBe(-1);
    expect(side('fishing_rig')).toBe(Math.sign(attachmentTransformForHull('fishing_rig', 2).position[0]));
    // The hull is on neither side: the eye goes where the player is not.
    const player = state.players[0];
    const { heading, position } = state.canoe;
    const stand = (across: number): void => {
      player.position = { x: position.x + Math.cos(heading) * across + Math.sin(heading) * 2, y: 0, z: position.z + Math.sin(heading) * across - Math.cos(heading) * 2 };
    };
    stand(-1);
    expect(builtViewSide(state, { kind: 'hull', tier: 2 })).toBe(-1);
    stand(1);
    expect(builtViewSide(state, { kind: 'hull', tier: 2 })).toBe(1);
    // When the look says which side the light falls on, the hull is looked at from there, wherever the player stands.
    expect(builtViewSide(state, { kind: 'hull', tier: 2 }, 0, 'starboard')).toBe(-1);
    expect(builtViewSide(state, { kind: 'hull', tier: 2 }, 0, 'port')).toBe(1);
    stand(-1);
    expect(builtViewSide(state, { kind: 'hull', tier: 2 }, 0, 'port')).toBe(1);
    // A piece on one side is still looked at from its own side, lit or not.
    expect(builtViewSide(state, { kind: 'attachment', attachmentId: 'outrigger_starboard' }, 0, 'port')).toBe(-1);
    const across = (pose: CameraPose): number => Math.sign((pose.position.x - position.x) * Math.cos(heading) + (pose.position.z - position.z) * Math.sin(heading));
    const box = hullBounds(state);
    expect(across(builtViewPose(state, { kind: 'hull', tier: 2 }, { ...box, lit: 'starboard' }, surface))).toBe(1);
    expect(across(builtViewPose(state, { kind: 'hull', tier: 2 }, { ...box, lit: 'port' }, surface))).toBe(-1);
  });

  it('takes in whoever is aboard or stands by the canoe, head to foot, and nobody who is far off', () => {
    const state = readyToPatch(3);
    const box = hullBounds(state);
    const { heading, position } = state.canoe;
    const [bow, aboard, far] = state.players;
    // One stands at the bow (where `standOn` put them), one sits in the canoe, one is 40 m up the island.
    Object.assign(aboard, { mode: 'canoe', seat: 0 });
    Object.assign(far, { mode: 'foot', seat: null, position: { x: position.x + Math.sin(heading) * 40, y: 6, z: position.z - Math.cos(heading) * 40 } });
    const framed = framedPoints(state, box);
    const along = -(bow.position.x - position.x) * Math.sin(heading) + (bow.position.z - position.z) * Math.cos(heading);
    expect(along).toBeLessThan(box.min.z + 0.5);
    const reach = (points: { x: number; y: number; z: number }[]) => ({
      bow: Math.min(...points.map((point) => point.z)), stern: Math.max(...points.map((point) => point.z)), top: Math.max(...points.map((point) => point.y)),
      width: Math.max(...points.map((point) => point.x)) - Math.min(...points.map((point) => point.x)),
    });
    // The one at the bow, head to foot. Not the one up the island.
    expect(reach(framed).bow).toBeLessThan(along - 0.3);
    expect(reach(framed).bow).toBeGreaterThan(-10);
    expect(reach(framed).top).toBeGreaterThanOrEqual(bow.position.y - position.y + 1.9);
    expect(reach(framed).top).toBeLessThan(5);
    // The one aboard: their head is over the rail. With nobody by the canoe, nothing else is added.
    bow.position = { ...far.position };
    const seated = reach(framedPoints(state, box));
    expect(seated.top).toBeGreaterThan(1.1);
    expect(seated.top).toBeLessThan(1.5);
    expect([seated.bow, seated.stern, seated.width]).toEqual([box.min.z, box.max.z, box.max.x - box.min.x]);
    aboard.mode = 'foot';
    aboard.position = { ...far.position };
    expect(framedPoints(state, box).length).toBe(8);
    // And the pose shows the standing one whole: their head is inside the frame.
    const whole = readyToPatch();
    const pose = builtViewPose(whole, { kind: 'hull', tier: 1 }, null, surface);
    const head = { x: whole.players[0].position.x, y: whole.players[0].position.y + 1.85, z: whole.players[0].position.z };
    const feet = { ...whole.players[0].position };
    for (const point of [project(pose, 16 / 9, head), project(pose, 16 / 9, feet)]) {
      expect(Math.abs(point.x)).toBeLessThan(0.8);
      expect(point.y).toBeLessThan(0.8);
      expect(point.y).toBeGreaterThan(-0.6);
    }
  });

  it('frames the bare hull with headroom when the look cannot say how big the canoe is', () => {
    const state = readyToPatch();
    const box = hullBounds(state);
    expect(box.max.z - box.min.z).toBe(HULL_TIERS[0].dimensions.length);
    expect(builtViewPose(state, { kind: 'hull', tier: 1 }, null, surface)).toEqual(builtViewPose(state, { kind: 'hull', tier: 1 }, box, surface));
    expect(box.lit).toBeUndefined();
  });
});

describe('the built view is the builder\'s alone', () => {
  it('a crewmate\'s build takes nobody else\'s screen: the piece, the note and nothing more', () => {
    const game = readyToPatch();
    const mate = addPlayer(game)!;
    setConnected(game, mate.id, true, true);
    Object.assign(mate, { mode: 'foot', seat: null, islandId: 'home_knoll', position: { ...game.players[0].position } });
    const { app, models, poses } = atBuilder(game);
    run(app, 0.3);
    const before = poses.at(-1)!;
    // The crewmate builds, through the rules, as the host's link does for a guest.
    expect(dispatch(game, { type: 'upgrade_hull' }, mate.id).ok).toBe(true);
    run(app, 0.5);
    expect(app.session.builtView).toBeNull();
    expect(models.at(-1)!.built).toBeNull();
    expect(models.at(-1)!.panel?.id).toBe('canoe_builder');
    expect(poses.at(-1)).toEqual(before);
    expect(models.at(-1)!.toasts.map((toast) => toast.text)).toContain('Hull rebuilt: Patched canoe');
  });

  it('a guest who builds is shown it once the host has built it, and the host\'s screen is left alone', () => {
    const host = client();
    const guest = client();
    let link: HostLink | null = null;
    host.app.session.onShare = (made) => {
      link = made;
    };
    const game = readyToPatch();
    host.app.session.adoptGame(game);
    const pair = createLoopbackPair({ delay: 0.1 });
    link!.accept(pair.host);
    guest.app.session.joinGame(pair.guest, { name: 'Sam', key: 'key-sam-0123456789' });
    const tick = (seconds: number): void => {
      for (let frame = 0; frame < Math.round(seconds / FIXED_STEP); frame += 1) {
        pair.advance(FIXED_STEP);
        host.app.frame(FIXED_STEP);
        guest.app.frame(FIXED_STEP);
      }
    };
    tick(1);
    expect(guest.app.session.screen).toBe('game');
    // The guest steps ashore beside the host and opens the builder.
    const sam = game.players.find((player) => player.id === guest.app.session.localPlayerId)!;
    Object.assign(sam, { mode: 'foot', seat: null, islandId: 'home_knoll', position: { ...game.players[0].position } });
    tick(0.5);
    guest.app.session.handleIntent({ type: 'open_panel', panel: 'canoe_builder' });
    host.app.session.handleIntent({ type: 'open_panel', panel: 'canoe_builder' });
    tick(0.2);
    expect(guest.app.session.panels.stack).toEqual(['canoe_builder']);
    guest.app.session.handleIntent({ type: 'command', command: { type: 'upgrade_hull' } });
    // Not yet: the host has not run it.
    expect(guest.app.session.builtView).toBeNull();
    tick(0.6);
    expect(game.canoe.hullTier).toBe(1);
    expect(guest.app.session.builtView?.piece).toEqual({ kind: 'hull', tier: 1 });
    expect(guest.models.at(-1)!.built?.title).toBe('Patched canoe');
    // The host sees the hull change and reads the note. Their panel and their camera are theirs.
    expect(host.app.session.builtView).toBeNull();
    expect(host.models.at(-1)!.built).toBeNull();
    expect(host.app.session.panels.stack).toEqual(['canoe_builder']);
    tick(BUILT_VIEW_SECONDS);
    expect(guest.app.session.builtView).toBeNull();
    expect(guest.app.session.panels.stack).toEqual(['canoe_builder']);
  });

  it('a guest whose build the host refuses is shown nothing', () => {
    const host = client();
    const guest = client();
    let link: HostLink | null = null;
    host.app.session.onShare = (made) => {
      link = made;
    };
    const game = newGame(7);
    standOn(game, 'home_knoll');
    host.app.session.adoptGame(game);
    const pair = createLoopbackPair({ delay: 0.1 });
    link!.accept(pair.host);
    guest.app.session.joinGame(pair.guest, { name: 'Sam', key: 'key-sam-0123456789' });
    const tick = (seconds: number): void => {
      for (let frame = 0; frame < Math.round(seconds / FIXED_STEP); frame += 1) {
        pair.advance(FIXED_STEP);
        host.app.frame(FIXED_STEP);
        guest.app.frame(FIXED_STEP);
      }
    };
    tick(1);
    const sam = game.players.find((player) => player.id === guest.app.session.localPlayerId)!;
    Object.assign(sam, { mode: 'foot', seat: null, islandId: 'home_knoll', position: { ...game.players[0].position } });
    tick(0.5);
    guest.app.session.handleIntent({ type: 'open_panel', panel: 'canoe_builder' });
    tick(0.2);
    guest.app.session.handleIntent({ type: 'command', command: { type: 'upgrade_hull' } });
    tick(1);
    expect(game.canoe.hullTier).toBe(0);
    expect(guest.app.session.builtView).toBeNull();
    // And a hull a crewmate then rebuilds is not taken for the guest's own.
    for (const { itemId, count } of HULL_TIERS[1].cost) give(game, itemId, count, 'cargo');
    expect(dispatch(game, { type: 'upgrade_hull' }, 0).ok).toBe(true);
    tick(1);
    expect(guest.app.session.builtView).toBeNull();
  });
});

describe('the built view\'s words and its slip', () => {
  it('names every hull and every attachment from the data', () => {
    expect(builtWords({ kind: 'hull', tier: 3 })).toEqual({ kicker: 'Hull rebuilt', title: 'Long canoe', text: HULL_TIERS[3].description });
    for (const attachmentId of Object.keys(ATTACHMENTS) as (keyof typeof ATTACHMENTS)[]) {
      const words = builtWords({ kind: 'attachment', attachmentId });
      expect(words).toEqual({ kicker: 'Built', title: ATTACHMENTS[attachmentId].name, text: ATTACHMENTS[attachmentId].description });
    }
  });

  it('knows the piece a command builds, and when the state shows it', () => {
    const state = readyToPatch();
    expect(builtPieceOf({ type: 'upgrade_hull' }, state, false)).toEqual({ kind: 'hull', tier: 1 });
    expect(showsPiece(state, { kind: 'hull', tier: 1 })).toBe(false);
    state.canoe.hullTier = 1;
    expect(builtPieceOf({ type: 'upgrade_hull' }, state, true)).toEqual({ kind: 'hull', tier: 1 });
    expect(showsPiece(state, { kind: 'hull', tier: 1 })).toBe(true);
    expect(builtPieceOf({ type: 'build_attachment', attachmentId: 'rudder' }, state, true)).toEqual({ kind: 'attachment', attachmentId: 'rudder' });
    expect(showsPiece(state, { kind: 'attachment', attachmentId: 'rudder' })).toBe(false);
    expect(builtPieceOf({ type: 'toggle_lantern' }, state, true)).toBeNull();
    // No hull past the last.
    state.canoe.hullTier = 3;
    expect(builtPieceOf({ type: 'upgrade_hull' }, state, false)).toBeNull();
  });

  it('writes the slip with the four lines of the model, and no control: the screen behind it takes the press', () => {
    const [slip] = builtView({ kicker: 'Built', title: 'Cargo rack', text: 'Slatted shelves.', hint: 'Any key', dismiss: { type: 'end_built_view' } });
    const words = (node: typeof slip): string[] => (node.tag === '#text' ? [node.text] : node.children.flatMap(words));
    expect(words(slip)).toEqual(['Built', 'Cargo rack', 'Slatted shelves.', 'Any key']);
    const tags = (node: typeof slip): string[] => [node.tag, ...node.children.flatMap(tags)];
    expect(tags(slip)).not.toContain('button');
    expect(slip.intent).toBeNull();
  });
});

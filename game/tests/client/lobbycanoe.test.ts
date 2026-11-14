/**
 * The lobby's camera and the canoe behind the menu, in the app (Luc, Round 4): the canoe the look drew is
 * measured once, the camera frames it from the first frame it is drawn, a window pulled to another shape is
 * followed at once, and a game's own camera is as it was.
 */
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/client/app.ts';
import type { App } from '../../src/client/app.ts';
import type { CanoeBounds } from '../../src/client/builtview.ts';
import type { CameraPose } from '../../src/client/camera.ts';
import { createSilentAudio } from '../../src/client/contracts.ts';
import type { GameInterface, WorldView } from '../../src/client/contracts.ts';
import { LobbyCanoe } from '../../src/client/lobbycanoe.ts';
import { LOBBY_DISTANCE, LOBBY_FOCUS_HEIGHT, LOBBY_UNFRAMED } from '../../src/client/lobbyframe.ts';
import { createSaveStore } from '../../src/save/index.ts';
import type { CanoeState, GameState } from '../../src/sim/index.ts';
import { FakeStorage, newGame } from '../support.ts';

/** A bare short hull and a long one with a mast and both floats, as the look measures them. */
const SMALL = { min: { x: -0.5, y: -0.15, z: -2.5 }, max: { x: 0.5, y: 0.66, z: 2.5 } };
const BIG = { min: { x: -2.15, y: -0.48, z: -3.92 }, max: { x: 2.74, y: 4.44, z: 3.92 } };

/** What the look was handed on a frame: the state, and its canoe as it was then (the state itself moves on). */
interface Drawn { state: GameState; canoe: CanoeState }
interface Client { app: App; poses: CameraPose[]; drawn: Drawn[]; look: { asked: number; aspect: number; measures: boolean } }

/** An app on a look that measures the canoe it was last handed: the big box for the long hull, the small one for the others. */
function client(storage = new FakeStorage(), measures = true): Client {
  const poses: CameraPose[] = [];
  const drawn: Drawn[] = [];
  const look = { asked: 0, aspect: 16 / 9, measures };
  const bounds = (): CanoeBounds | null => {
    look.asked += 1;
    const last = drawn.at(-1);
    return last ? { ...(last.canoe.hullTier === 3 ? BIG : SMALL), aspect: look.aspect } : null;
  };
  const worldView: WorldView = {
    mount: () => {}, resize: () => {}, applyGraphicsSettings: () => {}, showStage: () => {},
    sync: (state) => void drawn.push({ state, canoe: structuredClone(state.canoe) }), handleEvents: () => {},
    render: (pose) => void poses.push(pose), dispose: () => {},
    ...(measures ? { canoeBounds: bounds, viewAspect: () => look.aspect } : {}),
  };
  const gameInterface: GameInterface = { mount: () => {}, update: () => {}, dispose: () => {} };
  let clock = 9_000_000;
  const app = createApp({ worldView, gameInterface, audio: createSilentAudio(), storage, now: () => (clock += 1_000), randomSeed: () => 42 });
  return { app, poses, drawn, look };
}

function storageWith(change: (canoe: CanoeState) => void): FakeStorage {
  const storage = new FakeStorage();
  const state = newGame(7);
  change(state.canoe);
  createSaveStore(storage, () => 5_000).save(0, state);
  return storage;
}

const frames = (app: App, count: number): void => {
  for (let frame = 0; frame < count; frame += 1) app.frame(1 / 60);
};

/** How far the camera stands from the canoe, and whether it looks straight at it. */
function readPose(pose: CameraPose, canoe: CanoeState): { distance: number; atCanoe: boolean } {
  const distance = Math.hypot(pose.position.x - canoe.position.x, pose.position.y - LOBBY_FOCUS_HEIGHT, pose.position.z - canoe.position.z);
  return { distance, atCanoe: Math.abs(pose.target.x - canoe.position.x) < 1e-9 && Math.abs(pose.target.z - canoe.position.z) < 1e-9 };
}

describe('the lobby\'s camera frames the canoe the look drew', () => {
  it('from the first frame: the camera looks left of the canoe, 13 m off, and the canoe was measured once', () => {
    const { app, poses, drawn, look } = client();
    frames(app, 1);
    expect(poses).toHaveLength(1);
    const first = readPose(poses[0]!, drawn[0]!.canoe);
    expect(first.atCanoe).toBe(false);
    expect(first.distance).toBeCloseTo(LOBBY_DISTANCE, 6);
    frames(app, 600);
    expect(look.asked).toBe(1);
    const last = readPose(poses.at(-1)!, drawn.at(-1)!.canoe);
    expect(last.atCanoe).toBe(false);
    expect(last.distance).toBeCloseTo(LOBBY_DISTANCE, 6);
  });

  it('the long hull with everything on it is held from further off than the small one', () => {
    const { app, poses, drawn, look } = client(storageWith((canoe) => { canoe.hullTier = 3; }));
    frames(app, 120);
    expect(drawn.at(-1)!.canoe.hullTier).toBe(3);
    expect(look.asked).toBe(1);
    const far = readPose(poses.at(-1)!, drawn.at(-1)!.canoe).distance;
    expect(far).toBeGreaterThan(LOBBY_DISTANCE + 0.5);
    // And from its first frame: no frame shows it from 13 m and then steps back.
    expect(readPose(poses[0]!, drawn[0]!.canoe).distance).toBeCloseTo(far, 6);
  });

  it('a window pulled to another shape is framed anew at once, with no new measuring', () => {
    const { app, poses, drawn, look } = client(storageWith((canoe) => { canoe.hullTier = 3; }));
    frames(app, 10);
    const wide = readPose(poses.at(-1)!, drawn.at(-1)!.canoe).distance;
    look.aspect = 4 / 3;
    frames(app, 1);
    const narrow = readPose(poses.at(-1)!, drawn.at(-1)!.canoe).distance;
    expect(narrow).toBeGreaterThan(wide + 2);
    expect(look.asked).toBe(1);
  });

  it('a look that cannot measure: the lobby as it always was, the canoe in the middle, 13 m off', () => {
    const { app, poses, drawn } = client(new FakeStorage(), false);
    frames(app, 30);
    for (const [index, pose] of poses.entries()) {
      const seen = readPose(pose, drawn[index]!.canoe);
      expect(seen.atCanoe).toBe(true);
      expect(seen.distance).toBeCloseTo(LOBBY_DISTANCE, 6);
    }
  });

  it('a game\'s own camera is not the lobby\'s: it looks at the player, close by', () => {
    const { app, poses, drawn } = client(storageWith((canoe) => { canoe.hullTier = 3; }));
    frames(app, 5);
    expect(app.session.newGame(1)).toBe(true);
    frames(app, 5);
    const game = app.session.game!;
    expect(drawn.at(-1)!.state).toBe(game);
    const pose = poses.at(-1)!;
    expect(Math.hypot(pose.position.x - pose.target.x, pose.position.y - pose.target.y, pose.position.z - pose.target.z)).toBeLessThan(LOBBY_DISTANCE - 1);
  });
});

describe('the framing is worked out once for a canoe, a window and a lens', () => {
  const look = (aspect: { value: number }) => ({ canoeBounds: () => ({ ...BIG, aspect: aspect.value }), viewAspect: () => aspect.value });
  const canoe = newGame(7).canoe;

  it('the same answer, by the same object, for as long as nothing changes; a new one for another lens or window', () => {
    const lobby = new LobbyCanoe();
    const aspect = { value: 16 / 9 };
    expect(lobby.framing(look(aspect), 60)).toBe(LOBBY_UNFRAMED);
    expect(lobby.changed(canoe, look(aspect))).toBe(true);
    expect(lobby.changed(canoe, look(aspect))).toBe(false);
    const first = lobby.framing(look(aspect), 60);
    for (let frame = 0; frame < 100; frame += 1) expect(lobby.framing(look(aspect), 60)).toBe(first);
    expect(lobby.framings).toBe(1);
    expect(lobby.framing(look(aspect), 45).distance).toBeGreaterThan(first.distance);
    aspect.value = 4 / 3;
    expect(lobby.framing(look(aspect), 45).distance).toBeGreaterThan(first.distance);
    expect(lobby.framings).toBe(3);
    expect(lobby.measures).toBe(1);
  });

  it('another hull, another list of attachments or the sail up or down: measured again', () => {
    const lobby = new LobbyCanoe();
    const aspect = { value: 16 / 9 };
    lobby.changed(canoe, look(aspect));
    expect(lobby.changed({ ...canoe, hullTier: 2 }, look(aspect))).toBe(true);
    expect(lobby.changed({ ...canoe, hullTier: 2, attachments: ['mast_sail'] }, look(aspect))).toBe(true);
    const sail = { ...canoe, hullTier: 2, attachments: canoe.attachments, sailRaised: true };
    expect(lobby.changed(sail, look(aspect))).toBe(true);
    expect(lobby.changed(sail, look(aspect))).toBe(false);
    expect(lobby.measures).toBe(4);
  });
});

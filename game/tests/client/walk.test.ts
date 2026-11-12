/**
 * A guest's own walking through two whole clients: the keys move the figure
 * the look is handed, and the camera, on the frame they go down; and a prompt
 * the host refuses leaves nothing stuck.
 */
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/client/app.ts';
import type { App } from '../../src/client/app.ts';
import { createSilentAudio } from '../../src/client/contracts.ts';
import type { GameInterface, InterfaceModel, WorldView } from '../../src/client/contracts.ts';
import { ISLANDS_BY_ID, TUNING, spotPosition } from '../../src/data/index.ts';
import { createLoopbackPair } from '../../src/net/index.ts';
import type { HostLink, LoopbackConditions } from '../../src/net/index.ts';
import { FIXED_STEP, drainEvents, hashState, terrainHeight } from '../../src/sim/index.ts';
import type { GameState } from '../../src/sim/index.ts';
import { FakeStorage, newGame, standOn } from '../support.ts';

interface Client {
  app: App;
  /** The state the look was last handed. */
  drawn: GameState[];
  toasts(): string[];
}

function client(): Client {
  const models: InterfaceModel[] = [];
  const drawn: GameState[] = [];
  const worldView: WorldView = {
    mount: () => {}, resize: () => {}, applyGraphicsSettings: () => {}, showStage: () => {},
    sync: (state) => void drawn.push(state), handleEvents: () => {}, render: () => {}, dispose: () => {},
  };
  const gameInterface: GameInterface = { mount: () => {}, update: (model) => void models.push(model), dispose: () => {} };
  const app = createApp({ worldView, gameInterface, audio: createSilentAudio(), storage: new FakeStorage(), now: () => 5000, randomSeed: () => 42 });
  return { app, drawn, toasts: () => models.at(-1)!.toasts.map((toast) => toast.text) };
}

/** A host with the canoe beached at Home Knoll, and a guest on foot by the fire, 250 ms away each way. */
function ashore(conditions: Partial<LoopbackConditions> = { delay: 0.25 }) {
  const host = client();
  const guest = client();
  let link: HostLink | null = null;
  host.app.session.onShare = (made) => {
    link = made;
  };
  const game = newGame(7);
  standOn(game, 'home_knoll');
  game.quests.bail_out.status = 'completed';
  game.quests.first_haul.status = 'active';
  game.weather.secondsRemaining = 99999;
  drainEvents(game);
  host.app.session.adoptGame(game);
  const pair = createLoopbackPair(conditions);
  link!.accept(pair.host);
  guest.app.session.joinGame(pair.guest, { name: 'Sam', key: 'key-sam-0123456789' });
  const tick = (seconds: number): void => {
    for (let frame = 0; frame < Math.round(seconds / FIXED_STEP); frame += 1) {
      pair.advance(FIXED_STEP);
      host.app.frame(FIXED_STEP);
      guest.app.frame(FIXED_STEP);
    }
  };
  tick(2);
  const fire = spotPosition(ISLANDS_BY_ID.home_knoll, ISLANDS_BY_ID.home_knoll.camp!.spot);
  const x = fire.x + 2;
  Object.assign(game.players[1]!, {
    mode: 'foot', seat: null, islandId: 'home_knoll', position: { x, y: terrainHeight(x, fire.z), z: fire.z }, hunger: 100, thirst: 100, energy: 100,
  });
  tick(2);
  const me = () => guest.drawn.at(-1)!.players[1]!;
  return { host, guest, game, pair, tick, me };
}

const gap = (first: { x: number; z: number }, second: { x: number; z: number }): number => Math.hypot(second.x - first.x, second.z - first.z);

describe('a guest walks', () => {
  it('the look is handed the moved figure on the frame the key goes down, 250 ms from the host', () => {
    const { guest, tick, me } = ashore();
    expect(me().mode).toBe('foot');
    const before = { ...me().position };
    guest.app.session.keyDown('KeyW');
    tick(FIXED_STEP);
    expect(gap(before, me().position)).toBeCloseTo(TUNING.foot.walkSpeed * FIXED_STEP, 9);
    // What the session calls the game is what the look drew.
    expect(guest.app.session.game).toBe(guest.drawn.at(-1));
  });

  it('the camera goes with the figure at once, not after the round trip', () => {
    const { guest, tick, me } = ashore();
    const eye = { ...guest.app.lastPose!.position };
    const aim = { ...guest.app.lastPose!.target };
    guest.app.session.keyDown('KeyW');
    tick(FIXED_STEP);
    expect(gap(aim, guest.app.lastPose!.target)).toBeGreaterThan(0);
    // Half a second of walking: less than the round trip. The figure is 1.3 m on and the camera has gone with it.
    tick(0.5 - FIXED_STEP);
    const pose = guest.app.lastPose!;
    expect(gap(eye, pose.position)).toBeGreaterThan(0.8);
    expect(gap(aim, pose.target)).toBeGreaterThan(0.8);
    expect(gap(pose.target, me().position)).toBeLessThan(0.6);
  });

  it('is still only shown the host\'s game: the truth it holds is the host\'s, and the host walked it to where it stands', () => {
    const { guest, game, tick, me } = ashore({ delay: 0.12, loss: 0.2 });
    guest.app.session.keyDown('KeyW');
    tick(1.5);
    guest.app.session.keyUp('KeyW');
    guest.app.session.keyDown('KeyD');
    tick(1);
    guest.app.session.keyUp('KeyD');
    tick(0.5);
    expect(gap(game.players[1]!.position, me().position)).toBeLessThan(0.01);
    tick(2);
    const link = guest.app.session.guest!;
    expect(link.mismatches).toBe(0);
    expect(gap(link.truth!.players[1]!.position, game.players[1]!.position)).toBeLessThan(1e-9);
    // The guest's copy of the truth never held the figure's early place: it is the host's state, to the fingerprint.
    expect(link.truth!.tick).toBeLessThanOrEqual(game.tick);
    expect(hashState(link.truth!)).toMatch(/^[0-9a-f]{8}$/);
  });

  it('a prompt the host refuses leaves nothing stuck: a note, no command left waiting, and the keys still walk', () => {
    const { guest, tick, me } = ashore({ delay: 0.12 });
    // By the fire, out of reach of the canoe. The guest asks to board all the same, W held.
    guest.app.session.keyDown('KeyW');
    tick(0.3);
    guest.app.session.dispatch({ type: 'board' });
    tick(1);
    expect(guest.toasts().length).toBeGreaterThan(0);
    expect(guest.app.session.guest!.commandsWaiting).toBe(0);
    expect(me().mode).toBe('foot');
    expect(guest.app.session.panels.stack).toHaveLength(0);
    const before = { ...me().position };
    tick(0.5);
    expect(gap(before, me().position)).toBeGreaterThan(1);
  });
});

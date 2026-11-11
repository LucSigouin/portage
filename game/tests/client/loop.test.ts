import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/client/app.ts';
import type { App } from '../../src/client/app.ts';
import type { AudioEngine, CameraPose, FrameInfo, GameInterface, InterfaceModel, WorldView } from '../../src/client/contracts.ts';
import { createFrameLoop } from '../../src/client/loop.ts';
import type { LoopClock } from '../../src/client/loop.ts';
import type { GameEvent } from '../../src/sim/index.ts';
import { islandLanding } from '../../src/sim/index.ts';
import { FakeStorage } from '../support.ts';

/** A display that calls back when told to. Time only moves when a test moves it. */
class FakeClock implements LoopClock {
  time = 0;
  /** Milliseconds each call to `frame` appears to take. */
  workMilliseconds = 0;
  private callbacks = new Map<number, (timestamp: number) => void>();
  private nextHandle = 1;

  requestFrame(callback: (timestamp: number) => void): number {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.callbacks.set(handle, callback);
    return handle;
  }

  cancelFrame(handle: number): void {
    this.callbacks.delete(handle);
  }

  now(): number {
    return this.time;
  }

  get pending(): number {
    return this.callbacks.size;
  }

  /** One display refresh, `milliseconds` after the last. */
  refresh(milliseconds: number): void {
    this.time += milliseconds;
    const due = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const callback of due) callback(this.time);
  }
}

function loopWith(cap: () => number, clock = new FakeClock()) {
  const frames: number[] = [];
  const loop = createFrameLoop({
    clock,
    frame: (frameSeconds) => {
      frames.push(frameSeconds);
      clock.time += clock.workMilliseconds;
    },
    frameRateCap: cap,
  });
  return { loop, clock, frames };
}

const HZ60 = 1000 / 60;

describe('the frame loop', () => {
  it('runs a frame per display refresh with the real time between them', () => {
    const { loop, clock, frames } = loopWith(() => 0);
    loop.start();
    expect(loop.running).toBe(true);
    clock.refresh(HZ60); // the first refresh only starts the clock
    expect(frames).toEqual([]);
    clock.refresh(HZ60);
    clock.refresh(HZ60);
    clock.refresh(8);
    expect(frames).toHaveLength(3);
    expect(frames[0]).toBeCloseTo(1 / 60, 6);
    expect(frames[2]).toBeCloseTo(0.008, 6);
  });

  it('holds a 30 fps cap on a 60 Hz display by skipping every other refresh', () => {
    const { loop, clock, frames } = loopWith(() => 30);
    loop.start();
    for (let refresh = 0; refresh < 61; refresh += 1) clock.refresh(HZ60);
    expect(frames).toHaveLength(30);
    for (const frameSeconds of frames) expect(frameSeconds).toBeCloseTo(1 / 30, 6);
    // No time is lost to the skipped refreshes.
    expect(frames.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 6);
  });

  it('does not drop a 60 fps cap to 30 when the display runs a hair fast', () => {
    const { loop, clock, frames } = loopWith(() => 60);
    loop.start();
    for (let refresh = 0; refresh < 61; refresh += 1) clock.refresh(refresh % 2 === 0 ? 16.2 : 17.1);
    expect(frames).toHaveLength(60);
  });

  it('holds a 60 fps cap on a 144 Hz display', () => {
    const { loop, clock, frames } = loopWith(() => 60);
    loop.start();
    for (let refresh = 0; refresh < 145; refresh += 1) clock.refresh(1000 / 144);
    expect(frames.length).toBeGreaterThanOrEqual(46);
    expect(frames.length).toBeLessThanOrEqual(62);
    for (const frameSeconds of frames) expect(frameSeconds).toBeGreaterThan(1 / 75);
  });

  it('reads the cap every frame, so a settings change takes effect at once', () => {
    let cap = 30;
    const { loop, clock, frames } = loopWith(() => cap);
    loop.start();
    for (let refresh = 0; refresh < 21; refresh += 1) clock.refresh(HZ60);
    expect(frames).toHaveLength(10);
    cap = 0;
    for (let refresh = 0; refresh < 20; refresh += 1) clock.refresh(HZ60);
    expect(frames).toHaveLength(30);
  });

  it('clamps a long gap, so a tab coming back does not jump the game', () => {
    const { loop, clock, frames } = loopWith(() => 60);
    loop.start();
    clock.refresh(HZ60);
    clock.refresh(30_000);
    expect(frames).toEqual([0.25]);
    clock.refresh(HZ60);
    expect(frames[1]).toBeCloseTo(1 / 60, 6);
  });

  it('stops asking for frames when stopped, and starts clean again', () => {
    const { loop, clock, frames } = loopWith(() => 0);
    loop.start();
    loop.start(); // a second start does not double the loop
    expect(clock.pending).toBe(1);
    clock.refresh(HZ60);
    clock.refresh(HZ60);
    loop.stop();
    expect(loop.running).toBe(false);
    expect(clock.pending).toBe(0);
    clock.refresh(HZ60);
    expect(frames).toHaveLength(1);
    loop.start();
    clock.refresh(5_000); // the time spent stopped is not a frame
    clock.refresh(HZ60);
    expect(frames).toHaveLength(2);
    expect(frames[1]).toBeCloseTo(1 / 60, 6);
  });

  it('measures the frame rate and the work inside a frame', () => {
    const { loop, clock } = loopWith(() => 0);
    clock.workMilliseconds = 4;
    loop.start();
    expect(loop.stats.framesPerSecond).toBe(0);
    // Each refresh comes 20 ms after the last frame started: 50 fps, 4 ms of it spent working.
    // The readout averages 30 frames at a time; the second batch is all steady frames.
    for (let refresh = 0; refresh < 70; refresh += 1) clock.refresh(16);
    expect(loop.stats.framesPerSecond).toBeCloseTo(50, 0);
    expect(loop.stats.frameMilliseconds).toBeCloseTo(20, 1);
    expect(loop.stats.workMilliseconds).toBeCloseTo(4, 3);
  });
});

/** Fakes for the three contracts. They record every call, in order. */
function fakes() {
  const calls: string[] = [];
  const seen = {
    audioEvents: [] as GameEvent[][],
    worldEvents: [] as GameEvent[][],
    frames: [] as FrameInfo[],
    poses: [] as CameraPose[],
    models: [] as InterfaceModel[],
    volumes: [] as number[],
    scenes: [] as string[],
    stages: [] as string[],
    sounds: [] as string[],
    renderScales: [] as number[],
  };
  const worldView: WorldView = {
    mount: () => calls.push('world.mount'),
    resize: () => calls.push('world.resize'),
    applyGraphicsSettings: (graphics) => {
      seen.renderScales.push(graphics.renderScale);
    },
    showStage: (stage) => {
      seen.stages.push(stage);
    },
    sync: (_state, frame) => {
      calls.push('world.sync');
      seen.frames.push(frame);
    },
    handleEvents: (events) => {
      calls.push('world.handleEvents');
      seen.worldEvents.push([...events]);
    },
    render: (pose) => {
      calls.push('world.render');
      seen.poses.push(pose);
    },
    dispose: () => calls.push('world.dispose'),
  };
  const gameInterface: GameInterface = {
    mount: () => calls.push('interface.mount'),
    update: (model) => {
      calls.push('interface.update');
      seen.models.push(model);
    },
    dispose: () => calls.push('interface.dispose'),
  };
  const audio: AudioEngine = {
    unlock: async () => {},
    setVolumes: (volumes) => {
      seen.volumes.push(volumes.master);
    },
    handleEvents: (events) => {
      calls.push('audio.handleEvents');
      seen.audioEvents.push([...events]);
    },
    update: () => calls.push('audio.update'),
    playInterface: (sound) => {
      seen.sounds.push(sound);
    },
    setScene: (scene) => {
      seen.scenes.push(scene);
    },
    suspend: () => calls.push('audio.suspend'),
    resume: () => calls.push('audio.resume'),
    dispose: () => calls.push('audio.dispose'),
  };
  return { calls, seen, worldView, gameInterface, audio };
}

function appWith(): { app: App } & ReturnType<typeof fakes> {
  const parts = fakes();
  const app = createApp({
    worldView: parts.worldView, gameInterface: parts.gameInterface, audio: parts.audio,
    storage: new FakeStorage(), now: () => 5_000, randomSeed: () => 42,
  });
  return { app, ...parts };
}

describe('one frame of the app', () => {
  it('calls the three contracts in the documented order', () => {
    const { app, calls } = appWith();
    app.frame(1 / 60);
    expect(calls).toEqual([
      'audio.handleEvents', 'audio.update', 'world.sync', 'world.handleEvents', 'world.render', 'interface.update',
    ]);
  });

  it('drains the events once and hands the same ones to the sound, the world and the toasts', () => {
    const { app, seen } = appWith();
    app.session.newGame(0);
    const game = app.session.game!;
    // The start of a game queues its first event; land to queue more.
    const landing = islandLanding('home_knoll');
    game.canoe.position = { x: landing.shore.x, y: 0, z: landing.shore.z - 2 };
    game.canoe.heading = landing.bearing;
    game.player.position = { ...game.canoe.position };
    app.session.keyDown('KeyE');
    app.frame(1 / 60);

    const events = seen.audioEvents.at(-1)!;
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(['quest_started', 'landed', 'autosave_requested']));
    expect(seen.worldEvents.at(-1)).toEqual(events);
    expect(game.events).toEqual([]); // drained
    const toasts = seen.models.at(-1)!.toasts.map((toast) => toast.text);
    expect(toasts).toEqual(expect.arrayContaining(['New quest: Bail out', 'Ashore on Home Knoll', 'Game saved']));

    // The next frame has nothing left to hand out.
    app.frame(1 / 60);
    expect(seen.audioEvents.at(-1)).toEqual([]);
    expect(seen.worldEvents.at(-1)).toEqual([]);
  });

  it('tells the world view how much time passed, and that it stopped when paused', () => {
    const { app, seen } = appWith();
    app.session.newGame(0);
    app.frame(0.05);
    expect(seen.frames.at(-1)).toMatchObject({ frameSeconds: 0.05, paused: false });
    expect(seen.frames.at(-1)!.simulatedSeconds).toBeCloseTo(0.05, 5);
    app.session.keyDown('Escape');
    app.frame(0.05);
    expect(seen.frames.at(-1)).toMatchObject({ frameSeconds: 0.05, simulatedSeconds: 0, paused: true });
    expect(seen.frames.at(-1)!.elapsedSeconds).toBeCloseTo(0.1, 6);
    expect(seen.models.at(-1)).toMatchObject({ paused: true, panel: { id: 'pause' } });
  });

  it('follows the screen with the stage and the audio scene', () => {
    const { app, seen } = appWith();
    app.frame(1 / 60);
    expect(seen.stages).toEqual(['lobby']);
    expect(seen.scenes).toEqual(['lobby']);
    app.session.newGame(0);
    app.frame(1 / 60);
    app.session.keyDown('Escape');
    app.frame(1 / 60);
    app.session.keyDown('Escape');
    app.frame(1 / 60);
    expect(seen.stages).toEqual(['lobby', 'game']);
    expect(seen.scenes).toEqual(['lobby', 'game', 'paused', 'game']);
    app.session.game!.flags.beacon_lit = true;
    app.session.game!.events.push({ type: 'game_completed' });
    app.frame(1 / 60);
    expect(seen.stages.at(-1)).toBe('credits');
    expect(seen.scenes.at(-1)).toBe('credits');
    app.session.quitToLobby();
    app.frame(1 / 60);
    expect(seen.stages.at(-1)).toBe('lobby');
  });

  it('applies settings to the sound and the world at start and on every change', () => {
    const { app, seen } = appWith();
    expect(seen.volumes).toEqual([0.8]);
    expect(seen.renderScales).toEqual([1]);
    app.session.handleIntent({ type: 'change_setting', setting: 'audio.master', value: 0.2 });
    app.session.handleIntent({ type: 'change_setting', setting: 'graphics.qualityPreset', value: 'low' });
    expect(seen.volumes.at(-1)).toBe(0.2);
    expect(seen.renderScales.at(-1)).toBe(0.75);
    expect(seen.sounds).toEqual(['click', 'click']);
  });

  it('puts the camera behind the canoe and gives the field of view from the settings', () => {
    const { app, seen } = appWith();
    app.session.handleIntent({ type: 'change_setting', setting: 'graphics.fieldOfView', value: 75 });
    app.session.newGame(0);
    app.frame(1 / 60);
    const pose = seen.poses.at(-1)!;
    const canoe = app.session.game!.canoe;
    expect(pose.fieldOfView).toBe(75);
    // The new game starts with the bow pointing south: the camera is to the north of it.
    expect(canoe.heading).toBeCloseTo(Math.PI);
    expect(pose.position.z).toBeLessThan(canoe.position.z - 5);
    expect(app.camera.yaw).toBeCloseTo(Math.PI);
    // Dragging the mouse turns it; a paused game does not swing it back.
    app.session.input.pointerDown();
    app.session.input.pointerMove(200, 0);
    app.frame(1 / 60);
    expect(app.camera.yaw).not.toBeCloseTo(Math.PI);
  });

  it('quiets the sound and pauses when the tab is hidden', () => {
    const { app, calls } = appWith();
    app.session.newGame(0);
    app.setHidden(true);
    expect(app.session.paused).toBe(true);
    app.setHidden(false);
    expect(calls.filter((call) => call === 'audio.suspend' || call === 'audio.resume')).toEqual(['audio.suspend', 'audio.resume']);
  });

  it('shows the frame-rate readout only when asked', () => {
    const parts = fakes();
    const app = createApp({
      worldView: parts.worldView, gameInterface: parts.gameInterface, audio: parts.audio, storage: new FakeStorage(),
      stats: () => ({ framesPerSecond: 59.6, frameMilliseconds: 16.78, workMilliseconds: 1.23 }),
    });
    app.frame(1 / 60);
    expect(parts.seen.models.at(-1)!.debug).toBeNull();
    app.session.handleIntent({ type: 'change_setting', setting: 'graphics.showFps', value: true });
    app.frame(1 / 60);
    expect(parts.seen.models.at(-1)!.debug).toEqual({
      showFrameRate: true, framesPerSecond: 60, frameMilliseconds: 16.8, workMilliseconds: 1.2, lines: [],
    });
  });
});

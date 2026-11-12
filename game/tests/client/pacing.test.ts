/**
 * Pacing on made-up screens: the real loop and the real app (the session, the rules, the camera)
 * on a clock the test owns, with the canoe being paddled. For every screen rate it counts the
 * frames drawn a second, the rules steps in each drawn frame, how the canoe moves against the
 * camera from one drawn frame to the next, and the gap each frame was told it was meant to have.
 */
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/client/app.ts';
import type { App } from '../../src/client/app.ts';
import { createSilentAudio } from '../../src/client/contracts.ts';
import type { CameraPose, FrameInfo, WorldView } from '../../src/client/contracts.ts';
import { stageShot } from '../../src/client/debug/staging.ts';
import { SCREEN_WATCH_FRAMES, ScreenMeter, createFrameLoop } from '../../src/client/loop.ts';
import type { FrameLoop } from '../../src/client/loop.ts';
import type { GameState } from '../../src/sim/index.ts';
import { FakeStorage } from '../support.ts';

/** A small seeded generator, so runs repeat. */
function seeded(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

/** One drawn frame, as the look was handed it. */
interface Drawn {
  /** When the display frame it was drawn in came, milliseconds. */
  at: number;
  frame: FrameInfo;
  /** The gap the loop said this frame was meant to have, seconds. */
  due: number;
  /** Rules steps since the last drawn frame. */
  steps: number;
  /** Metres the canoe moved since the last drawn frame. */
  canoeMoved: number;
  /** Metres the camera's look-at point moved since the last drawn frame. */
  cameraMoved: number;
  /** Metres from the camera's look-at point to the canoe, over the ground. */
  lag: number;
}

interface ScreenRun {
  app: App;
  loop: FrameLoop;
  drawn: Drawn[];
  /** Run the made-up screen for this many seconds. */
  run(seconds: number): void;
  /** Milliseconds the next display frames each take to draw: a busy chip misses the display frames inside that. */
  cost: number;
}

/**
 * A made-up screen of `hertz` display frames a second, each a touch early or late (`jitter` ms
 * either way), running the real loop and the real app. `scene` is 'play' (afloat, paddling),
 * 'lobby', or 'paused'.
 */
function onScreen(hertz: number, cap: number, scene: 'play' | 'lobby' | 'paused' = 'play', jitter = 0.3, cost = 0): ScreenRun {
  const drawn: Drawn[] = [];
  let state: GameState | null = null;
  let info: FrameInfo | null = null;
  let last: { tick: number; x: number; z: number; pose: CameraPose } | null = null;
  let now = 0;
  const worldView: WorldView = {
    mount: () => {}, resize: () => {}, applyGraphicsSettings: () => {}, showStage: () => {},
    sync: (syncedState, frame) => {
      state = syncedState;
      info = frame;
    },
    handleEvents: () => {},
    render: (pose) => {
      const game = state!;
      const { x, z } = game.canoe.position;
      if (last) {
        drawn.push({
          at: now,
          frame: info!,
          due,
          steps: game.tick - last.tick,
          canoeMoved: Math.hypot(x - last.x, z - last.z),
          cameraMoved: Math.hypot(pose.target.x - last.pose.target.x, pose.target.y - last.pose.target.y, pose.target.z - last.pose.target.z),
          lag: Math.hypot(x - pose.target.x, z - pose.target.z),
        });
      }
      last = { tick: game.tick, x, z, pose };
    },
    dispose: () => {},
  };
  const app = createApp({
    worldView,
    gameInterface: { mount: () => {}, update: () => {}, dispose: () => {} },
    audio: createSilentAudio(),
    storage: new FakeStorage(), now: () => 5_000, randomSeed: () => 42,
  });
  const session = app.session;
  session.updateSettings({ ...session.settings, graphics: { ...session.settings.graphics, fpsCap: cap } });
  if (scene !== 'lobby') {
    session.adoptGame(stageShot('play').state!);
    session.keyDown('KeyW');
    if (scene === 'paused') session.keyDown('Escape');
  }

  let pending: ((timestamp: number) => void) | null = null;
  let frames = 0;
  let due = 0;
  const loop = createFrameLoop({
    clock: {
      requestFrame: (callback) => {
        pending = callback;
        return 1;
      },
      cancelFrame: () => {
        pending = null;
      },
      now: () => now,
    },
    frame: (frameSeconds, dueSeconds) => {
      frames += 1;
      due = dueSeconds;
      app.frame(frameSeconds);
    },
    frameRateCap: () => session.settings.graphics.fpsCap,
  });
  const random = seeded(7);
  const period = 1000 / hertz;
  let display = 0;
  let busyUntil = 0;
  const result: ScreenRun = {
    app, loop, drawn, cost,
    run(seconds: number): void {
      const until = display + Math.round(seconds * hertz);
      for (; display < until; display += 1) {
        now = display * period + (random() * 2 - 1) * jitter;
        // A chip still drawing the last frame misses this display frame.
        if (now < busyUntil - 0.5) continue;
        const before = frames;
        const callback = pending;
        pending = null;
        callback?.(now);
        if (frames > before) busyUntil = now + result.cost;
      }
    },
  };
  loop.start();
  // The loop watches the screen first; then a second for the canoe and the camera to settle into their stride.
  result.run((SCREEN_WATCH_FRAMES + 2) / hertz + 1);
  drawn.length = 0;
  return result;
}

const share = (frames: Drawn[], test: (frame: Drawn) => boolean): number => frames.filter(test).length / frames.length;
const MOVED = 1e-9;

const RATES = [30, 60, 75, 90, 120, 144, 165];

describe('pacing on the default 60 cap, a fast chip', () => {
  for (const hertz of RATES) {
    const expected = Math.min(60, hertz);
    it(`${hertz} Hz screen: ${expected} frames a second, ${60 / expected} rules step${expected === 60 ? '' : 's'} in every one`, () => {
      const screen = onScreen(hertz, 60);
      screen.run(8);
      const { drawn } = screen;
      // Never fewer frames than the lower of 60 and the screen's rate.
      expect(drawn.length / 8).toBeGreaterThan(expected - 0.5);
      expect(drawn.length / 8).toBeLessThan(expected + 0.5);
      // The same number of rules steps in every drawn frame: the world moves evenly.
      expect(share(drawn, (frame) => frame.steps === 60 / expected)).toBe(1);
      // The canoe is under way, and the camera and the canoe move in the same frames.
      expect(share(drawn, (frame) => frame.canoeMoved > MOVED && frame.cameraMoved > MOVED)).toBe(1);
      // The camera holds its place behind the canoe: the gap between them does not twitch from frame to frame.
      const lagChanges = drawn.slice(1).map((frame, index) => Math.abs(frame.lag - drawn[index]!.lag));
      expect(Math.max(...lagChanges)).toBeLessThan(0.002);
      // Every frame is told the gap it was meant to have.
      for (const frame of drawn) expect(frame.due).toBeCloseTo(1 / expected, 4);
      // Each frame is shown on the display frame nearest its beat: never more than a display frame late.
      const gaps = drawn.slice(1).map((frame, index) => frame.at - drawn[index]!.at);
      expect(Math.max(...gaps)).toBeLessThan(1000 / expected + 1000 / hertz + 1);
    });
  }

  it('a 60 Hz screen is as before: every display frame is a frame of one sixtieth, with one rules step', () => {
    const screen = onScreen(60, 60, 'play', 0);
    screen.run(5);
    expect(screen.drawn).toHaveLength(300);
    for (const frame of screen.drawn) {
      expect(frame.steps).toBe(1);
      expect(frame.frame.frameSeconds).toBe(1 / 60);
      expect(frame.frame.simulatedSeconds).toBeCloseTo(1 / 60, 9);
    }
  });

  it('the lobby keeps the same beat: its circling camera and its drifting canoe move in the same frames', () => {
    for (const hertz of [60, 75, 144]) {
      const screen = onScreen(hertz, 60, 'lobby');
      screen.run(5);
      expect(screen.drawn.length / 5).toBeCloseTo(60, 0);
      expect(share(screen.drawn, (frame) => frame.steps === 1 && frame.cameraMoved > MOVED)).toBe(1);
    }
  });
});

describe('pacing with the cap off or changed', () => {
  it('no cap: every display frame is drawn, and a frame with no rules step moves neither the canoe nor the camera', () => {
    for (const hertz of [75, 144, 165]) {
      const screen = onScreen(hertz, 0);
      screen.run(4);
      const { drawn } = screen;
      expect(drawn.length / 4).toBeCloseTo(hertz, 0);
      const still = drawn.filter((frame) => frame.steps === 0);
      expect(still.length / drawn.length).toBeCloseTo(1 - 60 / hertz, 1);
      expect(share(still, (frame) => frame.canoeMoved === 0 && frame.cameraMoved === 0)).toBe(1);
      expect(share(drawn.filter((frame) => frame.steps > 0), (frame) => frame.canoeMoved > MOVED && frame.cameraMoved > MOVED)).toBe(1);
      for (const frame of drawn) expect(frame.due).toBeCloseTo(1 / hertz, 4);
    }
  });

  it('no cap, in the lobby: the circling camera waits for the backdrop too', () => {
    const screen = onScreen(144, 0, 'lobby');
    screen.run(5);
    const still = screen.drawn.filter((frame) => frame.steps === 0);
    expect(still.length).toBeGreaterThan(300);
    expect(share(still, (frame) => frame.cameraMoved === 0)).toBe(1);
    expect(share(screen.drawn.filter((frame) => frame.steps > 0), (frame) => frame.cameraMoved > MOVED)).toBe(1);
  });

  it('a 30 cap: 30 frames a second with two rules steps each, on every screen', () => {
    for (const hertz of RATES) {
      const screen = onScreen(hertz, 30);
      screen.run(4);
      expect(screen.drawn.length / 4).toBeCloseTo(30, 0);
      expect(share(screen.drawn, (frame) => frame.steps === 2)).toBe(1);
      for (const frame of screen.drawn) expect(frame.due).toBeCloseTo(1 / 30, 4);
    }
  });

  it('a cap above the screen is the screen: a 144 cap on a 60 Hz screen draws 60, one step each', () => {
    const screen = onScreen(60, 144);
    screen.run(5);
    expect(screen.drawn.length / 5).toBeCloseTo(60, 0);
    expect(share(screen.drawn, (frame) => frame.steps === 1)).toBe(1);
    for (const frame of screen.drawn) expect(frame.due).toBeCloseTo(1 / 60, 4);
  });

  it('caps above 60 on a fast screen: the cap is held, and the frames with no step stand still', () => {
    for (const [hertz, cap] of [[144, 90], [165, 90], [240, 120]] as const) {
      const screen = onScreen(hertz, cap);
      screen.run(4);
      expect(screen.drawn.length / 4).toBeCloseTo(cap, 0);
      const still = screen.drawn.filter((frame) => frame.steps === 0);
      expect(share(still, (frame) => frame.canoeMoved === 0 && frame.cameraMoved === 0)).toBe(1);
      for (const frame of screen.drawn) expect(frame.due).toBeCloseTo(1 / cap, 4);
    }
  });
});

describe('pause, and time kept', () => {
  it('a paused game still gets its frames, steps nothing, and the mouse still turns the camera', () => {
    for (const hertz of [60, 144]) {
      const screen = onScreen(hertz, 60, 'paused');
      screen.run(2);
      expect(screen.drawn.length / 2).toBeCloseTo(60, 0);
      expect(share(screen.drawn, (frame) => frame.steps === 0 && frame.canoeMoved === 0 && frame.frame.paused)).toBe(1);
      const yaw = screen.app.camera.yaw;
      screen.app.session.input.pointerDown();
      screen.app.session.input.pointerMove(120, 0);
      screen.run(0.1);
      expect(screen.app.camera.yaw).not.toBeCloseTo(yaw, 3);
    }
  });

  it('no time is lost or made: the rules run 60 steps for every second of the screen, at every rate and cap', () => {
    for (const hertz of RATES) {
      for (const cap of [60, 0, 30, 90]) {
        const screen = onScreen(hertz, cap);
        screen.run(5);
        const steps = screen.drawn.reduce((sum, frame) => sum + frame.steps, 0);
        expect(Math.abs(steps - 300)).toBeLessThanOrEqual(3);
      }
    }
  });

  it('a chip too slow for the cap falls back to whole steps, and the frames say so', () => {
    // A 144 Hz screen and a chip that needs 25 ms a frame: 40 frames a second at best.
    const screen = onScreen(144, 60, 'play', 0.3, 25);
    screen.run(5);
    const { drawn } = screen;
    expect(drawn.length / 5).toBeGreaterThan(34);
    expect(drawn.length / 5).toBeLessThan(42);
    const steps = drawn.reduce((sum, frame) => sum + frame.steps, 0);
    expect(Math.abs(steps - 300)).toBeLessThanOrEqual(3);
    // The time a frame stands for is whole sixtieths, the camera moves with the canoe in every one...
    expect(share(drawn, (frame) => frame.steps >= 1 && frame.canoeMoved > MOVED && frame.cameraMoved > MOVED)).toBe(1);
    // ...and the look can see the frames run long: on average they stand for more than they were meant to.
    const mean = drawn.reduce((sum, frame) => sum + frame.frame.frameSeconds, 0) / drawn.length;
    expect(mean).toBeGreaterThan((1 / 60) * 1.4);
    for (const frame of drawn) expect(frame.due).toBeCloseTo(1 / 60, 4);
  });
});

describe('measuring the screen', () => {
  /** Feed a meter `count` display-frame gaps from `gapAt`. */
  const feed = (meter: ScreenMeter, count: number, gapAt: (index: number) => number): void => {
    for (let index = 0; index < count; index += 1) meter.note(gapAt(index));
  };

  it('reads every rate from its display frames, jitter and all', () => {
    for (const hertz of [24, 30, 48, 50, 60, 75, 90, 100, 120, 144, 165, 240]) {
      const random = seeded(hertz);
      const meter = new ScreenMeter();
      expect(meter.watching).toBe(true);
      feed(meter, 200, () => 1000 / hertz + (random() * 2 - 1) * 0.3);
      expect(meter.watching).toBe(false);
      expect(Math.abs(1000 / meter.milliseconds - hertz) / hertz).toBeLessThan(0.01);
    }
  });

  it('reads timestamps rounded to the millisecond, as some browsers hand them out', () => {
    for (const hertz of [60, 75, 144, 240]) {
      const meter = new ScreenMeter();
      let time = 0;
      let last = 0;
      feed(meter, 200, () => {
        time += 1000 / hertz;
        const gap = Math.round(time) - last;
        last = Math.round(time);
        return gap;
      });
      expect(Math.abs(1000 / meter.milliseconds - hertz) / hertz).toBeLessThan(0.03);
    }
  });

  it('a busy frame does not read as a slower screen', () => {
    // One display frame in five missed, then two in three, then every other one for good.
    for (const hertz of [60, 144]) {
      const period = 1000 / hertz;
      const meter = new ScreenMeter();
      feed(meter, SCREEN_WATCH_FRAMES, () => period);
      feed(meter, 300, (index) => (index % 5 === 0 ? period * 2 : period));
      expect(meter.milliseconds).toBeCloseTo(period, 3);
      feed(meter, 300, (index) => (index % 3 === 0 ? period : period * 2));
      expect(meter.milliseconds).toBeCloseTo(period, 3);
      feed(meter, 600, () => period * 2);
      expect(meter.milliseconds).toBeCloseTo(period, 3);
      feed(meter, 600, () => period * 3);
      expect(meter.milliseconds).toBeCloseTo(period, 3);
    }
  });

  it('a stall or a hidden tab is not a display frame', () => {
    const meter = new ScreenMeter();
    feed(meter, 30, () => 1000 / 60);
    feed(meter, 80, () => 400);
    meter.note(30_000);
    meter.note(0);
    expect(meter.milliseconds).toBeCloseTo(1000 / 60, 6);
  });

  it('a first reading taken while the page was busy is put right by the first clean frames', () => {
    const meter = new ScreenMeter();
    feed(meter, SCREEN_WATCH_FRAMES, () => 1000 / 30);
    expect(meter.milliseconds).toBeCloseTo(1000 / 30, 6);
    feed(meter, 60, () => 1000 / 60);
    expect(meter.milliseconds).toBeCloseTo(1000 / 60, 6);
  });

  it('follows the window to a faster screen', () => {
    const meter = new ScreenMeter();
    feed(meter, 100, () => 1000 / 60);
    feed(meter, 100, () => 1000 / 144);
    expect(meter.milliseconds).toBeCloseTo(1000 / 144, 6);
  });

  it('in the loop: a slow chip from the very first frame still reads the screen, and the frames are told its gap', () => {
    // A 60 Hz screen, no cap, a chip that needs 40 ms a frame: every drawn frame is three display frames long.
    const screen = onScreen(60, 0, 'play', 0.3, 40);
    screen.run(5);
    expect(screen.drawn.length / 5).toBeCloseTo(20, 0);
    expect(screen.loop.screenMilliseconds).toBeCloseTo(1000 / 60, 1);
    for (const frame of screen.drawn) {
      expect(frame.due).toBeCloseTo(1 / 60, 3);
      expect(frame.frame.frameSeconds).toBeCloseTo(0.05, 2);
    }
  });
});

/**
 * The quality ladder and the drawing size: full size at render scale 1, and
 * cost is shed in B2's order, resolution last and never under half. The canvas
 * (and so the heroes) stays the window's own size whatever the world is drawn
 * at. The ladder starts on the rung that fits, finds its level in seconds,
 * judges a frame against the gap it was meant to have, climbs back, and never pumps.
 */
import { describe, expect, it } from 'vitest';
import { createDefaultSettings } from '../../src/settings/index.ts';
import { createFrameLoop } from '../../src/client/loop.ts';
import {
  ASK_AGAIN_SECONDS, CLIMB_AFTER_SECONDS, DOWN_AGAIN_SECONDS, FAILS_ALLOWED, FINDING_SECONDS, FrameLadder, LADDER, LADDER_REST_SECONDS, PIXEL_BUDGET, WARM_UP_SECONDS,
  WINDOW_PIXEL_LIMIT, WORLD_FLOOR, climbTo, drawingPixelRatio, fitMilliseconds, fittingRung, qualityAt, qualityCeiling, shedNote, topFitMilliseconds,
  windowPixelRatio,
} from '../../src/look/quality.ts';

const graphics = createDefaultSettings().graphics;
const LAST = LADDER.length - 1;

describe('drawing size', () => {
  it('draws the screen at full size at render scale 1', () => {
    for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]]) expect(drawingPixelRatio(width, height, 1, 1, 1)).toBe(1);
  });

  it('draws a dense screen above 1x while it fits the pixel budget', () => {
    expect(drawingPixelRatio(1728, 1117, 2, 1, 1)).toBe(2);
    const ratio = drawingPixelRatio(2560, 1440, 2, 1, 1);
    expect(ratio).toBeGreaterThan(1);
    expect(2560 * 1440 * ratio * ratio).toBeLessThanOrEqual(PIXEL_BUDGET * 1.0001);
  });

  it('follows the render scale setting', () => {
    expect(drawingPixelRatio(1920, 1080, 1, 0.5, 1)).toBe(0.5);
    expect(drawingPixelRatio(1920, 1080, 1, 1.5, 1)).toBe(1.5);
  });

  it('never goes under half size by the ladder\'s doing: at 40% the land\'s lines break up', () => {
    // Half, written out: the diagnosis's finding, not whatever the constant happens to say.
    expect(WORLD_FLOOR).toBe(0.5);
    const resolutionAt = (rung: number): number => qualityAt(qualityCeiling(graphics), rung).resolution;
    expect(drawingPixelRatio(1920, 1080, 1, 1, resolutionAt(LAST))).toBe(0.5);
    for (let rung = 0; rung <= LAST; rung += 1) {
      for (const renderScale of [0.75, 1, 1.5]) expect(drawingPixelRatio(1920, 1080, 1, renderScale, resolutionAt(rung))).toBeGreaterThanOrEqual(0.5);
      // Only the player's own render scale goes lower, and then the ladder takes nothing more.
      expect(drawingPixelRatio(1920, 1080, 1, 0.5, resolutionAt(rung))).toBe(0.5);
    }
    // The Low preset's 0.75: rung 9 is 54% as it was, and the two new rungs stop at half.
    expect(drawingPixelRatio(1920, 1080, 1, 0.75, resolutionAt(9))).toBeCloseTo(0.54, 10);
    expect(drawingPixelRatio(1920, 1080, 1, 0.75, resolutionAt(10))).toBe(0.5);
    // A rung above the floor is exactly what it was.
    for (let rung = 0; rung <= 9; rung += 1) expect(drawingPixelRatio(2560, 1440, 2, 1, resolutionAt(rung))).toBe(Math.min(2, Math.sqrt(PIXEL_BUDGET / (2560 * 1440))) * 1 * resolutionAt(rung));
  });
});

describe('window size (the heroes)', () => {
  it('is the window\'s own pixels, past the pixel budget too', () => {
    for (const [width, height] of [[1920, 1080], [3840, 2160], [5120, 2160], [7680, 4320]]) expect(windowPixelRatio(width, height, 1)).toBe(1);
    // Luc's screen: the world is drawn smaller than the window, the canvas is not.
    expect(drawingPixelRatio(5120, 2160, 1, 1, 1)).toBeLessThan(1);
    expect(5120 * 2160).toBeGreaterThan(PIXEL_BUDGET);
    expect(5120 * 2160).toBeLessThan(WINDOW_PIXEL_LIMIT);
  });

  it('is the dense screen\'s own pixels, up to 2x', () => {
    expect(windowPixelRatio(1728, 1117, 2)).toBe(2);
    expect(windowPixelRatio(2560, 1440, 2)).toBe(2);
    expect(windowPixelRatio(1920, 1080, 3)).toBe(2);
  });

  it('is never touched by the render scale or the ladder: neither is an input', () => {
    expect(windowPixelRatio.length).toBe(3);
    for (const rung of [0, LAST]) expect(drawingPixelRatio(1920, 1080, 1, 1, qualityAt(qualityCeiling(graphics), rung).resolution)).toBeLessThanOrEqual(windowPixelRatio(1920, 1080, 1));
  });
});

/**
 * Run the ladder for `seconds` on a machine whose frame time depends on the rung. Returns the seconds at each change.
 * `due`: the gap each frame was meant to have. `costAt`: the chip test's reading of a rung in milliseconds, to answer a ladder that asks.
 */
function run(
  ladder: FrameLadder, seconds: number, frameSecondsAt: (rung: number, time: number) => number, from = 0,
  more: { due?: number; costAt?: (rung: number, time: number) => number; asked?: number[] } = {},
): number[] {
  const changes: number[] = [];
  let time = from;
  while (time < from + seconds) {
    const frame = frameSecondsAt(ladder.rung, time);
    time += frame;
    let changed = ladder.note(frame, more.due);
    if (ladder.asking !== null && more.costAt) {
      const costAt = more.costAt;
      more.asked?.push(ladder.asking);
      changed = ladder.answer(climbTo(ladder.asking, ladder.bestAllowed, (rung) => costAt(rung, time), fitMilliseconds(more.due)));
    }
    if (changed) changes.push(time);
  }
  return changes;
}
const QUICK = 1 / 60;
const LONG = 1 / 40;
const moves = (ladder: FrameLadder): string[] => ladder.changes.map((change) => `${change.from}>${change.to}`);
const ups = (ladder: FrameLadder): number => ladder.changes.filter((change) => change.to < change.from).length;
/** Climbs that did not hold: the ladder went up to a rung and its next change was back down. What a player sees as a flip. */
const failedTries = (ladder: FrameLadder): number => ladder.changes.filter((change, index) => change.to < change.from && (ladder.changes[index + 1]?.to ?? 0) > change.to).length;

/** The diagnosis's costs: a 1920×1080 frame afloat on this Mac, milliseconds by rung (`perf-why/raw/02-costs-*`). */
const AFLOAT = [5.86, 5.82, 5.66, 5.6, 5.31, 4.92, 4.64, 4.01, 3.44, 3.06, 2.61, 2.22];
/** A chip `factor` times slower than this Mac on a 60 Hz screen: on time while a frame fits the gap, else at its own rate. */
const chip = (factor: number) => ({
  frame: (rung: number): number => Math.max(QUICK, (AFLOAT[rung] * factor) / 1000),
  cost: (rung: number): number => AFLOAT[rung] * factor,
});

describe('quality ladder', () => {
  it('sheds the weather\'s fine work first, then reflections, and resolution last, down to half and no further', () => {
    const shedOrder = LADDER.slice(1).map((rung) => Object.keys(rung)[0]);
    expect(shedOrder).toEqual(['weather', 'reflection', 'reflection', 'fine', 'ink', 'ink', 'resolution', 'resolution', 'resolution', 'resolution', 'resolution']);
    const ceiling = qualityCeiling(graphics);
    // The first rung sheds weather detail and nothing else of the world.
    expect(qualityAt(ceiling, 1)).toEqual({ ...ceiling, weather: 0 });
    expect(shedNote(ceiling, qualityAt(ceiling, 1))).toBe('shed: weather detail off');
    for (let rung = 0; rung <= 6; rung += 1) expect(qualityAt(ceiling, rung).resolution).toBe(1);
    expect(qualityAt(ceiling, 7).resolution).toBeLessThan(1);
    expect(qualityAt(ceiling, 2).reflection).toBeLessThan(ceiling.reflection);
    // The rungs that were there are what they were; two more under them, 60% and 50%.
    expect([7, 8, 9, 10, 11].map((rung) => qualityAt(ceiling, rung).resolution)).toEqual([0.9, 0.8, 0.72, 0.6, 0.5]);
    expect(LAST).toBe(11);
    expect(Math.min(...LADDER.map((rung) => rung.resolution ?? 1))).toBe(0.5);
  });

  it('never raises anything above the settings', () => {
    const low = qualityCeiling({ ...graphics, qualityPreset: 'low', waterDetail: 'low', shadows: 'off' });
    expect(low.reflection).toBe(0);
    expect(low.fine).toBe(0);
    for (let rung = 0; rung < LADDER.length; rung += 1) {
      const quality = qualityAt(low, rung);
      expect(quality.reflection).toBe(0);
      expect(quality.ink).toBeLessThanOrEqual(low.ink);
    }
  });

  it('starts from B2 at the default settings', () => {
    expect(qualityCeiling(graphics)).toEqual({ weather: 1, reflection: 0.75, fine: 1, ink: 2, resolution: 1 });
    expect(shedNote(qualityCeiling(graphics), qualityAt(qualityCeiling(graphics), 0))).toBe('nothing shed');
    expect(shedNote(qualityCeiling(graphics), qualityAt(qualityCeiling(graphics), 8))).toContain('resolution 80%');
    expect(shedNote(qualityCeiling(graphics), qualityAt(qualityCeiling(graphics), LAST))).toContain('resolution 50%');
  });

  it('warms up for three seconds by the clock, whatever the frame rate, then steps down after two seconds of long frames', () => {
    // 9 frames a second is a chip 16 times slower: 180 frames of warm-up was 20 seconds there.
    for (const frameSeconds of [1 / 9, 1 / 25, 1 / 40, 1 / 50]) {
      const ladder = new FrameLadder();
      const [first] = run(ladder, 30, () => frameSeconds);
      expect(first).toBeGreaterThan(3);
      expect(first).toBeLessThan(5.5);
    }
    expect(WARM_UP_SECONDS).toBe(3);
    // Nothing in the warm-up counts, however slow.
    const ladder = new FrameLadder();
    expect(run(ladder, 3, () => 0.2)).toEqual([]);
    expect(run(ladder, 30, () => QUICK, 3)).toEqual([]);
  });

  it('holds still on good frames, and when pinned', () => {
    const steady = new FrameLadder();
    for (let frame = 0; frame < 2000; frame += 1) steady.note(1 / 60);
    expect(steady.rung).toBe(0);
    const pinned = new FrameLadder({ hold: true, startRung: 3 });
    for (let frame = 0; frame < 2000; frame += 1) pinned.note(0.05);
    expect(pinned.rung).toBe(3);
    pinned.startOn(7);
    expect(pinned.rung).toBe(3);
  });

  it('climbs back one rung at a time once frames are quick again', () => {
    const ladder = new FrameLadder();
    // A slow spell: 25 seconds of 40 frames a second, then quick for good.
    const changes = run(ladder, 250, (_rung, time) => (time < 25 ? LONG : QUICK));
    const down = ladder.changes.filter((change) => change.to > change.from);
    const up = ladder.changes.filter((change) => change.to < change.from);
    expect(down.length).toBeGreaterThanOrEqual(2);
    expect(up.length).toBe(down.length);
    for (const change of up) expect(change.from - change.to).toBe(1);
    expect(ladder.rung).toBe(0);
    expect(changes.length).toBe(ladder.changes.length);
  });

  it('changes ten seconds apart, except on the way down to its first level: those are two seconds apart and all go down', () => {
    for (const frameSecondsAt of [
      (_rung: number, time: number) => (time < 25 ? LONG : QUICK),
      (rung: number) => (rung < 3 ? 1 / 15 : QUICK),
      (rung: number, time: number) => (rung < 2 || Math.floor(time / 7) % 2 === 0 ? LONG : QUICK),
      (rung: number) => (rung < 9 ? 1 / 22 : QUICK),
    ]) {
      const ladder = new FrameLadder();
      run(ladder, 400, frameSecondsAt);
      expect(ladder.changes.length).toBeGreaterThan(1);
      const firstUp = ladder.changes.findIndex((change) => change.to < change.from);
      for (let index = 1; index < ladder.changes.length; index += 1) {
        const gap = ladder.changes[index].at - ladder.changes[index - 1].at;
        // Two and ten, written out: Luc's rule, not whatever the constants happen to say.
        if (firstUp < 0 || index < firstUp) expect(gap).toBeGreaterThanOrEqual(2);
        else expect(gap).toBeGreaterThanOrEqual(10);
      }
    }
    expect(DOWN_AGAIN_SECONDS).toBeGreaterThanOrEqual(2);
    expect(LADDER_REST_SECONDS).toBeGreaterThanOrEqual(10);
    expect(CLIMB_AFTER_SECONDS).toBeGreaterThanOrEqual(10);
  });

  it('finds its level in seconds: a slow chip is on its rung quickly, with every change downward', () => {
    // No chip test here (`&chiptest=0`): an 8 times slower chip, from the top.
    const slow = chip(8);
    const ladder = new FrameLadder();
    run(ladder, 300, slow.frame);
    expect(ladder.rung).toBe(LAST);
    expect(ups(ladder)).toBe(0);
    expect(ladder.changes[ladder.changes.length - 1].at).toBeLessThan(20);
  });

  it('once a rung has held ten seconds, a slow spell costs one change in ten seconds, not a run of them', () => {
    const ladder = new FrameLadder();
    run(ladder, 30, () => QUICK);
    run(ladder, 9, () => LONG, 30);
    expect(ladder.changes.length).toBe(1);
    // And when a game begins (the lobby was lighter work), it may find its level quickly again.
    const lobby = new FrameLadder();
    run(lobby, 30, () => QUICK);
    lobby.find();
    run(lobby, 9, () => LONG, 30);
    expect(lobby.changes.length).toBeGreaterThanOrEqual(3);
    expect(ups(lobby)).toBe(0);
  });

  it('quick steps down end after thirty seconds, even on a chip whose frames are never good for ten seconds running', () => {
    // A shared chip: three seconds of long frames in every eight, on every rung. It never has ten good seconds.
    const ladder = new FrameLadder();
    run(ladder, 300, (_rung, time) => (time % 8 < 3 ? LONG : QUICK));
    expect(ladder.changes.length).toBeGreaterThan(4);
    expect(ups(ladder)).toBe(0);
    for (let index = 1; index < ladder.changes.length; index += 1) {
      // Thirty and ten, written out.
      if (ladder.changes[index].at > 30) expect(ladder.changes[index].at - ladder.changes[index - 1].at).toBeGreaterThanOrEqual(10);
    }
    expect(FINDING_SECONDS).toBe(30);
    // And a new game gives it thirty more, no longer.
    const again = new FrameLadder();
    run(again, 60, () => QUICK);
    again.find();
    run(again, 300, (_rung, time) => (time % 8 < 3 ? LONG : QUICK), 60);
    const late = again.changes.filter((change) => change.at > 60 + 30);
    expect(late.length).toBeGreaterThan(1);
    for (const change of late) expect(change.at - again.changes[again.changes.indexOf(change) - 1].at).toBeGreaterThanOrEqual(10);
  });

  it('does not pump: a rung that runs long twice is left alone for the session', () => {
    // This machine cannot hold rung 0 and is fine on rung 1.
    const ladder = new FrameLadder();
    run(ladder, 3600, (rung) => (rung === 0 ? LONG : QUICK));
    expect(moves(ladder)).toEqual(['0>1', '1>0', '0>1']);
    expect(ladder.changes.filter((change) => change.from === 0).length).toBe(FAILS_ALLOWED);
    expect(ladder.rung).toBe(1);
    expect(ladder.bestAllowed).toBe(1);
    // A settings change gives every rung a fresh start.
    ladder.reset();
    expect(ladder.bestAllowed).toBe(0);
    expect(ladder.rung).toBe(0);
  });

  it('gives a rung one try: one that runs long straight after the climb to it is out, and the ladder goes back one rung', () => {
    // Rungs 0 to 2 run at 15 a second, so the first drop skips rungs 1 and 2. The old rule then tried rung 2 twice and fell past rung 3 each time.
    const ladder = new FrameLadder();
    run(ladder, 3600, (rung) => (rung < 3 ? 1 / 15 : QUICK));
    expect(moves(ladder)).toEqual(['0>3', '3>2', '2>3']);
    expect(ladder.bestAllowed).toBe(3);
    expect(failedTries(ladder)).toBe(1);
  });

  it('settles: on any machine the changes stop, and no rung is climbed to and dropped more than once', () => {
    for (const holds of [0, 1, 4, 8, LAST]) {
      for (const slow of [1 / 50, 1 / 24, 1 / 12]) {
        const ladder = new FrameLadder();
        run(ladder, 3600, (rung) => (rung < holds ? slow : QUICK));
        const settledBy = ladder.changes.length > 0 ? ladder.changes[ladder.changes.length - 1].at : 0;
        expect(ladder.rung).toBe(holds);
        expect(settledBy).toBeLessThan(120);
        // One failed try in the whole session: the rung above the one that holds. (A big drop may overshoot; climbing back from that holds.)
        expect(failedTries(ladder)).toBeLessThanOrEqual(1);
        expect(ladder.changes.length).toBeLessThanOrEqual(LAST + 2);
        for (let rung = 0; rung < LADDER.length; rung += 1) {
          expect(ladder.changes.filter((change) => change.from === rung && change.to > rung).length).toBeLessThanOrEqual(FAILS_ALLOWED);
        }
      }
    }
  });

  it('drops further in one change when badly behind', () => {
    const behind = new FrameLadder();
    run(behind, 5, () => 1 / 15);
    expect(behind.changes.length).toBe(1);
    expect(behind.rung).toBe(3);
    const nearly = new FrameLadder();
    run(nearly, 6.5, () => 1 / 42);
    expect(nearly.rung).toBe(1);
  });

  it('reads nothing into a stall: a hidden tab or a hitch is not a slow frame', () => {
    const ladder = new FrameLadder();
    run(ladder, 5, () => QUICK);
    for (let stall = 0; stall < 40; stall += 1) ladder.note(2);
    // The loop hands on a quarter second at most: that is a stall too.
    for (let stall = 0; stall < 40; stall += 1) ladder.note(0.25);
    run(ladder, 5, () => QUICK);
    expect(ladder.rung).toBe(0);
    expect(ladder.changes.length).toBe(0);
  });
});

describe('the gap a frame was meant to have (dueSeconds)', () => {
  it('on a 60 Hz screen a chip that holds only 50 steps down instead of settling there', () => {
    const fifty = new FrameLadder();
    run(fifty, 60, (rung) => (rung === 0 ? 1 / 50 : QUICK), 0, { due: 1 / 60 });
    expect(fifty.rung).toBeGreaterThan(0);
    // Long is past 17.5 ms: one frame in twenty shown twice. 57.5 a second holds, 56 does not.
    const holds = new FrameLadder();
    run(holds, 60, () => 1 / 57.5, 0, { due: 1 / 60 });
    expect(holds.changes.length).toBe(0);
    const slips = new FrameLadder();
    run(slips, 60, (rung) => (rung === 0 ? 1 / 56 : QUICK), 0, { due: 1 / 60 });
    expect(slips.rung).toBeGreaterThan(0);
  });

  it('a fast chip keeps rung 0 on 30, 75, 90 and 144 Hz screens, with and without the 60 cap', () => {
    // [screen Hz, frames a second the cap asks for (0 = every display frame), frames a second the loop then draws]
    for (const [hertz, cap, rate] of [
      [30, 60, 30], [30, 0, 30], [60, 60, 60], [60, 30, 30], [75, 60, 60], [75, 0, 75], [90, 60, 60], [90, 0, 90], [120, 60, 60], [144, 60, 60], [144, 0, 144],
      [144, 90, 90], [165, 60, 60],
    ] as const) {
      // The game's own loop on a made-up screen: the chip is instant, so every gap is the screen's and the cap's.
      // The loop says what gap each frame was meant to have, as it does in the game.
      const ladder = new FrameLadder();
      let pending: ((timestamp: number) => void) | null = null;
      let now = 0;
      let drawn = 0;
      const loop = createFrameLoop({
        clock: { requestFrame: (callback) => { pending = callback; return 1; }, cancelFrame: () => { pending = null; }, now: () => now },
        frameRateCap: () => cap,
        frame: (frameSeconds, dueSeconds) => {
          drawn += 1;
          ladder.note(frameSeconds, dueSeconds);
        },
      });
      loop.start();
      for (let tick = 0; tick < 300 * hertz; tick += 1) {
        // a display frame lands a little early or late, as real ones do
        now = (tick * 1000) / hertz + (tick % 3 === 0 ? 0.4 : tick % 3 === 1 ? -0.3 : 0);
        const callback = pending as ((timestamp: number) => void) | null;
        pending = null;
        callback?.(now);
      }
      expect(drawn / 300).toBeCloseTo(rate, 0);
      expect(`${hertz} Hz cap ${cap}: rung ${ladder.rung}, ${ladder.changes.length} changes`).toBe(`${hertz} Hz cap ${cap}: rung 0, 0 changes`);
    }
  });

  it('a slow chip on a fast screen is still seen: frames that take two beats are long whatever the screen', () => {
    // 144 Hz screen under the 60 cap, and the chip needs 25 ms on rung 0: the loop hands on frames of two beats.
    for (const hertz of [60, 75, 144]) {
      const ladder = new FrameLadder();
      let pending: ((timestamp: number) => void) | null = null;
      let now = 0;
      let busyUntil = 0;
      const loop = createFrameLoop({
        clock: { requestFrame: (callback) => { pending = callback; return 1; }, cancelFrame: () => { pending = null; }, now: () => now },
        frameRateCap: () => 60,
        frame: (frameSeconds, dueSeconds) => {
          ladder.note(frameSeconds, dueSeconds);
          busyUntil = now + (ladder.rung === 0 ? 25 : 4);
        },
      });
      loop.start();
      for (let tick = 0; tick < 60 * hertz; tick += 1) {
        now = (tick * 1000) / hertz;
        if (now < busyUntil) continue;
        const callback = pending as ((timestamp: number) => void) | null;
        pending = null;
        callback?.(now);
      }
      // Down in the first seconds, then one try at the top (this ladder climbs without asking), and it is left alone.
      expect(`${hertz} Hz: ${moves(ladder).join(' ')}`).toBe(`${hertz} Hz: 0>1 1>0 0>1`);
      expect(ladder.changes[0].at).toBeLessThan(6);
    }
  });

  it('sheds nothing to chase more than 60 a second on a faster screen', () => {
    // 144 Hz, every frame asked for, and the chip draws 100: late against 6.9 ms, on time against a 60th.
    const ladder = new FrameLadder();
    run(ladder, 120, () => 1 / 100, 0, { due: 1 / 144 });
    expect(ladder.changes.length).toBe(0);
    expect(fitMilliseconds(1 / 144)).toBeCloseTo(15, 5);
    expect(fitMilliseconds(1 / 30)).toBeCloseTo(30, 5);
  });

  it('takes a 60th when it is not told', () => {
    const untold = new FrameLadder();
    run(untold, 30, () => 1 / 30);
    expect(untold.rung).toBeGreaterThan(0);
    const told = new FrameLadder();
    run(told, 30, () => 1 / 30, 0, { due: 1 / 30 });
    expect(told.rung).toBe(0);
  });
});

describe('the chip test: start on the rung that fits', () => {
  const fits = fitMilliseconds(1 / 60);

  it('finds the best rung that fits, wherever it is, timing five rungs at most', () => {
    for (let best = 0; best <= LAST; best += 1) {
      const timed: number[] = [];
      expect(fittingRung((rung) => {
        timed.push(rung);
        return rung >= best ? 10 : 20;
      }, fits)).toBe(best);
      expect(timed.length).toBeLessThanOrEqual(5);
      expect(timed[0]).toBe(0);
    }
    // A fast chip is timed at the top and nowhere else.
    const timed: number[] = [];
    fittingRung((rung) => {
      timed.push(rung);
      return 6;
    }, fits);
    expect(timed).toEqual([0]);
  });

  it('puts this Mac on rung 0, a 4 times slower chip on rung 8, and an 8 times slower one on the last', () => {
    expect(fits).toBeCloseTo(15, 5);
    expect([1, 2, 4, 8, 16].map((factor) => fittingRung(chip(factor).cost, fits))).toEqual([0, 0, 8, LAST, LAST]);
  });

  it('a machine at the line keeps every pixel: rung 0 fits when the ladder itself would hold it', () => {
    // This Mac on a 5120×2160 window: a top-quality frame takes about 17 ms. On time is up to 17.5.
    const topFits = topFitMilliseconds(1 / 60);
    expect(topFits).toBeCloseTo(17.5, 5);
    const costs = (top: number) => (rung: number): number => top * (AFLOAT[rung] / AFLOAT[0]);
    expect(fittingRung(costs(17.2), fits, undefined, undefined, 0, topFits)).toBe(0);
    // The test's margin would have started it five rungs down, with the fine strokes gone.
    expect(fittingRung(costs(17.2), fits)).toBe(5);
    // Past the line the margin is back: the best rung under 15 ms, not the first under 17.5.
    expect(fittingRung(costs(18), fits, undefined, undefined, 0, topFits)).toBe(6);
    // And the ladder holds rung 0 there: 17.2 ms is 58 a second, which is on time.
    const ladder = new FrameLadder({ ask: true });
    run(ladder, 300, () => 0.0172, 0, { due: 1 / 60 });
    expect(ladder.changes).toEqual([]);
    // Climbing back to the top after a slow spell is judged the same way; any other rung keeps the margin.
    expect(climbTo(0, 0, () => 17.2, fits, undefined, topFits)).toBe(0);
    expect(climbTo(0, 0, () => 17.2, fits)).toBeNull();
    expect(climbTo(3, 0, () => 17.2, fits, undefined, topFits)).toBeNull();
    // A 30 Hz screen: on time is up to 35 ms.
    expect(topFitMilliseconds(1 / 30)).toBeCloseTo(35, 5);
  });

  it('when time runs out keeps the best rung it saw fit, or the last rung', () => {
    let calls = 0;
    expect(fittingRung(chip(16).cost, fits, () => true)).toBe(LAST);
    // Time for two rungs: the top (too slow) and the middle one (fits), then out of time.
    expect(fittingRung((rung) => (rung >= 3 ? 10 : 20), fits, () => (calls += 1) > 1)).toBe(5);
    // The last rung is never timed: a chip ends up there whether it fits or not.
    const timed: number[] = [];
    fittingRung((rung) => {
      timed.push(rung);
      return 99;
    }, fits);
    expect(timed).not.toContain(LAST);
  });

  it('a slow chip that starts on its rung sees no change at all: the ladder asks before it climbs', () => {
    for (const factor of [4, 8]) {
      const slow = chip(factor);
      const ladder = new FrameLadder({ ask: true });
      ladder.startOn(fittingRung(slow.cost, fits));
      const asked: number[] = [];
      const asks = run(ladder, 3600, slow.frame, 0, { due: 1 / 60, costAt: slow.cost, asked });
      expect(ladder.changes).toEqual([]);
      expect(asks).toEqual([]);
      // It asked about the rung above three times (after ten seconds, a minute, five minutes), then left it alone for the hour.
      // The 8 times slower chip never asks: on the last rung its frames are never on time.
      expect(asked).toEqual(factor === 4 ? [7, 7, 7] : []);
      if (factor === 4) expect(ladder.bestAllowed).toBe(8);
    }
    expect(ASK_AGAIN_SECONDS).toEqual([60, 300]);
  });

  it('a busy moment at load does not strand a good chip: after ten good seconds it goes to the rung that fits, in one change', () => {
    // The test read this Mac as 4 times slower than it is. Play is quick on every rung.
    const ladder = new FrameLadder({ ask: true });
    ladder.startOn(8);
    run(ladder, 120, () => QUICK, 0, { costAt: chip(1).cost });
    expect(moves(ladder)).toEqual(['8>0']);
    expect(ladder.changes[0].at).toBeGreaterThan(12);
    // Still busy at the first ask: it asks again a minute later, and then climbs.
    const later = new FrameLadder({ ask: true });
    later.startOn(8);
    const asked: number[] = [];
    run(later, 200, () => QUICK, 0, { costAt: (rung, time) => chip(time < 30 ? 4 : 1).cost(rung), asked });
    expect(asked).toEqual([7, 7]);
    expect(moves(later)).toEqual(['8>0']);
    expect(later.changes[0].at).toBeGreaterThan(70);
    // A chip in between goes to its own rung, not the top: twice as slow as this Mac at 2560×1440 would be about rung 6.
    const between = new FrameLadder({ ask: true });
    between.startOn(LAST);
    run(between, 600, () => QUICK, 0, { costAt: (rung) => (rung >= 6 ? 8 : 16) });
    expect(moves(between)).toEqual(['11>6']);
    // No room to spare: one rung at a time, ten seconds apart.
    const tight = new FrameLadder({ ask: true });
    tight.startOn(5);
    run(tight, 60, () => QUICK, 0, { costAt: (rung) => (rung >= 3 ? 12 : 16) });
    expect(moves(tight)).toEqual(['5>4', '4>3']);
    expect(tight.changes[1].at - tight.changes[0].at).toBeGreaterThanOrEqual(10);
  });

  it('the answer to a ladder that asks: no, the rung above, or with room to spare the best rung that fits', () => {
    const timed: number[] = [];
    const measure = (costs: number[]) => (rung: number): number => {
      timed.push(rung);
      return costs[rung];
    };
    expect(climbTo(7, 0, measure(AFLOAT.map((cost) => cost * 4)), fits)).toBeNull();
    expect(timed).toEqual([7]);
    expect(climbTo(4, 0, () => 12, fits)).toBe(4);
    expect(climbTo(4, 0, () => 5, fits)).toBe(0);
    // Never above the best rung still allowed.
    expect(climbTo(4, 2, () => 5, fits)).toBe(2);
    expect(climbTo(4, 4, () => 5, fits)).toBe(4);
  });

  it('a climb the chip test allowed that then runs long is that rung\'s one try', () => {
    // The test says rung 0 fits, play says it does not (the browser's own work, a heavier view).
    const ladder = new FrameLadder({ ask: true });
    ladder.startOn(1);
    run(ladder, 600, (rung) => (rung === 0 ? LONG : QUICK), 0, { costAt: () => 5 });
    expect(moves(ladder)).toEqual(['1>0', '0>1']);
    expect(ladder.bestAllowed).toBe(1);
  });

  it('a climb of several rungs that fails goes back in one change, and every climb after it is one rung', () => {
    // The test says the top fits with room to spare. Play says only rung 5 and below hold: the test cannot be trusted here.
    const ladder = new FrameLadder({ ask: true });
    ladder.startOn(8);
    run(ladder, 900, (rung) => (rung < 5 ? LONG : QUICK), 0, { costAt: () => 5 });
    expect(moves(ladder)).toEqual(['8>0', '0>8', '8>7', '7>6', '6>5', '5>4', '4>5']);
    // One failed try for a rung, two in the session: the jump, and the rung above the one that holds.
    expect(failedTries(ladder)).toBe(2);
    expect(ladder.bestAllowed).toBe(5);
    for (let index = 1; index < ladder.changes.length; index += 1) expect(ladder.changes[index].at - ladder.changes[index - 1].at).toBeGreaterThanOrEqual(10);
  });

  it('without an answer it does not climb', () => {
    const ladder = new FrameLadder({ ask: true });
    ladder.startOn(3);
    run(ladder, 60, () => QUICK);
    expect(ladder.rung).toBe(3);
    expect(ladder.asking).toBe(2);
    expect(ladder.answer(2)).toBe(true);
    expect(ladder.rung).toBe(2);
    expect(ladder.asking).toBeNull();
    expect(ladder.answer(1)).toBe(false);
    // An answer never takes it down, or above a rung that is out.
    run(ladder, 60, () => QUICK);
    expect(ladder.asking).toBe(1);
    expect(ladder.answer(0)).toBe(true);
    expect(ladder.rung).toBe(0);
  });
});

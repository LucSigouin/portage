/**
 * The quality ladder and the drawing size: full size at render scale 1, and
 * cost is shed in B2's order, resolution last. The canvas (and so the heroes)
 * stays the window's own size whatever the world is drawn at. The ladder
 * climbs back, and never pumps.
 */
import { describe, expect, it } from 'vitest';
import { createDefaultSettings } from '../../src/settings/index.ts';
import {
  CLIMB_AFTER_SECONDS, FAILS_ALLOWED, FrameLadder, LADDER, LADDER_REST_SECONDS, PIXEL_BUDGET, WINDOW_PIXEL_LIMIT,
  drawingPixelRatio, qualityAt, qualityCeiling, shedNote, windowPixelRatio,
} from '../../src/look/quality.ts';

const graphics = createDefaultSettings().graphics;

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
    for (const rung of [0, 9]) expect(drawingPixelRatio(1920, 1080, 1, 1, qualityAt(qualityCeiling(graphics), rung).resolution)).toBeLessThanOrEqual(windowPixelRatio(1920, 1080, 1));
  });
});

/** Run the ladder for `seconds` on a machine whose frame time depends on the rung. Returns the seconds at each change. */
function run(ladder: FrameLadder, seconds: number, frameSecondsAt: (rung: number, time: number) => number, from = 0): number[] {
  const changes: number[] = [];
  let time = from;
  while (time < from + seconds) {
    const frame = frameSecondsAt(ladder.rung, time);
    time += frame;
    if (ladder.note(frame)) changes.push(time);
  }
  return changes;
}
const QUICK = 1 / 60;
const LONG = 1 / 40;

describe('quality ladder', () => {
  it('sheds the weather\'s fine work first, then reflections, and resolution last', () => {
    const shedOrder = LADDER.slice(1).map((rung) => Object.keys(rung)[0]);
    expect(shedOrder).toEqual(['weather', 'reflection', 'reflection', 'fine', 'ink', 'ink', 'resolution', 'resolution', 'resolution']);
    const ceiling = qualityCeiling(graphics);
    // The first rung sheds weather detail and nothing else of the world.
    expect(qualityAt(ceiling, 1)).toEqual({ ...ceiling, weather: 0 });
    expect(shedNote(ceiling, qualityAt(ceiling, 1))).toBe('shed: weather detail off');
    for (let rung = 0; rung <= 6; rung += 1) expect(qualityAt(ceiling, rung).resolution).toBe(1);
    expect(qualityAt(ceiling, 7).resolution).toBeLessThan(1);
    expect(qualityAt(ceiling, 2).reflection).toBeLessThan(ceiling.reflection);
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
  });

  it('steps down after two seconds of long frames, and not before the warm-up', () => {
    const ladder = new FrameLadder();
    let stepped = 0;
    for (let frame = 0; frame < 170; frame += 1) if (ladder.note(0.04)) stepped += 1;
    expect(stepped).toBe(0);
    for (let frame = 0; frame < 120; frame += 1) if (ladder.note(0.025)) stepped += 1;
    expect(stepped).toBe(1);
    expect(ladder.rung).toBe(1);
  });

  it('holds still on good frames, and when pinned', () => {
    const steady = new FrameLadder();
    for (let frame = 0; frame < 2000; frame += 1) steady.note(1 / 60);
    expect(steady.rung).toBe(0);
    const pinned = new FrameLadder({ hold: true, startRung: 3 });
    for (let frame = 0; frame < 2000; frame += 1) pinned.note(0.05);
    expect(pinned.rung).toBe(3);
  });

  it('climbs back one rung at a time once frames are quick again', () => {
    const ladder = new FrameLadder();
    // A slow spell: 25 seconds of 40 frames a second, then quick for good.
    const changes = run(ladder, 120, (_rung, time) => (time < 25 ? LONG : QUICK));
    const down = ladder.changes.filter((change) => change.to > change.from);
    const up = ladder.changes.filter((change) => change.to < change.from);
    expect(down.length).toBeGreaterThanOrEqual(2);
    expect(up.length).toBe(down.length);
    for (const change of up) expect(change.from - change.to).toBe(1);
    expect(ladder.rung).toBe(0);
    expect(changes.length).toBe(ladder.changes.length);
  });

  it('never changes twice within ten seconds, down or up', () => {
    for (const frameSecondsAt of [
      (_rung: number, time: number) => (time < 25 ? LONG : QUICK),
      (rung: number) => (rung < 3 ? 1 / 15 : QUICK),
      (rung: number, time: number) => (rung < 2 || Math.floor(time / 7) % 2 === 0 ? LONG : QUICK),
    ]) {
      const ladder = new FrameLadder();
      run(ladder, 400, frameSecondsAt);
      expect(ladder.changes.length).toBeGreaterThan(1);
      for (let index = 1; index < ladder.changes.length; index += 1) {
        // Ten, written out: Luc's rule, not whatever the constant happens to say.
        expect(ladder.changes[index].at - ladder.changes[index - 1].at).toBeGreaterThanOrEqual(10);
      }
    }
    expect(LADDER_REST_SECONDS).toBeGreaterThanOrEqual(10);
    expect(CLIMB_AFTER_SECONDS).toBeGreaterThanOrEqual(10);
  });

  it('does not pump: a rung that runs long twice is left alone for the session', () => {
    // This machine cannot hold rung 0 and is fine on rung 1.
    const ladder = new FrameLadder();
    run(ladder, 3600, (rung) => (rung === 0 ? LONG : QUICK));
    expect(ladder.changes.map((change) => `${change.from}>${change.to}`)).toEqual(['0>1', '1>0', '0>1']);
    expect(ladder.changes.filter((change) => change.from === 0).length).toBe(FAILS_ALLOWED);
    expect(ladder.rung).toBe(1);
    expect(ladder.bestAllowed).toBe(1);
    // A settings change gives every rung a fresh start.
    ladder.reset();
    expect(ladder.bestAllowed).toBe(0);
    expect(ladder.rung).toBe(0);
  });

  it('settles: on any machine the changes stop, each rung tried at most twice', () => {
    for (const holds of [0, 1, 4, 8]) {
      const ladder = new FrameLadder();
      run(ladder, 3600, (rung) => (rung < holds ? 1 / 24 : QUICK));
      const settledBy = ladder.changes.length > 0 ? ladder.changes[ladder.changes.length - 1].at : 0;
      expect(ladder.rung).toBe(holds);
      expect(settledBy).toBeLessThan(600);
      for (let rung = 0; rung < LADDER.length; rung += 1) {
        expect(ladder.changes.filter((change) => change.from === rung && change.to > rung).length).toBeLessThanOrEqual(FAILS_ALLOWED);
      }
    }
  });

  it('drops further in one change when badly behind', () => {
    // (the warm-up is 180 frames: 12 seconds at 15 frames a second)
    const behind = new FrameLadder();
    run(behind, 16, () => 1 / 15);
    expect(behind.changes.length).toBe(1);
    expect(behind.rung).toBe(3);
    const nearly = new FrameLadder();
    run(nearly, 8, () => 1 / 42);
    expect(nearly.rung).toBe(1);
  });

  it('reads nothing into a stall: a hidden tab or a hitch is not a slow frame', () => {
    const ladder = new FrameLadder();
    run(ladder, 5, () => QUICK);
    for (let stall = 0; stall < 40; stall += 1) ladder.note(2);
    run(ladder, 5, () => QUICK);
    expect(ladder.rung).toBe(0);
    expect(ladder.changes.length).toBe(0);
  });
});

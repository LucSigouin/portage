/**
 * The quality ladder and the drawing size: full size at render scale 1, and
 * cost is shed in B2's order, resolution last.
 */
import { describe, expect, it } from 'vitest';
import { createDefaultSettings } from '../../src/settings/index.ts';
import { FrameLadder, LADDER, PIXEL_BUDGET, drawingPixelRatio, qualityAt, qualityCeiling, shedNote } from '../../src/look/quality.ts';

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

describe('quality ladder', () => {
  it('sheds reflections first and resolution last', () => {
    const shedOrder = LADDER.slice(1).map((rung) => Object.keys(rung)[0]);
    expect(shedOrder).toEqual(['reflection', 'reflection', 'fine', 'ink', 'ink', 'resolution', 'resolution', 'resolution']);
    const ceiling = qualityCeiling(graphics);
    for (let rung = 0; rung <= 5; rung += 1) expect(qualityAt(ceiling, rung).resolution).toBe(1);
    expect(qualityAt(ceiling, 6).resolution).toBeLessThan(1);
    expect(qualityAt(ceiling, 1).reflection).toBeLessThan(ceiling.reflection);
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
    expect(qualityCeiling(graphics)).toEqual({ reflection: 0.75, fine: 1, ink: 2, resolution: 1 });
    expect(shedNote(qualityCeiling(graphics), qualityAt(qualityCeiling(graphics), 0))).toBe('nothing shed');
    expect(shedNote(qualityCeiling(graphics), qualityAt(qualityCeiling(graphics), 7))).toContain('resolution 80%');
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
});

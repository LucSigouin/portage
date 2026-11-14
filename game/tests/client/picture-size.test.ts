/**
 * A still picture drawn once into a frame on the page: how big it is in real pixels, where its corner sits, and when
 * it is drawn. These three were written for the lobby's canoe sketch (gone since Round 4) and now serve the pick
 * screen's four figures (`interface/cast-host.ts`). Their tests are main's, word for word.
 */
import { describe, expect, it } from 'vitest';
import { FIRST_DRAW_FRAME, SETTLE_MILLISECONDS, drawDue, pixelNudge, sketchPixels } from '../../src/client/preview.ts';

describe('when the one picture is drawn', () => {
  const size = { width: 354, height: 256 };
  const base = { frame: 10, wantedKey: 'a', size, drawn: null, failedKey: null, sizeChangedAt: 0, now: 5_000 };

  it('never before the third frame of the page: the first one times the chip', () => {
    expect(FIRST_DRAW_FRAME).toBe(3);
    expect(drawDue({ ...base, frame: 1 })).toBe(false);
    expect(drawDue({ ...base, frame: 2 })).toBe(false);
    expect(drawDue({ ...base, frame: 3 })).toBe(true);
  });

  it('once: a picture of this canoe at this size is not drawn again', () => {
    expect(drawDue({ ...base, drawn: { key: 'a', ...size } })).toBe(false);
    expect(drawDue({ ...base, frame: 100_000, now: 9e9, drawn: { key: 'a', ...size } })).toBe(false);
  });

  it('again at once for another canoe, and for another size only when the size has held still', () => {
    expect(drawDue({ ...base, drawn: { key: 'b', ...size } })).toBe(true);
    const resized = { ...base, drawn: { key: 'a', width: 252, height: 182 } };
    expect(drawDue({ ...resized, sizeChangedAt: 5_000 - SETTLE_MILLISECONDS + 1 })).toBe(false);
    expect(drawDue({ ...resized, sizeChangedAt: 5_000 - SETTLE_MILLISECONDS })).toBe(true);
  });

  it('not at all with no canoe, no frame on the page, or a canoe that could not be drawn', () => {
    expect(drawDue({ ...base, wantedKey: null })).toBe(false);
    expect(drawDue({ ...base, size: null })).toBe(false);
    expect(drawDue({ ...base, failedKey: 'a' })).toBe(false);
    expect(drawDue({ ...base, failedKey: 'b' })).toBe(true);
  });
});

describe('sharp at the size shown', () => {
  it('the picture has as many pixels as its frame has on the screen, never more', () => {
    expect(sketchPixels(353.74, 256.2, 1)).toEqual({ width: 353, height: 256 });
    // On a 2x screen: a whole number of CSS pixels (251 by 182), so every browser lays it on whole screen pixels.
    expect(sketchPixels(251.6, 182.2, 2)).toEqual({ width: 502, height: 364 });
    expect(sketchPixels(267.93, 200.9, 2)).toEqual({ width: 534, height: 400 });
    expect(sketchPixels(282.4, 204.8, 1.25)).toEqual({ width: 352, height: 255 });
    expect(sketchPixels(341, 256, 1.5)).toEqual({ width: 511, height: 384 });
    expect(sketchPixels(200, 100, Number.NaN)).toEqual({ width: 200, height: 100 });
    expect(sketchPixels(0, 0, 1)).toBeNull();
    expect(sketchPixels(10, 300, 1)).toBeNull();
    expect(sketchPixels(9_000, 300, 1)).toEqual({ width: 2048, height: 300 });
  });

  it('the nudge puts a corner on a whole screen pixel, by the shortest way', () => {
    expect(pixelNudge(-387, 1)).toBeCloseTo(0, 10);
    expect(pixelNudge(-387.123, 1)).toBeCloseTo(0.123, 10);
    expect(pixelNudge(-387.7, 1)).toBeCloseTo(-0.3, 10);
    // Half screen pixels on a 2x screen, and a 1.25x screen.
    expect(pixelNudge(10.3, 2)).toBeCloseTo(0.2, 10);
    expect((10.3 + pixelNudge(10.3, 2)) * 2).toBeCloseTo(21, 10);
    expect((-200.33 + pixelNudge(-200.33, 1.25)) * 1.25).toBeCloseTo(Math.round(-200.33 * 1.25), 10);
    for (const at of [-512.49, -0.5, 0.25, 77.77]) expect(Math.abs(pixelNudge(at, 1))).toBeLessThanOrEqual(0.5);
  });
});

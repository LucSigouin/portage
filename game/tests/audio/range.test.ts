import { describe, expect, it } from 'vitest';
import { withinRange } from '../../src/audio/graph.ts';

describe('a parameter stays within what the output device allows', () => {
  it('holds a filter at the ceiling of a 24 kHz device, and leaves lower values alone', () => {
    const frequency = { maxValue: 12000 } as AudioParam;
    expect(withinRange(frequency, 16000)).toBe(12000);
    expect(withinRange(frequency, 2400)).toBe(2400);
  });

  it('passes the value through when the parameter states no ceiling', () => {
    expect(withinRange({} as AudioParam, 16000)).toBe(16000);
  });
});

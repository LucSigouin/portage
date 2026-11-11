import { describe, expect, it } from 'vitest';
import type { RegionId } from '../../src/data/index.ts';
import { LOBBY_INPUTS } from '../../src/audio/layers.ts';
import type { LayerInputs } from '../../src/audio/layers.ts';
import { FINALE_SECONDS, REGION_TONALITY, dayPhase, degreeToNote, foldDegree, moodFor } from '../../src/audio/music.ts';
import { FakeOscillatorNode, inputsOf } from './fake-audio-context.ts';
import type { Rig } from './support.ts';
import { SAMPLE_EVENTS, createRig } from './support.ts';

/** Let fake time pass, ticking the way a frame would. */
function run(rig: Rig, seconds: number): void {
  for (let frame = 0; frame < seconds * 10; frame += 1) {
    rig.context.advance(0.1);
    rig.engine.inspector.tick();
  }
}

const gameInputs = (overrides: Partial<LayerInputs>): LayerInputs => ({ ...LOBBY_INPUTS, hour: 12, ...overrides });

/** Pitch of every oscillator made so far, rounded: a fingerprint of what was played. */
const notesPlayed = (rig: Rig, from = 0): number[] => rig.context.nodes.slice(from)
  .filter((node): node is FakeOscillatorNode => node instanceof FakeOscillatorNode)
  .map((oscillator) => Math.round(oscillator.frequency.value));

describe('music', () => {
  it('starts with the lobby theme, on the music bus', async () => {
    const rig = await createRig();
    expect(rig.engine.inspector.musicState()).toBe('lobby');
    expect(rig.engine.inspector.voiceCount('music')).toBe(0);
    run(rig, 12);
    expect(rig.engine.inspector.voiceCount('music')).toBeGreaterThan(0);
    expect(inputsOf(rig.nodes.inputs.music).length).toBeGreaterThan(0);
    expect(rig.engine.inspector.voicesStarted('pad')).toBeGreaterThanOrEqual(1);
    rig.engine.dispose();
  });

  it('switches music with the scene', async () => {
    const rig = await createRig();
    const { inspector } = rig.engine;
    run(rig, 12);
    const lobbyVoices = inspector.voiceCount('music');
    expect(lobbyVoices).toBeGreaterThan(0);

    rig.engine.setScene('game');
    expect(inspector.musicState()).toBe('game:shallows:day:clear');
    // The lobby music is let go at once, not left to overlap the new bed.
    expect(inspector.voiceCount('music')).toBe(0);
    run(rig, 12);
    expect(inspector.voiceCount('music')).toBeGreaterThan(0);

    // Pausing keeps the game's music; only the mix changes.
    rig.engine.setScene('paused');
    expect(inspector.musicState()).toBe('game:shallows:day:clear');
    expect(inspector.voiceCount('music')).toBeGreaterThan(0);

    rig.engine.setScene('credits');
    expect(inspector.musicState()).toBe('credits');
    rig.engine.setScene('lobby');
    expect(inspector.musicState()).toBe('lobby');
    rig.engine.dispose();
  });

  it('follows region, hour and weather in game', async () => {
    const rig = await createRig();
    const { inspector } = rig.engine;
    rig.engine.setScene('game');
    inspector.applyLayerInputs(gameInputs({ regionId: 'reach', hour: 20, weatherKind: 'rain' }), 0.016);
    expect(inspector.musicState()).toBe('game:reach:dusk:rain');
    inspector.applyLayerInputs(gameInputs({ regionId: 'narrows', hour: 2, weatherKind: 'clear' }), 0.016);
    expect(inspector.musicState()).toBe('game:narrows:night:clear');
    inspector.applyLayerInputs(gameInputs({ regionId: 'fog', hour: 6, weatherKind: 'storm', stormLevel: 1 }), 0.016);
    expect(inspector.musicState()).toBe('game:fog:dawn:storm:thinned');
    rig.engine.dispose();
  });

  it('starts a fresh bed when the region changes', async () => {
    const rig = await createRig();
    const { inspector } = rig.engine;
    rig.engine.setScene('game');
    inspector.applyLayerInputs(gameInputs({ regionId: 'shallows' }), 0.016);
    run(rig, 12);
    expect(inspector.voiceCount('music')).toBeGreaterThan(0);
    inspector.applyLayerInputs(gameInputs({ regionId: 'narrows' }), 0.016);
    expect(inspector.voiceCount('music')).toBe(0);
    // The same region again is not a change.
    run(rig, 12);
    const sounding = inspector.voiceCount('music');
    inspector.applyLayerInputs(gameInputs({ regionId: 'narrows' }), 0.016);
    expect(inspector.voiceCount('music')).toBe(sounding);
    rig.engine.dispose();
  });

  it('gives each region its own mode, all sharing the notes the one-shots use', () => {
    const pentatonic = [2, 4, 6, 9, 11];
    const names = new Set<string>();
    for (const regionId of Object.keys(REGION_TONALITY) as RegionId[]) {
      const tonality = REGION_TONALITY[regionId];
      names.add(tonality.name);
      const pitchClasses = tonality.scale.map((semitones) => (tonality.tonic + semitones) % 12);
      for (const pitchClass of pentatonic) expect(pitchClasses, regionId).toContain(pitchClass);
      for (const cell of tonality.cells) expect(cell.degrees, regionId).toHaveLength(cell.beats.length);
    }
    expect(names.size).toBe(4);
    const shallows = REGION_TONALITY.shallows;
    expect(degreeToNote(shallows, 0, 0)).toBe(50);
    expect(degreeToNote(shallows, 7, 0)).toBe(62);
    expect(degreeToNote(shallows, -1, 0)).toBe(48);
    expect(degreeToNote(shallows, 4, 2)).toBe(81);
  });

  it('keeps every phrase in a singable range', async () => {
    expect([18, 11, 9, 0, -4, -5, -12].map(foldDegree)).toEqual([4, 4, 9, 0, -4, 2, 2]);
    // Ten minutes of lobby music: no note above the pluck register plus its glassy octave.
    const rig = await createRig(9);
    run(rig, 600);
    const highest = Math.max(...notesPlayed(rig).filter((frequency) => frequency > 20));
    // Top of the range is F sharp 6 (1480 Hz); upper partials and glass double or triple it.
    expect(highest).toBeLessThan(1480 * 2 * 5.5);
    expect(rig.engine.inspector.voicesStarted('phrase:pluck')).toBeGreaterThan(20);
    rig.engine.dispose();
  });

  it('thins out in a storm and slows down at night', () => {
    const clear = moodFor({ regionId: 'reach', hour: 12, weatherKind: 'clear', stormLevel: 0 });
    const storm = moodFor({ regionId: 'reach', hour: 12, weatherKind: 'storm', stormLevel: 1 });
    expect(storm.phraseGap).toBeGreaterThan(clear.phraseGap * 3);
    expect(storm.padLevel).toBeLessThan(clear.padLevel * 0.5);
    expect(storm.phraseLevel).toBeLessThan(clear.phraseLevel * 0.5);
    expect(storm.padVoices).toBeLessThan(clear.padVoices);

    const night = moodFor({ regionId: 'reach', hour: 1, weatherKind: 'clear', stormLevel: 0 });
    expect(night.phraseGap).toBeGreaterThan(clear.phraseGap);
    expect(night.brightness).toBeLessThan(clear.brightness);
    const fog = moodFor({ regionId: 'reach', hour: 12, weatherKind: 'fog', stormLevel: 0 });
    expect(fog.phraseGap).toBeGreaterThan(clear.phraseGap);
    expect(['dawn', 'day', 'dusk', 'night'].map((_phase, index) => dayPhase([6, 12, 20, 1][index])))
      .toEqual(['dawn', 'day', 'dusk', 'night']);
  });

  it('plays fewer phrases in a storm than in clear weather', async () => {
    const phrases = async (inputs: LayerInputs): Promise<number> => {
      const rig = await createRig(3);
      rig.engine.setScene('game');
      rig.engine.inspector.applyLayerInputs(inputs, 0.016);
      run(rig, 400);
      const { voicesStarted } = rig.engine.inspector;
      const total = voicesStarted('phrase:pluck') + voicesStarted('phrase:bowed') + voicesStarted('phrase:glass');
      rig.engine.dispose();
      return total;
    };
    const clear = await phrases(gameInputs({ regionId: 'reach' }));
    const storm = await phrases(gameInputs({ regionId: 'reach', weatherKind: 'storm', stormLevel: 1 }));
    expect(clear).toBeGreaterThanOrEqual(15);
    expect(storm).toBeLessThan(clear / 2);
    expect(storm).toBeGreaterThanOrEqual(1);
  });

  it('never repeats itself: no two minutes alike, and no two sessions alike', async () => {
    const rig = await createRig(21);
    run(rig, 120);
    const mark = rig.context.nodes.length;
    const first = notesPlayed(rig);
    run(rig, 120);
    const second = notesPlayed(rig, mark);
    expect(first.length).toBeGreaterThan(30);
    expect(second.length).toBeGreaterThan(30);
    expect(second.join()).not.toBe(first.join());
    rig.engine.dispose();

    const other = await createRig(22);
    run(other, 120);
    expect(notesPlayed(other).join()).not.toBe(first.join());
    other.engine.dispose();
  });

  it('plays the finale when the Beacon is lit, then returns to the scene', async () => {
    const rig = await createRig();
    const { inspector } = rig.engine;
    rig.engine.setScene('game');
    run(rig, 12);
    rig.engine.handleEvents([SAMPLE_EVENTS.game_completed]);
    expect(inspector.musicState()).toBe('finale');
    expect(inspector.voiceLabels('music')).toEqual(['finale']);
    expect(inspector.voicesStarted('beacon_lit')).toBe(1);

    // Nothing else is scheduled over it, and the credits do not cut it short.
    rig.engine.setScene('credits');
    run(rig, FINALE_SECONDS - 2);
    expect(inspector.musicState()).toBe('finale');
    expect(inspector.voicesStarted('pad')).toBe(1);

    run(rig, 4);
    expect(inspector.musicState()).toBe('credits');
    run(rig, 12);
    expect(inspector.voicesStarted('pad')).toBeGreaterThanOrEqual(2);
    rig.engine.dispose();
  });

  it('cuts the finale short when the player leaves for the lobby', async () => {
    const rig = await createRig();
    rig.engine.setScene('game');
    rig.engine.handleEvents([SAMPLE_EVENTS.game_completed]);
    rig.engine.setScene('lobby');
    expect(rig.engine.inspector.musicState()).toBe('lobby');
    expect(rig.engine.inspector.voiceCount('music')).toBe(0);
    rig.engine.dispose();
  });
});

/**
 * Generative music. Nothing here is a loop: a slow bed of overlapping pad
 * breaths moves through a few chords by chance, and over it short phrases are
 * drawn from a handful of written cells, each time transposed, turned over,
 * cut short or stretched. Region sets the mode, the hour sets the pace and
 * colour, the weather thins it out.
 *
 * All four region modes are cut from the same seven notes as D major (the
 * Shallows swap C sharp for C), so one-shots in D pentatonic sit on any of them.
 */
import type { RegionId, WeatherKind } from '../data/index.ts';
import type { AudioGraph } from './graph.ts';
import { clamp, noteFrequency } from './graph.ts';
import { bowed, glass, pad, pluck } from './instruments.ts';
import type { VoiceBuilder, VoicePool } from './voices.ts';

export type MusicMode = 'silent' | 'lobby' | 'game' | 'credits';
export type DayPhase = 'dawn' | 'day' | 'dusk' | 'night';

/** What the in-game music follows. */
export interface MusicContext {
  regionId: RegionId;
  hour: number;
  weatherKind: WeatherKind;
  stormLevel: number;
}

/** A short melodic cell: scale degrees (0 = tonic, 7 = the octave) and note lengths in beats. */
interface Cell {
  degrees: readonly number[];
  beats: readonly number[];
}

interface Tonality {
  name: string;
  /** MIDI note of the tonic, in the octave below middle C. */
  tonic: number;
  /** Semitones above the tonic, one octave. */
  scale: readonly number[];
  /** Chords as scale degrees. The first is home. */
  chords: readonly (readonly number[])[];
  /** Seconds per beat. */
  beat: number;
  cells: readonly Cell[];
  /** Added to the hour's share of bowed phrases. */
  bowedBias: number;
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11] as const;
const MIXOLYDIAN = [0, 2, 4, 5, 7, 9, 10] as const;
const DORIAN = [0, 2, 3, 5, 7, 9, 10] as const;
const AEOLIAN = [0, 2, 3, 5, 7, 8, 10] as const;
const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10] as const;

/** The lobby theme. It is stated plainly now and then so it can be recognised. */
const LOBBY_THEME: Cell = { degrees: [-3, 0, 1, 2, 4, 2, 1, 0], beats: [1, 1, 0.5, 1.5, 2, 1, 1, 3] };

const HOME_TONALITY: Tonality = {
  name: 'D major', tonic: 50, scale: MAJOR, beat: 0.6, bowedBias: 0,
  chords: [[0, 2, 4], [3, 5, 7], [5, 7, 9], [4, 6, 8]],
  cells: [
    LOBBY_THEME,
    { degrees: [4, 5, 4, 2, 1], beats: [1, 1, 1, 1, 3] },
    { degrees: [2, 1, 0, -3], beats: [1, 1, 1, 3] },
    { degrees: [0, 2, 4, 7], beats: [0.5, 0.5, 1, 3] },
  ],
};

export const REGION_TONALITY: Record<RegionId, Tonality> = {
  // Warm and settled: the flat seventh gives it a folk colour.
  shallows: {
    name: 'D mixolydian', tonic: 50, scale: MIXOLYDIAN, beat: 0.62, bowedBias: 0,
    chords: [[0, 2, 4], [6, 8, 10], [3, 5, 7]],
    cells: [
      { degrees: [0, 2, 4, 2], beats: [1, 1, 2, 2] },
      { degrees: [4, 5, 4, 2, 1], beats: [1, 0.5, 1.5, 1, 2] },
      { degrees: [7, 6, 4], beats: [1.5, 0.5, 3] },
      { degrees: [1, 2, 4, 7], beats: [0.5, 0.5, 1, 3] },
    ],
  },
  // Open water: fifths and the bright sixth of the Dorian mode.
  reach: {
    name: 'E dorian', tonic: 52, scale: DORIAN, beat: 0.7, bowedBias: 0.05,
    chords: [[0, 2, 4], [3, 5, 7], [6, 8, 10]],
    cells: [
      { degrees: [0, 4, 3, 4], beats: [1, 2, 1, 2] },
      { degrees: [4, 5, 7, 5, 4], beats: [1, 1, 1.5, 0.5, 2] },
      { degrees: [7, 6, 4, 2], beats: [1, 1, 1, 3] },
      { degrees: [2, 3, 4], beats: [0.5, 0.5, 3] },
    ],
  },
  // The valley pinches: minor, slower, the flat sixth leaning down.
  narrows: {
    name: 'B aeolian', tonic: 47, scale: AEOLIAN, beat: 0.8, bowedBias: 0.2,
    chords: [[0, 2, 4], [5, 7, 9], [3, 5, 7]],
    cells: [
      { degrees: [0, 2, 1, 0], beats: [2, 1, 1, 3] },
      { degrees: [4, 5, 4, 2], beats: [1.5, 0.5, 2, 2] },
      { degrees: [0, 4, 6, 4], beats: [1, 1, 2, 2] },
    ],
  },
  // The Fog: almost nothing, and the flat second when something does move.
  fog: {
    name: 'F sharp phrygian', tonic: 42, scale: PHRYGIAN, beat: 1, bowedBias: 0.3,
    chords: [[0, 4], [0, 3, 4], [1, 3, 5]],
    cells: [
      { degrees: [0, 1, 0], beats: [2, 2, 4] },
      { degrees: [4, 3, 1, 0], beats: [2, 1, 1, 4] },
      { degrees: [7, 4], beats: [3, 5] },
    ],
  },
};

export function dayPhase(hour: number): DayPhase {
  if (hour >= 5 && hour < 8) return 'dawn';
  if (hour >= 8 && hour < 18) return 'day';
  if (hour >= 18 && hour < 22) return 'dusk';
  return 'night';
}

/** How the music should feel right now. */
export interface Mood {
  /** Mean seconds of silence between phrases. */
  phraseGap: number;
  phraseLevel: number;
  padLevel: number;
  /** Multiplies filter cut-offs and upper partials. */
  brightness: number;
  /** 0 to 1: share of phrases that are bowed rather than plucked. */
  bowedShare: number;
  /** 0 to 1: share of plucked phrases played as glassy harmonics. */
  glassShare: number;
  /** Multiplies the beat. */
  stretch: number;
  /** Notes in each pad breath. */
  padVoices: number;
}

const PHASE_MOOD: Record<DayPhase, Mood> = {
  dawn: { phraseGap: 6, phraseLevel: 0.9, padLevel: 0.9, brightness: 1.1, bowedShare: 0.15, glassShare: 0.1, stretch: 1, padVoices: 3 },
  day: { phraseGap: 8, phraseLevel: 1, padLevel: 0.8, brightness: 1, bowedShare: 0.1, glassShare: 0, stretch: 1, padVoices: 3 },
  dusk: { phraseGap: 10, phraseLevel: 0.85, padLevel: 1, brightness: 0.8, bowedShare: 0.5, glassShare: 0.1, stretch: 1.15, padVoices: 3 },
  night: { phraseGap: 18, phraseLevel: 0.6, padLevel: 0.75, brightness: 0.6, bowedShare: 0.35, glassShare: 0.4, stretch: 1.3, padVoices: 2 },
};

/** Mood for the in-game music. A storm thins it: longer gaps, quieter, fewer pad notes. */
export function moodFor(context: MusicContext): Mood {
  const mood = { ...PHASE_MOOD[dayPhase(context.hour)] };
  const storm = clamp(context.stormLevel, 0, 1);
  if (context.weatherKind === 'rain' || context.weatherKind === 'storm') {
    mood.phraseGap *= 1.2;
    mood.phraseLevel *= 0.8;
    mood.brightness *= 0.85;
  }
  if (context.weatherKind === 'fog') {
    mood.phraseGap *= 1.6;
    mood.padLevel *= 1.15;
    mood.brightness *= 0.7;
    mood.glassShare = Math.max(mood.glassShare, 0.5);
  }
  mood.phraseGap *= 1 + 3 * storm;
  mood.phraseLevel *= 1 - 0.6 * storm;
  mood.padLevel *= 1 - 0.65 * storm;
  if (storm > 0.6) mood.padVoices = 1;
  return mood;
}

const LOBBY_MOOD: Mood = {
  phraseGap: 5, phraseLevel: 1, padLevel: 0.9, brightness: 1, bowedShare: 0.1, glassShare: 0.05, stretch: 1, padVoices: 3,
};
const CREDITS_MOOD: Mood = {
  phraseGap: 4, phraseLevel: 1, padLevel: 1, brightness: 1.05, bowedShare: 0.3, glassShare: 0.1, stretch: 1.1, padVoices: 3,
};

/** MIDI note of a scale degree. Degrees run past the octave in both directions. */
export function degreeToNote(tonality: Tonality, degree: number, octave: number): number {
  const size = tonality.scale.length;
  const index = ((degree % size) + size) % size;
  return tonality.tonic + 12 * (octave + Math.floor(degree / size)) + tonality.scale[index];
}

/** Highest and lowest scale degree a phrase may reach, so a variation never turns shrill or muddy. */
const HIGHEST_DEGREE = 9;
const LOWEST_DEGREE = -4;

/** Bring a degree back into range by whole octaves. */
export function foldDegree(degree: number): number {
  let folded = degree;
  while (folded > HIGHEST_DEGREE) folded -= 7;
  while (folded < LOWEST_DEGREE) folded += 7;
  return folded;
}

/** Seconds the finale runs before the music returns to its mode. */
export const FINALE_SECONDS = 26;

export interface Music {
  setMode(mode: MusicMode): void;
  setContext(context: MusicContext): void;
  /** The short piece for lighting the Beacon. The current mode resumes after it. */
  playFinale(): void;
  /** Schedule everything due within `lookahead` seconds. */
  advance(lookahead: number): void;
  /** For the lab and the tests: "lobby", "game:reach:dusk:rain", "finale". */
  describe(): string;
}

export function createMusic(graph: AudioGraph, pool: VoicePool): Music {
  let mode: MusicMode = 'silent';
  let context: MusicContext = { regionId: 'shallows', hour: 9, weatherKind: 'clear', stormLevel: 0 };
  let padNextAt = 0;
  let phraseNextAt = 0;
  let finaleEndsAt = 0;
  let chordIndex = 0;
  let phrasesSinceTheme = 0;

  const random = graph.random;
  const between = (minimum: number, maximum: number): number => minimum + random() * (maximum - minimum);
  const pick = <Item>(items: readonly Item[]): Item => items[Math.floor(random() * items.length)];

  const tonality = (): Tonality => (mode === 'game' ? REGION_TONALITY[context.regionId] : HOME_TONALITY);
  const mood = (): Mood => (mode === 'game' ? moodFor(context) : mode === 'credits' ? CREDITS_MOOD : LOBBY_MOOD);
  const inFinale = (): boolean => graph.now() < finaleEndsAt;

  /** Begin again in the current mode: fade what is sounding, restart the clocks. */
  const restart = (fadeSeconds: number): void => {
    pool.silence('music', fadeSeconds);
    const now = graph.now();
    chordIndex = 0;
    phrasesSinceTheme = 0;
    padNextAt = now + 0.4;
    phraseNextAt = now + between(2.5, 4.5);
  };

  /** One pad breath: two or three chord notes that swell and fade over many seconds. */
  const schedulePad = (delay: number): number => {
    const key = tonality();
    const feel = mood();
    // Drift between chords by chance, always free to fall back home.
    chordIndex = random() < 0.45 ? 0 : Math.floor(random() * key.chords.length);
    const chord = key.chords[chordIndex];
    const attack = between(3, 5.5);
    const hold = between(6, 12);
    const release = between(5, 8);
    const voice = pool.open({ bus: 'music', label: 'pad', priority: 2, delay, gain: feel.padLevel, reverb: 0.5 });
    if (voice) {
      const count = Math.min(feel.padVoices, chord.length);
      for (let index = 0; index < count; index += 1) {
        // Root low, the rest an octave up so the bed stays clear of mud.
        const note = degreeToNote(key, chord[index], index === 0 ? 0 : 1);
        const options = {
          at: index * between(0.3, 1.2), frequency: noteFrequency(note), gain: index === 0 ? 0.1 : 0.065,
          attack, hold, release, pan: index === 0 ? 0 : index === 1 ? -0.35 : 0.35,
        };
        if (index === 0 && random() < feel.bowedShare) bowed(voice, options);
        else pad(voice, { ...options, brightness: feel.brightness });
      }
    }
    // The next breath starts while this one is still sounding.
    return attack + hold * between(0.6, 0.9);
  };

  /** Turn a written cell into this occurrence of it. */
  const varyCell = (cell: Cell, plain: boolean): { degrees: number[]; beats: number[] } => {
    let degrees = [...cell.degrees];
    let beats = [...cell.beats];
    if (plain) return { degrees, beats };
    const shift = pick([0, 0, 0, 1, 2, -2, 4]);
    degrees = degrees.map((degree) => degree + shift);
    if (random() < 0.2) degrees = degrees.map((degree) => 2 * degrees[0] - degree);
    if (degrees.length > 3 && random() < 0.25) {
      degrees = degrees.slice(0, -1);
      beats = beats.slice(0, -1);
      beats[beats.length - 1] = Math.max(beats[beats.length - 1], 2);
    }
    if (random() < 0.15) {
      degrees.push(degrees[degrees.length - 1] + 7);
      beats.push(3);
    }
    return { degrees: degrees.map(foldDegree), beats };
  };

  const playNote = (
    voice: VoiceBuilder, kind: 'pluck' | 'bowed' | 'glass', at: number, note: number, seconds: number,
    gain: number, brightness: number, pan: number,
  ): void => {
    const frequency = noteFrequency(note);
    if (kind === 'bowed') {
      bowed(voice, {
        at, frequency, gain: gain * 0.55, attack: Math.min(0.5, seconds * 0.4), hold: seconds * 0.6,
        release: 1.2 + seconds * 0.4, pan,
      });
    } else if (kind === 'glass') {
      glass(voice, { at, frequency: frequency * 2, gain: gain * 0.4, decay: 2.5 + seconds, pan });
    } else {
      pluck(voice, { at, frequency, gain, decay: 1.3 + seconds * 0.8, brightness, pan });
    }
  };

  /** One phrase, all its notes in a single voice. Returns its length in seconds. */
  const schedulePhrase = (delay: number): number => {
    const key = tonality();
    const feel = mood();
    const stateTheme = mode !== 'game' && phrasesSinceTheme >= 3;
    phrasesSinceTheme = stateTheme ? 0 : phrasesSinceTheme + 1;
    const { degrees, beats } = varyCell(stateTheme ? key.cells[0] : pick(key.cells), stateTheme);
    const kind = random() < clamp(feel.bowedShare + key.bowedBias, 0, 0.9)
      ? 'bowed' : random() < feel.glassShare ? 'glass' : 'pluck';
    // Bowed lines sit lower; plucked ones ring above the bed.
    const octave = kind === 'bowed' ? 1 : 2;
    const beat = key.beat * feel.stretch * (kind === 'bowed' ? 1.4 : 1);
    const voice = pool.open({
      bus: 'music', label: `phrase:${kind}`, priority: 3, delay, gain: feel.phraseLevel,
      reverb: kind === 'pluck' ? 0.35 : 0.55,
    });
    let at = 0;
    for (let index = 0; index < degrees.length; index += 1) {
      const seconds = beats[index] * beat;
      if (voice) {
        playNote(
          voice, kind, at + between(-0.012, 0.012) + 0.012, degreeToNote(key, degrees[index], octave), seconds,
          0.17 * between(0.85, 1.1), feel.brightness, between(-0.25, 0.25),
        );
      }
      at += seconds;
    }
    return at;
  };

  /** The Beacon: a climb through G and A to a D that rings, then the theme, slowly. */
  const scheduleFinale = (): void => {
    const voice = pool.open({ bus: 'music', label: 'finale', priority: 5, gain: 1.5, reverb: 0.5 });
    if (!voice) return;
    const note = (midi: number): number => noteFrequency(midi);
    const arpeggio = (start: number, notes: readonly number[], spacing: number, gain: number): void => {
      notes.forEach((midi, index) => {
        pluck(voice, {
          at: start + index * spacing, frequency: note(midi), gain, decay: 1.6 + index * 0.25,
          pan: (index % 2 === 0 ? -1 : 1) * 0.2,
        });
      });
    };
    // D: a low swell and a rising arpeggio.
    bowed(voice, { at: 0, frequency: note(38), gain: 0.1, attack: 2, hold: 5, release: 4 });
    bowed(voice, { at: 0.3, frequency: note(45), gain: 0.07, attack: 2, hold: 5, release: 4 });
    arpeggio(1.2, [62, 69, 74, 76, 78, 81], 0.3, 0.16);
    // G.
    for (const [midi, pan] of [[55, 0], [59, -0.3], [62, 0.3]] as const) {
      pad(voice, { at: 4, frequency: note(midi), gain: 0.07, attack: 1.5, hold: 2, release: 3, pan });
    }
    arpeggio(4.4, [71, 74, 79], 0.3, 0.16);
    // A.
    for (const [midi, pan] of [[45, 0], [52, -0.3], [57, 0.3], [61, 0]] as const) {
      pad(voice, { at: 7, frequency: note(midi), gain: 0.06, attack: 1.2, hold: 2, release: 3, pan });
    }
    arpeggio(7.3, [69, 73, 76, 81], 0.28, 0.17);
    // The arrival.
    [62, 66, 69, 74].forEach((midi, index) => {
      voice.bell({
        at: 10 + index * 0.05, frequency: note(midi), ratio: 2, index: 1.2, gain: 0.085, attack: 0.01, decay: 7,
        indexDecay: 2.5, pan: (index - 1.5) * 0.25,
      });
    });
    bowed(voice, { at: 10, frequency: note(50), gain: 0.09, attack: 0.6, hold: 4, release: 5 });
    bowed(voice, { at: 10, frequency: note(57), gain: 0.06, attack: 0.6, hold: 4, release: 5 });
    arpeggio(10.6, [86, 81, 78, 74], 0.22, 0.14);
    glass(voice, { at: 11.6, frequency: note(93), gain: 0.04, decay: 4 });
    // The theme, slowly, an octave up.
    let at = 13.5;
    LOBBY_THEME.degrees.forEach((degree, index) => {
      pluck(voice, { at, frequency: note(degreeToNote(HOME_TONALITY, degree, 2)), gain: 0.17, decay: 2.2 });
      at += LOBBY_THEME.beats[index] * 0.55;
    });
    pluck(voice, { at: 19.6, frequency: note(74), gain: 0.16, decay: 3.5 });
    pluck(voice, { at: 19.6, frequency: note(62), gain: 0.14, decay: 4 });
    glass(voice, { at: 19.9, frequency: note(93), gain: 0.035, decay: 4.5 });
  };

  return {
    setMode(next: MusicMode): void {
      if (next === mode) return;
      const leavingGameForMenu = next === 'lobby' || next === 'silent';
      mode = next;
      // The finale plays out into the credits, but not into the lobby.
      if (inFinale() && !leavingGameForMenu) return;
      finaleEndsAt = 0;
      restart(next === 'silent' ? 1 : 2);
    },

    setContext(next: MusicContext): void {
      const regionChanged = next.regionId !== context.regionId;
      context = next;
      // A new region is a new mode: let the old bed go and start the new one.
      if (regionChanged && mode === 'game' && !inFinale()) restart(3);
    },

    playFinale(): void {
      pool.silence('music', 1.5);
      finaleEndsAt = graph.now() + FINALE_SECONDS;
      scheduleFinale();
    },

    advance(lookahead: number): void {
      if (mode === 'silent') return;
      const now = graph.now();
      if (finaleEndsAt > 0) {
        if (now < finaleEndsAt) return;
        finaleEndsAt = 0;
        restart(2);
      }
      // After a long suspension the clocks are far behind: pick up from now.
      if (padNextAt < now - 5) padNextAt = now;
      if (phraseNextAt < now - 5) phraseNextAt = now + between(1, 3);
      if (padNextAt < now + lookahead) {
        const start = Math.max(padNextAt, now);
        padNextAt = start + schedulePad(start - now);
      }
      if (phraseNextAt < now + lookahead) {
        const start = Math.max(phraseNextAt, now);
        const feel = mood();
        // Now and then a second phrase answers the first after a short breath.
        const answer = random() < 0.25;
        const gap = answer ? between(1.5, 3) : feel.phraseGap * between(0.6, 1.5);
        phraseNextAt = start + schedulePhrase(start - now) + gap;
      }
    },

    describe(): string {
      if (inFinale()) return 'finale';
      if (mode !== 'game') return mode;
      const thinned = context.stormLevel > 0.5 ? ':thinned' : '';
      return `game:${context.regionId}:${dayPhase(context.hour)}:${context.weatherKind}${thinned}`;
    },
  };
}

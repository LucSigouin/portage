/**
 * Small synthesised instruments shared by the one-shots, the ambience grains
 * and the music: plucked and bowed notes, wood, water, metal, paper. Each one
 * adds a few partials to a voice. `gain` is roughly the peak it contributes.
 */
import type { VoiceBuilder } from './voices.ts';

interface Placement {
  /** Seconds after the voice starts. */
  at?: number;
  gain: number;
  pan?: number;
}

/** A plucked string or tine: bright attack, upper partials die first. */
export function pluck(
  voice: VoiceBuilder, options: Placement & { frequency: number; decay?: number; brightness?: number },
): void {
  const { at = 0, frequency, gain, pan } = options;
  const decay = options.decay ?? 1.6;
  const brightness = options.brightness ?? 1;
  voice.tone({ at, type: 'triangle', frequency, gain: gain * 0.8, attack: 0.003, decay, pan });
  voice.tone({ at, frequency: frequency * 2, gain: gain * 0.28 * brightness, attack: 0.002, decay: decay * 0.45, pan });
  voice.tone({ at, frequency: frequency * 3.01, gain: gain * 0.1 * brightness, attack: 0.002, decay: decay * 0.22, pan });
  voice.noise({
    at, gain: gain * 0.22 * brightness, attack: 0.001, decay: 0.03, pan,
    filter: { type: 'bandpass', frequency: Math.min(frequency * 5, 6000), quality: 1.2 },
  });
}

/** A slow bowed note: two detuned saws opening through a low-pass, late vibrato. */
export function bowed(
  voice: VoiceBuilder,
  options: Placement & { frequency: number; attack?: number; hold?: number; release?: number },
): void {
  const { at = 0, frequency, gain, pan } = options;
  const attack = options.attack ?? 0.8;
  const hold = options.hold ?? 1.5;
  const release = options.release ?? 1.8;
  for (const detune of [-5, 6]) {
    voice.tone({
      at, type: 'sawtooth', frequency, detune, gain: gain * 0.45, attack, hold, decay: release, pan,
      filter: {
        type: 'lowpass', frequency: Math.min(frequency * 2.2, 2400), sweepTo: Math.min(frequency * 3.2, 3200),
        sweepSeconds: attack + hold * 0.5, quality: 0.9,
      },
      vibrato: { rate: 4.6, depth: frequency * 0.004, delay: attack * 0.8 },
    });
  }
  voice.tone({ at, frequency, gain: gain * 0.5, attack, hold, decay: release, pan });
}

/** A soft sustained pad tone: sine and a faintly detuned triangle. */
export function pad(
  voice: VoiceBuilder,
  options: Placement & { frequency: number; attack: number; hold: number; release: number; brightness?: number },
): void {
  const { at = 0, frequency, gain, pan, attack, hold, release } = options;
  const cutoff = Math.min(frequency * 4, 1800) * (options.brightness ?? 1);
  voice.tone({ at, frequency, gain: gain * 0.6, attack, hold, decay: release, pan });
  voice.tone({
    at, type: 'triangle', frequency, detune: 5, gain: gain * 0.4, attack: attack * 1.2, hold, decay: release, pan,
    filter: { type: 'lowpass', frequency: cutoff, quality: 0.5 },
  });
}

/** A glassy, bell-like high note with a long tail. */
export function glass(voice: VoiceBuilder, options: Placement & { frequency: number; decay?: number }): void {
  const { at = 0, frequency, gain, pan } = options;
  const decay = options.decay ?? 3;
  voice.tone({ at, frequency, gain: gain * 0.8, attack: 0.02, decay, pan });
  voice.tone({ at, frequency: frequency * 2.76, gain: gain * 0.16, attack: 0.01, decay: decay * 0.35, pan });
  voice.tone({ at, frequency: frequency * 5.4, gain: gain * 0.05, attack: 0.005, decay: decay * 0.15, pan });
}

/** A knock on wood: three bar partials and a click. */
export function woodKnock(
  voice: VoiceBuilder, options: Placement & { frequency: number; decay?: number },
): void {
  const { at = 0, frequency, gain, pan } = options;
  const decay = options.decay ?? 0.09;
  voice.tone({ at, frequency, gain: gain * 0.7, attack: 0.001, decay, pan });
  voice.tone({ at, frequency: frequency * 2.76, gain: gain * 0.3, attack: 0.001, decay: decay * 0.6, pan });
  voice.tone({ at, frequency: frequency * 5.4, gain: gain * 0.12, attack: 0.001, decay: decay * 0.35, pan });
  voice.noise({
    at, gain: gain * 0.3, attack: 0.0005, decay: 0.018, pan,
    filter: { type: 'bandpass', frequency: Math.min(frequency * 6, 5000), quality: 1 },
  });
}

/** A hollow thump on the canoe hull. Triangle, so small speakers still carry it. */
export function hullThump(voice: VoiceBuilder, options: Placement & { frequency: number; decay?: number }): void {
  const { at = 0, frequency, gain, pan } = options;
  const decay = options.decay ?? 0.22;
  voice.tone({
    at, type: 'triangle', frequency, glideTo: frequency * 0.68, glideSeconds: 0.12, gain: gain * 0.9,
    attack: 0.002, decay, pan,
  });
  voice.tone({ at, frequency: frequency * 2.4, gain: gain * 0.2, attack: 0.001, decay: decay * 0.4, pan });
  voice.noise({
    at, color: 'brown', gain: gain * 0.5, attack: 0.001, decay: 0.07, pan,
    filter: { type: 'lowpass', frequency: 500 },
  });
}

/** One air bubble: a short sine that chirps upward. */
export function bubble(voice: VoiceBuilder, options: Placement & { frequency: number }): void {
  const { at = 0, frequency, gain, pan } = options;
  voice.tone({
    at, frequency, glideTo: frequency * 1.7, glideSeconds: 0.05, gain, attack: 0.004, decay: 0.07, pan,
  });
}

/** Water thrown or struck. `size` 0 is a drip, 1 is a body going in. */
export function waterSplash(voice: VoiceBuilder, options: Placement & { size: number }): void {
  const { at = 0, gain, pan, size } = options;
  voice.noise({
    at, gain, attack: 0.008, decay: 0.25 + 0.6 * size, pan,
    filter: { type: 'bandpass', frequency: 1500 - 500 * size, sweepTo: 520 - 160 * size, quality: 0.8 },
  });
  voice.noise({
    at: at + 0.02, gain: gain * 0.25, attack: 0.03, decay: 0.3 + 0.5 * size, pan,
    filter: { type: 'highpass', frequency: 3500 },
  });
  voice.tone({
    at, type: 'triangle', frequency: 190 - 70 * size, glideTo: 95 - 30 * size, glideSeconds: 0.1,
    gain: gain * 0.5, attack: 0.002, decay: 0.16 + 0.2 * size, pan,
  });
  const bubbles = 2 + Math.round(4 * size);
  for (let index = 0; index < bubbles; index += 1) {
    bubble(voice, {
      at: at + 0.06 + voice.random() * 0.25 * (1 + size), frequency: 260 + voice.random() * 480,
      gain: gain * 0.18, pan,
    });
  }
}

/** Wood or rope under strain: a slow saw through a narrow resonance. */
export function creak(
  voice: VoiceBuilder, options: Placement & { pitch: number; resonance: number; seconds: number },
): void {
  const { at = 0, gain, pan, pitch, resonance, seconds } = options;
  voice.tone({
    at, type: 'sawtooth', frequency: pitch, glideTo: pitch * 1.5, gain: gain * 4, attack: 0.03,
    hold: seconds * 0.5, decay: seconds * 0.5, pan,
    filter: { type: 'bandpass', frequency: resonance, sweepTo: resonance * 1.25, quality: 5 },
  });
}

/** Paper, canvas or leaves: a soft band of hiss in two flutters. */
export function rustle(
  voice: VoiceBuilder, options: Placement & { seconds: number; brightness?: number },
): void {
  const { at = 0, gain, pan, seconds } = options;
  const brightness = options.brightness ?? 1;
  for (const [offset, level] of [[0, 1], [seconds * 0.45, 0.7]] as const) {
    voice.noise({
      at: at + offset, gain: gain * level, attack: seconds * 0.15, decay: seconds * 0.55, pan,
      filter: { type: 'highpass', frequency: 2200 * brightness },
      secondFilter: { type: 'lowpass', frequency: 6500 * brightness },
    });
  }
}

/** Struck metal: three partials that do not line up. */
export function metalPing(
  voice: VoiceBuilder, options: Placement & { frequency: number; decay?: number },
): void {
  const { at = 0, frequency, gain, pan } = options;
  const decay = options.decay ?? 0.3;
  voice.tone({ at, frequency, gain: gain * 0.6, attack: 0.001, decay, pan });
  voice.tone({ at, frequency: frequency * 2.32, gain: gain * 0.3, attack: 0.001, decay: decay * 0.7, pan });
  voice.tone({ at, frequency: frequency * 4.17, gain: gain * 0.15, attack: 0.001, decay: decay * 0.45, pan });
  voice.noise({
    at, gain: gain * 0.3, attack: 0.0005, decay: 0.012, pan,
    filter: { type: 'highpass', frequency: 4000 },
  });
}

/** Gravel or grit under a hull or a boot: a scrape with loose stones in it. */
export function gravel(voice: VoiceBuilder, options: Placement & { seconds: number; stones?: number }): void {
  const { at = 0, gain, pan, seconds } = options;
  voice.noise({
    at, gain, attack: 0.02, decay: seconds, pan,
    filter: { type: 'bandpass', frequency: 1700, quality: 0.6 },
  });
  voice.noise({
    at, color: 'pink', gain: gain * 0.8, attack: 0.02, decay: seconds * 0.8, pan,
    filter: { type: 'bandpass', frequency: 420, quality: 0.8 },
  });
  const stones = options.stones ?? 5;
  for (let index = 0; index < stones; index += 1) {
    voice.noise({
      at: at + voice.random() * seconds * 0.7, gain: gain * (0.25 + 0.5 * voice.random()), attack: 0.0005,
      decay: 0.015, pan,
      filter: { type: 'bandpass', frequency: 2500 + voice.random() * 2000, quality: 2 },
    });
  }
}

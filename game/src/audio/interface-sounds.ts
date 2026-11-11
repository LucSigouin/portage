/**
 * Menu and panel sounds. Small, soft, made of wood and paper so they suit any
 * of the three art styles: no beeps, no synthetic sweeps.
 */
import { rustle, woodKnock } from './instruments.ts';
import type { VoiceBuilder } from './voices.ts';

/** Sounds the client plays for its own widgets. */
export type InterfaceSound = 'hover' | 'click' | 'open' | 'close' | 'error' | 'tab';

export interface InterfaceSoundDefinition {
  /** Seconds before the same sound may play again. */
  minimumInterval: number;
  play(voice: VoiceBuilder): void;
}

export const INTERFACE_SOUNDS: Record<InterfaceSound, InterfaceSoundDefinition> = {
  // A fingertip on paper.
  hover: {
    minimumInterval: 0.04,
    play(voice) {
      voice.noise({
        gain: 0.1, attack: 0.001, decay: 0.025,
        filter: { type: 'bandpass', frequency: 3200, quality: 1.5 },
      });
      voice.tone({ frequency: 900, gain: 0.05, attack: 0.001, decay: 0.02 });
    },
  },
  // A knuckle on a wooden bar.
  click: {
    minimumInterval: 0.04,
    play(voice) {
      woodKnock(voice, { frequency: 420, gain: 0.2, decay: 0.06 });
    },
  },
  // A sheet sliding out, set down on wood.
  open: {
    minimumInterval: 0.08,
    play(voice) {
      woodKnock(voice, { frequency: 300, gain: 0.18, decay: 0.05 });
      voice.noise({
        at: 0.01, gain: 0.16, attack: 0.02, decay: 0.14,
        filter: { type: 'bandpass', frequency: 1800, sweepTo: 3200, quality: 1 },
      });
    },
  },
  // The sheet sliding back, then the lid.
  close: {
    minimumInterval: 0.08,
    play(voice) {
      voice.noise({
        gain: 0.14, attack: 0.015, decay: 0.12,
        filter: { type: 'bandpass', frequency: 3000, sweepTo: 1400, quality: 1 },
      });
      woodKnock(voice, { at: 0.07, frequency: 240, gain: 0.2, decay: 0.05 });
    },
  },
  // Two dull thuds: no.
  error: {
    minimumInterval: 0.15,
    play(voice) {
      woodKnock(voice, { frequency: 180, gain: 0.24, decay: 0.07 });
      woodKnock(voice, { at: 0.085, frequency: 160, gain: 0.22, decay: 0.07 });
    },
  },
  // A page flicked over.
  tab: {
    minimumInterval: 0.05,
    play(voice) {
      rustle(voice, { gain: 0.13, seconds: 0.06, brightness: 1.3 });
      woodKnock(voice, { at: 0.012, frequency: 700, gain: 0.14, decay: 0.035 });
    },
  },
};

export const INTERFACE_SOUND_NAMES = Object.keys(INTERFACE_SOUNDS) as InterfaceSound[];

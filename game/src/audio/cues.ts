/**
 * One-shot sounds, and the table that maps every game event onto one.
 *
 * `EVENT_CUES` is keyed by event type, so the compiler refuses to build when a
 * new event is added to the rules engine without a decision here. An event
 * that should make no sound is mapped to `null` on purpose, with the reason.
 *
 * Every melodic cue stays inside D major pentatonic (D E F# A B). All four
 * region modes of the music share those five notes, so a cue never clashes
 * with the bed under it.
 */
import { NODES_BY_ID, RECIPES } from '../data/index.ts';
import type { NodeTypeId, RegionId, StationId } from '../data/index.ts';
import type { GameEvent, GameEventType, GameState } from '../sim/index.ts';
import { noteFrequency } from './graph.ts';
import {
  bowed, bubble, creak, glass, gravel, hullThump, metalPing, pad, pluck, rustle, waterSplash, woodKnock,
} from './instruments.ts';
import type { VoiceBuilder } from './voices.ts';

export type Material = 'wood' | 'metal' | 'stone' | 'plant' | 'water';
export type ScavengeKind = 'chop' | 'pry' | 'rummage' | 'pick' | 'splash';

export type CueName =
  | 'item_gained' | 'item_gained_special' | 'item_lost' | 'item_left_behind'
  | 'scavenge_chop' | 'scavenge_pry' | 'scavenge_rummage' | 'scavenge_pick' | 'scavenge_splash'
  | 'harvest_blocked' | 'node_depleted'
  | 'craft_hands' | 'craft_fire' | 'craft_bench' | 'craft_smoker' | 'craft_forge'
  | 'eat' | 'drink' | 'bail'
  | 'attachment_built' | 'hull_upgraded'
  | 'quest_started' | 'quest_advanced' | 'quest_ready' | 'quest_completed'
  | 'bottle_found' | 'cache_hauled'
  | 'storm_warning' | 'rough_water' | 'swamping_warning'
  | 'capsized' | 'exhausted' | 'washed_ashore'
  | 'beached' | 'launched' | 'boarded' | 'landed' | 'slept'
  | 'region_entered' | 'island_discovered' | 'fog_turned_back'
  | 'meter_hunger' | 'meter_thirst' | 'meter_energy'
  | 'dialogue_opened' | 'dialogue_closed'
  | 'lantern_lit' | 'lantern_out' | 'sail_raised' | 'sail_lowered'
  | 'rain_collected' | 'fish_caught' | 'planter_harvested'
  | 'beacon_lit';

/** What to play, and how to colour it. */
export interface CueRequest {
  cue: CueName;
  /** What was struck, for the scavenging sounds. */
  material?: Material;
  /** Region whose tonic the cue should lean on. */
  regionId?: RegionId;
}

export interface CueDefinition {
  /** 1 foley, 2 routine, 3 feedback, 4 important, 5 must be heard. */
  priority: number;
  /** Seconds before the same cue may sound again. A burst collapses to one. */
  minimumInterval: number;
  /** 0 to 1: share sent to the reverb. */
  reverb?: number;
  /** Trim for the whole cue. */
  gain?: number;
  /** Pull the music down by `depth` (0 to 1) for `seconds`. */
  duck?: { depth: number; seconds: number };
  play(voice: VoiceBuilder, request: CueRequest): void;
}

const NOTE = {
  D2: 38, A2: 45, D3: 50, A3: 57, B3: 59, D4: 62, E4: 64, 'F#4': 66, A4: 69, B4: 71,
  D5: 74, E5: 76, 'F#5': 78, A5: 81, B5: 83, D6: 86, E6: 88, A6: 93,
} as const;

const pitch = (name: keyof typeof NOTE): number => noteFrequency(NOTE[name]);

/** Tonic of each region's mode, as a MIDI note in the octave below middle C. */
export const REGION_TONIC: Record<RegionId, number> = { shallows: 50, reach: 52, narrows: 47, fog: 42 };

/** Small pitch spread so repeated hits do not sound stamped out. */
const vary = (voice: VoiceBuilder, spread = 0.08): number => 1 + (voice.random() * 2 - 1) * spread;

/** How each material rings when struck: a body pitch and how bright it is. */
const MATERIAL_TONE: Record<Material, { body: number; bright: number; ring: number }> = {
  wood: { body: 1, bright: 1, ring: 0 },
  metal: { body: 1.5, bright: 1.6, ring: 1 },
  stone: { body: 1.8, bright: 1.9, ring: 0.25 },
  plant: { body: 0.8, bright: 0.7, ring: 0 },
  water: { body: 0.7, bright: 0.8, ring: 0 },
};

/** A hammer blow on a nail in wood. */
function hammerBlow(voice: VoiceBuilder, at: number, gain: number): void {
  const scale = vary(voice, 0.05);
  voice.noise({
    at, gain: gain * 0.6, attack: 0.0005, decay: 0.02,
    filter: { type: 'bandpass', frequency: 3000 * scale, quality: 1 },
  });
  hullThump(voice, { at, frequency: 235 * scale, gain: gain * 0.8, decay: 0.09 });
  woodKnock(voice, { at, frequency: 610 * scale, gain: gain * 0.4, decay: 0.05 });
  voice.tone({ at, frequency: 2100 * scale, gain: gain * 0.12, attack: 0.001, decay: 0.07 });
}

/** One pull of a handsaw. */
function sawStroke(voice: VoiceBuilder, at: number, gain: number, upward: boolean): void {
  voice.noise({
    at, gain, attack: 0.03, decay: 0.2,
    filter: {
      type: 'bandpass', frequency: upward ? 1100 : 1700, sweepTo: upward ? 1700 : 1100, quality: 2.5,
    },
  });
}

export const CUES: Record<CueName, CueDefinition> = {
  // --- Items -----------------------------------------------------------------
  item_gained: {
    priority: 2, minimumInterval: 0.09,
    play(voice) {
      woodKnock(voice, { frequency: 640 * vary(voice), gain: 0.16, decay: 0.05 });
      voice.tone({
        at: 0.015, type: 'triangle', frequency: 523, glideTo: 784, glideSeconds: 0.07, gain: 0.14, decay: 0.13,
      });
    },
  },
  item_gained_special: {
    priority: 3, minimumInterval: 0.2, reverb: 0.3,
    play(voice) {
      woodKnock(voice, { frequency: 700, gain: 0.14, decay: 0.05 });
      pluck(voice, { at: 0.03, frequency: pitch('A5'), gain: 0.2, decay: 0.9 });
      pluck(voice, { at: 0.13, frequency: pitch('D6'), gain: 0.22, decay: 1.2 });
    },
  },
  item_lost: {
    priority: 1, minimumInterval: 0.15,
    play(voice) {
      voice.tone({
        type: 'triangle', frequency: 494, glideTo: 330, glideSeconds: 0.09, gain: 0.11, decay: 0.14,
      });
      hullThump(voice, { at: 0.07, frequency: 150, gain: 0.1, decay: 0.08 });
    },
  },
  item_left_behind: {
    priority: 2, minimumInterval: 0.3,
    play(voice) {
      woodKnock(voice, { frequency: 230, gain: 0.2, decay: 0.07 });
      voice.tone({
        at: 0.05, type: 'triangle', frequency: 370, glideTo: 294, glideSeconds: 0.1, gain: 0.08, decay: 0.16,
      });
    },
  },

  // --- Scavenging --------------------------------------------------------------
  scavenge_chop: {
    priority: 2, minimumInterval: 0.2,
    play(voice, request) {
      const tone = MATERIAL_TONE[request.material ?? 'wood'];
      const scale = vary(voice);
      voice.noise({
        gain: 0.34, attack: 0.0005, decay: 0.07,
        filter: { type: 'bandpass', frequency: 1800 * tone.bright * scale, quality: 0.8 },
      });
      hullThump(voice, { frequency: 180 * tone.body * scale, gain: 0.34, decay: 0.14 });
      voice.tone({ type: 'triangle', frequency: 520 * tone.body * scale, gain: 0.14, attack: 0.001, decay: 0.06 });
      if (tone.ring > 0) metalPing(voice, { frequency: 1400 * scale, gain: 0.12 * tone.ring, decay: 0.18 });
      for (const at of [0.09, 0.14]) {
        voice.noise({
          at: at + voice.random() * 0.02, gain: 0.07, attack: 0.0005, decay: 0.03,
          filter: { type: 'bandpass', frequency: 3500 * tone.bright, quality: 1.5 },
        });
      }
    },
  },
  scavenge_pry: {
    priority: 2, minimumInterval: 0.25,
    play(voice, request) {
      const tone = MATERIAL_TONE[request.material ?? 'wood'];
      const scale = vary(voice);
      creak(voice, { pitch: 48 * scale, resonance: 850 * tone.bright, seconds: 0.34, gain: 0.2 });
      voice.noise({
        at: 0.36, gain: 0.28, attack: 0.0005, decay: 0.06,
        filter: { type: 'bandpass', frequency: 2000 * tone.bright, quality: 1 },
      });
      hullThump(voice, { at: 0.36, frequency: 150 * tone.body, gain: 0.26, decay: 0.12 });
      if (tone.ring > 0) metalPing(voice, { at: 0.36, frequency: 1240 * scale, gain: 0.14 * tone.ring, decay: 0.28 });
    },
  },
  scavenge_rummage: {
    priority: 2, minimumInterval: 0.2,
    play(voice, request) {
      const tone = MATERIAL_TONE[request.material ?? 'wood'];
      let at = 0;
      for (let index = 0; index < 4; index += 1) {
        const scale = 0.6 + voice.random() * 0.9;
        voice.noise({
          at, gain: 0.14 + voice.random() * 0.12, attack: 0.001, decay: 0.04 + voice.random() * 0.05,
          filter: { type: 'bandpass', frequency: 1300 * tone.bright * scale, quality: 1.2 },
        });
        woodKnock(voice, { at, frequency: 420 * tone.body * scale, gain: 0.13, decay: 0.06 });
        if (tone.ring > 0 && voice.random() < 0.6) {
          metalPing(voice, { at, frequency: 1700 * scale, gain: 0.09 * tone.ring, decay: 0.2 });
        }
        at += 0.07 + voice.random() * 0.1;
      }
    },
  },
  scavenge_pick: {
    priority: 2, minimumInterval: 0.2,
    play(voice, request) {
      const tone = MATERIAL_TONE[request.material ?? 'plant'];
      rustle(voice, { gain: 0.11, seconds: 0.16, brightness: 1.3 * tone.bright });
      for (const at of [0.04, 0.17]) {
        const frequency = 520 * tone.body * vary(voice, 0.15);
        voice.tone({
          at, frequency, glideTo: frequency * 1.5, glideSeconds: 0.04, gain: 0.17, attack: 0.002, decay: 0.07,
        });
      }
    },
  },
  scavenge_splash: {
    priority: 2, minimumInterval: 0.25,
    play(voice) {
      waterSplash(voice, { gain: 0.3, size: 0.35 });
    },
  },
  harvest_blocked: {
    priority: 2, minimumInterval: 0.4,
    play(voice) {
      woodKnock(voice, { frequency: 215, gain: 0.2, decay: 0.07 });
      woodKnock(voice, { at: 0.09, frequency: 190, gain: 0.17, decay: 0.07 });
    },
  },
  node_depleted: {
    priority: 2, minimumInterval: 0.3,
    play(voice) {
      woodKnock(voice, { frequency: 380, gain: 0.2, decay: 0.12 });
      woodKnock(voice, { at: 0.11, frequency: 285, gain: 0.18, decay: 0.14 });
      voice.noise({
        at: 0.1, color: 'pink', gain: 0.06, attack: 0.02, decay: 0.2,
        filter: { type: 'lowpass', frequency: 900 },
      });
    },
  },

  // --- Crafting ----------------------------------------------------------------
  craft_hands: {
    priority: 3, minimumInterval: 0.25, reverb: 0.2,
    play(voice) {
      creak(voice, { pitch: 70, resonance: 1300, seconds: 0.12, gain: 0.08 });
      craftDone(voice, 0.14);
    },
  },
  craft_fire: {
    priority: 3, minimumInterval: 0.25, reverb: 0.2,
    play(voice) {
      voice.noise({
        gain: 0.09, attack: 0.02, decay: 0.55,
        filter: { type: 'highpass', frequency: 4200 },
      });
      for (const at of [0.03, 0.12, 0.19]) {
        voice.noise({
          at: at + voice.random() * 0.03, gain: 0.16, attack: 0.0005, decay: 0.012,
          filter: { type: 'bandpass', frequency: 2500 + voice.random() * 2500, quality: 2 },
        });
      }
      craftDone(voice, 0.24);
    },
  },
  craft_bench: {
    priority: 3, minimumInterval: 0.25, reverb: 0.2,
    play(voice) {
      sawStroke(voice, 0, 0.16, true);
      sawStroke(voice, 0.17, 0.16, false);
      craftDone(voice, 0.38);
    },
  },
  craft_smoker: {
    priority: 3, minimumInterval: 0.25, reverb: 0.25,
    play(voice) {
      voice.noise({
        color: 'pink', gain: 0.16, attack: 0.15, decay: 0.5,
        filter: { type: 'lowpass', frequency: 700, sweepTo: 1300 },
      });
      craftDone(voice, 0.3);
    },
  },
  craft_forge: {
    priority: 3, minimumInterval: 0.25, reverb: 0.3,
    play(voice) {
      metalPing(voice, { frequency: 1250, gain: 0.2, decay: 0.6 });
      hullThump(voice, { frequency: 170, gain: 0.2, decay: 0.08 });
      metalPing(voice, { at: 0.2, frequency: 1320, gain: 0.16, decay: 0.5 });
      craftDone(voice, 0.4);
    },
  },

  // --- Eating, drinking, bailing --------------------------------------------------
  eat: {
    priority: 2, minimumInterval: 0.4,
    play(voice) {
      for (const at of [0, 0.16, 0.34]) {
        const scale = vary(voice, 0.12);
        voice.noise({
          at, gain: 0.4, attack: 0.002, decay: 0.07,
          filter: { type: 'bandpass', frequency: 1800 * scale, sweepTo: 1100 * scale, quality: 1.2 },
        });
        voice.tone({ at, type: 'triangle', frequency: 220 * scale, gain: 0.1, attack: 0.001, decay: 0.04 });
      }
    },
  },
  drink: {
    priority: 2, minimumInterval: 0.4,
    play(voice) {
      [190, 212, 238].forEach((frequency, index) => {
        const at = index * 0.17;
        voice.tone({
          at, type: 'triangle', frequency, glideTo: frequency * 1.4, glideSeconds: 0.07, gain: 0.2,
          attack: 0.006, decay: 0.11,
        });
        voice.noise({
          at, gain: 0.05, attack: 0.01, decay: 0.09,
          filter: { type: 'bandpass', frequency: 900, quality: 1 },
        });
      });
      voice.noise({
        at: 0.56, gain: 0.05, attack: 0.08, decay: 0.26,
        filter: { type: 'bandpass', frequency: 1500, quality: 0.7 },
      });
    },
  },
  bail: {
    priority: 2, minimumInterval: 0.5,
    play(voice) {
      // The scoop, the tin can ringing as it fills, then the throw over the side.
      voice.noise({
        gain: 0.36, attack: 0.03, decay: 0.2,
        filter: { type: 'bandpass', frequency: 700, sweepTo: 1400, quality: 0.9 },
      });
      metalPing(voice, { at: 0.02, frequency: 1650 * vary(voice, 0.04), gain: 0.07, decay: 0.09 });
      waterSplash(voice, { at: 0.38, gain: 0.26, size: 0.2, pan: voice.random() < 0.5 ? -0.5 : 0.5 });
    },
  },

  // --- Building ------------------------------------------------------------------
  attachment_built: {
    priority: 4, minimumInterval: 0.6, reverb: 0.3, duck: { depth: 0.4, seconds: 1.8 },
    play(voice) {
      for (const at of [0, 0.22, 0.44, 0.6]) hammerBlow(voice, at, 0.4);
      [NOTE.D5, NOTE['F#5'], NOTE.A5].forEach((note, index) => {
        pluck(voice, { at: 0.95 + index * 0.09, frequency: noteFrequency(note), gain: 0.22, decay: 0.9 + index * 0.2 });
      });
      pluck(voice, { at: 1.13, frequency: pitch('D4'), gain: 0.16, decay: 1.4 });
    },
  },
  hull_upgraded: {
    priority: 4, minimumInterval: 1, reverb: 0.35, duck: { depth: 0.55, seconds: 3 },
    play(voice) {
      sawStroke(voice, 0, 0.18, true);
      sawStroke(voice, 0.2, 0.18, false);
      for (const at of [0.48, 0.68, 0.88, 1.03, 1.18]) hammerBlow(voice, at, 0.4);
      hullThump(voice, { at: 1.45, frequency: 96, gain: 0.5, decay: 0.5 });
      [NOTE.D4, NOTE.A4, NOTE.D5, NOTE['F#5'], NOTE.A5].forEach((note, index) => {
        pluck(voice, { at: 1.5 + index * 0.1, frequency: noteFrequency(note), gain: 0.2, decay: 1.2 + index * 0.2 });
      });
      pad(voice, { at: 1.5, frequency: pitch('D3'), gain: 0.14, attack: 0.3, hold: 0.8, release: 1.8 });
      pad(voice, { at: 1.5, frequency: pitch('A3'), gain: 0.1, attack: 0.3, hold: 0.8, release: 1.8 });
    },
  },

  // --- Quests --------------------------------------------------------------------
  quest_started: {
    priority: 3, minimumInterval: 0.5, reverb: 0.3,
    play(voice) {
      rustle(voice, { gain: 0.08, seconds: 0.2 });
      pluck(voice, { at: 0.12, frequency: pitch('D4'), gain: 0.2, decay: 1.2 });
      pluck(voice, { at: 0.26, frequency: pitch('A4'), gain: 0.18, decay: 1.2 });
    },
  },
  quest_advanced: {
    priority: 3, minimumInterval: 0.35, reverb: 0.25,
    play(voice) {
      pluck(voice, { frequency: pitch('A4'), gain: 0.2, decay: 0.7 });
      pluck(voice, { at: 0.1, frequency: pitch('D5'), gain: 0.22, decay: 0.9 });
    },
  },
  quest_ready: {
    priority: 3, minimumInterval: 0.5, reverb: 0.3,
    play(voice) {
      pluck(voice, { frequency: pitch('A4'), gain: 0.2, decay: 0.7 });
      pluck(voice, { at: 0.1, frequency: pitch('D5'), gain: 0.2, decay: 0.8 });
      pluck(voice, { at: 0.2, frequency: pitch('E5'), gain: 0.22, decay: 1.2 });
    },
  },
  quest_completed: {
    priority: 4, minimumInterval: 1, reverb: 0.45, duck: { depth: 0.6, seconds: 3.2 },
    play(voice) {
      pluck(voice, { frequency: pitch('D4'), gain: 0.2, decay: 2.2 });
      [NOTE.A4, NOTE.D5, NOTE['F#5'], NOTE.A5, NOTE.D6].forEach((note, index) => {
        pluck(voice, { at: 0.1 + index * 0.1, frequency: noteFrequency(note), gain: 0.18, decay: 1.2 + index * 0.25 });
      });
      glass(voice, { at: 0.6, frequency: pitch('D6'), gain: 0.07, decay: 2.4 });
      pad(voice, { at: 0.1, frequency: pitch('D3'), gain: 0.12, attack: 0.4, hold: 0.6, release: 2.4 });
      pad(voice, { at: 0.1, frequency: pitch('A3'), gain: 0.09, attack: 0.4, hold: 0.6, release: 2.4 });
    },
  },

  // --- Finds ---------------------------------------------------------------------
  bottle_found: {
    priority: 3, minimumInterval: 0.6, reverb: 0.4, duck: { depth: 0.3, seconds: 1.4 },
    play(voice) {
      // Cork, two clinks of glass, the note unrolling, a small sparkle.
      voice.tone({ frequency: 400, glideTo: 900, glideSeconds: 0.015, gain: 0.26, attack: 0.001, decay: 0.05 });
      voice.noise({
        gain: 0.14, attack: 0.0005, decay: 0.02,
        filter: { type: 'bandpass', frequency: 1800, quality: 1 },
      });
      for (const [at, frequency] of [[0.12, 2200], [0.26, 2480]] as const) {
        glass(voice, { at, frequency, gain: 0.13, decay: 0.4 });
      }
      rustle(voice, { at: 0.4, gain: 0.07, seconds: 0.25 });
      glass(voice, { at: 0.55, frequency: pitch('A6'), gain: 0.05, decay: 1.4 });
      glass(voice, { at: 0.68, frequency: pitch('E6'), gain: 0.05, decay: 1.6 });
    },
  },
  cache_hauled: {
    priority: 4, minimumInterval: 1, reverb: 0.35, duck: { depth: 0.5, seconds: 3 },
    play(voice) {
      // Winch ratchet speeding up, rope under load, the chest breaking the surface, the thud on deck.
      let at = 0;
      for (let index = 0; index < 7; index += 1) {
        metalPing(voice, { at, frequency: 900 * vary(voice, 0.03), gain: 0.12, decay: 0.03 });
        at += 0.15 - index * 0.012;
      }
      creak(voice, { pitch: 60, resonance: 800, seconds: 0.6, gain: 0.14 });
      voice.noise({
        at: 0.75, gain: 0.3, attack: 0.15, decay: 0.9,
        filter: { type: 'bandpass', frequency: 600, sweepTo: 1500, quality: 0.8 },
      });
      voice.noise({
        at: 0.95, gain: 0.07, attack: 0.1, decay: 1.2,
        filter: { type: 'highpass', frequency: 3000 },
      });
      hullThump(voice, { at: 1.25, frequency: 98, gain: 0.5, decay: 0.3 });
      woodKnock(voice, { at: 1.25, frequency: 300, gain: 0.2, decay: 0.1 });
      voice.bell({ at: 1.5, frequency: pitch('D4'), ratio: 3.5, index: 1.2, gain: 0.12, decay: 2.2 });
      pluck(voice, { at: 1.5, frequency: pitch('D5'), gain: 0.18, decay: 1.2 });
      pluck(voice, { at: 1.62, frequency: pitch('A5'), gain: 0.18, decay: 1.5 });
    },
  },

  // --- Weather and water -----------------------------------------------------------
  storm_warning: {
    priority: 4, minimumInterval: 5, reverb: 0.55, duck: { depth: 0.4, seconds: 4 },
    play(voice) {
      // Far thunder, a gust, and a low open fifth under it.
      voice.noise({
        color: 'brown', gain: 0.6, attack: 0.4, decay: 4,
        filter: { type: 'lowpass', frequency: 320, sweepTo: 110 },
      });
      voice.noise({
        color: 'pink', gain: 0.2, attack: 1.2, decay: 2.5,
        filter: { type: 'bandpass', frequency: 320, sweepTo: 760, sweepSeconds: 1.4, quality: 0.9 },
      });
      voice.tone({ type: 'triangle', frequency: 73.4, gain: 0.14, attack: 1, hold: 0.5, decay: 3 });
      voice.tone({ type: 'triangle', frequency: 110, gain: 0.1, attack: 1.2, hold: 0.3, decay: 3 });
    },
  },
  rough_water: {
    priority: 3, minimumInterval: 2.5, reverb: 0.15,
    play(voice) {
      voice.noise({
        gain: 0.28, attack: 0.02, decay: 0.5,
        filter: { type: 'bandpass', frequency: 900, sweepTo: 400, quality: 0.8 },
      });
      hullThump(voice, { frequency: 120, gain: 0.3, decay: 0.25 });
      voice.noise({
        at: 0.04, gain: 0.09, attack: 0.05, decay: 0.5,
        filter: { type: 'highpass', frequency: 3500 },
      });
    },
  },
  swamping_warning: {
    priority: 4, minimumInterval: 3, duck: { depth: 0.4, seconds: 1.6 },
    play(voice) {
      // Two knocks on a hull that sits too low, twice, and water finding its way in.
      for (const at of [0, 0.14, 0.62, 0.76]) hullThump(voice, { at, frequency: 132, gain: 0.36, decay: 0.16 });
      for (let index = 0; index < 6; index += 1) {
        bubble(voice, { at: 0.2 + index * 0.11, frequency: 170 + index * 38, gain: 0.14 });
      }
      voice.noise({
        at: 0.15, color: 'pink', gain: 0.12, attack: 0.3, decay: 0.8,
        filter: { type: 'bandpass', frequency: 500, sweepTo: 900, quality: 1 },
      });
    },
  },

  // --- Failing ---------------------------------------------------------------------
  capsized: {
    priority: 5, minimumInterval: 3, reverb: 0.3, duck: { depth: 0.8, seconds: 4 },
    play(voice) {
      waterSplash(voice, { gain: 0.5, size: 1 });
      voice.tone({
        type: 'triangle', frequency: 82, glideTo: 44, glideSeconds: 0.8, gain: 0.45, attack: 0.005, decay: 1,
      });
      // Going under: everything closes down to a low wash.
      voice.noise({
        at: 0.3, color: 'pink', gain: 0.4, attack: 0.3, decay: 2.5,
        filter: { type: 'lowpass', frequency: 900, sweepTo: 160 },
      });
      for (let index = 0; index < 8; index += 1) {
        bubble(voice, { at: 0.4 + voice.random() * 1.4, frequency: 180 + voice.random() * 320, gain: 0.12 });
      }
    },
  },
  exhausted: {
    priority: 5, minimumInterval: 3, reverb: 0.35, duck: { depth: 0.8, seconds: 4 },
    play(voice) {
      // A long breath out, a note that sinks, a heartbeat slowing.
      voice.noise({
        gain: 0.13, attack: 0.25, decay: 1.2,
        filter: { type: 'bandpass', frequency: 900, sweepTo: 500, quality: 0.8 },
      });
      voice.tone({
        type: 'triangle', frequency: 196, glideTo: 110, glideSeconds: 1.6, gain: 0.16, attack: 0.2, decay: 2,
      });
      for (const [at, level] of [[0.2, 1], [0.5, 0.8], [1.4, 0.6], [1.75, 0.4]] as const) {
        hullThump(voice, { at, frequency: 84, gain: 0.3 * level, decay: 0.18 });
      }
    },
  },
  washed_ashore: {
    priority: 4, minimumInterval: 3, reverb: 0.4, duck: { depth: 0.5, seconds: 3 },
    play(voice) {
      // A wave running up the beach and drawing back, pebbles, then waking.
      voice.noise({
        color: 'pink', gain: 0.3, attack: 1, decay: 2,
        filter: { type: 'bandpass', frequency: 500, sweepTo: 1200, sweepSeconds: 1.1, quality: 0.7 },
      });
      for (let index = 0; index < 6; index += 1) {
        voice.noise({
          at: 1.2 + voice.random(), gain: 0.05 + voice.random() * 0.05, attack: 0.0005, decay: 0.02,
          filter: { type: 'bandpass', frequency: 3000 + voice.random() * 2000, quality: 2 },
        });
      }
      pad(voice, { at: 0.8, frequency: pitch('A3'), gain: 0.1, attack: 1.2, hold: 0.4, release: 3 });
      pad(voice, { at: 0.8, frequency: pitch('E4'), gain: 0.07, attack: 1.2, hold: 0.4, release: 3 });
      pluck(voice, { at: 2.2, frequency: pitch('E5'), gain: 0.14, decay: 1.8 });
    },
  },

  // --- Canoe and shore ---------------------------------------------------------------
  beached: {
    priority: 3, minimumInterval: 0.8,
    play(voice) {
      hullThump(voice, { frequency: 112, gain: 0.34, decay: 0.2 });
      gravel(voice, { at: 0.02, gain: 0.26, seconds: 0.4 });
    },
  },
  launched: {
    priority: 3, minimumInterval: 0.8,
    play(voice) {
      gravel(voice, { gain: 0.28, seconds: 0.25, stones: 3 });
      voice.noise({
        at: 0.2, gain: 0.3, attack: 0.12, decay: 0.5,
        filter: { type: 'bandpass', frequency: 700, sweepTo: 1300, quality: 0.8 },
      });
      bubble(voice, { at: 0.32, frequency: 300, gain: 0.14 });
    },
  },
  boarded: {
    priority: 3, minimumInterval: 0.5,
    play(voice) {
      hullThump(voice, { frequency: 130, gain: 0.34, decay: 0.2 });
      hullThump(voice, { at: 0.16, frequency: 105, gain: 0.3, decay: 0.22 });
      creak(voice, { at: 0.1, pitch: 55, resonance: 700, seconds: 0.2, gain: 0.06 });
      voice.noise({
        at: 0.2, color: 'pink', gain: 0.1, attack: 0.06, decay: 0.4,
        filter: { type: 'bandpass', frequency: 450, quality: 1 },
      });
    },
  },
  landed: {
    priority: 3, minimumInterval: 0.5,
    play(voice) {
      waterSplash(voice, { gain: 0.3, size: 0.15, pan: -0.2 });
      waterSplash(voice, { at: 0.22, gain: 0.26, size: 0.1, pan: 0.2 });
      gravel(voice, { at: 0.42, gain: 0.22, seconds: 0.14, stones: 3 });
    },
  },
  slept: {
    priority: 4, minimumInterval: 2, reverb: 0.5, duck: { depth: 0.6, seconds: 3.5 },
    play(voice) {
      [NOTE.A4, NOTE['F#4'], NOTE.D4].forEach((note, index) => {
        voice.tone({
          at: index * 0.5, type: 'triangle', frequency: noteFrequency(note), gain: 0.15, attack: 0.08, decay: 1.8,
        });
        voice.tone({ at: index * 0.5, frequency: noteFrequency(note) * 2, gain: 0.03, attack: 0.08, decay: 0.9 });
      });
      pad(voice, { at: 1, frequency: pitch('D3'), gain: 0.1, attack: 0.8, hold: 0.6, release: 2.6 });
    },
  },

  // --- Places ------------------------------------------------------------------------
  region_entered: {
    priority: 3, minimumInterval: 2, reverb: 0.5, duck: { depth: 0.35, seconds: 2.5 },
    play(voice, request) {
      const tonic = REGION_TONIC[request.regionId ?? 'shallows'];
      bowed(voice, { frequency: noteFrequency(tonic), gain: 0.12, attack: 0.8, hold: 0.6, release: 2.2 });
      pluck(voice, { at: 0.6, frequency: noteFrequency(tonic + 12), gain: 0.16, decay: 1.6 });
      pluck(voice, { at: 0.9, frequency: noteFrequency(tonic + 19), gain: 0.16, decay: 2 });
    },
  },
  island_discovered: {
    priority: 3, minimumInterval: 1, reverb: 0.5, duck: { depth: 0.3, seconds: 1.6 },
    play(voice) {
      [NOTE.D5, NOTE.E5, NOTE.A5].forEach((note, index) => {
        pluck(voice, { at: index * 0.11, frequency: noteFrequency(note), gain: 0.2, decay: 1.1 + index * 0.3 });
      });
      voice.noise({
        at: 0.1, gain: 0.03, attack: 0.2, decay: 0.8,
        filter: { type: 'highpass', frequency: 6000 },
      });
    },
  },
  fog_turned_back: {
    priority: 4, minimumInterval: 4, reverb: 0.6, duck: { depth: 0.5, seconds: 2.5 },
    play(voice) {
      // Two voices a hair apart, sinking together, and a breath through a pipe.
      for (const frequency of [311, 317]) {
        voice.tone({
          frequency, glideTo: frequency * 0.72, glideSeconds: 1.4, gain: 0.13, attack: 0.3, decay: 1.8,
        });
      }
      voice.noise({
        gain: 0.3, attack: 0.3, decay: 1.6,
        filter: { type: 'bandpass', frequency: 640, sweepTo: 420, quality: 5 },
      });
    },
  },

  // --- Meters ------------------------------------------------------------------------
  meter_hunger: {
    priority: 3, minimumInterval: 2,
    play(voice) {
      woodKnock(voice, { frequency: 160, gain: 0.22, decay: 0.1 });
      woodKnock(voice, { at: 0.16, frequency: 150, gain: 0.2, decay: 0.1 });
      voice.tone({
        at: 0.3, type: 'sawtooth', frequency: 58, glideTo: 46, gain: 0.2, attack: 0.08, decay: 0.45,
        filter: { type: 'lowpass', frequency: 260, quality: 2 },
        vibrato: { rate: 9, depth: 5 },
      });
    },
  },
  meter_thirst: {
    priority: 3, minimumInterval: 2,
    play(voice) {
      for (const at of [0, 0.13]) {
        voice.noise({
          at, gain: 0.28, attack: 0.0005, decay: 0.025,
          filter: { type: 'bandpass', frequency: 2300, quality: 2 },
        });
        woodKnock(voice, { at, frequency: 520, gain: 0.16, decay: 0.04 });
      }
      voice.tone({
        at: 0.26, type: 'triangle', frequency: 587, glideTo: 392, glideSeconds: 0.25, gain: 0.15, attack: 0.01,
        decay: 0.35,
      });
    },
  },
  meter_energy: {
    priority: 3, minimumInterval: 2, reverb: 0.2,
    play(voice) {
      voice.noise({
        gain: 0.14, attack: 0.2, decay: 0.8,
        filter: { type: 'bandpass', frequency: 800, sweepTo: 480, quality: 0.8 },
      });
      voice.tone({
        at: 0.1, type: 'triangle', frequency: 220, glideTo: 165, glideSeconds: 0.7, gain: 0.17, attack: 0.1,
        decay: 0.9,
      });
    },
  },

  // --- Talking -----------------------------------------------------------------------
  dialogue_opened: {
    priority: 3, minimumInterval: 0.3, reverb: 0.25,
    play(voice) {
      rustle(voice, { gain: 0.07, seconds: 0.16 });
      pluck(voice, { at: 0.05, frequency: pitch('F#4'), gain: 0.16, decay: 0.7 });
      pluck(voice, { at: 0.15, frequency: pitch('A4'), gain: 0.17, decay: 0.9 });
    },
  },
  dialogue_closed: {
    priority: 3, minimumInterval: 0.3, reverb: 0.25,
    play(voice) {
      pluck(voice, { frequency: pitch('A4'), gain: 0.14, decay: 0.6 });
      pluck(voice, { at: 0.1, frequency: pitch('F#4'), gain: 0.14, decay: 0.8 });
      rustle(voice, { at: 0.12, gain: 0.05, seconds: 0.14 });
    },
  },

  // --- Canoe switches ----------------------------------------------------------------
  lantern_lit: {
    priority: 3, minimumInterval: 0.3, reverb: 0.2,
    play(voice) {
      for (const at of [0, 0.09]) {
        voice.noise({
          at, gain: 0.3, attack: 0.0005, decay: 0.012,
          filter: { type: 'bandpass', frequency: 4000, quality: 1.5 },
        });
      }
      voice.noise({
        at: 0.12, color: 'pink', gain: 0.28, attack: 0.08, decay: 0.5,
        filter: { type: 'bandpass', frequency: 500, sweepTo: 1200, quality: 0.8 },
      });
      voice.tone({ at: 0.16, frequency: pitch('A4'), gain: 0.08, attack: 0.1, decay: 0.9 });
      voice.tone({ at: 0.16, frequency: pitch('E5'), gain: 0.055, attack: 0.1, decay: 0.9 });
    },
  },
  lantern_out: {
    priority: 3, minimumInterval: 0.3,
    play(voice) {
      voice.noise({
        color: 'pink', gain: 0.3, attack: 0.01, decay: 0.18,
        filter: { type: 'lowpass', frequency: 1100, sweepTo: 400 },
      });
      glass(voice, { at: 0.12, frequency: 2600, gain: 0.07, decay: 0.12 });
    },
  },
  sail_raised: {
    priority: 3, minimumInterval: 0.6, reverb: 0.15,
    play(voice) {
      [0, 0.11, 0.22].forEach((at, index) => {
        creak(voice, { at, pitch: 62 + index * 9, resonance: 1100 + index * 150, seconds: 0.08, gain: 0.08 });
      });
      for (const at of [0.3, 0.42, 0.58]) {
        voice.noise({
          at, color: 'pink', gain: 0.3, attack: 0.004, decay: 0.12,
          filter: { type: 'lowpass', frequency: 1300 },
        });
      }
      voice.noise({
        at: 0.72, color: 'pink', gain: 0.3, attack: 0.05, decay: 0.5,
        filter: { type: 'bandpass', frequency: 320, quality: 0.8 },
      });
      hullThump(voice, { at: 0.72, frequency: 96, gain: 0.22, decay: 0.3 });
    },
  },
  sail_lowered: {
    priority: 3, minimumInterval: 0.6, reverb: 0.15,
    play(voice) {
      voice.noise({
        color: 'pink', gain: 0.24, attack: 0.05, decay: 0.7,
        filter: { type: 'bandpass', frequency: 1500, sweepTo: 500, quality: 0.7 },
      });
      creak(voice, { at: 0.1, pitch: 80, resonance: 1000, seconds: 0.15, gain: 0.06 });
      hullThump(voice, { at: 0.55, frequency: 120, gain: 0.2, decay: 0.15 });
    },
  },

  // --- Passive attachments -----------------------------------------------------------
  rain_collected: {
    priority: 1, minimumInterval: 0.5, reverb: 0.3,
    play(voice) {
      voice.tone({ frequency: 900, glideTo: 1500, glideSeconds: 0.03, gain: 0.16, attack: 0.002, decay: 0.12 });
      voice.tone({
        at: 0.14, frequency: 1100, glideTo: 1750, glideSeconds: 0.03, gain: 0.13, attack: 0.002, decay: 0.12,
      });
      voice.tone({ at: 0.01, frequency: 520, gain: 0.05, attack: 0.004, decay: 0.2 });
    },
  },
  fish_caught: {
    priority: 3, minimumInterval: 0.6, reverb: 0.2,
    play(voice) {
      waterSplash(voice, { gain: 0.24, size: 0.3 });
      for (const at of [0.25, 0.33, 0.41]) {
        voice.noise({
          at, gain: 0.16, attack: 0.002, decay: 0.05,
          filter: { type: 'bandpass', frequency: 900, quality: 1 },
        });
      }
      for (let index = 0; index < 5; index += 1) {
        metalPing(voice, { at: 0.12 + index * 0.05, frequency: 2400, gain: 0.04, decay: 0.02 });
      }
      pluck(voice, { at: 0.5, frequency: pitch('A5'), gain: 0.18, decay: 0.9 });
    },
  },
  planter_harvested: {
    priority: 2, minimumInterval: 0.6, reverb: 0.25,
    play(voice) {
      rustle(voice, { gain: 0.1, seconds: 0.22, brightness: 1.2 });
      pluck(voice, { at: 0.1, frequency: pitch('A4'), gain: 0.15, decay: 0.7, brightness: 0.6 });
      pluck(voice, { at: 0.22, frequency: pitch('B4'), gain: 0.15, decay: 0.9, brightness: 0.6 });
    },
  },

  // --- The Beacon --------------------------------------------------------------------
  beacon_lit: {
    priority: 5, minimumInterval: 5, reverb: 0.5,
    play(voice) {
      // The breaker, the generator climbing, static clearing, the lamp catching.
      hullThump(voice, { frequency: 140, gain: 0.4, decay: 0.2 });
      metalPing(voice, { frequency: 700, gain: 0.2, decay: 0.3 });
      voice.tone({
        at: 0.2, type: 'sawtooth', frequency: 41, glideTo: 61.7, glideSeconds: 1.8, gain: 0.4, attack: 1.2,
        hold: 1.2, decay: 2.5,
        filter: { type: 'lowpass', frequency: 180, sweepTo: 420, quality: 1 },
      });
      voice.noise({
        at: 0.4, gain: 0.1, attack: 0.3, decay: 1.6,
        filter: { type: 'bandpass', frequency: 2400, sweepTo: 5000, quality: 3 },
      });
      voice.noise({
        at: 1.6, color: 'pink', gain: 0.3, attack: 0.2, decay: 1.2,
        filter: { type: 'bandpass', frequency: 400, sweepTo: 1800, quality: 0.7 },
      });
      [NOTE.D3, NOTE.A3, NOTE.D4, NOTE['F#4']].forEach((note, index) => {
        voice.bell({
          at: 1.8 + index * 0.06, frequency: noteFrequency(note), ratio: 2, index: 1.5, gain: 0.1, attack: 0.01,
          decay: 6, indexDecay: 2.5,
        });
      });
    },
  },
};

/** The shared ending of every crafting cue: two taps and a rising third. */
function craftDone(voice: VoiceBuilder, at: number): void {
  woodKnock(voice, { at, frequency: 620, gain: 0.18, decay: 0.05 });
  woodKnock(voice, { at: at + 0.09, frequency: 780, gain: 0.18, decay: 0.05 });
  pluck(voice, { at: at + 0.2, frequency: pitch('D5'), gain: 0.2, decay: 0.6 });
  pluck(voice, { at: at + 0.31, frequency: pitch('F#5'), gain: 0.2, decay: 0.8 });
}

export const CUE_NAMES = Object.keys(CUES) as CueName[];

// --- Scavenging styles -----------------------------------------------------------

/** What working each kind of node sounds like. Keyed by node type so none is forgotten. */
export const SCAVENGE_STYLE: Record<NodeTypeId, { kind: ScavengeKind; material: Material }> = {
  driftwood_pile: { kind: 'rummage', material: 'wood' },
  cattail_stand: { kind: 'pick', material: 'plant' },
  berry_bush: { kind: 'pick', material: 'plant' },
  apple_tree: { kind: 'pick', material: 'plant' },
  mushroom_log: { kind: 'pick', material: 'plant' },
  birch: { kind: 'pry', material: 'plant' },
  spruce: { kind: 'pick', material: 'wood' },
  stone_outcrop: { kind: 'chop', material: 'stone' },
  clay_bank: { kind: 'rummage', material: 'plant' },
  crate: { kind: 'pry', material: 'wood' },
  attic: { kind: 'rummage', material: 'wood' },
  shed: { kind: 'rummage', material: 'wood' },
  junk_heap: { kind: 'rummage', material: 'metal' },
  boat_wreck: { kind: 'pry', material: 'wood' },
  machinery: { kind: 'pry', material: 'metal' },
  rain_barrel: { kind: 'splash', material: 'water' },
  garden_bed: { kind: 'pick', material: 'plant' },
  fishing_spot: { kind: 'splash', material: 'water' },
  wreck_buoy: { kind: 'splash', material: 'water' },
  message_bottle: { kind: 'pick', material: 'water' },
  cache: { kind: 'rummage', material: 'wood' },
  beacon_lamp: { kind: 'pry', material: 'metal' },
};

const SCAVENGE_CUE: Record<ScavengeKind, CueName> = {
  chop: 'scavenge_chop', pry: 'scavenge_pry', rummage: 'scavenge_rummage', pick: 'scavenge_pick',
  splash: 'scavenge_splash',
};

/** Seconds between hits while a scavenge is held. */
export const SCAVENGE_INTERVAL: Record<ScavengeKind, number> = {
  chop: 0.85, pry: 1.15, rummage: 0.7, pick: 0.62, splash: 1.5,
};

const CRAFT_CUE: Record<StationId, CueName> = {
  hands: 'craft_hands', fire: 'craft_fire', bench: 'craft_bench', smoker: 'craft_smoker', forge: 'craft_forge',
};

/**
 * The sound of working a node. A hatchet always chops, whatever the node's
 * default is: the spruce is scraped by hand but chopped with the hatchet.
 */
export function scavengeRequest(nodeId: string, actionIndex: number): (CueRequest & { kind: ScavengeKind }) | null {
  const node = NODES_BY_ID[nodeId];
  if (!node) return null;
  const style = SCAVENGE_STYLE[node.typeId];
  const tool = node.actions[actionIndex]?.tool ?? null;
  const kind: ScavengeKind = tool === 'hatchet' ? 'chop' : style.kind;
  return { cue: SCAVENGE_CUE[kind], material: style.material, kind };
}

// --- Events ------------------------------------------------------------------------

type EventOf<Type extends GameEventType> = Extract<GameEvent, { type: Type }>;

/** State the engine saw last, for the few cues that need more than the event. */
export interface CueLookup {
  state: GameState | null;
}

type CueResolver<Type extends GameEventType> = (event: EventOf<Type>, lookup: CueLookup) => CueRequest | null;

/**
 * Every game event, and the sound it makes. A cue name, a function that picks
 * one from the event, or `null` for an event that is silent on purpose.
 */
export const EVENT_CUES: { [Type in GameEventType]: CueName | CueResolver<Type> | null } = {
  item_gained: (event) => ({
    cue: event.container === 'belt' || event.container === 'key_items' ? 'item_gained_special' : 'item_gained',
  }),
  item_lost: 'item_lost',
  item_left_behind: 'item_left_behind',
  crafted: (event) => ({ cue: CRAFT_CUE[RECIPES[event.recipeId]?.station ?? 'hands'] }),
  ate: 'eat',
  drank: 'drink',
  harvest_started: (event, lookup) => {
    const harvest = lookup.state?.player.harvest;
    return scavengeRequest(event.nodeId, harvest && harvest.nodeId === event.nodeId ? harvest.actionIndex : 0);
  },
  harvest_blocked: 'harvest_blocked',
  node_depleted: 'node_depleted',
  bottle_found: 'bottle_found',
  cache_hauled: 'cache_hauled',
  quest_started: 'quest_started',
  quest_advanced: 'quest_advanced',
  quest_ready: 'quest_ready',
  quest_completed: 'quest_completed',
  hull_upgraded: 'hull_upgraded',
  attachment_built: 'attachment_built',
  // Silent: the rain, wind and storm layers follow the weather itself and cross-fade.
  weather_changed: null,
  storm_warning: 'storm_warning',
  rough_water: 'rough_water',
  swamping_warning: 'swamping_warning',
  capsized: 'capsized',
  exhausted: 'exhausted',
  washed_ashore: 'washed_ashore',
  canoe_beached: 'beached',
  canoe_launched: 'launched',
  boarded: 'boarded',
  landed: 'landed',
  slept: 'slept',
  region_entered: (event) => ({ cue: 'region_entered', regionId: event.regionId }),
  island_discovered: 'island_discovered',
  fog_turned_back: 'fog_turned_back',
  meter_low: (event) => ({
    cue: event.meter === 'hunger' ? 'meter_hunger' : event.meter === 'thirst' ? 'meter_thirst' : 'meter_energy',
  }),
  dialogue_opened: 'dialogue_opened',
  dialogue_closed: 'dialogue_closed',
  lantern_toggled: (event) => ({ cue: event.lit ? 'lantern_lit' : 'lantern_out' }),
  sail_changed: (event) => ({ cue: event.raised ? 'sail_raised' : 'sail_lowered' }),
  rain_collected: 'rain_collected',
  fish_caught: 'fish_caught',
  planter_harvested: 'planter_harvested',
  // Silent: it always follows a quest_completed, which already plays; the toast is the client's.
  rewards_pending: null,
  // Silent: saving is bookkeeping, not something the player should hear.
  autosave_requested: null,
  game_completed: 'beacon_lit',
};

/** Event types that are silent on purpose. */
export const SILENT_EVENTS: readonly GameEventType[] = (Object.keys(EVENT_CUES) as GameEventType[])
  .filter((type) => EVENT_CUES[type] === null);

/** The cue an event plays, or null when it is silent. */
export function resolveEventCue(event: GameEvent, lookup: CueLookup): CueRequest | null {
  // The table is keyed by the event's own type, so the entry always matches the event.
  const entry = EVENT_CUES[event.type] as CueName | CueResolver<GameEventType> | null;
  if (entry === null) return null;
  return typeof entry === 'string' ? { cue: entry } : entry(event, lookup);
}

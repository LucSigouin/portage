/**
 * The continuous world: beds of filtered noise that follow the game state
 * (water, wind, rain, storm, hull wash, slosh, fire, crickets, fog hush) and
 * the scattered grains on top of them (wavelets, thunder, crackles, birds,
 * loons, paddle strokes, footsteps, bailing, scavenging).
 *
 * The rules engine hands over a whole `GameState`. `deriveLayerInputs` boils
 * it down to the dozen numbers the sound follows, so the lab page can drive
 * the same layers from sliders.
 */
import { ISLANDS_BY_ID } from '../data/index.ts';
import type { RegionId, WeatherKind } from '../data/index.ts';
import {
  FIXED_STEP, nearestIsland, playerOf, selectInventory, selectMeters, selectTimeOfDay, selectWeather, waterRoughnessAt,
} from '../sim/index.ts';
import type { GameState, PlayerId } from '../sim/index.ts';
import { SCAVENGE_INTERVAL, scavengeRequest } from './cues.ts';
import type { CueRequest } from './cues.ts';
import type { AudioGraph, NoiseColor, SmoothedParameter } from './graph.ts';
import { clamp, createSmoothedParameter, smoothStep } from './graph.ts';
import { bubble, gravel, hullThump, waterSplash } from './instruments.ts';
import type { VoiceBuilder, VoicePool } from './voices.ts';

/** The numbers the continuous sound follows. */
export interface LayerInputs {
  /** Water roughness where the listener is, 0 to 4. */
  roughness: number;
  /** Metres per second. */
  windSpeed: number;
  /** 0 dry to 1 downpour. */
  rain: number;
  /** 0 to 1. */
  stormLevel: number;
  /** 0 clear to 1 thick fog. */
  fog: number;
  /** 0 to 24. */
  hour: number;
  regionId: RegionId;
  weatherKind: WeatherKind;
  /** 0 beside an island to 1 far out on open water. */
  openWater: number;
  /** In the canoe. */
  aboard: boolean;
  /** Metres per second along the heading; negative when backing. */
  canoeSpeed: number;
  paddling: 'none' | 'paddle' | 'power';
  bailing: boolean;
  /** Water in the hull, 0 to 1. */
  hullWater: number;
  /** Aboard, or close enough to hear the hull. */
  nearCanoe: boolean;
  /** A fire station or the firebox is in reach. */
  nearFire: boolean;
  onFoot: boolean;
  /** Metres per second over the ground. */
  footSpeed: number;
  /** Walking in shallow water. */
  wading: boolean;
  /** Metres the listener stands above the water. */
  heightAboveWater: number;
  /** The node being worked, while a scavenge is held. */
  scavenge: { nodeId: string; actionIndex: number } | null;
}

/** A calm morning in the Shallows, for the lobby's live scene. */
export const LOBBY_INPUTS: LayerInputs = {
  roughness: 1, windSpeed: 2.5, rain: 0, stormLevel: 0, fog: 0, hour: 9, regionId: 'shallows', weatherKind: 'clear',
  openWater: 0.2,
  aboard: true, canoeSpeed: 0, paddling: 'none', bailing: false, hullWater: 0, nearCanoe: true, nearFire: false,
  onFoot: false, footSpeed: 0, wading: false, heightAboveWater: 0, scavenge: null,
};

/** Dusk on open water, for the credits. */
export const CREDITS_INPUTS: LayerInputs = { ...LOBBY_INPUTS, hour: 20.5, windSpeed: 2, openWater: 0.7 };

export type LayerName =
  | 'water' | 'wind' | 'pines' | 'rain' | 'storm' | 'wash' | 'slosh' | 'fire' | 'crickets' | 'hush';

export const LAYER_NAMES: readonly LayerName[] = [
  'water', 'wind', 'pines', 'rain', 'storm', 'wash', 'slosh', 'fire', 'crickets', 'hush',
];

/** How dark it is: 0 by day, 1 through the night. */
export function nightShare(hour: number): number {
  return hour >= 12 ? smoothStep(20.5, 22, hour) : 1 - smoothStep(4.5, 6, hour);
}

/** 1 around sunrise, 0 otherwise. */
function dawnShare(hour: number): number {
  return smoothStep(4.5, 5.5, hour) * (1 - smoothStep(7.5, 9, hour));
}

/** 1 through the evening, 0 otherwise. */
function duskShare(hour: number): number {
  return smoothStep(18.5, 19.5, hour) * (1 - smoothStep(21.5, 22.5, hour));
}

/** How loud each bed should be for a given state. Pure, so the tests can check directions. */
export function computeLayerLevels(inputs: LayerInputs): Record<LayerName, number> {
  const roughness = clamp(inputs.roughness, 0, 4);
  const wind = clamp(inputs.windSpeed, 0, 14);
  const waterPresence = inputs.aboard ? 1 : clamp(1 - inputs.heightAboveWater / 10, 0.3, 1);
  const quiet = (1 - inputs.rain) * (1 - inputs.stormLevel);
  return {
    water: waterPresence * (0.3 + 0.22 * roughness),
    wind: (wind / 12) ** 1.3 * 1.2,
    pines: clamp(wind / 10, 0, 1) * (1 - inputs.openWater) * 0.35,
    rain: clamp(inputs.rain, 0, 1),
    storm: clamp(inputs.stormLevel, 0, 1) * 0.5,
    wash: inputs.aboard ? clamp(Math.abs(inputs.canoeSpeed) / 5, 0, 1) ** 1.2 * 0.9 : 0,
    slosh: inputs.nearCanoe ? clamp(inputs.hullWater, 0, 1) ** 1.3 * 1.2 : 0,
    fire: inputs.nearFire ? 0.8 : 0,
    crickets: nightShare(inputs.hour) * quiet * (1 - 0.6 * inputs.openWater) * 0.05,
    hush: clamp(inputs.fog, 0, 1) * 0.2,
  };
}

/** How busy the day birds are, 0 to about 1.6 at dawn. */
export function birdActivity(inputs: LayerInputs): number {
  const daylight = 1 - nightShare(inputs.hour);
  const calm = (1 - 0.8 * inputs.rain) * (1 - inputs.stormLevel) * (1 - 0.6 * inputs.fog);
  return daylight * calm * (1 - 0.75 * inputs.openWater) * (1 + 0.8 * dawnShare(inputs.hour));
}

/** How likely a loon is to call: dusk and night over open water, almost never by day. */
export function loonActivity(inputs: LayerInputs): number {
  const hours = Math.max(nightShare(inputs.hour), 0.8 * duskShare(inputs.hour), 0.6 * dawnShare(inputs.hour), 0.06);
  return hours * (0.4 + 0.6 * inputs.openWater) * (inputs.stormLevel < 0.4 ? 1 : 0);
}

/** Cut-off of the ambience bus: wide open in clear air, closed down in fog. */
export function fogCutoff(fog: number): number {
  return 16000 * (2400 / 16000) ** clamp(fog, 0, 1);
}

// --- From game state to inputs ---------------------------------------------------

/** What `deriveLayerInputs` remembers between frames. */
export interface DeriveMemory {
  initialised: boolean;
  tick: number;
  canoeSpeed: number;
  /** 0 to 1: how sure we are the canoe is being paddled. */
  paddleConfidence: number;
  footX: number;
  footZ: number;
  footSpeed: number;
  /** Seconds until the slower lookups run again. */
  slowCountdown: number;
  nearFire: boolean;
  openWater: number;
}

export function createDeriveMemory(): DeriveMemory {
  return {
    initialised: false, tick: 0, canoeSpeed: 0, paddleConfidence: 0, footX: 0, footZ: 0, footSpeed: 0,
    slowCountdown: 0, nearFire: false, openWater: 0,
  };
}

const SLOW_LOOKUP_SECONDS = 0.25;
/** Faster than a run: the player was moved, not walking. */
const TELEPORT_SPEED = 8;

/**
 * Boil the game state down to what the sound follows.
 *
 * The state carries no input, so "is the canoe being paddled" is read off the
 * hull speed: a coasting hull loses half its speed per second, a paddled one
 * holds it. Under sail the two cannot be told apart, so only a power stroke
 * (which the state does flag) counts as paddling there.
 */
export function deriveLayerInputs(state: GameState, memory: DeriveMemory, frameSeconds: number, playerId: PlayerId = 0): LayerInputs {
  const player = playerOf(state, playerId);
  const canoe = state.canoe;
  const weather = selectWeather(state);
  const aboard = player.mode === 'canoe';
  if (!memory.initialised || state.tick < memory.tick) {
    memory.initialised = true;
    memory.tick = state.tick;
    memory.canoeSpeed = canoe.speed;
    memory.paddleConfidence = 0;
    memory.footX = player.position.x;
    memory.footZ = player.position.z;
    memory.footSpeed = 0;
    memory.slowCountdown = 0;
  }

  const steppedSeconds = (state.tick - memory.tick) * FIXED_STEP;
  if (steppedSeconds > 0) {
    const speed = Math.abs(canoe.speed);
    const change = (speed - Math.abs(memory.canoeSpeed)) / steppedSeconds;
    const held = aboard && !player.bailing && !canoe.sailRaised && speed > 0.25 && change > -0.3 * speed;
    memory.paddleConfidence = clamp(memory.paddleConfidence + ((held ? 1 : -1) * steppedSeconds) / 0.3, 0, 1);
    const walked = Math.hypot(player.position.x - memory.footX, player.position.z - memory.footZ) / steppedSeconds;
    memory.footSpeed = aboard || walked > TELEPORT_SPEED ? 0 : walked;
    memory.tick = state.tick;
    memory.canoeSpeed = canoe.speed;
    memory.footX = player.position.x;
    memory.footZ = player.position.z;
  }

  memory.slowCountdown -= frameSeconds;
  if (memory.slowCountdown <= 0) {
    memory.slowCountdown = SLOW_LOOKUP_SECONDS;
    memory.nearFire = selectInventory(state, playerId).stations.includes('fire');
    const island = ISLANDS_BY_ID[nearestIsland(player.position.x, player.position.z)];
    const offshore = Math.hypot(player.position.x - island.center.x, player.position.z - island.center.z)
      - Math.max(island.radiusX, island.radiusZ);
    memory.openWater = aboard ? clamp((offshore - 20) / 160, 0, 1) : 0;
  }

  const powerStroke = aboard && player.exerting && !player.bailing;
  return {
    roughness: waterRoughnessAt(player.position.x, player.position.z, weather.stormLevel),
    windSpeed: weather.windSpeed,
    rain: weather.raining ? (weather.kind === 'storm' ? 0.6 + 0.4 * weather.stormLevel : 0.65) : 0,
    stormLevel: weather.stormLevel,
    fog: weather.kind === 'fog' ? 1 : player.regionId === 'fog' ? 0.8 : 0,
    hour: selectTimeOfDay(state).hour,
    regionId: player.regionId,
    weatherKind: weather.kind,
    openWater: memory.openWater,
    aboard,
    canoeSpeed: canoe.speed,
    paddling: powerStroke ? 'power' : memory.paddleConfidence > 0.5 ? 'paddle' : 'none',
    bailing: aboard && canoe.bailing,
    hullWater: selectMeters(state, playerId).waterLevel / 100,
    nearCanoe: aboard || Math.hypot(player.position.x - canoe.position.x, player.position.z - canoe.position.z) < 8,
    nearFire: memory.nearFire,
    onFoot: !aboard,
    footSpeed: memory.footSpeed,
    wading: !aboard && player.position.y < 0.02,
    heightAboveWater: Math.max(0, player.position.y),
    // Scavenging takes one press: the `harvest_started` event plays its hit, and nothing is held.
    scavenge: null,
  };
}

// --- Grain recipes ---------------------------------------------------------------

/** A small wave lapping at a hull or a rock. */
function wavelet(voice: VoiceBuilder, roughness: number, aboard: boolean): void {
  const centre = 600 + voice.random() * 800;
  voice.noise({
    gain: 0.5 + 0.12 * roughness, attack: 0.03 + voice.random() * 0.05, decay: 0.25 + voice.random() * 0.3,
    filter: { type: 'bandpass', frequency: centre, sweepTo: centre * 0.6, quality: 1.2 },
  });
  if (aboard && voice.random() < 0.5) {
    bubble(voice, { at: 0.03, frequency: 200 + voice.random() * 140, gain: 0.25 });
  }
}

/** Distant thunder: sometimes a crack, always a long roll and a second one behind it. */
function thunder(voice: VoiceBuilder, stormLevel: number): void {
  const distance = voice.random();
  const gain = (0.45 - 0.25 * distance) * Math.sqrt(stormLevel);
  if (distance < 0.35) {
    voice.noise({
      gain: gain * 0.6, attack: 0.002, decay: 0.25,
      filter: { type: 'bandpass', frequency: 1400, sweepTo: 300, quality: 0.6 },
    });
  }
  voice.noise({
    at: 0.05, color: 'brown', gain: gain * 2.6, attack: 0.08 + 0.4 * distance, decay: 3 + 3 * voice.random(),
    filter: { type: 'lowpass', frequency: 420, sweepTo: 100 },
  });
  voice.noise({
    at: 0.7 + voice.random() * 0.8, color: 'brown', gain: gain * 1.8, attack: 0.3, decay: 2.5 + 2 * voice.random(),
    filter: { type: 'lowpass', frequency: 280, sweepTo: 90 },
  });
}

/** One snap of the fire. Most are tiny, a few are pops. */
function crackle(voice: VoiceBuilder): void {
  const size = voice.random() ** 3;
  voice.noise({
    gain: 0.12 + 0.6 * size, attack: 0.0005, decay: 0.008 + 0.022 * size,
    filter: { type: 'bandpass', frequency: 2000 + voice.random() * 4000, quality: 1.5 },
  });
  if (size > 0.55) hullThump(voice, { frequency: 150, gain: 0.25 * size, decay: 0.05 });
}

/** A glop of bilge water rolling under the ribs. */
function glop(voice: VoiceBuilder): void {
  bubble(voice, { frequency: 130 + voice.random() * 110, gain: 0.35 });
  voice.noise({
    color: 'pink', gain: 0.22, attack: 0.02, decay: 0.2,
    filter: { type: 'bandpass', frequency: 380, quality: 1.2 },
  });
}

/** Three invented songbirds: a falling whistle, a trill, a long note with triplets. */
function birdCall(voice: VoiceBuilder): void {
  const species = Math.floor(voice.random() * 3);
  if (species === 0) {
    const base = 3600 + voice.random() * 600;
    const notes = 2 + Math.floor(voice.random() * 2);
    for (let index = 0; index < notes; index += 1) {
      const frequency = base * (1 - index * 0.11);
      voice.tone({
        at: index * 0.42, frequency, glideTo: frequency * 0.96, gain: 1, attack: 0.03, hold: 0.18, decay: 0.15,
      });
    }
  } else if (species === 1) {
    const base = 4800 + voice.random() * 800;
    const notes = 8 + Math.floor(voice.random() * 7);
    for (let index = 0; index < notes; index += 1) {
      voice.tone({
        at: index * 0.055, frequency: base * 0.92, glideTo: base * 1.08, glideSeconds: 0.035, gain: 0.8,
        attack: 0.004, decay: 0.045,
      });
    }
  } else {
    const base = 2900 + voice.random() * 400;
    voice.tone({ frequency: base, gain: 1, attack: 0.04, hold: 0.4, decay: 0.12 });
    for (let group = 0; group < 3; group += 1) {
      for (let note = 0; note < 3; note += 1) {
        voice.tone({
          at: 0.7 + group * 0.36 + note * 0.1, frequency: base * 1.19, gain: 1 - group * 0.15, attack: 0.01,
          hold: 0.05, decay: 0.05,
        });
      }
    }
  }
}

/** A loon across the water: the long rising wail, or the quick wavering call. */
function loonCall(voice: VoiceBuilder): void {
  const base = 560 + voice.random() * 60;
  const partials = [[1, 1], [2, 0.22], [3, 0.06]] as const;
  if (voice.random() < 0.7) {
    for (const [harmonic, level] of partials) {
      voice.tone({
        frequency: base * harmonic, gain: level, attack: 0.18, hold: 1.5, decay: 0.7,
        contour: [
          { time: 0.3, frequency: base * harmonic },
          { time: 0.55, frequency: base * 1.5 * harmonic },
          { time: 1.5, frequency: base * 1.52 * harmonic },
          { time: 2.1, frequency: base * 1.12 * harmonic },
        ],
        vibrato: { rate: 5.5, depth: 5 * harmonic, delay: 0.6 },
        filter: { type: 'lowpass', frequency: 2400 },
      });
    }
  } else {
    const low = base * 1.45;
    const high = base * 1.8;
    const wavers = 9 + Math.floor(voice.random() * 5);
    const contour = Array.from({ length: wavers * 2 }, (_unused, index) => ({
      time: 0.05 * (index + 1), frequency: index % 2 === 0 ? high : low,
    }));
    for (const [harmonic, level] of partials) {
      voice.tone({
        frequency: low * harmonic, gain: level, attack: 0.06, hold: wavers * 0.1 - 0.1, decay: 0.3,
        contour: contour.map((point) => ({ time: point.time, frequency: point.frequency * harmonic })),
        filter: { type: 'lowpass', frequency: 2600 },
      });
    }
  }
}

/** One paddle stroke: the catch, the pull, the drips off the blade. */
function paddleStroke(voice: VoiceBuilder, power: boolean): void {
  const level = power ? 1.35 : 1;
  bubble(voice, { frequency: 200 + voice.random() * 40, gain: 0.12 * level });
  voice.noise({
    gain: 0.1 * level, attack: 0.004, decay: 0.08,
    filter: { type: 'bandpass', frequency: 900, quality: 1 },
  });
  voice.noise({
    at: 0.06, gain: 0.22 * level, attack: 0.16, decay: power ? 0.36 : 0.44,
    filter: { type: 'bandpass', frequency: 520, sweepTo: 1250, sweepSeconds: 0.3, quality: 0.9 },
  });
  for (let index = 0; index < 3; index += 1) {
    const frequency = 900 + voice.random() * 700;
    voice.tone({
      at: 0.62 + index * 0.09 + voice.random() * 0.04, frequency, glideTo: frequency * 1.5, glideSeconds: 0.025,
      gain: 0.035 * level, attack: 0.002, decay: 0.06,
    });
  }
}

/** A boot on pine needles and grit, or in the shallows. */
function footstep(voice: VoiceBuilder, running: boolean, wading: boolean): void {
  const level = running ? 1.3 : 1;
  if (wading) {
    waterSplash(voice, { gain: 0.18 * level, size: 0.12 });
    return;
  }
  const scale = 0.9 + voice.random() * 0.2;
  hullThump(voice, { frequency: 96 * scale, gain: 0.12 * level, decay: 0.06 });
  gravel(voice, { gain: 0.13 * level, seconds: 0.09, stones: 2 });
}

// --- The layers ------------------------------------------------------------------

/** A slow wobble multiplied onto a signal: gain swings around 1 by `depth`. */
interface Sway {
  rate: number;
  depth: number;
}

/** When the next grain of a family is due, in context time. 0 = not scheduled. */
interface GrainClock {
  next: number;
}

const STROKE_SECONDS = { paddle: 1.25, power: 0.92 } as const;
const BAIL_SECONDS = 0.95;
const WALK_STRIDE_METRES = 0.78;
const RUN_STRIDE_METRES = 1.15;
/** Above this ground speed the player is running. */
const RUN_SPEED = 3.4;

export interface Layers {
  /** Follow new inputs: glide the beds, and play the foley that tracks movement. */
  update(inputs: LayerInputs, frameSeconds: number): void;
  /** Schedule every scattered grain due within `lookahead` seconds. */
  schedule(lookahead: number): void;
  /** The level each bed is heading for. */
  levels(): Record<LayerName, number>;
  /** The gain node that sets each bed's level. */
  readonly gains: Record<LayerName, GainNode>;
  readonly inputs: LayerInputs;
}

export function createLayers(
  graph: AudioGraph,
  pool: VoicePool,
  output: AudioNode,
  ambienceCutoff: SmoothedParameter,
  playCue: (request: CueRequest) => void,
): Layers {
  const context = graph.context;
  let inputs: LayerInputs = { ...LOBBY_INPUTS };
  let levelTargets = computeLayerLevels({ ...inputs, roughness: 0, windSpeed: 0 });

  const gains = {} as Record<LayerName, GainNode>;
  const levels = {} as Record<LayerName, SmoothedParameter>;
  for (const name of LAYER_NAMES) {
    const node = graph.gain(0);
    graph.connect(node, output);
    gains[name] = node;
    levels[name] = createSmoothedParameter(context, node.gain, 0, 0.6);
  }

  const startLoop = (color: NoiseColor): AudioBufferSourceNode => {
    const source = graph.noise(color, 0.9 + graph.random() * 0.2);
    source.start(0, graph.noiseOffset(color));
    return source;
  };

  const startOscillator = (type: OscillatorType, frequency: number): OscillatorNode => {
    const oscillator = graph.oscillator(type, frequency);
    oscillator.start();
    return oscillator;
  };

  /** Multiply slow wobbles onto a signal and pass it on. */
  const sway = (source: AudioNode, sways: readonly Sway[]): AudioNode => {
    const node = graph.gain(1);
    graph.connect(source, node);
    for (const { rate, depth } of sways) {
      const depthNode = graph.gain(depth);
      graph.connect(startOscillator('sine', rate), depthNode);
      graph.connect(depthNode, node.gain);
    }
    return node;
  };

  /** Noise through filters in series. Returns the last node and the first filter. */
  const band = (
    color: NoiseColor, filters: readonly { type: BiquadFilterType; frequency: number; quality?: number }[],
  ): { output: AudioNode; filter: BiquadFilterNode } => {
    let tail: AudioNode = startLoop(color);
    let first: BiquadFilterNode | null = null;
    for (const settings of filters) {
      const filter = graph.filter(settings.type, settings.frequency, settings.quality ?? 0.707);
      graph.connect(tail, filter);
      tail = filter;
      first ??= filter;
    }
    return { output: tail, filter: first as BiquadFilterNode };
  };

  /** Wobble a filter's centre, in cents, so the band never sits still. */
  const wander = (filter: BiquadFilterNode, rate: number, cents: number): void => {
    const depthNode = graph.gain(cents);
    graph.connect(startOscillator('sine', rate), depthNode);
    graph.connect(depthNode, filter.detune);
  };

  // Water: a soft band that swells, opening up as the water gets rougher.
  const water = band('pink', [{ type: 'bandpass', frequency: 600, quality: 0.5 }]);
  graph.connect(sway(water.output, [{ rate: 0.11, depth: 0.35 }, { rate: 0.29, depth: 0.2 }]), gains.water);
  const waterTone = createSmoothedParameter(context, water.filter.frequency, 600, 1.5);

  // Wind: a wandering band, plus a thin whistle that only shows in a blow.
  const windBody = band('pink', [{ type: 'bandpass', frequency: 400, quality: 0.8 }]);
  wander(windBody.filter, 0.05, 260);
  graph.connect(sway(windBody.output, [{ rate: 0.07, depth: 0.3 }, { rate: 0.23, depth: 0.25 }]), gains.wind);
  const windTone = createSmoothedParameter(context, windBody.filter.frequency, 400, 2);
  const windWhistle = band('white', [{ type: 'bandpass', frequency: 1700, quality: 9 }]);
  wander(windWhistle.filter, 0.13, 250);
  const whistleGain = graph.gain(0);
  graph.connect(windWhistle.output, whistleGain);
  graph.connect(whistleGain, gains.wind);
  const whistleLevel = createSmoothedParameter(context, whistleGain.gain, 0, 2);

  // Wind in the pines: only near land.
  const pines = band('pink', [{ type: 'highpass', frequency: 2500 }, { type: 'lowpass', frequency: 7000 }]);
  graph.connect(sway(pines.output, [{ rate: 0.17, depth: 0.4 }]), gains.pines);

  // Rain: hiss in the air and a lower patter on the water.
  const rainHiss = band('white', [{ type: 'highpass', frequency: 1800 }, { type: 'lowpass', frequency: 9000 }]);
  const rainHissGain = graph.gain(0.7);
  graph.connect(rainHiss.output, rainHissGain);
  graph.connect(rainHissGain, gains.rain);
  const rainPatter = band('pink', [{ type: 'bandpass', frequency: 900, quality: 0.7 }]);
  const rainPatterGain = graph.gain(0.5);
  graph.connect(rainPatter.output, rainPatterGain);
  graph.connect(rainPatterGain, gains.rain);

  // Storm bed: a low rumble under everything. Kept above 60 Hz so small speakers carry it.
  const storm = band('brown', [{ type: 'lowpass', frequency: 300 }]);
  graph.connect(sway(storm.output, [{ rate: 0.09, depth: 0.35 }]), gains.storm);

  // Hull wash: water running past the canoe, brighter the faster it goes.
  const wash = band('pink', [{ type: 'bandpass', frequency: 700, quality: 0.7 }]);
  graph.connect(wash.output, gains.wash);
  const washTone = createSmoothedParameter(context, wash.filter.frequency, 700, 0.4);
  const ripple = band('white', [{ type: 'highpass', frequency: 3200 }]);
  const rippleGain = graph.gain(0.15);
  graph.connect(ripple.output, rippleGain);
  graph.connect(rippleGain, gains.wash);

  // Slosh: water in the hull rocking from side to side.
  const slosh = band('brown', [{ type: 'bandpass', frequency: 260, quality: 1.4 }]);
  const sloshPan = graph.panner(0);
  graph.connect(sway(slosh.output, [{ rate: 0.45, depth: 0.6 }]), sloshPan);
  graph.connect(sloshPan, gains.slosh);
  const sloshPanParameter = (sloshPan as Partial<StereoPannerNode>).pan;
  if (sloshPanParameter) {
    const depthNode = graph.gain(0.6);
    graph.connect(startOscillator('sine', 0.31), depthNode);
    graph.connect(depthNode, sloshPanParameter);
  }

  // Fire: a low fluttering roar and a little hiss. The crackle is grains.
  const fire = band('brown', [{ type: 'bandpass', frequency: 320, quality: 0.6 }]);
  graph.connect(sway(fire.output, [{ rate: 3.1, depth: 0.25 }, { rate: 0.7, depth: 0.2 }]), gains.fire);
  const fireHiss = band('pink', [{ type: 'highpass', frequency: 1500 }]);
  const fireHissGain = graph.gain(0.08);
  graph.connect(fireHiss.output, fireHissGain);
  graph.connect(fireHissGain, gains.fire);

  // Crickets: two pulsed tones, left and right, drifting in and out of step.
  for (const [frequency, pulseRate, chirpRate, pan] of [[4300, 31, 2.2, -0.5], [4750, 37, 1.7, 0.5]] as const) {
    const pulse = graph.gain(0.5);
    const pulseDepth = graph.gain(0.5);
    graph.connect(startOscillator('sine', pulseRate), pulseDepth);
    graph.connect(pulseDepth, pulse.gain);
    const chirp = graph.gain(0.5);
    const chirpEdge = graph.filter('lowpass', 25);
    const chirpDepth = graph.gain(0.5);
    graph.connect(startOscillator('square', chirpRate), chirpEdge);
    graph.connect(chirpEdge, chirpDepth);
    graph.connect(chirpDepth, chirp.gain);
    const panner = graph.panner(pan);
    graph.connect(startOscillator('sine', frequency), pulse);
    graph.connect(pulse, chirp);
    graph.connect(chirp, panner);
    graph.connect(panner, gains.crickets);
  }

  // Fog hush: a faint low air that fills the space the fog takes away.
  const hush = band('pink', [{ type: 'lowpass', frequency: 500 }]);
  graph.connect(hush.output, gains.hush);

  // --- Grain clocks --------------------------------------------------------------
  const clocks = {
    wavelet: { next: 0 }, thunder: { next: 0 }, crackle: { next: 0 }, bird: { next: 0 }, loon: { next: 0 },
    glop: { next: 0 },
  } satisfies Record<string, GrainClock>;

  /** Fire every grain of one family that falls inside the lookahead window. */
  const runClock = (
    clock: GrainClock, active: boolean, lookahead: number, firstDelay: () => number, interval: () => number,
    fire: (delay: number) => void,
  ): void => {
    if (!active) {
      clock.next = 0;
      return;
    }
    const now = graph.now();
    if (clock.next === 0 || clock.next < now - 1) clock.next = now + firstDelay();
    for (let fired = 0; fired < 8 && clock.next < now + lookahead; fired += 1) {
      fire(Math.max(0, clock.next - now));
      clock.next += Math.max(0.02, interval());
    }
  };

  const randomBetween = (minimum: number, maximum: number): number => minimum + graph.random() * (maximum - minimum);
  const randomPan = (width: number): number => (graph.random() * 2 - 1) * width;

  const schedule = (lookahead: number): void => {
    const target = levelTargets;
    const roughness = clamp(inputs.roughness, 0, 4);

    runClock(clocks.wavelet, target.water > 0.05, lookahead, () => randomBetween(0.1, 1),
      () => randomBetween(0.6, 1.8) / (0.5 + 0.5 * roughness), (delay) => {
        const voice = pool.open({
          bus: 'ambience', label: 'wavelet', priority: 1, delay, pan: randomPan(0.7),
          gain: 0.2 * target.water, reverb: 0.1,
        });
        if (voice) wavelet(voice, roughness, inputs.aboard);
      });

    runClock(clocks.thunder, inputs.stormLevel > 0.15, lookahead, () => randomBetween(2, 6),
      () => randomBetween(9, 26) / Math.max(0.35, inputs.stormLevel), (delay) => {
        const voice = pool.open({
          bus: 'ambience', label: 'thunder', priority: 3, delay, pan: randomPan(0.6), reverb: 0.5,
        });
        if (voice) thunder(voice, inputs.stormLevel);
      });

    runClock(clocks.crackle, inputs.nearFire, lookahead, () => 0.05,
      () => -Math.log(1 - graph.random()) / 9, (delay) => {
        const voice = pool.open({
          bus: 'ambience', label: 'crackle', priority: 1, delay, pan: randomPan(0.25), gain: 0.5,
        });
        if (voice) crackle(voice);
      });

    const birds = birdActivity(inputs);
    runClock(clocks.bird, birds > 0.05, lookahead, () => randomBetween(1, 5) / birds,
      () => randomBetween(3, 10) / birds, (delay) => {
        const voice = pool.open({
          bus: 'ambience', label: 'bird', priority: 1, delay, pan: randomPan(0.9),
          gain: randomBetween(0.025, 0.06), reverb: randomBetween(0.35, 0.6),
        });
        if (voice) birdCall(voice);
      });

    const loons = loonActivity(inputs);
    runClock(clocks.loon, loons > 0.05, lookahead, () => randomBetween(8, 25) / loons,
      () => randomBetween(35, 90) / loons, (delay) => {
        const voice = pool.open({
          bus: 'ambience', label: 'loon', priority: 2, delay, pan: randomPan(0.8),
          gain: randomBetween(0.06, 0.1), reverb: 0.7,
        });
        if (voice) loonCall(voice);
      });

    runClock(clocks.glop, target.slosh > 0.1, lookahead, () => randomBetween(0.2, 1),
      () => randomBetween(0.5, 2) / (0.4 + inputs.hullWater), (delay) => {
        const voice = pool.open({
          bus: 'ambience', label: 'glop', priority: 1, delay, pan: randomPan(0.4), gain: 0.25 * target.slosh,
        });
        if (voice) glop(voice);
      });
  };

  // --- Foley that tracks movement --------------------------------------------------
  let nextStrokeAt = 0;
  let strokeSide = 1;
  let nextBailAt = 0;
  let strideProgress = 0;
  let stepSide = 1;
  let scavengeNodeId: string | null = null;
  let nextScavengeAt = 0;

  const foley = (frameSeconds: number): void => {
    const now = graph.now();

    if (inputs.paddling === 'none' || !inputs.aboard) {
      nextStrokeAt = 0;
    } else if (now >= nextStrokeAt) {
      const power = inputs.paddling === 'power';
      const voice = pool.open({ bus: 'effects', label: 'paddle', priority: 1, pan: strokeSide * 0.45, reverb: 0.08 });
      if (voice) paddleStroke(voice, power);
      strokeSide = -strokeSide;
      nextStrokeAt = now + STROKE_SECONDS[inputs.paddling] * randomBetween(0.95, 1.05);
    }

    if (!inputs.bailing) {
      nextBailAt = 0;
    } else if (now >= nextBailAt) {
      playCue({ cue: 'bail' });
      nextBailAt = now + BAIL_SECONDS;
    }

    if (!inputs.onFoot || inputs.footSpeed < 0.3) {
      // Standing still: the next step lands as soon as the player moves off.
      strideProgress = Math.max(strideProgress, 0.6);
    } else {
      const running = inputs.footSpeed > RUN_SPEED;
      strideProgress += (inputs.footSpeed * frameSeconds) / (running ? RUN_STRIDE_METRES : WALK_STRIDE_METRES);
      if (strideProgress >= 1) {
        strideProgress %= 1;
        const voice = pool.open({ bus: 'effects', label: 'footstep', priority: 1, pan: stepSide * 0.12 });
        if (voice) footstep(voice, running, inputs.wading);
        stepSide = -stepSide;
      }
    }

    // In the game a scavenge is one press: its harvest_started event plays the one hit and `scavenge`
    // stays null. The rhythm below is only heard in the sound lab, which can hold a node open.
    const request = inputs.scavenge ? scavengeRequest(inputs.scavenge.nodeId, inputs.scavenge.actionIndex) : null;
    if (!inputs.scavenge || !request) {
      scavengeNodeId = null;
    } else if (scavengeNodeId !== inputs.scavenge.nodeId) {
      scavengeNodeId = inputs.scavenge.nodeId;
      nextScavengeAt = now + SCAVENGE_INTERVAL[request.kind];
    } else if (now >= nextScavengeAt) {
      playCue(request);
      nextScavengeAt = now + SCAVENGE_INTERVAL[request.kind] * randomBetween(0.92, 1.08);
    }
  };

  return {
    update(next: LayerInputs, frameSeconds: number): void {
      inputs = next;
      levelTargets = computeLayerLevels(inputs);
      for (const name of LAYER_NAMES) levels[name].set(levelTargets[name], name === 'wash' ? 0.25 : undefined);
      const wind = clamp(inputs.windSpeed, 0, 14);
      waterTone.set(420 + 180 * clamp(inputs.roughness, 0, 4));
      windTone.set(200 + 65 * wind);
      whistleLevel.set(clamp((wind - 6) / 6, 0, 1) ** 2 * 0.5);
      washTone.set(700 + 260 * Math.min(Math.abs(inputs.canoeSpeed), 5));
      ambienceCutoff.set(fogCutoff(inputs.fog));
      foley(frameSeconds);
    },
    schedule,
    levels: () => ({ ...levelTargets }),
    gains,
    get inputs(): LayerInputs {
      return inputs;
    },
  };
}

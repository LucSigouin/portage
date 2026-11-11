/**
 * The audio lab: a plain dev page for judging the sound by ear.
 * http://localhost:5220/audio-lab.html
 *
 * It drives the same engine the game uses. One-shots go in as real game
 * events. The world sliders stand in for the game state: they feed the layers
 * the same numbers `update` would derive from a `GameState`.
 *
 * `?selftest=1` runs the self-test as soon as the page loads.
 */
import type { RegionId, WeatherKind } from '../../data/index.ts';
import { SILENT_EVENTS, scavengeRequest } from '../cues.ts';
import { createEngineCore } from '../engine.ts';
import type { AudioScene, AudioVolumes } from '../engine.ts';
import { SOFT_CLIP_CEILING } from '../graph.ts';
import { INTERFACE_SOUND_NAMES } from '../interface-sounds.ts';
import type { LayerInputs } from '../layers.ts';
import { dayPhase } from '../music.ts';
import { VOICE_LIMITS } from '../voices.ts';
import type { BusName } from '../voices.ts';
import { LAB_SOUNDS, WORLD_PRESETS, cueSeconds, nodeOfType } from './catalogue.ts';
import type { LabSound } from './catalogue.ts';
import { DEFAULT_VOLUMES, formatDecibels, offlineRenderingAvailable, runSelfTest, toDecibels } from './selftest.ts';
import type { SelfTestRow } from './selftest.ts';

const engine = createEngineCore();
const { inspector } = engine;

// --- Small DOM helpers ---------------------------------------------------------

type Child = Node | string;

function element<Tag extends keyof HTMLElementTagNameMap>(
  tag: Tag, className = '', children: readonly Child[] = [],
): HTMLElementTagNameMap[Tag] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.append(...children);
  return node;
}

function button(label: string, onClick: () => void, className = ''): HTMLButtonElement {
  const node = element('button', className, [label]);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

function panel(title: string, hint: string, children: readonly Child[]): HTMLElement {
  return element('section', 'panel', [
    element('h2', '', [title]),
    ...(hint ? [element('p', 'hint', [hint])] : []),
    ...children,
  ]);
}

function mount(id: string, ...children: Child[]): void {
  const host = document.getElementById(id);
  if (!host) throw new Error(`audio-lab.html has no #${id}`);
  host.replaceChildren(...children);
}

// --- Start, scenes, volumes ----------------------------------------------------

let unlocked = false;
let scene: AudioScene = 'lobby';
let volumes: AudioVolumes = { ...DEFAULT_VOLUMES };
let analysers: { master: AnalyserNode; output: AnalyserNode; samples: Float32Array<ArrayBuffer> } | null = null;

const statusLine = element('span', 'status', ['Locked. Browsers allow no sound before a click.']);
const unlockButton = button('Unlock audio', () => {
  void unlock();
}, 'primary');

async function unlock(): Promise<void> {
  await engine.unlock();
  const context = inspector.context();
  const nodes = inspector.nodes();
  if (!context || !nodes) {
    statusLine.textContent = 'This browser has no WebAudio. The engine stays silent.';
    return;
  }
  if (!analysers) {
    const master = context.createAnalyser();
    const output = context.createAnalyser();
    master.fftSize = 2048;
    output.fftSize = 2048;
    nodes.master.connect(master);
    nodes.output.connect(output);
    analysers = { master, output, samples: new Float32Array(2048) };
  }
  unlocked = true;
  unlockButton.textContent = 'Audio unlocked';
  unlockButton.classList.add('done');
  document.body.classList.add('unlocked');
}

const sceneButtons = new Map<AudioScene, HTMLButtonElement>();
function setScene(next: AudioScene): void {
  scene = next;
  engine.setScene(next);
  for (const [name, node] of sceneButtons) node.classList.toggle('active', name === next);
}
const SCENE_HINTS: Record<AudioScene, string> = {
  lobby: 'theme, calm water',
  game: 'follows the sliders',
  paused: 'world down, music kept',
  credits: 'fuller theme, dusk',
};

interface Control {
  row: HTMLElement;
  set(value: number): void;
}

/** A labelled range input that shows its value. */
function slider(
  label: string, minimum: number, maximum: number, step: number, initial: number,
  format: (value: number) => string, onInput: (value: number) => void,
): Control {
  const input = element('input');
  input.type = 'range';
  input.min = String(minimum);
  input.max = String(maximum);
  input.step = String(step);
  input.value = String(initial);
  const readout = element('output', '', [format(initial)]);
  input.addEventListener('input', () => {
    const value = Number(input.value);
    readout.textContent = format(value);
    onInput(value);
  });
  return {
    row: element('label', 'control', [element('span', 'name', [label]), input, readout]),
    set(value: number): void {
      input.value = String(value);
      readout.textContent = format(Number(input.value));
    },
  };
}

function checkbox(label: string, initial: boolean, onInput: (value: boolean) => void): Control {
  const input = element('input');
  input.type = 'checkbox';
  input.checked = initial;
  input.addEventListener('input', () => onInput(input.checked));
  return {
    row: element('label', 'control check', [input, element('span', 'name', [label])]),
    set(value: number): void {
      input.checked = value !== 0;
    },
  };
}

function select<Value extends string>(
  label: string, options: readonly (readonly [Value, string])[], initial: Value, onInput: (value: Value) => void,
): { row: HTMLElement; set(value: Value): void } {
  const input = element('select');
  for (const [value, text] of options) {
    const option = element('option', '', [text]);
    option.value = value;
    input.append(option);
  }
  input.value = initial;
  input.addEventListener('input', () => onInput(input.value as Value));
  return {
    row: element('label', 'control', [element('span', 'name', [label]), input]),
    set(value: Value): void {
      input.value = value;
    },
  };
}

const percent = (value: number): string => `${Math.round(value * 100)}%`;
const fixed = (digits: number, unit = '') => (value: number): string => `${value.toFixed(digits)}${unit}`;

function buildStart(): void {
  for (const name of ['lobby', 'game', 'paused', 'credits'] as const) {
    const node = button(name, () => setScene(name), 'scene');
    node.append(element('small', '', [SCENE_HINTS[name]]));
    sceneButtons.set(name, node);
  }
  const volumeControls = (['master', 'music', 'effects', 'ambience'] as const).map((name) =>
    slider(name, 0, 1, 0.01, volumes[name], percent, (value) => {
      volumes = { ...volumes, [name]: value };
      engine.setVolumes(volumes);
    }));

  mount('start',
    panel('1. Start', '', [
      element('div', 'row', [unlockButton, statusLine]),
      element('div', 'row', [
        button('Suspend', () => engine.suspend()),
        button('Resume', () => engine.resume()),
      ]),
    ]),
    panel('Scene', 'Sets the music and the balance between the buses.', [
      element('div', 'scenes', [...sceneButtons.values()]),
    ]),
    panel('Volumes', 'The four sliders of the settings screen. Half-way sounds like half.', [
      ...volumeControls.map((control) => control.row),
      button('Reset to the default settings', () => {
        volumes = { ...DEFAULT_VOLUMES };
        engine.setVolumes(volumes);
        volumeControls.forEach((control, index) => {
          control.set(volumes[(['master', 'music', 'effects', 'ambience'] as const)[index]]);
        });
      }),
    ]),
  );
  setScene('lobby');
}

// --- Meter -----------------------------------------------------------------------

const METER_FLOOR = -60;
const meter = {
  outputBar: element('div', 'bar'),
  masterBar: element('div', 'bar'),
  outputText: element('output', '', ['-inf']),
  masterText: element('output', '', ['-inf']),
  holdText: element('output', '', ['-inf']),
  reductionText: element('output', '', ['0.0']),
  voices: element('div', 'voices'),
  musicText: element('output', '', ['silent']),
  contextText: element('output', '', ['locked']),
};
let heldPeak = 0;
/** Largest output sample since the last reset, for the play-all table. */
let windowPeak = 0;

const barWidth = (level: number): string =>
  `${Math.max(0, Math.min(100, (1 - toDecibels(level) / METER_FLOOR) * 100))}%`;

function peakOf(analyser: AnalyserNode, samples: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(samples);
  let peak = 0;
  for (const sample of samples) {
    const magnitude = Math.abs(sample);
    if (magnitude > peak) peak = magnitude;
  }
  return peak;
}

function buildMeter(): void {
  const meterRow = (label: string, bar: HTMLElement, text: HTMLElement): HTMLElement =>
    element('div', 'meter-row', [element('span', 'name', [label]), element('div', 'track', [bar]), text, ' dBFS']);
  const fact = (label: string, value: HTMLElement, unit = ''): HTMLElement =>
    element('div', 'fact', [element('span', 'name', [label]), value, unit]);
  mount('meter', panel('Live meter', `Peak level of what you hear. The soft clipper tops out at ${formatDecibels(SOFT_CLIP_CEILING)} dBFS, so the output cannot clip.`, [
    meterRow('Output', meter.outputBar, meter.outputText),
    meterRow('Before limiter', meter.masterBar, meter.masterText),
    element('div', 'facts', [
      fact('Peak held', meter.holdText, ' dBFS'),
      fact('Limiter', meter.reductionText, ' dB'),
      fact('Music', meter.musicText),
      fact('Context', meter.contextText),
    ]),
    element('div', 'row', [
      element('span', 'name', ['Active voices']),
      meter.voices,
      button('Reset peak', () => {
        heldPeak = 0;
      }),
    ]),
  ]));
}

function updateMeter(): void {
  const context = inspector.context();
  meter.contextText.textContent = context ? `${context.state}, ${context.sampleRate} Hz` : 'locked';
  meter.musicText.textContent = inspector.musicState();
  meter.voices.replaceChildren(...(Object.keys(VOICE_LIMITS) as BusName[]).map((bus) =>
    element('span', 'voice', [`${bus} ${inspector.voiceCount(bus)}/${VOICE_LIMITS[bus]}`])));
  if (!analysers) return;
  const output = peakOf(analysers.output, analysers.samples);
  const master = peakOf(analysers.master, analysers.samples);
  heldPeak = Math.max(heldPeak, output);
  windowPeak = Math.max(windowPeak, output);
  meter.outputBar.style.width = barWidth(output);
  meter.masterBar.style.width = barWidth(master);
  meter.outputBar.classList.toggle('hot', toDecibels(output) > -1);
  meter.masterBar.classList.toggle('hot', toDecibels(master) > -1);
  meter.outputText.textContent = formatDecibels(output);
  meter.masterText.textContent = formatDecibels(master);
  meter.holdText.textContent = formatDecibels(heldPeak);
  meter.reductionText.textContent = (inspector.nodes()?.limiter.reduction ?? 0).toFixed(1);
}

// --- World state -----------------------------------------------------------------

const SCAVENGE_CHOICES = [
  ['none', 'not scavenging'],
  ['chop', 'chopping a spruce'],
  ['pry', 'prying a crate'],
  ['rummage', 'rummaging in a junk heap'],
  ['pick', 'picking berries'],
  ['splash', 'fishing'],
] as const;
type ScavengeChoice = (typeof SCAVENGE_CHOICES)[number][0];

const SCAVENGE_NODES: Record<Exclude<ScavengeChoice, 'none'>, { nodeId: string; actionIndex: number }> = {
  chop: { nodeId: nodeOfType('spruce'), actionIndex: 1 },
  pry: { nodeId: nodeOfType('crate'), actionIndex: 0 },
  rummage: { nodeId: nodeOfType('junk_heap'), actionIndex: 0 },
  pick: { nodeId: nodeOfType('berry_bush'), actionIndex: 0 },
  splash: { nodeId: nodeOfType('fishing_spot'), actionIndex: 0 },
};

let world: LayerInputs = { ...WORLD_PRESETS[0].inputs };
/** Every control, so a preset can move them all. */
const worldControls: ((inputs: LayerInputs) => void)[] = [];

function buildWorld(): void {
  const number = (
    key: 'roughness' | 'windSpeed' | 'rain' | 'stormLevel' | 'fog' | 'canoeSpeed' | 'hullWater' | 'hour' | 'openWater'
      | 'footSpeed' | 'heightAboveWater',
    label: string, minimum: number, maximum: number, step: number, format: (value: number) => string,
  ): HTMLElement => {
    const control = slider(label, minimum, maximum, step, world[key], format, (value) => {
      world = { ...world, [key]: value };
    });
    worldControls.push((inputs) => control.set(inputs[key]));
    return control.row;
  };
  const flag = (key: 'bailing' | 'nearFire' | 'nearCanoe' | 'wading', label: string): HTMLElement => {
    const control = checkbox(label, world[key], (value) => {
      world = { ...world, [key]: value };
    });
    worldControls.push((inputs) => control.set(inputs[key] ? 1 : 0));
    return control.row;
  };

  const region = select<RegionId>('Region', [
    ['shallows', 'The Shallows'], ['reach', 'The Reach'], ['narrows', 'The Narrows'], ['fog', 'The Fog'],
  ], world.regionId, (value) => {
    world = { ...world, regionId: value };
  });
  worldControls.push((inputs) => region.set(inputs.regionId));

  const weather = select<WeatherKind>('Weather (music)', [
    ['clear', 'clear'], ['fog', 'fog'], ['rain', 'rain'], ['storm', 'storm'],
  ], world.weatherKind, (value) => {
    world = { ...world, weatherKind: value };
  });
  worldControls.push((inputs) => weather.set(inputs.weatherKind));

  const paddling = select<LayerInputs['paddling']>('Paddling', [
    ['none', 'not paddling'], ['paddle', 'paddling'], ['power', 'power stroke'],
  ], world.paddling, (value) => {
    world = { ...world, paddling: value };
  });
  worldControls.push((inputs) => paddling.set(inputs.paddling));

  const onFoot = checkbox('On foot (off: in the canoe)', world.onFoot, (value) => {
    world = { ...world, onFoot: value, aboard: !value };
  });
  worldControls.push((inputs) => onFoot.set(inputs.onFoot ? 1 : 0));

  const scavenge = select<ScavengeChoice>('Scavenging', SCAVENGE_CHOICES, 'none', (value) => {
    const held = value === 'none' ? null : SCAVENGE_NODES[value];
    world = { ...world, scavenge: held };
    // In the game the harvest_started event plays the first hit.
    if (held) inspector.playCue(scavengeRequest(held.nodeId, held.actionIndex) ?? { cue: 'scavenge_pick' });
  });
  worldControls.push((inputs) => {
    if (!inputs.scavenge) scavenge.set('none');
  });

  const clock = (value: number): string => {
    const hours = Math.floor(value);
    const minutes = Math.round((value - hours) * 60);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')} ${dayPhase(value)}`;
  };

  const group = (title: string, rows: readonly HTMLElement[]): HTMLElement =>
    element('fieldset', '', [element('legend', '', [title]), ...rows]);

  const applyPreset = (inputs: LayerInputs): void => {
    world = { ...inputs };
    for (const control of worldControls) control(world);
    if (scene !== 'game') setScene('game');
  };

  mount('world', panel('2. World', 'Stands in for the game state. The layers and the music follow these in the game scene; the lobby and the credits bring their own.', [
    element('div', 'presets', WORLD_PRESETS.map((preset) => button(preset.label, () => applyPreset(preset.inputs)))),
    element('div', 'groups', [
      group('Water and weather', [
        number('roughness', 'Water roughness', 0, 4, 0.1, fixed(1)),
        number('windSpeed', 'Wind', 0, 14, 0.5, fixed(1, ' m/s')),
        number('rain', 'Rain', 0, 1, 0.05, percent),
        number('stormLevel', 'Storm', 0, 1, 0.05, percent),
        number('fog', 'Fog', 0, 1, 0.05, percent),
        weather.row,
      ]),
      group('Place and time', [
        region.row,
        number('hour', 'Time of day', 0, 24, 0.25, clock),
        number('openWater', 'Open water', 0, 1, 0.05, percent),
        flag('nearFire', 'Fire in reach'),
      ]),
      group('Canoe', [
        number('canoeSpeed', 'Canoe speed', -1.2, 5, 0.1, fixed(1, ' m/s')),
        paddling.row,
        number('hullWater', 'Water in the hull', 0, 1, 0.05, percent),
        flag('bailing', 'Bailing'),
        flag('nearCanoe', 'Near the canoe'),
      ]),
      group('On foot', [
        onFoot.row,
        number('footSpeed', 'Walking speed', 0, 4.4, 0.1, (value) => `${value.toFixed(1)} m/s${value > 3.4 ? ' run' : ''}`),
        flag('wading', 'Wading'),
        number('heightAboveWater', 'Height above the water', 0, 20, 0.5, fixed(1, ' m')),
        scavenge.row,
      ]),
    ]),
  ]));
}

// --- One-shots and interface -------------------------------------------------------

function play(sound: LabSound): void {
  if (sound.event) engine.handleEvents([sound.event]);
  else inspector.playCue(sound.request);
}

function buildSounds(): void {
  const groups = new Map<string, HTMLElement[]>();
  for (const sound of LAB_SOUNDS) {
    const node = button(sound.label, () => play(sound));
    node.title = sound.event ? `event: ${sound.event.type}, cue: ${sound.request.cue}` : `cue: ${sound.request.cue}`;
    groups.set(sound.group, [...(groups.get(sound.group) ?? []), node]);
  }
  mount('sounds', panel('3. One-shots', 'Each button sends the real game event. Hover for the event and cue names. Important ones duck the music.', [
    ...[...groups].map(([name, buttons]) =>
      element('div', 'group', [element('h3', '', [name]), element('div', 'buttons', buttons)])),
    element('p', 'hint', [`Silent on purpose: ${SILENT_EVENTS.join(', ')}. The weather is carried by the layers, the other two are bookkeeping.`]),
  ]));

  mount('interface', panel('Interface', 'Menu sounds. They ride the effects volume and are not turned down when paused.', [
    element('div', 'buttons', INTERFACE_SOUND_NAMES.map((sound) => button(sound, () => engine.playInterface(sound)))),
  ]));
}

// --- Self-test ---------------------------------------------------------------------

const selfTest = {
  status: element('p', 'status', ['Not run yet.']),
  body: element('tbody'),
  live: new Map<string, HTMLElement>(),
};
let selfTestRunning = false;
let playingAll = false;

function addSelfTestRow(row: SelfTestRow): void {
  const measurement = row.measurement;
  const cells = measurement
    ? [
      formatDecibels(measurement.masterPeak), formatDecibels(measurement.outputPeak),
      formatDecibels(measurement.outputRms), measurement.soundingSeconds.toFixed(1),
    ]
    : ['', '', '', ''];
  const live = element('td', 'number', ['']);
  selfTest.live.set(row.label, live);
  selfTest.body.append(element('tr', row.verdict, [
    element('td', '', [row.section]),
    element('td', '', [row.label]),
    element('td', '', [row.volumes]),
    ...cells.map((text) => element('td', 'number', [text])),
    live,
    element('td', 'verdict', [row.verdict]),
    element('td', 'note', [row.failure ?? row.note]),
  ]));
}

async function startSelfTest(): Promise<void> {
  if (selfTestRunning) return;
  if (!offlineRenderingAvailable()) {
    selfTest.status.textContent = 'This browser has no OfflineAudioContext: the self-test cannot run here.';
    return;
  }
  selfTestRunning = true;
  selfTest.body.replaceChildren();
  selfTest.live.clear();
  const startedAt = performance.now();
  const rows = await runSelfTest((row, done, total) => {
    addSelfTestRow(row);
    selfTest.status.textContent = `Rendering ${done} of ${total}...`;
  });
  const measured = rows.flatMap((row) => (row.measurement ? [row.measurement] : []));
  const loudest = measured.reduce((peak, measurement) => Math.max(peak, measurement.outputPeak), 0);
  const count = (verdict: SelfTestRow['verdict']): number => rows.filter((row) => row.verdict === verdict).length;
  selfTest.status.textContent = `Self-test done: ${rows.length} sounds rendered in ${((performance.now() - startedAt) / 1000).toFixed(1)} s. `
    + `Loudest output ${formatDecibels(loudest)} dBFS (ceiling ${formatDecibels(SOFT_CLIP_CEILING)}). `
    + `${count('ok')} ok, ${count('quiet')} quiet, ${count('silent')} silent, ${count('hot')} hot, ${count('failed')} failed.`;
  selfTest.status.classList.add('finished');
  document.body.dataset.selfTest = 'done';
  selfTestRunning = false;
}

/** Play every one-shot aloud, one after another, noting the live peak of each. */
async function playAll(): Promise<void> {
  if (playingAll) {
    playingAll = false;
    return;
  }
  await unlock();
  if (!unlocked) return;
  playingAll = true;
  const wait = (seconds: number): Promise<void> => new Promise((resolve) => {
    setTimeout(resolve, seconds * 1000);
  });
  for (const sound of LAB_SOUNDS) {
    if (!playingAll) break;
    selfTest.status.textContent = `Playing: ${sound.group}: ${sound.label}`;
    windowPeak = 0;
    play(sound);
    await wait(Math.min(cueSeconds(sound.request), 6) + 0.9);
    const cell = selfTest.live.get(`${sound.group}: ${sound.label}`);
    if (cell) cell.textContent = formatDecibels(windowPeak);
  }
  selfTest.status.textContent = playingAll ? 'Played every one-shot.' : 'Stopped.';
  playingAll = false;
}

function buildSelfTest(): void {
  const header = ['Section', 'Sound', 'Volumes', 'Before limiter, peak dBFS', 'Output, peak dBFS', 'Output, RMS dBFS', 'Sounds for, s', 'Heard live, peak dBFS', 'Verdict', 'Note'];
  mount('selftest', panel('4. Self-test', 'Renders every sound through an offline context, with no speakers involved, and measures every sample. One-shots and music are rendered alone on their bus at the default volumes; layers are measured after they settle. It checks levels, not whether anything sounds good.', [
    element('div', 'row', [
      button('Run self-test', () => {
        void startSelfTest();
      }, 'primary'),
      button('Play every one-shot in turn', () => {
        void playAll();
      }),
      selfTest.status,
    ]),
    element('div', 'table-wrap', [
      element('table', '', [
        element('thead', '', [element('tr', '', header.map((text) => element('th', '', [text])))]),
        selfTest.body,
      ]),
    ]),
  ]));
}

// --- Frame loop --------------------------------------------------------------------

let lastFrame = performance.now();
function frame(now: number): void {
  const frameSeconds = Math.min(0.25, (now - lastFrame) / 1000);
  lastFrame = now;
  if (unlocked) {
    // In the game the sliders are the state. The lobby and the credits bring their own.
    if (scene === 'game' || scene === 'paused') inspector.applyLayerInputs(world, frameSeconds);
    inspector.tick();
  }
  updateMeter();
  requestAnimationFrame(frame);
}

buildStart();
buildMeter();
buildWorld();
buildSounds();
buildSelfTest();
requestAnimationFrame(frame);

// Any first click on the page is a gesture: use it, so no button is ever silent.
document.addEventListener('pointerdown', () => {
  if (!unlocked) void unlock();
}, { capture: true });

if (new URLSearchParams(location.search).has('selftest')) void startSelfTest();

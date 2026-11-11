import { describe, expect, it } from 'vitest';
import { createDefaultSettings } from '../../src/settings/index.ts';
import { DIALOGUE_DUCK, SCENE_MIX, createEngineCore, volumeToGain } from '../../src/audio/engine.ts';
import {
  SOFT_CLIP_CEILING, SOFT_CLIP_KNEE, createSoftClipCurve, scheduleEnvelope, softClip,
} from '../../src/audio/graph.ts';
import {
  FakeAudioContext, FakeAudioNode, FakeAudioParam, FakeCompressorNode, FakeWaveShaperNode, fakeGain, inputsOf,
} from './fake-audio-context.ts';
import { SAMPLE_EVENTS, createRig } from './support.ts';

const settled = (node: GainNode): number => fakeGain(node).gain.settledValue();

describe('mix', () => {
  it('bus gains follow setVolumes', async () => {
    const { context, engine, nodes } = await createRig();
    engine.setVolumes({ master: 0.5, music: 0.25, effects: 1, ambience: 0 });
    context.advance(2);
    const now = context.currentTime;
    expect(fakeGain(nodes.master).gain.valueAtTime(now)).toBeCloseTo(0.25, 5);
    expect(fakeGain(nodes.buses.music).gain.valueAtTime(now)).toBeCloseTo(0.0625, 5);
    expect(fakeGain(nodes.buses.effects).gain.valueAtTime(now)).toBeCloseTo(1, 5);
    expect(fakeGain(nodes.buses.ambience).gain.valueAtTime(now)).toBeCloseTo(0, 5);

    engine.setVolumes({ master: 1, music: 1, effects: 0.5, ambience: 0.5 });
    expect(settled(nodes.master)).toBeCloseTo(1, 5);
    expect(settled(nodes.buses.music)).toBeCloseTo(1, 5);
    expect(settled(nodes.buses.effects)).toBeCloseTo(0.25, 5);
    expect(settled(nodes.buses.ambience)).toBeCloseTo(0.25, 5);
    engine.dispose();
  });

  it('glides to a new volume instead of jumping', async () => {
    const { context, engine, nodes } = await createRig();
    engine.setVolumes({ master: 1, music: 1, effects: 1, ambience: 1 });
    context.advance(2);
    engine.setVolumes({ master: 0, music: 1, effects: 1, ambience: 1 });
    const master = fakeGain(nodes.master).gain;
    const now = context.currentTime;
    expect(master.valueAtTime(now)).toBeCloseTo(1, 3);
    const soon = master.valueAtTime(now + 0.02);
    expect(soon).toBeLessThan(1);
    expect(soon).toBeGreaterThan(0);
    expect(master.valueAtTime(now + 1)).toBeCloseTo(0, 5);
    engine.dispose();
  });

  it('starts from the default settings and keeps volumes set before unlock', async () => {
    const defaults = createDefaultSettings().audio;
    const first = await createRig();
    expect(settled(first.nodes.master)).toBeCloseTo(volumeToGain(defaults.master), 5);
    expect(settled(first.nodes.buses.music)).toBeCloseTo(volumeToGain(defaults.music), 5);
    expect(settled(first.nodes.buses.effects)).toBeCloseTo(volumeToGain(defaults.effects), 5);
    expect(settled(first.nodes.buses.ambience)).toBeCloseTo(volumeToGain(defaults.ambience), 5);
    first.engine.dispose();

    const context = new FakeAudioContext();
    const engine = createEngineCore({ contextFactory: () => context.asAudioContext(), autoTick: false });
    engine.setVolumes({ master: 0.3, music: 0.4, effects: 0.5, ambience: 0.6 });
    await engine.unlock();
    const nodes = engine.inspector.nodes();
    expect(settled(nodes!.master)).toBeCloseTo(0.09, 5);
    expect(settled(nodes!.buses.music)).toBeCloseTo(0.16, 5);
    expect(settled(nodes!.buses.effects)).toBeCloseTo(0.25, 5);
    expect(settled(nodes!.buses.ambience)).toBeCloseTo(0.36, 5);
    engine.dispose();
  });

  it('clamps volumes and ignores values that are not numbers', async () => {
    const { engine, nodes } = await createRig();
    engine.setVolumes({ master: 5, music: -2, effects: Number.NaN, ambience: Number.POSITIVE_INFINITY });
    expect(settled(nodes.master)).toBeCloseTo(1, 5);
    expect(settled(nodes.buses.music)).toBeCloseTo(0, 5);
    expect(settled(nodes.buses.effects)).toBeCloseTo(volumeToGain(createDefaultSettings().audio.effects), 5);
    expect(settled(nodes.buses.ambience)).toBeCloseTo(volumeToGain(createDefaultSettings().audio.ambience), 5);
    engine.dispose();
  });

  it('maps the slider to gain on a curve that is monotonic from silence to full', () => {
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(1)).toBe(1);
    let previous = -1;
    for (let step = 0; step <= 20; step += 1) {
      const gain = volumeToGain(step / 20);
      expect(gain).toBeGreaterThan(previous);
      previous = gain;
    }
  });

  it('routes four buses into the master, then the limiter, then the soft clipper', async () => {
    const { context, engine, nodes } = await createRig();
    const intoMaster = inputsOf(nodes.master);
    for (const bus of ['music', 'effects', 'ambience'] as const) {
      expect(intoMaster, bus).toContain(nodes.buses[bus] as unknown as FakeAudioNode);
      // Each bus: voices -> scene trim -> volume.
      expect(inputsOf(nodes.buses[bus]), bus).toContain(nodes.trims[bus] as unknown as FakeAudioNode);
    }
    // Interface sounds ride the effects volume, past the scene trim.
    expect(inputsOf(nodes.buses.effects)).toContain(nodes.inputs.interface as unknown as FakeAudioNode);
    expect(inputsOf(nodes.trims.effects)).not.toContain(nodes.inputs.interface as unknown as FakeAudioNode);
    // The reverb comes back into the master too.
    expect(intoMaster.some((node) => node.kind === 'gain' && inputsOf(node as unknown as AudioNode)
      .some((input) => input.kind === 'convolver'))).toBe(true);

    const limiter = nodes.limiter as unknown as FakeCompressorNode;
    expect(inputsOf(nodes.limiter)).toEqual([nodes.master]);
    expect(limiter.ratio.value).toBeGreaterThanOrEqual(8);
    expect(limiter.threshold.value).toBeLessThan(0);
    expect(inputsOf(nodes.output)).toEqual([nodes.limiter]);
    expect((nodes.output as unknown as FakeAudioNode).kind).toBe('waveShaper');
    expect(inputsOf(context.destination as unknown as AudioNode)).toEqual([nodes.output]);
    engine.dispose();
  });

  it('cannot clip: the soft clipper tops out below full scale', async () => {
    expect(SOFT_CLIP_CEILING).toBeLessThan(0.95);
    // Straight below the knee, bent above it, never past the ceiling, even for wild input.
    expect(softClip(0.5)).toBe(0.5);
    expect(softClip(-SOFT_CLIP_KNEE)).toBe(-SOFT_CLIP_KNEE);
    expect(softClip(0.9)).toBeLessThan(0.9);
    expect(softClip(40)).toBeCloseTo(SOFT_CLIP_CEILING, 6);
    expect(softClip(-40)).toBeCloseTo(-SOFT_CLIP_CEILING, 6);

    const curve = createSoftClipCurve();
    let previous = Number.NEGATIVE_INFINITY;
    for (const value of curve) {
      expect(Math.abs(value)).toBeLessThanOrEqual(SOFT_CLIP_CEILING + 1e-6);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
    const { engine, nodes } = await createRig();
    const shaper = nodes.output as unknown as FakeWaveShaperNode;
    expect(Math.max(...(shaper.curve ?? []))).toBeCloseTo(SOFT_CLIP_CEILING, 5);
    engine.dispose();
  });

  it('sets the balance for each scene and never trims the interface', async () => {
    const { engine, nodes } = await createRig();
    for (const scene of ['game', 'paused', 'credits', 'lobby'] as const) {
      engine.setScene(scene);
      for (const bus of ['music', 'effects', 'ambience'] as const) {
        expect(settled(nodes.trims[bus]), `${scene} ${bus}`).toBeCloseTo(SCENE_MIX[scene][bus], 5);
      }
    }
    // Paused turns the world down but not off, and leaves the menus alone.
    expect(SCENE_MIX.paused.ambience).toBeLessThan(SCENE_MIX.game.ambience);
    expect(SCENE_MIX.paused.effects).toBeLessThan(SCENE_MIX.game.effects);
    engine.dispose();
  });

  it('ducks the music while a conversation is open', async () => {
    const { context, engine, nodes } = await createRig();
    const duck = fakeGain(nodes.musicDuck).gain;
    expect(duck.settledValue()).toBe(1);
    engine.handleEvents([SAMPLE_EVENTS.dialogue_opened]);
    context.advance(8);
    expect(duck.valueAtTime(context.currentTime)).toBeCloseTo(DIALOGUE_DUCK, 3);
    engine.handleEvents([SAMPLE_EVENTS.dialogue_closed]);
    context.advance(8);
    expect(duck.valueAtTime(context.currentTime)).toBeCloseTo(1, 3);
    engine.dispose();
  });

  it('ducks the music under an important one-shot, then lets it back', async () => {
    const { context, engine, nodes } = await createRig();
    const duck = fakeGain(nodes.musicDuck).gain;
    engine.handleEvents([SAMPLE_EVENTS.quest_completed]);
    const now = context.currentTime;
    expect(duck.valueAtTime(now)).toBeCloseTo(1, 3);
    expect(duck.valueAtTime(now + 1)).toBeLessThan(0.5);
    expect(duck.valueAtTime(now + 20)).toBeCloseTo(1, 3);
    // A small routine cue leaves the music alone.
    context.advance(30);
    engine.handleEvents([SAMPLE_EVENTS.item_gained]);
    expect(duck.valueAtTime(context.currentTime + 0.5)).toBeCloseTo(1, 3);
    engine.dispose();
  });

  it('shapes an envelope that starts and ends on silence', () => {
    const parameter = new FakeAudioParam(0);
    const end = scheduleEnvelope(parameter as unknown as AudioParam, 1, 0.5, 0.01, 0.1, 0.4);
    expect(parameter.valueAtTime(1)).toBe(0);
    expect(parameter.valueAtTime(1.01)).toBeCloseTo(0.5, 5);
    expect(parameter.valueAtTime(1.11)).toBeCloseTo(0.5, 5);
    expect(parameter.valueAtTime(1.31)).toBeLessThan(0.5);
    expect(parameter.valueAtTime(end)).toBe(0);
    expect(end).toBeCloseTo(1.522, 5);
    // Never louder than the peak asked for.
    for (let time = 1; time < end; time += 0.005) expect(parameter.valueAtTime(time)).toBeLessThanOrEqual(0.5 + 1e-9);
  });
});

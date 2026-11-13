/**
 * The sound of a jump (Luc's list, Round 3: "character need to jump"): no footsteps while the feet are off the
 * ground. The footstep layer steps by the walker's speed over the ground, and a jumper keeps that speed in the air,
 * so the sound's inputs say 0 for as long as the jump is in the air and the true speed before it and after it.
 */
import { describe, expect, it } from 'vitest';
import { FIXED_STEP, LEAP_AIR_STEPS, NEUTRAL_INPUT, airborne, drainEvents, step } from '../../src/sim/index.ts';
import type { StepInput } from '../../src/sim/index.ts';
import { createDeriveMemory, deriveLayerInputs } from '../../src/audio/layers.ts';
import { newGame, teleport } from '../support.ts';

describe('the sound of a jump', () => {
  it('a running jump: footsteps before it, none in the air, footsteps again from the landing', () => {
    const state = newGame();
    // The clear lane north on Home Knoll (as `tests/jump.test.ts`).
    teleport(state, 'home_knoll', -2.5, 1150);
    const player = state.players[0];
    player.heading = 0;
    Object.assign(player, { hunger: 100, thirst: 100, energy: 100 });
    state.weather.secondsRemaining = 99999;
    drainEvents(state);
    const memory = createDeriveMemory();
    const run: StepInput = { ...NEUTRAL_INPUT, moveY: 1, cameraYaw: 0, run: true };
    const frame = (input: StepInput) => {
      step(state, input, FIXED_STEP);
      return deriveLayerInputs(state, memory, FIXED_STEP);
    };

    let heard = frame(run);
    for (let count = 0; count < 60; count += 1) heard = frame(run);
    expect(heard.onFoot).toBe(true);
    expect(heard.footSpeed).toBeGreaterThan(4);

    let quiet = 0;
    for (let count = 1; count < LEAP_AIR_STEPS; count += 1) {
      heard = frame({ ...run, jump: true });
      expect(airborne(player.leap)).toBe(true);
      // Still ashore (the mix does not change), and still moving at a run: only the footsteps stop.
      expect(heard.onFoot).toBe(true);
      expect(heard.footSpeed).toBe(0);
      expect(player.gait?.speed ?? 0).toBeGreaterThan(4);
      quiet += 1;
    }
    expect(quiet).toBe(LEAP_AIR_STEPS - 1);

    // The step the feet touch down on is a ground step: the run is heard again at once.
    heard = frame({ ...run, jump: true });
    expect(airborne(player.leap)).toBe(false);
    expect(heard.footSpeed).toBeGreaterThan(4);
    for (let count = 0; count < 20; count += 1) {
      heard = frame({ ...run, jump: true });
      expect(heard.footSpeed).toBeGreaterThan(4);
    }
  });

  it('nobody jumping: the footsteps are what they were', () => {
    const state = newGame();
    teleport(state, 'home_knoll', -2.5, 1150);
    state.players[0].heading = 0;
    Object.assign(state.players[0], { hunger: 100, thirst: 100, energy: 100 });
    const memory = createDeriveMemory();
    let heard = deriveLayerInputs(state, memory, FIXED_STEP);
    for (let count = 0; count < 40; count += 1) {
      step(state, { ...NEUTRAL_INPUT, moveY: 1, cameraYaw: 0 }, FIXED_STEP);
      heard = deriveLayerInputs(state, memory, FIXED_STEP);
    }
    expect(state.players[0].leap).toBeUndefined();
    expect(heard.footSpeed).toBeCloseTo(2.6, 6);
  });
});

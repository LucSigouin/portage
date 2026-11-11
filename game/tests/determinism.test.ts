import { describe, expect, it } from 'vitest';
import { deserialize, serialize } from '../src/save/index.ts';
import { FIXED_STEP, NEUTRAL_INPUT, createGame, dispatch, drainEvents, hashState, step } from '../src/sim/index.ts';
import type { Command, GameState, StepInput } from '../src/sim/index.ts';
import { runBot } from '../src/bot/bot.ts';
import { NODES_BY_ISLAND } from '../src/data/index.ts';

/**
 * A scripted player. What it does depends only on the tick and the state, so
 * the same game always gets the same inputs. It bails, lands, walks from node
 * to node scavenging, crafts, boards and paddles off again, so most systems
 * (and the loot and weather rolls) get exercised.
 */
function scriptedInput(tick: number, state: GameState): { input: StepInput; commands: Command[] } {
  let mixed = Math.imul(tick ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  mixed ^= mixed >>> 13;
  const noise = (Math.imul(mixed, 0xc2b2ae35) >>> 0) / 4294967296;
  // Eight 15 second phases: bail, paddle in (two), ashore (three), back off, drift.
  const phase = Math.floor(tick / 900) % 8;
  const commands: Command[] = [];
  if (tick % 900 === 0) {
    commands.push({ type: phase === 3 ? 'disembark' : phase === 6 ? 'board' : 'select_tool', toolId: null } as Command);
    commands.push({ type: 'stow_backpack' }, { type: 'craft', recipeId: 'rope' }, { type: 'fill_water', count: 2 });
    commands.push({ type: 'eat', itemId: 'berries' }, { type: 'select_tool', toolId: null });
  }
  let input: StepInput;
  if (phase === 0) {
    input = { ...NEUTRAL_INPUT, bail: true };
  } else if (phase <= 2) {
    input = { ...NEUTRAL_INPUT, paddle: 1, steer: (noise - 0.5) * 0.2 };
  } else if (phase <= 5) {
    const nodes = NODES_BY_ISLAND.home_knoll;
    const target = nodes[Math.floor(tick / 420) % nodes.length].position;
    const offsetX = target.x - state.players[0].position.x;
    const offsetZ = target.z - state.players[0].position.z;
    const range = Math.max(1, Math.hypot(offsetX, offsetZ));
    input = {
      ...NEUTRAL_INPUT, moveX: range > 1.5 ? offsetX / range : 0, moveY: range > 1.5 ? -offsetZ / range : 0,
      run: noise > 0.7,
    };
    // A press of the interact key every second: scavenge whatever is in reach.
    if (tick % 60 === 0) commands.push({ type: 'scavenge' });
  } else {
    input = { ...NEUTRAL_INPUT, paddle: noise > 0.3 ? -1 : 0.5, steer: noise - 0.5, powerStroke: noise > 0.8 };
  }
  return { input, commands };
}

function play(state: GameState, fromTick: number, toTick: number): void {
  for (let tick = fromTick; tick < toTick; tick += 1) {
    const { input, commands } = scriptedInput(tick, state);
    for (const command of commands) dispatch(state, command);
    step(state, input, FIXED_STEP);
    drainEvents(state);
  }
}

const TICKS = 60 * 60 * 4; // four minutes

describe('determinism', () => {
  it('gives the same state hash for the same seed and inputs', () => {
    const first = createGame(42);
    const second = createGame(42);
    play(first, 0, TICKS);
    play(second, 0, TICKS);
    expect(hashState(first)).toBe(hashState(second));
    expect(first).toEqual(second);
    // And the script really did something.
    expect(first.statistics.distancePaddled).toBeGreaterThan(30);
    expect(first.statistics.distanceWalked).toBeGreaterThan(30);
    expect(first.statistics.nodesHarvested).toBeGreaterThan(0);
    expect(first.quests.bail_out.progress[1]).toBe(1); // it landed on Home Knoll
  });

  it('gives a different game for a different seed or a different input', () => {
    const base = createGame(42);
    const otherSeed = createGame(43);
    const otherInput = createGame(42);
    play(base, 0, TICKS);
    play(otherSeed, 0, TICKS);
    play(otherInput, 0, TICKS - 1);
    step(otherInput, { ...NEUTRAL_INPUT, moveX: -1 }, FIXED_STEP);
    expect(hashState(otherSeed)).not.toBe(hashState(base));
    expect(hashState(otherInput)).not.toBe(hashState(base));
  });

  it('continues from a save exactly as if it had never stopped', () => {
    const uninterrupted = createGame(42);
    play(uninterrupted, 0, TICKS);
    for (const saveAt of [1, 777, 60 * 60, 60 * 60 * 3 + 11]) {
      const before = createGame(42);
      play(before, 0, saveAt);
      const loaded = deserialize(serialize(before, 0));
      if (!loaded.ok) throw new Error(loaded.reason);
      play(loaded.state, saveAt, TICKS);
      expect(hashState(loaded.state), `saved at tick ${saveAt}`).toBe(hashState(uninterrupted));
    }
  });

  it('runs whole fixed steps whatever the frame time', () => {
    const fine = createGame(9);
    const coarse = createGame(9);
    const input = { ...NEUTRAL_INPUT, paddle: 1, steer: 0.2 };
    for (let frame = 0; frame < 600; frame += 1) step(fine, input, FIXED_STEP);
    for (let frame = 0; frame < 200; frame += 1) step(coarse, input, FIXED_STEP * 3);
    expect(coarse.tick).toBe(600);
    expect(coarse.canoe.position).toEqual(fine.canoe.position);
    const slow = createGame(9);
    step(slow, input, 5); // a five second hitch is clamped, not simulated
    expect(slow.tick).toBe(15);
    const idle = createGame(9);
    step(idle, input, 0);
    step(idle, input, Number.NaN);
    step(idle, input, FIXED_STEP / 2);
    expect(idle.tick).toBe(0);
    step(idle, input, FIXED_STEP / 2);
    expect(idle.tick).toBe(1);
  });

  it('keeps the state plain JSON all the way through a full game', () => {
    const report = runBot({ seed: 3, untilQuest: 'ribs_and_rails' });
    expect(report.stoppedBecause).toBeNull();
    const state = report.state;
    const problems: string[] = [];
    const walk = (value: unknown, path: string): void => {
      if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
      if (typeof value === 'number') {
        if (!Number.isFinite(value)) problems.push(`${path} is ${value}`);
        return;
      }
      if (Array.isArray(value)) {
        value.forEach((entry, index) => walk(entry, `${path}[${index}]`));
        return;
      }
      if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
        for (const [key, entry] of Object.entries(value)) walk(entry, `${path}.${key}`);
        return;
      }
      problems.push(`${path} is not plain data (${typeof value})`);
    };
    walk(state, 'state');
    expect(problems).toEqual([]);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});

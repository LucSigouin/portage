/**
 * The crew: two to four players stepped through every co-op rule. Solo is
 * covered by the rest of the suite, which runs unchanged on a crew of one.
 */
import { describe, expect, it } from 'vitest';
import { HULL_TIERS, ISLANDS_BY_ID, NODES_BY_ID, NPCS, TUNING, spotPosition } from '../src/data/index.ts';
import type { IslandId } from '../src/data/index.ts';
import {
  FIXED_STEP, MAXIMUM_PLAYERS, NEUTRAL_INPUT, addPlayer, createGame, dispatch, drainEvents, eventsFor, hashState,
  islandLanding, landingBerth, playersAboard, seatTransformForHull, selectInteractable, selectInventory, selectMeters,
  step, terrainHeight,
} from '../src/sim/index.ts';
import type { GameEvent, GameState, PlayerState, StepInput } from '../src/sim/index.ts';
import { countIn, floatCanoeAt, newGame, standOn } from './support.ts';

const DAY = TUNING.time.daySeconds;
const HOUR = TUNING.time.hourSeconds;

/** Step the crew for a number of seconds. `inputs` is indexed by player id. */
function runCrew(state: GameState, inputs: Partial<StepInput>[], seconds: number): GameEvent[] {
  const full = inputs.map((input) => ({ ...NEUTRAL_INPUT, ...input }));
  const events: GameEvent[] = [];
  for (let index = 0; index < Math.round(seconds / FIXED_STEP); index += 1) {
    step(state, full, FIXED_STEP);
    events.push(...drainEvents(state));
  }
  return events;
}

/** A crew afloat on calm water south of Home Knoll, in a tight dry hull, under a sky that holds. */
function crewAfloat(crew: number): GameState {
  const state = newGame(7, { crew });
  state.canoe.hullTier = 1;
  floatCanoeAt(state, 200, 1300, 0);
  for (const player of state.players) player.position = { ...state.canoe.position };
  state.weather.secondsRemaining = 99999;
  drainEvents(state);
  return state;
}

/** Put the first quest behind the crew, so nobody is paid its reward for setting foot on Home Knoll. */
function pastFirstQuest(state: GameState): void {
  state.quests.bail_out.status = 'completed';
  state.quests.first_haul.status = 'active';
}

/** Stand one player on an island, off the canoe. */
function putAshore(player: PlayerState, islandId: IslandId, x: number, z: number): void {
  player.mode = 'foot';
  player.seat = null;
  player.islandId = islandId;
  player.position = { x, y: terrainHeight(x, z), z };
}

/** Stand one player beside a node, off the canoe. */
function putAtNode(player: PlayerState, nodeId: string): void {
  const node = NODES_BY_ID[nodeId];
  putAshore(player, node.islandId, node.position.x + 0.5, node.position.z);
}

/** The canoe beached at Home Knoll with the whole crew standing at the camp fire, fed and rested. */
function crewAtCamp(crew: number): GameState {
  const state = newGame(7, { crew });
  standOn(state, 'home_knoll');
  const camp = spotPosition(ISLANDS_BY_ID.home_knoll, ISLANDS_BY_ID.home_knoll.camp!.spot);
  state.players.forEach((player, index) => {
    putAshore(player, 'home_knoll', camp.x + 1 + index * 0.8, camp.z);
    player.hunger = 100;
    player.thirst = 100;
    player.energy = 100;
  });
  drainEvents(state);
  return state;
}

describe('a crew of up to four', () => {
  it('starts with one to four players, in id order, each in their own seat with their own backpack, and one tool belt for the crew', () => {
    expect(createGame(7).players).toHaveLength(1);
    for (const crew of [2, 3, 4]) {
      const state = createGame(7, { crew });
      expect(state.players.map((player) => player.id)).toEqual(Array.from({ length: crew }, (_, id) => id));
      expect(state.players.map((player) => player.seat)).toEqual(Array.from({ length: crew }, (_, seat) => seat));
      expect(playersAboard(state)).toHaveLength(crew);
      for (const player of state.players) {
        expect(player).toMatchObject({ mode: 'canoe', hunger: 80, thirst: 75, energy: 90, selectedTool: null, backpack: [] });
        expect(player.position).toEqual(state.canoe.position);
        expect(Object.keys(player)).not.toContain('tools');
      }
      // One bailing can for the crew, however many are aboard.
      expect(state.tools).toEqual(['bailing_can']);
      // Separate objects: one player's backpack is not another's.
      expect(state.players[0].backpack).not.toBe(state.players[1].backpack);
    }
    expect(createGame(7, { crew: 9 }).players).toHaveLength(MAXIMUM_PLAYERS);
    expect(createGame(7, { crew: 0 }).players).toHaveLength(1);
  });

  it('takes a late joiner into the lowest free seat, and no fifth', () => {
    const state = createGame(7, { crew: 3 });
    // Player 1 has gone ashore, so seat 1 is free.
    putAshore(state.players[1], 'home_knoll', 0, 1150);
    const joined = addPlayer(state);
    expect(joined).toMatchObject({ id: 3, seat: 1, mode: 'canoe' });
    expect(state.players.map((player) => player.id)).toEqual([0, 1, 2, 3]);
    expect(addPlayer(state)).toBeNull();
    expect(state.players).toHaveLength(4);
  });

  it('gives every seat its own place inside the hull, stern first, spreading with the long hull', () => {
    for (const tier of [0, 1, 2, 3]) {
      const { length, depth } = HULL_TIERS[tier].dimensions;
      const seats = [0, 1, 2, 3].map((seat) => seatTransformForHull(tier, seat).position);
      // Seat 0 is the stern seat (+z), seat 1 the bow seat (-z), 2 and 3 between them.
      expect(seats[0][2]).toBeGreaterThan(seats[2][2]);
      expect(seats[2][2]).toBeGreaterThan(seats[3][2]);
      expect(seats[3][2]).toBeGreaterThan(seats[1][2]);
      const along = seats.map((seat) => seat[2]).sort((first, second) => first - second);
      for (let index = 1; index < along.length; index += 1) expect(along[index] - along[index - 1]).toBeGreaterThan(0.55);
      for (const [x, y, z] of seats) {
        expect(x).toBe(0);
        expect(Math.abs(z)).toBeLessThan(length / 2 - 0.5);
        expect(y).toBeGreaterThan(0);
        expect(y).toBeLessThan(depth);
      }
    }
    expect(seatTransformForHull(3, 0).position[2]).toBeGreaterThan(seatTransformForHull(2, 0).position[2]);
    // Out-of-range asks are clamped, never thrown.
    expect(seatTransformForHull(99, 99)).toEqual(seatTransformForHull(3, 3));
  });
});

describe('inputs are per player', () => {
  it('reads a single input as player 0 and a list by player id', () => {
    const single = crewAfloat(2);
    const listed = crewAfloat(2);
    for (let index = 0; index < 300; index += 1) {
      step(single, { ...NEUTRAL_INPUT, paddle: 1, steer: 0.5 }, FIXED_STEP);
      step(listed, [{ ...NEUTRAL_INPUT, paddle: 1, steer: 0.5 }], FIXED_STEP);
    }
    expect(hashState(listed)).toBe(hashState(single));
  });

  it('walks each player on foot where their own input points', () => {
    const state = crewAtCamp(3);
    const before = state.players.map((player) => ({ ...player.position }));
    runCrew(state, [{ moveX: 1 }, {}, { moveX: -1, cameraYaw: 0 }], 1);
    expect(state.players[0].position.x).toBeGreaterThan(before[0].x + 2);
    expect(state.players[1].position).toEqual(before[1]);
    expect(state.players[2].position.x).toBeLessThan(before[2].x - 2);
  });

  it('runs a command for the player who sent it', () => {
    const state = crewAtCamp(2);
    state.players[1].backpack.push({ itemId: 'berries', count: 3 });
    state.players[1].hunger = 40;
    expect(dispatch(state, { type: 'eat', itemId: 'berries' }).ok).toBe(false); // player 0 holds none, and the cargo is empty
    const events: GameEvent[] = [];
    expect(dispatch(state, { type: 'eat', itemId: 'berries' }, 1).ok).toBe(true);
    events.push(...drainEvents(state));
    expect(state.players[1].hunger).toBeGreaterThan(40);
    expect(state.players[0].hunger).toBe(100);
    expect(countIn(state.players[1].backpack, 'berries')).toBe(2);
    expect(events).toContainEqual({ type: 'ate', itemId: 'berries', playerId: 1 });
    // Each screen hears its own events and the crew-wide ones.
    expect(eventsFor(events, 0).some((event) => event.type === 'ate')).toBe(false);
    expect(eventsFor(events, 1).some((event) => event.type === 'ate')).toBe(true);
    expect(selectInventory(state, 1).backpack).toBe(state.players[1].backpack);
    expect(selectMeters(state, 1).hunger).toBe(state.players[1].hunger);
  });
});

describe('paddling together', () => {
  const speedWith = (crew: number, inputs: Partial<StepInput>[]): number => {
    const state = crewAfloat(crew);
    runCrew(state, inputs, 10);
    return state.canoe.speed;
  };

  it('adds a quarter of the speed for each extra paddler: four make 1.75x', () => {
    const solo = speedWith(1, [{ paddle: 1 }]);
    expect(solo).toBeGreaterThan(2);
    expect(speedWith(2, [{ paddle: 1 }, { paddle: 1 }]) / solo).toBeCloseTo(1.25, 6);
    expect(speedWith(3, [{ paddle: 1 }, { paddle: 1 }, { paddle: 1 }]) / solo).toBeCloseTo(1.5, 6);
    expect(speedWith(4, [{ paddle: 1 }, { paddle: 1 }, { paddle: 1 }, { paddle: 1 }]) / solo).toBeCloseTo(1.75, 6);
  });

  it('moves the canoe for whoever is aboard: idle crew ride along and add nothing', () => {
    const solo = speedWith(1, [{ paddle: 1 }]);
    expect(speedWith(4, [{ paddle: 1 }])).toBe(solo);
    // Any seat can do the paddling.
    expect(speedWith(4, [{}, {}, {}, { paddle: 1 }])).toBe(solo);
    const state = crewAfloat(3);
    runCrew(state, [{}, { paddle: 1 }], 5);
    for (const player of state.players) {
      expect(player.position).toEqual(state.canoe.position);
      expect(player.heading).toBe(state.canoe.heading);
    }
  });

  it('lets a crew of power strokes beat the sail limit, and back-paddlers add up too', () => {
    const solo = speedWith(1, [{ paddle: 1, powerStroke: true }]);
    const four = speedWith(4, Array.from({ length: 4 }, () => ({ paddle: 1, powerStroke: true })));
    expect(four / solo).toBeCloseTo(1.75, 6);
    expect(four).toBeGreaterThan(TUNING.canoe.sailMaximumSpeed);
    const back = speedWith(1, [{ paddle: -1 }]);
    expect(speedWith(2, [{ paddle: -1 }, { paddle: -1 }]) / back).toBeCloseTo(1.25, 6);
    // Pulling against each other costs speed.
    expect(speedWith(2, [{ paddle: 1 }, { paddle: -1 }])).toBeLessThan(speedWith(1, [{ paddle: 1 }]));
  });

  it('steers by the sum of everyone\'s steering, clamped to one', () => {
    const headingAfter = (crew: number, inputs: Partial<StepInput>[]): number => {
      const state = crewAfloat(crew);
      runCrew(state, inputs, 2);
      return state.canoe.heading;
    };
    const one = headingAfter(1, [{ paddle: 1, steer: 1 }]);
    expect(one).toBeGreaterThan(0.5);
    // Two hard to starboard turn no faster than one: clamped.
    expect(headingAfter(2, [{ paddle: 1, steer: 1 }, { steer: 1 }])).toBe(one);
    // Two half turns make one whole.
    expect(headingAfter(2, [{ paddle: 1, steer: 0.5 }, { steer: 0.5 }])).toBe(one);
    // Opposite turns cancel.
    expect(headingAfter(2, [{ paddle: 1, steer: 1 }, { steer: -1 }])).toBe(0);
    // A passenger can steer while another paddles.
    expect(headingAfter(2, [{ paddle: 1 }, { steer: 1 }])).toBe(one);
  });

  it('charges a power stroke to the paddler who makes it', () => {
    const state = crewAfloat(3);
    for (const player of state.players) player.energy = 60;
    runCrew(state, [{ paddle: 1, powerStroke: true }, { paddle: 1 }, {}], 10);
    const [power, plain, idle] = state.players;
    expect(power.energy).toBeCloseTo(60 - TUNING.survival.powerStrokeEnergyPerSecond * 10, 1);
    expect(plain.energy).toBeCloseTo(60 + TUNING.survival.lightActivityEnergyPerSecond * 10, 1);
    expect(idle.energy).toBeCloseTo(60 + TUNING.survival.restEnergyPerSecond * 10, 1);
    expect(power.exerting).toBe(true);
    expect(plain.exerting).toBe(false);
    // Worn out, a paddler falls back to a plain stroke while the others keep their own energy.
    power.energy = 3;
    runCrew(state, [{ paddle: 1, powerStroke: true }, { paddle: 1, powerStroke: true }], 1);
    expect(power.exerting).toBe(false);
    expect(plain.exerting).toBe(true);
  });
});

describe('bailing together', () => {
  const waterAfter = (bailers: number): GameState => {
    const state = crewAfloat(4);
    state.canoe.waterLevel = 80;
    for (const player of state.players) player.energy = 60;
    runCrew(state, state.players.map((_, index) => (index < bailers ? { bail: true } : {})), 5);
    return state;
  };

  it('bails at the solo rate for each bailer', () => {
    const rate = TUNING.canoe.bailPerSecond;
    expect(waterAfter(0).canoe.waterLevel).toBeCloseTo(80, 6);
    expect(waterAfter(1).canoe.waterLevel).toBeCloseTo(80 - rate * 5, 6);
    expect(waterAfter(2).canoe.waterLevel).toBeCloseTo(80 - 2 * rate * 5, 6);
    expect(waterAfter(4).canoe.waterLevel).toBeCloseTo(80 - 4 * rate * 5, 6);
  });

  it('flags and charges only the players who bail', () => {
    const state = waterAfter(2);
    expect(state.players.map((player) => player.bailing)).toEqual([true, true, false, false]);
    expect(state.canoe.bailing).toBe(true);
    expect(state.players[0].energy).toBeCloseTo(60 - TUNING.survival.bailEnergyPerSecond * 5, 1);
    expect(state.players[3].energy).toBeCloseTo(60 + TUNING.survival.restEnergyPerSecond * 5, 1);
    // A bailer's hands are full: their paddle does nothing, the others' still does.
    const mixed = crewAfloat(2);
    mixed.canoe.waterLevel = 80;
    runCrew(mixed, [{ bail: true, paddle: 1 }, {}], 3);
    expect(mixed.canoe.speed).toBeCloseTo(0, 6);
    runCrew(mixed, [{ bail: true, paddle: 1 }, { paddle: 1 }], 3);
    expect(mixed.canoe.speed).toBeGreaterThan(1);
  });
});

describe('boarding and landing one by one', () => {
  /** Two aboard, the canoe run up on Home Knoll's beach. */
  function beachedCrew(crew = 2): GameState {
    const state = newGame(7, { crew });
    state.canoe.hullTier = 1;
    const berth = landingBerth('home_knoll', 1);
    floatCanoeAt(state, berth.x, berth.z, berth.heading);
    for (const player of state.players) player.position = { ...state.canoe.position };
    state.weather.secondsRemaining = 99999;
    drainEvents(state);
    return state;
  }

  it('lets one player step ashore while the other stays in the canoe', () => {
    const state = beachedCrew();
    expect(dispatch(state, { type: 'disembark' }, 1).ok).toBe(true);
    const [stayed, landed] = state.players;
    expect(landed).toMatchObject({ mode: 'foot', seat: null, islandId: 'home_knoll' });
    expect(stayed).toMatchObject({ mode: 'canoe', seat: 0 });
    expect(state.canoe.beached).toBe(true);
    expect(drainEvents(state)).toContainEqual({ type: 'landed', islandId: 'home_knoll', playerId: 1 });
    // The one ashore walks off on their own; the one aboard does not move.
    const canoeBefore = { ...state.canoe.position };
    runCrew(state, [{}, { moveY: 1, cameraYaw: Math.PI }], 2);
    expect(Math.hypot(landed.position.x - canoeBefore.x, landed.position.z - canoeBefore.z)).toBeGreaterThan(5);
    expect(stayed.position.x).toBeCloseTo(canoeBefore.x, 3);
    expect(stayed.position.z).toBeCloseTo(canoeBefore.z, 3);
  });

  it('does not stand two players on the same spot when both step out', () => {
    const state = beachedCrew(4);
    for (const player of state.players) expect(dispatch(state, { type: 'disembark' }, player.id).ok).toBe(true);
    for (const first of state.players) {
      for (const second of state.players) {
        if (first.id >= second.id) continue;
        expect(Math.hypot(first.position.x - second.position.x, first.position.z - second.position.z)).toBeGreaterThan(0.55);
      }
    }
    expect(playersAboard(state)).toHaveLength(0);
  });

  it('paddles off without the player left ashore, and picks them up later', () => {
    const state = beachedCrew();
    expect(dispatch(state, { type: 'disembark' }, 1).ok).toBe(true);
    const ashore = { ...state.players[1].position };
    // Player 0 backs the canoe off the beach and away.
    runCrew(state, [{ paddle: -1 }], 12);
    expect(state.canoe.beached).toBe(false);
    expect(Math.hypot(state.canoe.position.x - ashore.x, state.canoe.position.z - ashore.z)).toBeGreaterThan(8);
    expect(state.players[1].position).toEqual(ashore); // left where they stood
    expect(state.players[1].mode).toBe('foot');
    expect(dispatch(state, { type: 'board' }, 1)).toMatchObject({ ok: false, reason: 'not_at_canoe' });
    expect(selectInteractable(state, 1)?.kind).not.toBe('board');
    // Player 0 comes back in; player 1 boards and takes the free seat.
    runCrew(state, [{ paddle: 1 }], 20);
    expect(selectInteractable(state, 1)?.kind).toBe('board');
    expect(dispatch(state, { type: 'board' }, 1).ok).toBe(true);
    expect(state.players[1]).toMatchObject({ mode: 'canoe', seat: 1 });
    expect(state.players[1].position).toEqual(state.canoe.position);
    expect(drainEvents(state)).toContainEqual({ type: 'boarded', playerId: 1 });
  });

  it('moves for whoever is aboard, also when player 0 is the one left ashore', () => {
    const state = beachedCrew();
    expect(dispatch(state, { type: 'disembark' }, 0).ok).toBe(true);
    const ashore = { ...state.players[0].position };
    const beach = { ...state.canoe.position };
    runCrew(state, [{}, { paddle: -1 }], 12); // only player 1 has a paddle in the water
    expect(Math.hypot(state.canoe.position.x - beach.x, state.canoe.position.z - beach.z)).toBeGreaterThan(8);
    expect(state.players[1].position).toEqual(state.canoe.position);
    expect(state.players[0].position).toEqual(ashore);
    // Player 0's paddle input does nothing from the shore.
    const afloat = { ...state.canoe.position };
    const still = beachedCrew();
    dispatch(still, { type: 'disembark' }, 0);
    dispatch(still, { type: 'disembark' }, 1);
    const empty = { ...still.canoe.position };
    runCrew(still, [{ paddle: 1 }, { paddle: 1 }], 3);
    expect(still.canoe.position).toEqual(empty); // nobody aboard: the canoe stays put
    expect(afloat).not.toEqual(beach);
  });

  it('seats a boarder in the lowest free seat', () => {
    const state = beachedCrew(3);
    dispatch(state, { type: 'disembark' }, 0);
    dispatch(state, { type: 'disembark' }, 2);
    expect(state.players.map((player) => player.seat)).toEqual([null, 1, null]);
    dispatch(state, { type: 'board' }, 2);
    dispatch(state, { type: 'board' }, 0);
    expect(state.players.map((player) => player.seat)).toEqual([2, 1, 0]);
  });

  it('keeps cargo and stations for whoever is at the canoe', () => {
    const state = beachedCrew();
    pastFirstQuest(state);
    state.canoe.cargo.push({ itemId: 'berries', count: 5 });
    dispatch(state, { type: 'disembark' }, 1);
    const landing = islandLanding('birch_islet').shore;
    putAshore(state.players[1], 'birch_islet', landing.x, landing.z); // player 1 is an island away
    expect(selectInventory(state, 0).cargoAccessible).toBe(true);
    expect(selectInventory(state, 1).cargoAccessible).toBe(false);
    expect(dispatch(state, { type: 'eat', itemId: 'berries' }, 1)).toMatchObject({ ok: false, reason: 'item_not_held' });
    expect(dispatch(state, { type: 'eat', itemId: 'berries' }, 0).ok).toBe(true);
  });
});

describe('quests are the crew\'s', () => {
  it('counts any player\'s action: player 1 bails and lands, and the quest is done', () => {
    const state = newGame(7, { crew: 2 });
    const berth = landingBerth('home_knoll', 0);
    floatCanoeAt(state, berth.x, berth.z, berth.heading);
    state.canoe.waterLevel = 60;
    drainEvents(state);
    runCrew(state, [{}, { bail: true }], 20);
    expect(state.quests.bail_out.progress[0]).toBe(1);
    expect(dispatch(state, { type: 'disembark' }, 1).ok).toBe(true);
    expect(state.quests.bail_out.status).toBe('completed');
    expect(state.quests.first_haul.status).toBe('active');
    // The reward goes to the player who finished it. Player 0 never left their seat.
    expect(countIn(state.players[1].backpack, 'berries')).toBe(4);
    expect(state.players[0].backpack).toEqual([]);
    expect(state.players[0].mode).toBe('canoe');
  });

  it('counts what anyone holds and the crew\'s tools, and takes a delivery from whoever has it', () => {
    const state = crewAtCamp(3);
    state.quests.bail_out.status = 'completed';
    state.quests.first_haul.status = 'active';
    state.players[1].backpack.push({ itemId: 'driftwood', count: 3 });
    state.players[2].backpack.push({ itemId: 'fiber', count: 4 });
    state.tools.push('stone_knife');
    runCrew(state, [], 1);
    expect(state.quests.first_haul.status).toBe('completed');
    // Key items are the crew's: one find shows in every inventory.
    state.keyItems.lens = 1;
    for (const player of state.players) {
      expect(selectInventory(state, player.id).keyItems).toEqual([{ itemId: 'lens', count: 1 }]);
    }
  });

  it('keeps the tool in hand and each conversation to its own player', () => {
    const state = crewAtCamp(2);
    // Nobody can take a tool the crew does not have.
    expect(dispatch(state, { type: 'select_tool', toolId: 'hatchet' }, 0)).toMatchObject({ ok: false, reason: 'tool_not_owned' });
    expect(dispatch(state, { type: 'select_tool', toolId: 'hatchet' }, 1)).toMatchObject({ ok: false, reason: 'tool_not_owned' });
    state.tools.push('hatchet');
    expect(dispatch(state, { type: 'select_tool', toolId: 'hatchet' }, 1).ok).toBe(true);
    expect(state.players.map((player) => player.selectedTool)).toEqual([null, 'hatchet']);
    // A talk holds only the player having it.
    state.players[0].dialogue = { npcId: 'odile', nodeId: 'start' };
    const before = { ...state.players[0].position };
    runCrew(state, [{ moveX: 1 }, { moveX: 1 }], 1);
    expect(state.players[0].position).toEqual(before);
    expect(state.players[1].position.x).not.toBe(before.x + 0.8);
    expect(dispatch(state, { type: 'eat', itemId: 'berries' }, 0)).toMatchObject({ ok: false, reason: 'in_dialogue' });
    expect(dispatch(state, { type: 'eat', itemId: 'berries' }, 1)).toMatchObject({ ok: false, reason: 'item_not_held' });
  });
});

describe('tools are the crew\'s', () => {
  it('lets another player use a tool the moment one player makes it, an island away', () => {
    const state = crewAtCamp(2);
    const [maker, peeler] = state.players;
    maker.backpack.push({ itemId: 'stone', count: 2 }, { itemId: 'driftwood', count: 1 }, { itemId: 'fiber', count: 2 });
    putAtNode(peeler, 'birch_islet.birch.1');
    expect(dispatch(state, { type: 'scavenge' }, 1)).toMatchObject({ ok: false, reason: 'missing_requirements', missing: { tools: ['stone_knife'] } });
    drainEvents(state);
    expect(dispatch(state, { type: 'craft', recipeId: 'stone_knife' }, 0).ok).toBe(true);
    // The knife is the crew's: on nobody's person, in everybody's reach.
    expect(state.tools).toEqual(['bailing_can', 'stone_knife']);
    expect(drainEvents(state).find((event) => event.type === 'item_gained' && event.container === 'belt'))
      .toMatchObject({ itemId: 'stone_knife', playerId: 0 });
    for (const player of state.players) expect(selectInventory(state, player.id).tools).toEqual(['bailing_can', 'stone_knife']);
    expect(selectInteractable(state, 1)).toMatchObject({ available: true, prompt: 'Peel: Birch' });
    expect(dispatch(state, { type: 'scavenge' }, 1).ok).toBe(true);
    expect(countIn(peeler.backpack, 'birch_bark')).toBeGreaterThanOrEqual(2);
  });

  it('lets another player use a tool the moment one player finds it', () => {
    const state = crewAtCamp(2);
    const [finder, opener] = state.players;
    putAtNode(finder, 'the_boathouse.tool_rack');
    putAtNode(opener, 'the_boathouse.locker');
    expect(selectInteractable(state, 1)).toMatchObject({ nodeId: 'the_boathouse.locker', available: false, missing: { tools: ['pry_bar'] } });
    expect(dispatch(state, { type: 'scavenge' }, 0).ok).toBe(true);
    expect(state.tools).toEqual(['bailing_can', 'pry_bar']);
    expect(selectInteractable(state, 1)).toMatchObject({ nodeId: 'the_boathouse.locker', available: true });
    expect(dispatch(state, { type: 'scavenge' }, 1).ok).toBe(true);
    expect(state.keyItems.saw_blade).toBe(1);
  });

  it('puts a tool one player is given on the crew\'s belt', () => {
    const state = crewAtCamp(2);
    const spot = spotPosition(ISLANDS_BY_ID[NPCS.tink.islandId], NPCS.tink.spot);
    putAshore(state.players[1], NPCS.tink.islandId, spot.x + 1.5, spot.z);
    expect(dispatch(state, { type: 'talk', npcId: 'tink' }, 1).ok).toBe(true);
    expect(dispatch(state, { type: 'choose_dialogue_option', optionIndex: 0 }, 1).ok).toBe(true);
    expect(state.tools).toEqual(['bailing_can', 'wrench']);
    expect(dispatch(state, { type: 'select_tool', toolId: 'wrench' }, 0).ok).toBe(true);
  });

  it('lets two players hold the same tool in hand and work with it, each putting it away on their own', () => {
    const state = crewAtCamp(2);
    state.tools.push('hatchet');
    putAtNode(state.players[0], 'home_knoll.spruce.1');
    putAtNode(state.players[1], 'home_knoll.spruce.2');
    for (const player of state.players) expect(dispatch(state, { type: 'select_tool', toolId: 'hatchet' }, player.id).ok).toBe(true);
    expect(state.players.map((player) => player.selectedTool)).toEqual(['hatchet', 'hatchet']);
    for (const player of state.players) {
      expect(selectInteractable(state, player.id)).toMatchObject({ prompt: 'Chop: Spruce', actionIndex: 1 });
      expect(dispatch(state, { type: 'scavenge' }, player.id).ok).toBe(true);
      expect(countIn(player.backpack, 'log')).toBeGreaterThan(0);
    }
    expect(dispatch(state, { type: 'select_tool', toolId: null }, 0).ok).toBe(true);
    expect(state.players.map((player) => player.selectedTool)).toEqual([null, 'hatchet']);
    expect(state.tools).toEqual(['bailing_can', 'hatchet']);
  });

  it('reads the crew\'s tools for crafting, building and the bailing can, whoever asks', () => {
    // Crafting: player 1 at the camp bench, with a log and no saw in the crew.
    const camp = crewAtCamp(2);
    camp.players[1].backpack.push({ itemId: 'log', count: 1 });
    expect(dispatch(camp, { type: 'craft', recipeId: 'plank' }, 1)).toMatchObject({ ok: false, reason: 'missing_requirements', missing: { tools: ['saw'] } });
    camp.tools.push('saw');
    expect(dispatch(camp, { type: 'craft', recipeId: 'plank' }, 1).ok).toBe(true);
    expect(countIn(camp.players[1].backpack, 'plank')).toBeGreaterThan(0);

    // Building: player 1 aboard the beached canoe, the cost in the cargo, no hammer in the crew.
    const yard = newGame(7, { crew: 2 });
    yard.canoe.hullTier = 1;
    standOn(yard, 'home_knoll');
    yard.canoe.cargo.push({ itemId: 'plank', count: 8 }, { itemId: 'nails', count: 6 }, { itemId: 'rope', count: 2 });
    expect(dispatch(yard, { type: 'upgrade_hull' }, 1)).toMatchObject({ ok: false, reason: 'missing_requirements', missing: { tools: ['hammer'] } });
    yard.tools.push('hammer');
    expect(dispatch(yard, { type: 'upgrade_hull' }, 1).ok).toBe(true);
    expect(yard.canoe.hullTier).toBe(2);

    // The bailing can: one for the crew, and scooping water needs it whoever scoops.
    const afloat = crewAfloat(2);
    expect(dispatch(afloat, { type: 'fill_water', count: 1 }, 1).ok).toBe(true);
    afloat.tools = [];
    for (const player of afloat.players) {
      expect(dispatch(afloat, { type: 'fill_water', count: 1 }, player.id))
        .toMatchObject({ ok: false, reason: 'missing_requirements', missing: { tools: ['bailing_can'] } });
    }
  });

  it('gives a late joiner the crew\'s tools at once, and no second bailing can', () => {
    const state = createGame(7);
    state.tools.push('hatchet');
    const joined = addPlayer(state)!;
    expect(state.tools).toEqual(['bailing_can', 'hatchet']);
    expect(Object.keys(joined)).not.toContain('tools');
    expect(dispatch(state, { type: 'select_tool', toolId: 'hatchet' }, joined.id).ok).toBe(true);
  });
});

describe('sleeping as a crew', () => {
  function bedtime(crew: number): GameState {
    const state = crewAtCamp(crew);
    state.time = 21 * HOUR;
    for (const player of state.players) player.energy = 30;
    return state;
  }

  it('skips to morning only when every player is asleep', () => {
    const state = bedtime(3);
    expect(dispatch(state, { type: 'sleep' }, 0).ok).toBe(true);
    expect(dispatch(state, { type: 'sleep' }, 2).ok).toBe(true);
    expect(state.players.map((player) => player.asleep)).toEqual([true, false, true]);
    expect(state.time).toBe(21 * HOUR); // one still up: no skip
    expect(state.players[0].energy).toBe(30);
    expect(drainEvents(state).some((event) => event.type === 'slept')).toBe(false);
    // The last one lies down: the night skips for everyone.
    expect(dispatch(state, { type: 'sleep' }, 1).ok).toBe(true);
    expect(state.time).toBe(DAY + 6 * HOUR);
    for (const player of state.players) {
      expect(player.asleep).toBe(false);
      expect(player.energy).toBe(100);
      expect(player.hunger).toBeCloseTo(100 - TUNING.survival.hungerPerSecond * 0.5 * 9 * HOUR, 6);
    }
    const events = drainEvents(state);
    expect(events.filter((event) => event.type === 'slept').map((event) => event.playerId)).toEqual([0, 1, 2]);
    expect(events.filter((event) => event.type === 'autosave_requested')).toHaveLength(1);
  });

  it('holds a sleeper still, offers them a way up, and lets them get up', () => {
    const state = bedtime(2);
    dispatch(state, { type: 'sleep' }, 0);
    const before = { ...state.players[0].position };
    runCrew(state, [{ moveX: 1 }, {}], 1);
    expect(state.players[0].position).toEqual(before);
    expect(selectInteractable(state, 0)).toMatchObject({ kind: 'bed', command: { type: 'wake' } });
    expect(selectInteractable(state, 1)).toMatchObject({ kind: 'bed', command: { type: 'sleep' } });
    expect(dispatch(state, { type: 'wake' }, 0).ok).toBe(true);
    expect(state.players[0].asleep).toBe(false);
    runCrew(state, [{ moveX: 1 }, {}], 1);
    expect(state.players[0].position.x).toBeGreaterThan(before.x + 2);
    // Someone who got up no longer counts: the other lying down does not skip the night.
    dispatch(state, { type: 'sleep' }, 1);
    expect(state.time).toBeLessThan(22 * HOUR);
  });

  it('refuses a bed to a player who is nowhere near one, without blocking the others from lying down', () => {
    const state = bedtime(2);
    const landing = islandLanding('birch_islet').shore;
    putAshore(state.players[1], 'birch_islet', landing.x, landing.z);
    expect(dispatch(state, { type: 'sleep' }, 1)).toMatchObject({ ok: false, reason: 'no_bed_in_reach' });
    expect(dispatch(state, { type: 'sleep' }, 0).ok).toBe(true);
    expect(state.players[0].asleep).toBe(true);
    expect(state.time).toBe(21 * HOUR);
  });
});

describe('failing in a crew', () => {
  /** Player 0 afloat in the canoe with cargo; player 1 on Birch Islet with a full backpack. */
  function splitCrew(): GameState {
    const state = crewAfloat(2);
    pastFirstQuest(state);
    state.canoe.cargo.push({ itemId: 'plank', count: 20 }, { itemId: 'nails', count: 5 });
    const landing = islandLanding('birch_islet').shore;
    putAshore(state.players[1], 'birch_islet', landing.x, landing.z);
    state.players[1].backpack.push({ itemId: 'driftwood', count: 9 }, { itemId: 'berries', count: 1 }, { itemId: 'fiber', count: 20 });
    state.tools.push('hatchet');
    state.players[1].selectedTool = 'hatchet';
    return state;
  }

  it('fails a player at 0 energy alone: respawn point, meters at 50, half of each backpack stack', () => {
    const state = splitCrew();
    const [aboard, tired] = state.players;
    tired.energy = 0.001;
    tired.thirst = 0; // parched: the last of the energy drains away
    // The same step with nobody failing, to compare against.
    const control = splitCrew();
    runCrew(control, [], FIXED_STEP);
    const events = runCrew(state, [], FIXED_STEP);

    expect(tired).toMatchObject({ mode: 'foot', islandId: 'home_knoll', hunger: 50, thirst: 50, energy: 50, seat: null });
    const berth = landingBerth('home_knoll', state.canoe.hullTier);
    expect(Math.hypot(tired.position.x - berth.x, tired.position.z - berth.z)).toBeLessThan(8);
    expect(terrainHeight(tired.position.x, tired.position.z)).toBeGreaterThanOrEqual(-TUNING.foot.disembarkDepth);
    // Half of each stack, rounded in the player's favour. No tool is lost, and the one in hand stays there.
    expect(tired.backpack).toEqual([{ itemId: 'driftwood', count: 5 }, { itemId: 'berries', count: 1 }, { itemId: 'fiber', count: 10 }]);
    expect(state.tools).toEqual(['bailing_can', 'hatchet']);
    expect(tired.selectedTool).toBe('hatchet');
    // The canoe, its cargo, the clock and the other player carry on untouched.
    expect(state.canoe).toEqual(control.canoe);
    expect(state.time).toBe(control.time);
    expect(state.weather).toEqual(control.weather);
    expect(aboard).toEqual(control.players[0]);
    expect(aboard).toMatchObject({ mode: 'canoe', seat: 0 });
    expect(state.statistics.fails).toBe(1);
    expect(events).toContainEqual({ type: 'exhausted', playerId: 1 });
    expect(events).toContainEqual({
      type: 'washed_ashore', cause: 'exhausted', islandId: 'home_knoll', playerId: 1,
      lost: [{ itemId: 'driftwood', count: 4 }, { itemId: 'fiber', count: 10 }],
    });
    expect(events.some((event) => event.type === 'capsized' || event.type === 'canoe_beached')).toBe(false);
  });

  it('fails a seated player alone too when someone else is still aboard', () => {
    const state = crewAfloat(3);
    state.canoe.cargo.push({ itemId: 'plank', count: 20 });
    state.players[2].energy = 0.001;
    state.players[2].thirst = 0;
    const position = { ...state.canoe.position };
    runCrew(state, [], FIXED_STEP);
    expect(state.players[2]).toMatchObject({ mode: 'foot', islandId: 'home_knoll', seat: null, energy: 50 });
    expect(state.players.slice(0, 2).map((player) => player.mode)).toEqual(['canoe', 'canoe']);
    expect(state.canoe.position.x).toBeCloseTo(position.x, 1);
    expect(state.canoe.beached).toBe(false);
    expect(countIn(state.canoe.cargo, 'plank')).toBe(20);
  });

  it('takes the canoe along when the exhausted player was the last one aboard it afloat', () => {
    const state = splitCrew();
    const [alone, ashore] = state.players;
    alone.energy = 0.001;
    alone.thirst = 0;
    const ashoreBefore = JSON.stringify({ ...ashore, thirst: 0, hunger: 0, energy: 0 });
    const timeBefore = state.time;
    runCrew(state, [], FIXED_STEP);
    // The solo rule: canoe beached at the respawn point, cargo halved, six hours on.
    expect(alone).toMatchObject({ mode: 'foot', islandId: 'home_knoll', energy: 50 });
    expect(state.canoe.beached).toBe(true);
    expect(state.canoe.lastBeached.islandId).toBe('home_knoll');
    expect(countIn(state.canoe.cargo, 'plank')).toBe(10);
    expect(state.time).toBeCloseTo(timeBefore + FIXED_STEP + TUNING.time.failSkipHours * HOUR, 6);
    // The player on Birch Islet keeps their place, their backpack and their tool in hand. The crew keeps every tool.
    expect(JSON.stringify({ ...ashore, thirst: 0, hunger: 0, energy: 0 })).toBe(ashoreBefore);
    expect(state.tools).toEqual(['bailing_can', 'hatchet']);
    expect(ashore.selectedTool).toBe('hatchet');
  });

  it('capsizes everyone aboard under the solo rule and leaves the player ashore alone', () => {
    const state = newGame(7, { crew: 3 });
    pastFirstQuest(state);
    state.canoe.hullTier = 2;
    floatCanoeAt(state, 150, 100); // the Reach: too rough for a bare hull
    for (const player of state.players) player.position = { ...state.canoe.position };
    state.weather.secondsRemaining = 99999;
    state.canoe.cargo.push({ itemId: 'plank', count: 20 }, { itemId: 'nails', count: 5 });
    state.canoe.waterLevel = 99.9;
    const [first, second, ashore] = state.players;
    const landing = islandLanding('birch_islet').shore;
    putAshore(ashore, 'birch_islet', landing.x, landing.z);
    ashore.backpack.push({ itemId: 'driftwood', count: 9 });
    first.backpack.push({ itemId: 'berries', count: 6 });
    first.hunger = 91;
    second.thirst = 12;
    state.tools.push('hammer', 'hatchet');
    first.selectedTool = 'hammer';
    ashore.selectedTool = 'hatchet';
    const ashoreBefore = { ...ashore.position };
    const timeBefore = state.time;
    drainEvents(state);
    // Step until the very step it goes under.
    const events: GameEvent[] = [];
    for (let index = 0; index < 300 && state.statistics.fails === 0; index += 1) events.push(...runCrew(state, [{ paddle: 1 }], FIXED_STEP));

    expect(events.filter((event) => event.type === 'capsized')).toHaveLength(1);
    for (const victim of [first, second]) {
      expect(victim).toMatchObject({ mode: 'foot', islandId: 'home_knoll', seat: null, hunger: 50, thirst: 50, energy: 50 });
    }
    expect(Math.hypot(first.position.x - second.position.x, first.position.z - second.position.z)).toBeGreaterThan(0.55);
    // Today's rule: cargo halved, backpacks kept, canoe beached at the respawn point, dry, six hours on.
    expect(countIn(state.canoe.cargo, 'plank')).toBe(10);
    expect(countIn(state.canoe.cargo, 'nails')).toBe(3);
    expect(countIn(first.backpack, 'berries')).toBe(6);
    expect(state.canoe).toMatchObject({ beached: true, waterLevel: 0 });
    expect(state.canoe.lastBeached.islandId).toBe('home_knoll');
    expect(state.time - timeBefore).toBeGreaterThan(TUNING.time.failSkipHours * HOUR);
    expect(state.time - timeBefore).toBeLessThan(TUNING.time.failSkipHours * HOUR + 5);
    expect(state.statistics.fails).toBe(1);
    expect(events.filter((event) => event.type === 'washed_ashore').map((event) => event.playerId)).toEqual([0, 1]);
    // The third player was on Birch Islet: nothing of theirs moved or was lost.
    expect(ashore.position).toEqual(ashoreBefore);
    expect(ashore).toMatchObject({ mode: 'foot', islandId: 'birch_islet' });
    expect(countIn(ashore.backpack, 'driftwood')).toBe(9);
    expect(ashore.energy).toBeGreaterThan(80);
    // A capsize loses no tool, and takes none out of anyone's hand.
    expect(state.tools).toEqual(['bailing_can', 'hammer', 'hatchet']);
    expect(state.players.map((player) => player.selectedTool)).toEqual(['hammer', null, 'hatchet']);
  });

  it('does not capsize an empty canoe', () => {
    const state = crewAtCamp(2);
    state.canoe.waterLevel = 100;
    runCrew(state, [], 1);
    expect(state.statistics.fails).toBe(0);
  });
});

describe('determinism with four players', () => {
  /** A scripted minute for four: bail, paddle off, steer, land, walk about. */
  function play(seed: number): GameState {
    const state = createGame(seed, { crew: 4 });
    runCrew(state, [{ bail: true }, { bail: true }, { paddle: 0.4 }, { steer: 0.2 }], 6);
    runCrew(state, [{ paddle: 1, powerStroke: true }, { paddle: 1 }, { paddle: 1, steer: -0.1 }, { bail: true }], 30);
    dispatch(state, { type: 'disembark' }, 3);
    dispatch(state, { type: 'disembark' }, 1);
    dispatch(state, { type: 'fill_water', count: 1 }, 1);
    runCrew(state, [{ paddle: -1 }, { moveX: 1, run: true }, { steer: 1 }, { moveY: 1, cameraYaw: 2 }], 20);
    dispatch(state, { type: 'scavenge' }, 1);
    dispatch(state, { type: 'scavenge' }, 3);
    dispatch(state, { type: 'eat', itemId: 'berries' }, 1);
    runCrew(state, [{ paddle: 1 }, { moveY: -1, cameraYaw: 1 }, {}, { moveX: -0.5, moveY: 0.5 }], 10);
    return state;
  }

  it('gives the same state for the same seed and the same inputs', () => {
    const first = play(5);
    const second = play(5);
    expect(first.players).toHaveLength(4);
    expect(hashState(first)).toBe(hashState(second));
    expect(first).toEqual(second);
    expect(hashState(play(6))).not.toBe(hashState(first));
    // The script really did something with everyone.
    expect(first.players.map((player) => player.mode)).toContain('foot');
    expect(first.statistics.distancePaddled).toBeGreaterThan(20);
    expect(first.statistics.distanceWalked).toBeGreaterThan(20);
  });

  it('does not care how the frames are cut: one long step or many short ones', () => {
    const inputs = [{ paddle: 1 }, { bail: true }, { steer: 0.3 }, {}].map((input) => ({ ...NEUTRAL_INPUT, ...input }));
    const fine = createGame(9, { crew: 4 });
    const coarse = createGame(9, { crew: 4 });
    for (let index = 0; index < 600; index += 1) step(fine, inputs, FIXED_STEP);
    for (let index = 0; index < 40; index += 1) step(coarse, inputs, 0.25);
    expect(coarse.tick).toBe(fine.tick);
    // The leftover frame time differs in the last bit; everything simulated is the same.
    expect({ ...coarse, stepAccumulator: 0 }).toEqual({ ...fine, stepAccumulator: 0 });
  });

  it('stays plain JSON with four players', () => {
    const state = play(5);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});

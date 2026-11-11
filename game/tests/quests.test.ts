import { describe, expect, it } from 'vitest';
import { MAIN_QUESTS, NODE_IDS, NODES_BY_ID } from '../src/data/index.ts';
import {
  dispatch, selectActiveQuests, selectCurrentMainQuest, selectInteractable, selectQuestLog,
} from '../src/sim/index.ts';
import type { GameState } from '../src/sim/index.ts';
import {
  build, countIn, floatCanoeAt, give, newGame, run, standOn, teleportToCamp, teleportToNode,
} from './support.ts';

const tracked = (state: GameState) => selectActiveQuests(state)[0];

describe('the main line', () => {
  it('starts on Bail out, tracked, with live objective progress', () => {
    const state = newGame();
    expect(selectCurrentMainQuest(state)).toBe('bail_out');
    expect(tracked(state)).toMatchObject({ questId: 'bail_out', kind: 'main', status: 'active', tracked: true });
    expect(tracked(state).objectives.map((objective) => objective.done)).toEqual([false, false]);
    const events = run(state, { bail: true }, 22);
    expect(tracked(state).objectives.map((objective) => objective.done)).toEqual([true, false]);
    expect(events).toContainEqual({ type: 'quest_advanced', questId: 'bail_out', objectiveIndex: 0, progress: 1, required: 1 });
  });

  it('completes a quest by itself, pays the reward and starts the next', () => {
    const state = newGame();
    state.canoe.waterLevel = 5;
    standOn(state, 'home_knoll');
    const events = run(state, {}, 0.5);
    const types = events.map((event) => event.type);
    expect(types).toContain('quest_completed');
    expect(events).toContainEqual({ type: 'quest_started', questId: 'first_haul' });
    expect(state.quests.bail_out.status).toBe('completed');
    expect(state.quests.first_haul.status).toBe('active');
    expect(state.trackedQuestId).toBe('first_haul');
    expect(countIn(state.players[0].backpack, 'berries')).toBe(4);
    expect(countIn(state.players[0].backpack, 'clean_water')).toBe(2);
    expect(state.quests.stop_the_leak.status).toBe('locked');
  });

  it('latches objectives: spending the driftwood does not undo "gather driftwood"', () => {
    const state = newGame();
    state.canoe.waterLevel = 5;
    standOn(state, 'home_knoll');
    give(state, 'driftwood', 3);
    give(state, 'fiber', 4);
    give(state, 'stone', 2);
    run(state, {}, 0.5);
    expect(tracked(state).objectives.map((objective) => objective.progress)).toEqual([3, 4, 0]);
    expect(dispatch(state, { type: 'craft', recipeId: 'stone_knife' }).ok).toBe(true);
    expect(state.quests.first_haul.status).toBe('completed');
    expect(countIn(state.players[0].backpack, 'driftwood')).toBe(2);
    expect(selectCurrentMainQuest(state)).toBe('stop_the_leak');
  });

  it('counts crafting only while the quest that asks for it is active', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    teleportToCamp(state, 'home_knoll');
    give(state, 'spruce_gum', 8);
    give(state, 'driftwood', 6);
    expect(dispatch(state, { type: 'craft', recipeId: 'pitch', count: 2 }).ok).toBe(true); // too early to count
    state.quests.bail_out.status = 'completed';
    state.quests.first_haul.status = 'completed';
    state.quests.stop_the_leak.status = 'active';
    expect(state.quests.stop_the_leak.progress[2]).toBe(0);
    expect(dispatch(state, { type: 'craft', recipeId: 'pitch' }).ok).toBe(true);
    expect(state.quests.stop_the_leak.progress[2]).toBe(1);
    expect(dispatch(state, { type: 'craft', recipeId: 'pitch' }).ok).toBe(true);
    expect(state.quests.stop_the_leak.progress[2]).toBe(2);
  });

  it('gates the Beacon lamp on the rest of its quest, and ends the main line when it is lit', () => {
    const state = newGame();
    for (const quest of MAIN_QUESTS.slice(0, 11)) state.quests[quest.id].status = 'completed';
    state.quests.the_beacon.status = 'active';
    state.canoe.hullTier = 3;
    build(state, 'outrigger_port', 'outrigger_starboard', 'lantern_mast', 'radio');
    standOn(state, 'the_beacon');
    teleportToNode(state, NODE_IDS.beaconLamp);
    run(state, {}, 0.5);
    expect(selectInteractable(state)).toMatchObject({ kind: 'node', nodeId: NODE_IDS.beaconLamp, available: false });
    run(state, { interactHeld: true }, 8);
    expect(state.flags.beacon_lit).toBeUndefined();

    // Stock the hull: six stock food and six clean water in the cargo.
    give(state, 'smoked_fish', 4, 'cargo');
    give(state, 'jam', 2, 'cargo');
    give(state, 'clean_water', 6, 'cargo');
    run(state, {}, 0.5);
    expect(state.quests.the_beacon.progress).toEqual([12, 1, 0]);
    expect(selectInteractable(state)).toMatchObject({ available: true, prompt: 'Light: Beacon lamp' });
    const events = run(state, { interactHeld: true }, NODES_BY_ID[NODE_IDS.beaconLamp].actions[0].seconds + 0.5);
    expect(events.map((event) => event.type)).toContain('game_completed');
    expect(state.flags.beacon_lit).toBe(true);
    expect(selectCurrentMainQuest(state)).toBeNull();
    expect(state.quests.the_beacon.status).toBe('completed');
    // Free play: the game goes on.
    floatCanoeAt(state, 0, -1100);
    run(state, { paddle: 1 }, 3);
    expect(state.statistics.fails).toBe(0);
  });
});

describe('side quests', () => {
  it('offers, tracks deliveries live, and pays out on turn-in', () => {
    const state = newGame();
    standOn(state, 'orchard_hill');
    expect(state.quests.odile_windfall.status).toBe('available');
    expect(state.quests.odile_something_sweet.status).toBe('locked');
    expect(dispatch(state, { type: 'accept_quest', questId: 'odile_windfall' })).toMatchObject({ ok: false, reason: 'npc_out_of_reach' });
    state.players[0].position.x = -250 + 0.18 * 72;
    state.players[0].position.z = 705 + 0.22 * 56 + 1;
    expect(dispatch(state, { type: 'accept_quest', questId: 'odile_windfall' }).ok).toBe(true);
    expect(dispatch(state, { type: 'accept_quest', questId: 'odile_windfall' })).toMatchObject({ ok: false, reason: 'quest_not_available' });
    expect(dispatch(state, { type: 'turn_in_quest', questId: 'odile_windfall' })).toMatchObject({ ok: false, reason: 'quest_not_ready' });

    give(state, 'apple', 6);
    run(state, {}, 0.5);
    expect(state.quests.odile_windfall.status).toBe('ready');
    expect(dispatch(state, { type: 'eat', itemId: 'apple' }).ok).toBe(true);
    run(state, {}, 0.5);
    expect(state.quests.odile_windfall.status).toBe('active'); // one short again
    give(state, 'apple', 1);

    const result = dispatch(state, { type: 'turn_in_quest', questId: 'odile_windfall' });
    expect(result.ok).toBe(true);
    expect(countIn(state.players[0].backpack, 'apple')).toBe(0);
    expect(countIn(state.players[0].backpack, 'seeds')).toBe(4);
    expect(countIn(state.players[0].backpack, 'glass_jar')).toBe(2);
    expect(state.quests.odile_windfall.status).toBe('completed');
    expect(state.quests.odile_something_sweet.status).toBe('available');
    expect(state.quests.odile_garden_afloat.status).toBe('available');
  });

  it('keeps the collection quests out of the log until the first find', () => {
    const state = newGame();
    expect(selectQuestLog(state).map((quest) => quest.questId)).not.toContain('ten_bottles');
    standOn(state, 'home_knoll');
    teleportToNode(state, 'home_knoll.bottle');
    const events = run(state, { interactHeld: true }, 1.5);
    expect(events).toContainEqual({ type: 'bottle_found', bottleId: 'bottle_01' });
    expect(state.bottlesFound).toEqual(['bottle_01']);
    const entry = selectQuestLog(state).find((quest) => quest.questId === 'ten_bottles')!;
    expect(entry.objectives[0]).toMatchObject({ progress: 1, required: 10, done: false });
  });

  it('holds rewards that do not fit until they are claimed', () => {
    const state = newGame();
    state.canoe.waterLevel = 5;
    for (let slot = 0; slot < 8; slot += 1) give(state, 'stone', 20);
    for (let slot = 0; slot < 8; slot += 1) give(state, 'clay', 20, 'cargo');
    standOn(state, 'home_knoll');
    const events = run(state, {}, 0.5);
    expect(events.map((event) => event.type)).toContain('rewards_pending');
    expect(state.pendingRewards).toEqual([{ itemId: 'berries', count: 4 }, { itemId: 'clean_water', count: 2 }]);
    expect(dispatch(state, { type: 'claim_rewards' })).toMatchObject({ ok: false, reason: 'inventory_full' });
    dispatch(state, { type: 'discard', from: 'backpack', itemId: 'stone', count: 40 });
    expect(dispatch(state, { type: 'claim_rewards' }).ok).toBe(true);
    expect(state.pendingRewards).toEqual([]);
    expect(dispatch(state, { type: 'claim_rewards' })).toMatchObject({ ok: false, reason: 'nothing_to_claim' });
  });

  it('lets the tracker follow any quest', () => {
    const state = newGame();
    standOn(state, 'orchard_hill');
    state.players[0].position.x = -250 + 0.18 * 72;
    state.players[0].position.z = 705 + 0.22 * 56 + 1;
    dispatch(state, { type: 'accept_quest', questId: 'odile_windfall' });
    expect(dispatch(state, { type: 'track_quest', questId: 'odile_windfall' }).ok).toBe(true);
    expect(tracked(state).questId).toBe('odile_windfall');
    expect(dispatch(state, { type: 'track_quest', questId: null }).ok).toBe(true);
    expect(selectActiveQuests(state).every((quest) => !quest.tracked)).toBe(true);
  });
});

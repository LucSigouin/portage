import { describe, expect, it } from 'vitest';
import { LOOT_TABLES, NODES_BY_ID, NODE_IDS, TUNING } from '../src/data/index.ts';
import { dispatch, drainEvents, selectInteractable } from '../src/sim/index.ts';
import type { GameEvent } from '../src/sim/index.ts';
import {
  build, countIn, floatCanoeAt, give, newGame, run, scavenge, standOn, teleport, teleportToNode,
} from './support.ts';

const DAY = TUNING.time.daySeconds;
const gained = (events: GameEvent[]) => events.filter((event) => event.type === 'item_gained');

describe('scavenging', () => {
  it('prompts for the nearest node and takes one press, no holding', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    teleportToNode(state, 'home_knoll.driftwood_pile.1');
    expect(selectInteractable(state)).toMatchObject({
      kind: 'node', nodeId: 'home_knoll.driftwood_pile.1', prompt: 'Gather: Driftwood pile', available: true,
      command: { type: 'scavenge' },
    });
    const timeBefore = state.time;
    const result = dispatch(state, { type: 'scavenge' });
    const events = drainEvents(state);
    // Done on the press: no time passes, the loot is in the backpack, the node is picked clean.
    expect(state.time).toBe(timeBefore);
    const wood = countIn(state.players[0].backpack, 'driftwood');
    expect(wood).toBeGreaterThanOrEqual(3);
    expect(wood).toBeLessThanOrEqual(4);
    expect(result).toMatchObject({ ok: true, gained: [{ itemId: 'driftwood', count: wood }] });
    expect(events).toContainEqual({ type: 'harvest_started', nodeId: 'home_knoll.driftwood_pile.1', actionIndex: 0, playerId: 0 });
    expect(events).toContainEqual({ type: 'node_depleted', nodeId: 'home_knoll.driftwood_pile.1', playerId: 0 });
    expect(selectInteractable(state)).toBeNull();
    expect(state.statistics.nodesHarvested).toBe(1);
    // A second press finds nothing there.
    expect(dispatch(state, { type: 'scavenge' })).toMatchObject({ ok: false, reason: 'nothing_in_reach' });
    expect(state.statistics.nodesHarvested).toBe(1);
  });

  it('does nothing while the key is merely held: stepping never scavenges', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    teleportToNode(state, 'home_knoll.driftwood_pile.1');
    run(state, {}, 5);
    expect(countIn(state.players[0].backpack, 'driftwood')).toBe(0);
    expect(selectInteractable(state)).toMatchObject({ nodeId: 'home_knoll.driftwood_pile.1', available: true });
  });

  it('refills most nodes after ten minutes, and never a unique cache', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    teleportToNode(state, 'home_knoll.driftwood_pile.1');
    scavenge(state);
    state.time += TUNING.nodes.refillSeconds - 10;
    expect(selectInteractable(state)).toBeNull();
    state.time += 11;
    expect(selectInteractable(state)).toMatchObject({ nodeId: 'home_knoll.driftwood_pile.1', available: true });

    standOn(state, 'cabin_roofs');
    teleportToNode(state, NODE_IDS.atticChest);
    scavenge(state);
    expect(state.keyItems.hatchet_head).toBe(1);
    state.time += 100 * DAY;
    expect(selectInteractable(state)).toBeNull();
  });

  it('refuses without the tool, and says which', () => {
    const state = newGame();
    standOn(state, 'birch_islet');
    teleportToNode(state, 'birch_islet.birch.1');
    expect(selectInteractable(state)).toMatchObject({ available: false, prompt: 'Birch needs stone knife', missing: { tools: ['stone_knife'] } });
    expect(dispatch(state, { type: 'scavenge' })).toMatchObject({ ok: false, reason: 'missing_requirements', missing: { tools: ['stone_knife'] } });
    const events = drainEvents(state);
    expect(events.filter((event) => event.type === 'harvest_blocked')).toHaveLength(1);
    expect(events.find((event) => event.type === 'harvest_blocked')).toMatchObject({ missing: { tools: ['stone_knife'] }, playerId: 0 });
    expect(countIn(state.players[0].backpack, 'birch_bark')).toBe(0);
    expect(state.statistics.nodesHarvested).toBe(0);
    give(state, 'stone_knife');
    scavenge(state);
    expect(countIn(state.players[0].backpack, 'birch_bark')).toBeGreaterThanOrEqual(2);
  });

  it('takes gum from a spruce by hand and logs with the hatchet out', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    teleportToNode(state, 'home_knoll.spruce.1');
    expect(selectInteractable(state)).toMatchObject({ prompt: 'Scrape gum: Spruce', actionIndex: 0 });
    give(state, 'hatchet');
    state.players[0].selectedTool = 'hatchet';
    state.players[0].energy = 80;
    expect(selectInteractable(state)).toMatchObject({ prompt: 'Chop: Spruce', actionIndex: 1 });
    const chop = scavenge(state);
    expect(chop.find((event) => event.type === 'harvest_started')).toMatchObject({ actionIndex: 1 });
    expect(countIn(state.players[0].backpack, 'log')).toBe(3);
    // Chopping is work: the energy rule is the same as when it took a hold.
    expect(state.players[0].energy).toBe(80 - NODES_BY_ID['home_knoll.spruce.1'].actions[1].energyCost);
    // The gum is still there: each action has its own clock.
    expect(selectInteractable(state)).toMatchObject({ prompt: 'Scrape gum: Spruce', actionIndex: 0 });
    scavenge(state);
    expect(countIn(state.players[0].backpack, 'spruce_gum')).toBeGreaterThanOrEqual(2);
    expect(selectInteractable(state)).toBeNull();
  });

  it('will not chop when too tired, and says so', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    teleportToNode(state, 'home_knoll.spruce.1');
    give(state, 'hatchet');
    state.players[0].selectedTool = 'hatchet';
    const cost = NODES_BY_ID['home_knoll.spruce.1'].actions[1].energyCost;
    expect(cost).toBeGreaterThan(0);
    state.players[0].energy = TUNING.survival.minimumEnergyToExert + cost - 0.5;
    expect(dispatch(state, { type: 'scavenge' })).toMatchObject({ ok: false, reason: 'too_tired' });
    expect(countIn(state.players[0].backpack, 'log')).toBe(0);
    expect(state.players[0].energy).toBe(TUNING.survival.minimumEnergyToExert + cost - 0.5);
    // With just enough, it goes, and never takes the player to a fail.
    state.players[0].energy = TUNING.survival.minimumEnergyToExert + cost;
    expect(dispatch(state, { type: 'scavenge' }).ok).toBe(true);
    expect(state.players[0].energy).toBe(TUNING.survival.minimumEnergyToExert);
  });

  it('leaves what does not fit on the node, to pick up later with one press', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    teleport(state, 'home_knoll', NODES_BY_ID['home_knoll.driftwood_pile.3'].position.x + 0.5, NODES_BY_ID['home_knoll.driftwood_pile.3'].position.z);
    // Backpack and cargo both full: the canoe is landed here, so what does not fit in one would go in the other.
    for (let slot = 0; slot < 8; slot += 1) give(state, 'stone', 20);
    for (let slot = 0; slot < 8; slot += 1) give(state, 'stone', 20, 'cargo');
    const first = dispatch(state, { type: 'scavenge' });
    const events = drainEvents(state);
    const left = events.find((event) => event.type === 'item_left_behind');
    expect(left).toMatchObject({ nodeId: 'home_knoll.driftwood_pile.3', itemId: 'driftwood' });
    expect(first).toMatchObject({ ok: true, gained: [] }); // nothing fitted
    expect(selectInteractable(state)).toMatchObject({ prompt: 'Pick up from Driftwood pile', actionIndex: -1, command: { type: 'scavenge' } });
    state.players[0].backpack.pop();
    const pickUp = dispatch(state, { type: 'scavenge' });
    const wood = countIn(state.players[0].backpack, 'driftwood');
    expect(wood).toBeGreaterThanOrEqual(3);
    expect(pickUp).toMatchObject({ ok: true, gained: [{ itemId: 'driftwood', count: wood }] });
    expect(selectInteractable(state)).toBeNull();
    expect(state.statistics.nodesHarvested).toBe(1); // a pick-up is not a second harvest
  });

  it('hauls a sunken cache from the canoe, with the winch', () => {
    const state = newGame();
    state.canoe.hullTier = 3;
    build(state, 'outrigger_port', 'outrigger_starboard');
    const buoy = NODES_BY_ID['truss_bridge.wreck_buoy.1'];
    floatCanoeAt(state, buoy.position.x + 3, buoy.position.z);
    state.weather.windSpeed = 0;
    state.weather.windTarget = 0;
    state.weather.secondsRemaining = 9999;
    expect(selectInteractable(state)).toMatchObject({ kind: 'node', available: false, missing: { attachments: ['winch'] } });
    expect(dispatch(state, { type: 'scavenge' })).toMatchObject({ ok: false, reason: 'missing_requirements', missing: { attachments: ['winch'] } });
    build(state, 'winch');
    expect(selectInteractable(state)).toMatchObject({ available: true, prompt: 'Haul up: Tug wreck buoy' });
    const events = scavenge(state);
    expect(events).toContainEqual({ type: 'cache_hauled', nodeId: buoy.id });
    expect(countIn(state.canoe.cargo, 'steel_cable')).toBe(1);
    expect(state.statistics.cachesHauled).toBe(1);
  });

  it('is refused in the middle of a conversation', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    teleportToNode(state, 'home_knoll.driftwood_pile.1');
    state.players[0].dialogue = { npcId: 'odile', nodeId: 'start' };
    expect(dispatch(state, { type: 'scavenge' })).toMatchObject({ ok: false, reason: 'in_dialogue' });
    expect(countIn(state.players[0].backpack, 'driftwood')).toBe(0);
  });

  it('rolls loot inside its table on every seed', () => {
    const table = LOOT_TABLES.crate;
    const poolIds = table.pool.map((entry) => entry.itemId);
    const seen = new Set<string>();
    for (let seed = 1; seed <= 25; seed += 1) {
      const state = newGame(seed);
      standOn(state, 'the_boathouse');
      give(state, 'pry_bar');
      teleportToNode(state, 'the_boathouse.crate.1');
      const loot = gained(scavenge(state));
      const nails = loot.find((event) => event.type === 'item_gained' && event.itemId === 'nails');
      expect(nails).toBeDefined();
      for (const event of loot) {
        if (event.type !== 'item_gained') continue;
        if (event.itemId === 'nails') {
          expect(event.count).toBeGreaterThanOrEqual(3);
          expect(event.count).toBeLessThanOrEqual(8);
        } else if (poolIds.includes(event.itemId)) {
          seen.add(event.itemId);
          expect(event.count).toBeLessThanOrEqual(4);
        } else {
          throw new Error(`${event.itemId} is not in the crate table`);
        }
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(5); // the seed really varies the pool
  });
});

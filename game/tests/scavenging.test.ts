import { describe, expect, it } from 'vitest';
import { LOOT_TABLES, NODES, NODES_BY_ID, NODE_IDS, TUNING } from '../src/data/index.ts';
import { selectInteractable } from '../src/sim/index.ts';
import type { GameEvent } from '../src/sim/index.ts';
import {
  build, countIn, floatCanoeAt, give, newGame, run, standOn, teleport, teleportToNode,
} from './support.ts';

const DAY = TUNING.time.daySeconds;
const gained = (events: GameEvent[]) => events.filter((event) => event.type === 'item_gained');

describe('scavenging', () => {
  it('prompts for the nearest node and completes after the hold time', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    teleportToNode(state, 'home_knoll.driftwood_pile.1');
    expect(selectInteractable(state)).toMatchObject({
      kind: 'node', nodeId: 'home_knoll.driftwood_pile.1', prompt: 'Gather: Driftwood pile', holdSeconds: 2, available: true, progress: 0,
    });
    const early = run(state, { interactHeld: true }, 1);
    expect(early).toContainEqual({ type: 'harvest_started', nodeId: 'home_knoll.driftwood_pile.1' });
    const halfWay = selectInteractable(state);
    expect(halfWay?.kind === 'node' ? halfWay.progress : -1).toBeCloseTo(0.5, 6);
    expect(countIn(state.player.backpack, 'driftwood')).toBe(0);
    const late = run(state, { interactHeld: true }, 1.1);
    const wood = countIn(state.player.backpack, 'driftwood');
    expect(wood).toBeGreaterThanOrEqual(3);
    expect(wood).toBeLessThanOrEqual(4);
    expect(late).toContainEqual({ type: 'node_depleted', nodeId: 'home_knoll.driftwood_pile.1' });
    expect(selectInteractable(state)).toBeNull(); // picked clean
    expect(state.statistics.nodesHarvested).toBe(1);
  });

  it('starts over if you let go', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    teleportToNode(state, 'home_knoll.driftwood_pile.1');
    run(state, { interactHeld: true }, 1.5);
    run(state, {}, 0.1);
    run(state, { interactHeld: true }, 1.5);
    expect(countIn(state.player.backpack, 'driftwood')).toBe(0);
    run(state, { interactHeld: true }, 0.6);
    expect(countIn(state.player.backpack, 'driftwood')).toBeGreaterThan(0);
  });

  it('respawns most nodes after their days, and never a unique cache', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    teleportToNode(state, 'home_knoll.driftwood_pile.1');
    run(state, { interactHeld: true }, 2.1);
    state.time += 2 * DAY - 10;
    expect(selectInteractable(state)).toBeNull();
    state.time += 11;
    expect(selectInteractable(state)).toMatchObject({ nodeId: 'home_knoll.driftwood_pile.1', available: true });

    standOn(state, 'cabin_roofs');
    teleportToNode(state, NODE_IDS.atticChest);
    run(state, { interactHeld: true }, 4.1);
    expect(state.player.keyItems.hatchet_head).toBe(1);
    state.time += 100 * DAY;
    expect(selectInteractable(state)).toBeNull();
    for (const node of NODES) {
      for (const action of node.actions) {
        if (action.respawnDays === null) continue;
        expect(action.respawnDays, node.id).toBeGreaterThanOrEqual(0.5);
        expect(action.respawnDays, node.id).toBeLessThanOrEqual(4);
      }
    }
  });

  it('refuses without the tool, and says which', () => {
    const state = newGame();
    standOn(state, 'birch_islet');
    teleportToNode(state, 'birch_islet.birch.1');
    expect(selectInteractable(state)).toMatchObject({ available: false, prompt: 'Birch needs stone knife', missing: { tools: ['stone_knife'] } });
    const events = run(state, { interactHeld: true }, 4);
    expect(events.filter((event) => event.type === 'harvest_blocked')).toHaveLength(1);
    expect(events.find((event) => event.type === 'harvest_blocked')).toMatchObject({ missing: { tools: ['stone_knife'] } });
    expect(countIn(state.player.backpack, 'birch_bark')).toBe(0);
    give(state, 'stone_knife');
    run(state, {}, 0.1);
    run(state, { interactHeld: true }, 3.1);
    expect(countIn(state.player.backpack, 'birch_bark')).toBeGreaterThanOrEqual(2);
  });

  it('takes gum from a spruce by hand and logs with the hatchet out', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    teleportToNode(state, 'home_knoll.spruce.1');
    expect(selectInteractable(state)).toMatchObject({ prompt: 'Scrape gum: Spruce', actionIndex: 0 });
    give(state, 'hatchet');
    state.player.selectedTool = 'hatchet';
    state.player.energy = 80;
    expect(selectInteractable(state)).toMatchObject({ prompt: 'Chop: Spruce', actionIndex: 1, holdSeconds: 5 });
    run(state, { interactHeld: true }, 5.1);
    expect(countIn(state.player.backpack, 'log')).toBe(3);
    expect(state.player.energy).toBeLessThan(80 - 4); // chopping is work
    // The gum is still there: each action has its own clock.
    expect(selectInteractable(state)).toMatchObject({ prompt: 'Scrape gum: Spruce', actionIndex: 0 });
    run(state, {}, 0.1);
    run(state, { interactHeld: true }, 2.6);
    expect(countIn(state.player.backpack, 'spruce_gum')).toBeGreaterThanOrEqual(2);
    expect(selectInteractable(state)).toBeNull();
  });

  it('will not chop when exhausted', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    teleportToNode(state, 'home_knoll.spruce.1');
    give(state, 'hatchet');
    state.player.selectedTool = 'hatchet';
    state.player.energy = 8;
    state.time = 12 * 60;
    run(state, { interactHeld: true }, 5.5);
    expect(countIn(state.player.backpack, 'log')).toBe(0);
  });

  it('leaves what does not fit on the node, to pick up later', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    teleport(state, 'home_knoll', NODES_BY_ID['home_knoll.driftwood_pile.3'].position.x + 0.5, NODES_BY_ID['home_knoll.driftwood_pile.3'].position.z);
    for (let slot = 0; slot < 8; slot += 1) give(state, 'stone', 20);
    const events = run(state, { interactHeld: true }, 2.1);
    const left = events.find((event) => event.type === 'item_left_behind');
    expect(left).toMatchObject({ nodeId: 'home_knoll.driftwood_pile.3', itemId: 'driftwood' });
    expect(selectInteractable(state)).toMatchObject({ prompt: 'Pick up from Driftwood pile', actionIndex: -1 });
    state.player.backpack.pop();
    run(state, {}, 0.1);
    run(state, { interactHeld: true }, 0.6);
    expect(countIn(state.player.backpack, 'driftwood')).toBeGreaterThanOrEqual(3);
    expect(selectInteractable(state)).toBeNull();
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
    build(state, 'winch');
    expect(selectInteractable(state)).toMatchObject({ available: true, prompt: 'Haul up: Tug wreck buoy' });
    // Keep station against the current while the winch turns.
    const events = run(state, { interactHeld: true, paddle: 0.27, steer: 0 }, 8.2);
    expect(events).toContainEqual({ type: 'cache_hauled', nodeId: buoy.id });
    expect(countIn(state.canoe.cargo, 'steel_cable')).toBe(1);
    expect(state.statistics.cachesHauled).toBe(1);
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
      const loot = gained(run(state, { interactHeld: true }, 3.1));
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
          // Quest rewards for landing arrive in the same frames; nothing else may.
          expect(['berries', 'clean_water']).toContain(event.itemId);
        }
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(5); // the seed really varies the pool
  });
});

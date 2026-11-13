/**
 * Luc, 2026-11-13: "refills should be every 10 mins, for everything except the nevers."
 *
 * Every scavenge action that refills comes back ten minutes after it was used, fishing spots too, from one number
 * in the tuning. The nevers (message bottles, caches, the sunken lockers, the Beacon lamp) never come back.
 */
import { describe, expect, it } from 'vitest';
import { NODES, NODE_TYPES, TUNING } from '../src/data/index.ts';
import type { NodeDefinition } from '../src/data/index.ts';
import { dispatch, selectInteractable } from '../src/sim/index.ts';
import type { GameState } from '../src/sim/index.ts';
import { completeHarvest } from '../src/sim/interact.ts';
import { build, floatCanoeAt, give, newGame, teleportToNode } from './support.ts';

const NEVERS = ['beacon_lamp', 'cache', 'message_bottle', 'wreck_buoy'];

/** Every node of every type, once: the first one placed of each type. */
const oneOfEachType = (): NodeDefinition[] =>
  Object.keys(NODE_TYPES).map((typeId) => NODES.find((node) => node.typeId === typeId)).filter((node): node is NodeDefinition => node !== undefined);

/** A state where any node can be used: every tool, the winch, all quests open. */
function anythingGoes(): GameState {
  const state = newGame(7);
  for (const toolId of ['stone_knife', 'hatchet', 'pry_bar', 'saw', 'hammer', 'fishing_rod', 'wrench'] as const) give(state, toolId);
  state.canoe.hullTier = 3;
  build(state, 'outrigger_port', 'outrigger_starboard', 'winch');
  return state;
}

describe('refills every ten minutes, except the nevers', () => {
  it('is one number in the tuning: ten minutes', () => {
    expect(TUNING.nodes.refillSeconds).toBe(600);
  });

  it('marks only bottles, caches, sunken lockers and the Beacon lamp as never', () => {
    const nevers = new Set<string>();
    for (const node of NODES) {
      for (const action of node.actions) {
        if (action.respawnDays === null) nevers.add(node.typeId);
        else expect(action.respawnDays * TUNING.time.daySeconds, `${node.id} ${action.verb}`).toBeCloseTo(TUNING.nodes.refillSeconds, 9);
      }
    }
    expect([...nevers].sort()).toEqual(NEVERS);
  });

  it.each(oneOfEachType().flatMap((node) => node.actions.map((action, index) => [`${node.typeId}: ${action.verb}`, node, index] as const)))(
    '%s', (_name, node, actionIndex) => {
      const state = anythingGoes();
      const used = state.time;
      completeHarvest(state, state.players[0], node, actionIndex);
      const readyAt = state.nodes[node.id].readyAt[actionIndex];
      if (NEVERS.includes(node.typeId)) {
        expect(readyAt, 'never').toBeNull();
        return;
      }
      expect(readyAt, 'ten minutes on').toBe(used + 600);
    },
  );

  it('offers a spot again on the minute: a driftwood pile, and a fishing spot from the canoe', () => {
    const state = anythingGoes();
    teleportToNode(state, 'home_knoll.driftwood_pile.1');
    expect(dispatch(state, { type: 'scavenge' }).ok).toBe(true);
    const used = state.time;
    state.time = used + 599;
    expect(selectInteractable(state)).toBeNull();
    state.time = used + 600;
    expect(selectInteractable(state)).toMatchObject({ nodeId: 'home_knoll.driftwood_pile.1', available: true });

    const fishing = NODES.find((node) => node.typeId === 'fishing_spot')!;
    if (fishing.reach === 'canoe') floatCanoeAt(state, fishing.position.x + 2, fishing.position.z);
    else teleportToNode(state, fishing.id);
    state.players[0].selectedTool = 'fishing_rod';
    expect(selectInteractable(state)).toMatchObject({ nodeId: fishing.id, available: true });
    expect(dispatch(state, { type: 'scavenge' }).ok).toBe(true);
    const fished = state.time;
    state.time = fished + 599;
    const waiting = selectInteractable(state);
    expect(waiting?.kind === 'node' && waiting.nodeId === fishing.id && waiting.available).toBe(false);
    state.time = fished + 600;
    expect(selectInteractable(state)).toMatchObject({ nodeId: fishing.id, available: true });
  });
});

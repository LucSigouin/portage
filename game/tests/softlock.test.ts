import { describe, expect, it } from 'vitest';
import { MAIN_QUESTS, NODE_IDS } from '../src/data/index.ts';
import { dispatch, selectQuestLog } from '../src/sim/index.ts';
import type { GameEvent, GameState } from '../src/sim/index.ts';
import { give, newGame, run, scavenge, teleportToNode } from './support.ts';

/**
 * Luc's soft lock: he made the hatchet before "A proper edge" was given. The
 * hatchet uses up the hatchet head, the chest it came from is empty for good,
 * and the quest asked him to hold the head.
 */
export function stageLucsOrder(): GameState {
  const state = newGame(7);
  // The head, out of the attic chest at Cabin Roofs, while the main line is still on "Bail out".
  teleportToNode(state, NODE_IDS.atticChest);
  scavenge(state);
  expect(state.keyItems.hatchet_head).toBe(1);
  // Then the hatchet: head, handle and lashing; the knife is the tool.
  give(state, 'stone_knife');
  give(state, 'driftwood', 2);
  give(state, 'rope', 1);
  expect(dispatch(state, { type: 'craft', recipeId: 'hatchet' }).ok).toBe(true);
  expect(state.tools).toContain('hatchet');
  expect(state.keyItems.hatchet_head ?? 0).toBe(0);
  return state;
}

/** Walk the main line up to the quest before `questId`, with its steps all done, so the next tick hands the quest over. */
export function handOverMainQuest(state: GameState, questId: string): void {
  const target = MAIN_QUESTS.find((quest) => quest.id === questId)!;
  for (const quest of MAIN_QUESTS) {
    if (quest.order < target.order - 1) state.quests[quest.id].status = 'completed';
  }
  const previous = MAIN_QUESTS.find((quest) => quest.order === target.order - 1);
  if (previous) {
    state.quests[previous.id].status = 'active';
    state.quests[previous.id].progress = previous.objectives.map(() => 99);
  }
}

describe("Luc's case: the hatchet built before the quest", () => {
  it('lets "A proper edge" finish when it is given', () => {
    const state = stageLucsOrder();
    handOverMainQuest(state, 'a_proper_edge');
    const events: GameEvent[] = run(state, {}, 2);
    expect(state.quests.something_to_eat.status).toBe('completed');
    expect(state.quests.a_proper_edge.status).toBe('completed');
    expect(state.quests.ribs_and_rails.status).toBe('active');
    expect(events.filter((event) => event.type === 'quest_completed' && event.questId === 'a_proper_edge')).toHaveLength(1);
    const entry = selectQuestLog(state).find((quest) => quest.questId === 'a_proper_edge')!;
    expect(entry.objectives.map((objective) => objective.done)).toEqual([true, true]);
  });
});

/**
 * The red ! (Luc's bugfix list, line 19): before a recipe or a part an open quest still asks for, in the crafting
 * panel and the canoe builder. Not for a quest not yet given or done, nor for a step already done. In a crew the
 * quests are the crew's, so every crewmate sees the same marks.
 */
import { describe, expect, it } from 'vitest';
import { buildCanoeBuilderPanel, buildCraftingPanel, questWants } from '../../src/client/viewmodels/index.ts';
import { panelView } from '../../src/interface/views.ts';
import { collectText } from '../../src/interface/dom.ts';
import type { ViewNode } from '../../src/interface/dom.ts';
import type { GameState } from '../../src/sim/index.ts';
import { QUEST_LIST } from '../../src/data/index.ts';
import type { QuestId } from '../../src/data/index.ts';
import { give, newGame, standOn } from '../support.ts';

/** A game where every quest before `questId` is done and `questId` has been given. */
function atQuest(questId: QuestId, crew = 1): GameState {
  const state = newGame(7, { crew });
  for (const quest of QUEST_LIST) {
    if (quest.kind !== 'main') continue;
    if (quest.id === questId) {
      state.quests[quest.id].status = 'active';
      break;
    }
    state.quests[quest.id].status = 'completed';
  }
  state.trackedQuestId = questId;
  // "Stop the leak" patched the hull: by "Ribs and rails" it is the patched canoe.
  if (state.quests.stop_the_leak.status === 'completed') state.canoe.hullTier = 1;
  standOn(state, 'home_knoll');
  return state;
}

const marked = (state: GameState, playerId = 0): string[] => buildCraftingPanel(state, playerId).stations
  .flatMap((station) => station.recipes).filter((recipe) => recipe.questText !== '').map((recipe) => recipe.recipeId).sort();

const markedParts = (state: GameState, playerId = 0): string[] => {
  const panel = buildCanoeBuilderPanel(state, playerId);
  return [panel.hull, ...panel.attachments].filter((row) => row !== null && row.questText !== '').map((row) => String(row!.id)).sort();
};

const CLOSE = { label: 'Close', intent: { type: 'close_panel' as const }, enabled: true, note: null };

const marks = (nodes: ViewNode[]): ViewNode[] =>
  nodes.flatMap((node) => [...(node.classes.split(' ').includes('iw-quest-mark') ? [node] : []), ...marks(node.children)]);

describe('the red ! on what an open quest asks for', () => {
  it('marks the tools and the hull "Ribs and rails" asks for, and nothing a later quest wants', () => {
    const state = atQuest('ribs_and_rails');
    // Saw and hammer are made at the bench. The pry bar is found, not made: there is no recipe to mark.
    expect(marked(state)).toEqual(['hammer', 'saw']);
    expect(buildCraftingPanel(state).stations.flatMap((station) => station.recipes).find((recipe) => recipe.recipeId === 'saw')!.questText)
      .toBe('For Ribs and rails');
    // The ribbed hull is the next hull: marked. The port outrigger is the next quest's: not yet.
    expect(markedParts(state)).toEqual(['hull']);
  });

  it('drops the ! once the step is done, and once the quest is handed in', () => {
    const state = atQuest('ribs_and_rails');
    give(state, 'hammer');
    // The rules tick a step when a command changes what it counts (crafting the hammer would): tick it here.
    const hammerStep = QUEST_LIST.find((quest) => quest.id === 'ribs_and_rails')!.objectives
      .findIndex((objective) => objective.type === 'have_tool' && objective.toolId === 'hammer');
    state.quests.ribs_and_rails.progress[hammerStep] = 1;
    expect(marked(state)).toEqual(['saw']);
    state.quests.ribs_and_rails.status = 'completed';
    state.quests.steady_now.status = 'active';
    expect(marked(state)).toEqual([]);
    expect(markedParts(state)).toEqual(['outrigger_port']);
  });

  it('marks nothing for a quest not yet given, or ready to hand in', () => {
    const state = atQuest('ribs_and_rails');
    state.quests.ribs_and_rails.status = 'available';
    expect(marked(state)).toEqual([]);
    expect(markedParts(state)).toEqual([]);
    state.quests.ribs_and_rails.status = 'ready';
    expect(marked(state)).toEqual([]);
  });

  it('marks cooking and stock for the quests that ask for them', () => {
    const eat = atQuest('something_to_eat');
    expect(marked(eat)).toEqual(expect.arrayContaining(['clean_water', 'roast_roots']));
    const wants = questWants(atQuest('the_beacon'));
    expect([...wants.items.keys()]).toEqual(expect.arrayContaining(['smoked_fish', 'jam', 'dried_apple', 'clean_water']));
  });

  it('is the crew\'s: a guest sees the same marks as the host', () => {
    const state = atQuest('ribs_and_rails', 3);
    expect(marked(state, 1)).toEqual(marked(state, 0));
    expect(marked(state, 2)).toEqual(['hammer', 'saw']);
    expect(markedParts(state, 1)).toEqual(markedParts(state, 0));
  });

  it('is drawn as a red ! before the name, naming the quest, in both menus', () => {
    const state = atQuest('ribs_and_rails');
    const crafting = panelView({ ...buildCraftingPanel(state), title: 'Crafting', close: CLOSE });
    const drawn = marks(crafting);
    expect(drawn.length).toBe(2);
    for (const mark of drawn) {
      expect(collectText([mark])).toBe('!');
      expect(mark.attributes.title).toBe('For Ribs and rails');
    }
    const builder = panelView({ ...buildCanoeBuilderPanel(state), title: 'Canoe builder', close: CLOSE });
    expect(marks(builder).length).toBe(1);
  });
});

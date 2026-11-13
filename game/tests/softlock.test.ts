import { describe, expect, it } from 'vitest';
import {
  ATTACHMENTS, BOTTLE_IDS, HULL_TIERS, ISLANDS, ISLANDS_BY_ID, ITEMS, LOOT_TABLES, MAIN_QUESTS, NODES, NODES_BY_ID,
  NODE_IDS, NPCS, QUESTS, QUEST_LIST, RECIPES, STOCK_FOOD_IDS, spotPosition,
} from '../src/data/index.ts';
import type { ItemId, ObjectiveDefinition, QuestDefinition, QuestId } from '../src/data/index.ts';
import { deserialize } from '../src/save/index.ts';
import { dispatch, drainEvents, selectQuestLog, step, NEUTRAL_INPUT, FIXED_STEP } from '../src/sim/index.ts';
import type { GameEvent, GameState } from '../src/sim/index.ts';
import { objectiveRequired } from '../src/sim/quests.ts';
import {
  build, countIn, give, newGame, run, scavenge, standOn, teleport, teleportToBed, teleportToNode,
} from './support.ts';

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

// --- The tables: which steps can be used up for good, and what remakes them ----

/** Items the player can get again and again: a node that grows back, the lake, or a recipe made only of those. */
function renewableItems(): Set<ItemId> {
  const renewable = new Set<ItemId>(['dirty_water']); // scooped from the lake with the bailing can
  for (const node of NODES) {
    for (const action of node.actions) {
      if (action.respawnDays === null) continue;
      const table = LOOT_TABLES[action.lootTableId];
      for (const entry of [...table.guaranteed, ...table.pool]) renewable.add(entry.itemId);
    }
  }
  for (let grew = true; grew;) {
    grew = false;
    for (const recipe of Object.values(RECIPES)) {
      if (renewable.has(recipe.output.itemId) || !recipe.inputs.every((input) => renewable.has(input.itemId))) continue;
      renewable.add(recipe.output.itemId);
      grew = true;
    }
  }
  return renewable;
}

/** True when something in the game uses the item up: a recipe, a hull tier, an attachment, or a meal. */
function canBeUsedUp(itemId: ItemId): boolean {
  return Object.values(RECIPES).some((recipe) => recipe.inputs.some((input) => input.itemId === itemId))
    || HULL_TIERS.some((tier) => tier.cost.some((cost) => cost.itemId === itemId))
    || Object.values(ATTACHMENTS).some((attachment) => attachment.cost.some((cost) => cost.itemId === itemId))
    || ITEMS[itemId].edible !== null;
}

/** What making this tool or attachment uses up. */
function madeFrom(madeInto: NonNullable<Extract<ObjectiveDefinition, { type: 'have_item' }>['madeInto']>): ItemId[] {
  if ('attachmentId' in madeInto) return ATTACHMENTS[madeInto.attachmentId].cost.map((cost) => cost.itemId);
  return RECIPES[madeInto.toolId as keyof typeof RECIPES]?.inputs.map((input) => input.itemId) ?? [];
}

/**
 * Steps that could be stranded, read from the tables. A step that asks the
 * player to hold something that is found once and then used up must say what
 * it is made into; a step that names a product must name one that really uses
 * the item; a craft step must be one the player can repeat.
 */
export function findStrandableSteps(quests: readonly QuestDefinition[]): string[] {
  const renewable = renewableItems();
  const problems: string[] = [];
  for (const quest of quests) {
    quest.objectives.forEach((objective, index) => {
      const where = `${quest.id} step ${index + 1} (${objective.text})`;
      if (objective.type === 'have_item' || objective.type === 'deliver') {
        const { itemId } = objective;
        if (objective.type === 'have_item' && objective.madeInto && !madeFrom(objective.madeInto).includes(itemId)) {
          problems.push(`${where}: ${JSON.stringify(objective.madeInto)} does not use up ${itemId}`);
        }
        if (renewable.has(itemId) || !canBeUsedUp(itemId)) return;
        if (objective.type === 'deliver') problems.push(`${where}: ${itemId} is handed over, used up and cannot be found again`);
        else if (!objective.madeInto) problems.push(`${where}: ${itemId} is found once and used up, so the step must say what it is made into`);
      }
      if (objective.type === 'craft') {
        const repeatable = Object.values(RECIPES).some((recipe) =>
          objective.itemIds.includes(recipe.output.itemId) && recipe.inputs.every((input) => renewable.has(input.itemId)));
        if (!repeatable) problems.push(`${where}: nothing it asks for can be crafted again`);
      }
    });
  }
  return problems;
}

describe('the tables', () => {
  it('leave no step that can be used up for good without saying what remakes it', () => {
    expect(findStrandableSteps(QUEST_LIST)).toEqual([]);
  });

  it('name the right thing for the hatchet head and the radio parts', () => {
    const madeInto = (questId: QuestId, itemId: ItemId) =>
      QUESTS[questId].objectives.find((objective) => objective.type === 'have_item' && objective.itemId === itemId);
    expect(madeInto('a_proper_edge', 'hatchet_head')).toMatchObject({ madeInto: { toolId: 'hatchet' } });
    expect(madeInto('voices', 'radio_crystal')).toMatchObject({ madeInto: { attachmentId: 'radio' } });
  });

  it('are checked with teeth: take the hatchet head step back to the old wording and it is caught', () => {
    const broken = structuredClone(QUEST_LIST);
    const step = broken.find((quest) => quest.id === 'a_proper_edge')!.objectives[0];
    if (step.type === 'have_item') delete step.madeInto;
    expect(findStrandableSteps(broken)).toEqual([
      'a_proper_edge step 1 (Find the hatchet head at Cabin Roofs): hatchet_head is found once and used up, so the step must say what it is made into',
    ]);
    const wrong = structuredClone(QUEST_LIST);
    const wrongStep = wrong.find((quest) => quest.id === 'a_proper_edge')!.objectives[0];
    if (wrongStep.type === 'have_item') wrongStep.madeInto = { toolId: 'saw' };
    expect(findStrandableSteps(wrong)).toEqual(['a_proper_edge step 1 (Find the hatchet head at Cabin Roofs): {"toolId":"saw"} does not use up hatchet_head']);
  });
});

// --- Every step of every quest, done early -------------------------------------

type Step = QuestDefinition['objectives'][number];

function settle(state: GameState, events: GameEvent[], seconds = 0.4): void {
  events.push(...run(state, {}, seconds), ...drainEvents(state));
}

function standBeside(state: GameState, npcId: keyof typeof NPCS): void {
  const npc = NPCS[npcId];
  const spot = spotPosition(ISLANDS_BY_ID[npc.islandId], npc.spot);
  teleport(state, npc.islandId, spot.x + 0.4, spot.z);
}

/** A step whose node only answers once its own quest is open and the rest is done: it cannot be done early. */
function cannotBeDoneEarly(quest: QuestDefinition, objective: Step): boolean {
  return objective.type === 'node' && NODES_BY_ID[objective.nodeId].actions[0].questGate === quest.id;
}

/** Whether a step the player has already done and used up can be done again. Read from the tables. */
function canBeDoneAgain(objective: Step): boolean {
  const renewable = renewableItems();
  switch (objective.type) {
    case 'have_item':
    case 'deliver':
      return renewable.has(objective.itemId);
    case 'stock':
      return [...STOCK_FOOD_IDS, 'clean_water' as ItemId].every((itemId) => renewable.has(itemId));
    case 'craft':
      return Object.values(RECIPES).some((recipe) =>
        objective.itemIds.includes(recipe.output.itemId) && recipe.inputs.every((input) => renewable.has(input.itemId)));
    default:
      return true; // go back, talk again, sleep again; tools, hulls, attachments and counts are never taken away
  }
}

/** Do the step the way a player would, as far as the sim lets a test stage it. */
function doStep(state: GameState, objective: Step, events: GameEvent[]): void {
  switch (objective.type) {
    case 'bail':
      state.canoe.waterLevel = Math.max(0, objective.waterAtMost - 5);
      break;
    case 'land':
      standOn(state, objective.islandId);
      break;
    case 'have_item':
    case 'deliver':
      give(state, objective.itemId, objective.count);
      break;
    case 'have_tool':
      give(state, objective.toolId);
      break;
    case 'hull':
      state.canoe.hullTier = Math.max(state.canoe.hullTier, objective.tier);
      break;
    case 'attachment':
      build(state, objective.attachmentId);
      break;
    case 'enter_region':
      standOn(state, ISLANDS.find((island) => island.regionId === objective.regionId)!.id);
      break;
    case 'node': {
      state.nodes[objective.nodeId] = { readyAt: [null], leftover: [] };
      break;
    }
    case 'stock':
      give(state, STOCK_FOOD_IDS[0], objective.stockFood, 'cargo');
      give(state, 'clean_water', objective.cleanWater, 'cargo');
      break;
    case 'bottles':
      state.bottlesFound = BOTTLE_IDS.slice(0, objective.count);
      break;
    case 'smoke':
      state.statistics.smokedCount += objective.count;
      break;
    case 'caches':
      state.statistics.cachesHauled += objective.count;
      break;
    case 'craft': {
      const recipe = Object.values(RECIPES).find((candidate) => objective.itemIds.includes(candidate.output.itemId))!;
      const times = Math.ceil(objective.count / recipe.output.count);
      build(state, 'firebox', 'workbench', 'smoker', 'forge');
      standOn(state, 'home_knoll');
      for (const toolId of recipe.tools) give(state, toolId);
      for (const input of recipe.inputs) give(state, input.itemId, input.count * times);
      if (recipe.requiresFlag) state.flags[recipe.requiresFlag] = true;
      const result = dispatch(state, { type: 'craft', recipeId: recipe.id, count: times });
      expect(result.ok, `crafting ${recipe.id}`).toBe(true);
      break;
    }
    case 'sleep':
      teleportToBed(state, 'home_knoll');
      state.players[0].energy = 10;
      expect(dispatch(state, { type: 'sleep' }).ok, 'sleeping').toBe(true);
      break;
    case 'talk':
      standBeside(state, objective.npcId);
      expect(dispatch(state, { type: 'talk', npcId: objective.npcId }).ok, `talking to ${objective.npcId}`).toBe(true);
      dispatch(state, { type: 'end_dialogue' });
      break;
  }
  settle(state, events);
}

/** Use up or leave behind whatever the step was made of. Only what a player could really lose. */
function useUp(state: GameState, objective: Step, events: GameEvent[]): void {
  const removeFromStacks = (itemId: ItemId) => {
    for (const stacks of [state.canoe.cargo, ...state.players.map((player) => player.backpack)]) {
      for (let index = stacks.length - 1; index >= 0; index -= 1) if (stacks[index].itemId === itemId) stacks.splice(index, 1);
    }
    delete state.keyItems[itemId];
  };
  switch (objective.type) {
    case 'have_item':
      // Only what the game can really take away: a bearing from the lookout is never used for anything.
      if (canBeUsedUp(objective.itemId)) removeFromStacks(objective.itemId);
      // The step's own product is what used it up: the hatchet, the radio, the sail.
      if (objective.madeInto) {
        if ('toolId' in objective.madeInto) give(state, objective.madeInto.toolId);
        else build(state, objective.madeInto.attachmentId);
      }
      break;
    case 'deliver':
      removeFromStacks(objective.itemId);
      break;
    case 'stock':
      state.canoe.cargo = [];
      break;
    case 'land':
      standOn(state, objective.islandId === 'cabin_roofs' ? 'home_knoll' : 'cabin_roofs');
      break;
    case 'enter_region':
      standOn(state, 'home_knoll');
      break;
    default:
      break;
  }
  settle(state, events);
}

/** Give the quest: hand over a main quest, or accept a side quest from its survivor. */
function giveQuest(state: GameState, quest: QuestDefinition, events: GameEvent[]): void {
  if (quest.kind === 'main') {
    handOverMainQuest(state, quest.id);
    settle(state, events);
    return;
  }
  const unlock = (questId: QuestId): void => {
    for (const required of QUESTS[questId].requiresQuests) {
      unlock(required);
      state.quests[required].status = 'completed';
    }
  };
  unlock(quest.id);
  settle(state, events);
  if (quest.giver === null) return;
  expect(state.quests[quest.id].status).toBe('available');
  standBeside(state, quest.giver);
  expect(dispatch(state, { type: 'accept_quest', questId: quest.id }).ok, 'accepting').toBe(true);
  settle(state, events);
}

describe('every step of every quest, done before the quest is given', () => {
  const rows = QUEST_LIST.flatMap((quest) => quest.objectives.map((objective, index) => ({ quest, objective, index })));
  it('walks all the steps of all the quests in the tables', () => {
    expect(rows.length).toBe(QUEST_LIST.reduce((total, quest) => total + quest.objectives.length, 0));
    expect(QUEST_LIST.length).toBeGreaterThanOrEqual(21);
  });

  it.each(rows.map((row) => [`${row.quest.id} step ${row.index + 1}: ${row.objective.type} (${row.objective.text})`, row] as const))(
    '%s', (_name, { quest, objective, index }) => {
      const state = newGame(7);
      const events: GameEvent[] = [];
      if (cannotBeDoneEarly(quest, objective)) {
        // The Beacon lamp only answers once its quest is open and the rest is done: nothing to strand.
        return;
      }

      doStep(state, objective, events);
      useUp(state, objective, events);
      giveQuest(state, quest, events);

      // 1. The quest remembers the step. Only a hand-over and sleeping wait for the quest to be open.
      const required = objectiveRequired(objective);
      if (!['deliver', 'sleep'].includes(objective.type)) {
        expect(state.quests[quest.id].progress[index], 'the quest remembers the step').toBeGreaterThanOrEqual(required);
        const entry = selectQuestLog(state).find((view) => view.questId === quest.id)!;
        expect(entry.objectives[index].done, 'the quest log shows it done').toBe(true);
      }

      // 2. And the quest can still be finished: do whatever is left, the way a player would.
      for (const [otherIndex, other] of quest.objectives.entries()) {
        const credited = !['deliver', 'sleep'].includes(other.type) && state.quests[quest.id].progress[otherIndex] >= objectiveRequired(other);
        if (credited) continue;
        // A step the quest did not remember has to be done again, so it must be something that can be done again.
        if (otherIndex === index) expect(canBeDoneAgain(other), `"${other.text}" cannot be done again`).toBe(true);
        doStep(state, other, events);
      }
      settle(state, events);
      if (quest.giver !== null && state.quests[quest.id].status === 'ready') {
        standBeside(state, quest.giver);
        expect(dispatch(state, { type: 'turn_in_quest', questId: quest.id }).ok, 'turning in').toBe(true);
        settle(state, events);
      }
      expect(state.quests[quest.id].status, 'the quest finishes').toBe('completed');

      // 3. It paid once, and told the player.
      expect(events.filter((event) => event.type === 'quest_completed' && event.questId === quest.id)).toHaveLength(1);
    },
  );
});

// --- Telling the player ----------------------------------------------------------

describe('a quest that arrives already finished', () => {
  it('shows its steps done, pays its reward once, and announces itself through the events the game already has', () => {
    const state = newGame(7);
    // All of "First haul" done while the main line is still on "Bail out".
    give(state, 'driftwood', 3);
    give(state, 'fiber', 4);
    give(state, 'stone_knife');
    const early = run(state, {}, 0.4);
    expect(early.filter((event) => event.type === 'quest_advanced' && event.questId === 'first_haul')).toEqual([]);
    expect(state.quests.first_haul.status).toBe('locked');
    expect(state.quests.first_haul.progress).toEqual([3, 4, 1]);

    handOverMainQuest(state, 'first_haul');
    const events = run(state, {}, 0.4);
    const story = events
      .filter((event) => 'questId' in event && event.questId === 'first_haul')
      .map((event) => event.type === 'quest_advanced' ? `advanced ${event.objectiveIndex}` : event.type);
    expect(story).toEqual(['quest_started', 'advanced 0', 'advanced 1', 'advanced 2', 'quest_completed']);
    expect(events.filter((event) => event.type === 'quest_started' && event.questId === 'stop_the_leak')).toHaveLength(1);
    expect(state.quests.first_haul.status).toBe('completed');
    expect(state.quests.stop_the_leak.status).toBe('active');
    // "First haul" pays one rope, once (to the cargo: the player is still aboard).
    const ropes = () => countIn(state.players[0].backpack, 'rope') + countIn(state.canoe.cargo, 'rope');
    expect(ropes()).toBe(1);
    run(state, {}, 2);
    expect(ropes()).toBe(1);
    const entry = selectQuestLog(state).find((quest) => quest.questId === 'first_haul')!;
    expect(entry).toMatchObject({ status: 'completed' });
    expect(entry.objectives.every((objective) => objective.done)).toBe(true);
  });

  it('shows a step ticked on arrival: the planter built before Odile asks for it', () => {
    const state = newGame(7);
    build(state, 'outrigger_starboard', 'planter');
    state.quests.odile_windfall.status = 'completed';
    standOn(state, 'orchard_hill');
    run(state, {}, 0.4);
    expect(state.quests.odile_garden_afloat.status).toBe('available');
    expect(state.quests.odile_garden_afloat.progress).toEqual([1]);
    standBeside(state, 'odile');
    expect(dispatch(state, { type: 'accept_quest', questId: 'odile_garden_afloat' }).ok).toBe(true);
    const events = drainEvents(state);
    expect(events.map((event) => event.type)).toEqual(['quest_started', 'quest_advanced', 'quest_ready']);
    expect(selectQuestLog(state).find((quest) => quest.questId === 'odile_garden_afloat')!.objectives[0].done).toBe(true);
  });
});

describe('a hand-over', () => {
  it('is the one step that is checked live: apples in the bag count only once Odile has asked, and only while they are there', () => {
    const state = newGame(7);
    give(state, 'apple', 6);
    run(state, {}, 0.4);
    expect(state.quests.odile_windfall).toEqual({ status: 'available', progress: [0] });
    standBeside(state, 'odile');
    expect(dispatch(state, { type: 'accept_quest', questId: 'odile_windfall' }).ok).toBe(true);
    expect(state.quests.odile_windfall).toEqual({ status: 'ready', progress: [6] });
    expect(dispatch(state, { type: 'eat', itemId: 'apple' }).ok).toBe(true);
    run(state, {}, 0.4);
    expect(state.quests.odile_windfall).toEqual({ status: 'active', progress: [5] });
  });
});

// --- Saves that are already stuck -------------------------------------------------

describe('a save that is already stuck', () => {
  const fixtures = import.meta.glob<string>('./fixtures/stuck-v3-*.json', { eager: true, query: '?raw', import: 'default' });
  const stuckSave = fixtures['./fixtures/stuck-v3-hatchet-head.json'];

  it("is Luc's exact state: the hatchet made, the head gone for good, A proper edge open and one step short", () => {
    const saved = JSON.parse(stuckSave).state as GameState;
    expect(saved.quests.a_proper_edge).toEqual({ status: 'active', progress: [0, 1] });
    expect(saved.tools).toContain('hatchet');
    expect(saved.keyItems.hatchet_head ?? 0).toBe(0);
    expect(saved.nodes[NODE_IDS.atticChest].readyAt).toEqual([null]); // the chest is empty for good
  });

  it('loads and moves on by itself, with no action from the player', () => {
    const loaded = deserialize(stuckSave);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.migratedFrom).toBe(3); // the chart and the quest card of version 4, nothing else
    const state = loaded.state;
    const events: GameEvent[] = [];
    for (let tick = 0; tick < 12; tick += 1) {
      step(state, { ...NEUTRAL_INPUT }, FIXED_STEP);
      events.push(...drainEvents(state)); // not one command was sent
    }
    expect(state.quests.a_proper_edge.status).toBe('completed');
    expect(state.quests.ribs_and_rails.status).toBe('active');
    expect(state.players[0].trackedQuestIds).toEqual(['ribs_and_rails']);
    expect(events.filter((event) => event.type === 'quest_completed' && event.questId === 'a_proper_edge')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'quest_started' && event.questId === 'ribs_and_rails')).toHaveLength(1);
  });

  it('also frees a crew stuck on the radio crystal, and plays on from there', () => {
    const state = newGame(7);
    for (const quest of MAIN_QUESTS) if (quest.order < 10) state.quests[quest.id].status = 'completed';
    state.quests.voices.status = 'active';
    // As the old rules left it: the Tink talk, the hull and the radio all done, the three parts used up.
    state.quests.voices.progress = [1, 0, 0, 0, 1, 1];
    state.canoe.hullTier = 3;
    build(state, 'radio');
    run(state, {}, 0.4);
    expect(state.quests.voices.status).toBe('completed');
    expect(state.quests.through_the_narrows.status).toBe('active');
  });

  it('does not touch a quest whose ingredient is still in hand and not yet made into anything', () => {
    const state = newGame(7);
    for (const quest of MAIN_QUESTS) if (quest.order < 5) state.quests[quest.id].status = 'completed';
    state.quests.a_proper_edge.status = 'active';
    give(state, 'hatchet_head');
    run(state, {}, 0.4);
    expect(state.quests.a_proper_edge.progress).toEqual([1, 0]);
    expect(state.quests.a_proper_edge.status).toBe('active');
  });
});

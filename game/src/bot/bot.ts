/**
 * Headless bot. Plays the main line from New Game to lighting the Beacon
 * using only what a player has: `step` inputs and `dispatch` commands. It
 * reads the state and the data tables (as a player reads the screen and a
 * guide) and never writes to the state itself.
 *
 * It is driven by the quest objectives, not a script: for each objective it
 * works out what is missing, finds a recipe or a scavenge node for it, goes
 * there, and builds. Retuning costs or moving nodes does not need a new bot.
 */
import type {
  AttachmentId, Difficulty, IslandId, ItemAmount, ItemId, NodeDefinition, NpcId, ObjectiveDefinition,
  QuestDefinition, QuestId, RecipeDefinition, StationId, ToolId,
} from '../data/types.ts';
import {
  ATTACHMENTS, ATTACHMENT_IDS, CAMP_LAYOUTS, HULL_TIERS, ISLANDS, ISLANDS_BY_ID, ITEMS, LOOT_TABLES, MAIN_QUESTS, NODES,
  NODES_BY_ID, NODES_BY_ISLAND, NPCS, NPC_IDS, RECIPES, RECIPE_IDS, STOCK_FOOD_IDS, TUNING, isStackable,
  spotPosition,
} from '../data/index.ts';
import {
  FIXED_STEP, NEUTRAL_INPUT, bearingBetween, bearingDifference, createGame, dispatch, drainEvents, freeSpotNear,
  islandLanding, regionAt, selectActiveQuests, selectCanoeStats, selectDialogue, selectInteractable,
  selectInventory, selectTimeOfDay, step, terrainHeight,
} from '../sim/index.ts';
import type { Command, CommandResult, GameState, StepInput } from '../sim/index.ts';
import { isWildNodeId, wildIndex, wildNodesOn } from '../sim/gathering.ts';
import { SOLID_CLEARANCE, canReachIsland, clearGround, findFootPath, findWaterPath, footReachable, routeLength, walkGoal } from './navigation.ts';
import type { Point, Seaworthiness } from './navigation.ts';

/** Bot extras on top of the quest objectives: attachments a sensible player builds early. */
const STRATEGY: { questId: QuestId; beforeObjective: number; attachments: AttachmentId[] }[] = [
  // A bench aboard, so sewing and sawing in the Reach does not mean paddling home.
  { questId: 'steady_now', beforeObjective: 1, attachments: ['workbench'] },
  // Room for the radio parts and the long hull's timber.
  { questId: 'voices', beforeObjective: 0, attachments: ['cargo_rack'] },
  // Fire aboard: boil water and cook wherever the canoe is.
  { questId: 'voices', beforeObjective: 1, attachments: ['firebox'] },
];

export interface QuestReport {
  questId: QuestId;
  name: string;
  /** Played seconds when the quest completed. */
  completedAtSeconds: number;
  /** World clock when it completed, for example "day 2 14:05". */
  completedAtClock: string;
  lowestHunger: number;
  lowestThirst: number;
  lowestEnergy: number;
  highestWaterLevel: number;
  fails: number;
}

export interface BotReport {
  seed: number;
  difficulty: Difficulty;
  /** True when the Beacon was lit. */
  completed: boolean;
  quests: QuestReport[];
  /** Played seconds for the whole main line. */
  totalSeconds: number;
  worldDays: number;
  fails: number;
  /** Why the bot stopped early, or null. */
  stoppedBecause: string | null;
  distancePaddled: number;
  distanceWalked: number;
  state: GameState;
}

/**
 * How well the bot looks after itself. `CAREFUL` is the bot as it always was: a player who knows
 * the game. `CARELESS` is nearer a first-time player: it eats and drinks only once the warning is
 * on screen, bails late and not for long, spends its energy as fast as it comes, dithers, wanders,
 * sets off for the wrong island, drops things, and takes no notice of a storm until it breaks.
 */
export interface BotHabits {
  /** Eats once hunger is below `eatBelow`, and keeps eating up to `eatUntil`. */
  eatBelow: number;
  eatUntil: number;
  /** Drinks once thirst is below `drinkBelow`, up to `drinkUntil`. */
  drinkBelow: number;
  drinkUntil: number;
  /** Hunger points of food it likes to have along before it stops picking any up. */
  larder: number;
  /** Drinks (clean or to boil) it scoops up to at the canoe. */
  waterCarried: number;
  /** Bails once the water in the hull reaches `bailAt`, down to `bailUntil`. */
  bailAt: number;
  bailUntil: number;
  /** Power strokes until energy falls to `powerUntil`, runs until `runUntil`; each starts again 20 above. */
  powerUntil: number;
  runUntil: number;
  /** Seconds lost before each scavenge and each craft: finding the spot, reading the panel. */
  hesitation: number;
  /** One trip in this many goes to the wrong island first. 0: never. */
  detourEvery: number;
  /** One scavenge in this many is followed by a wander across the island. 0: never. */
  wanderEvery: number;
  /** One scavenge in this many, a stack from the backpack is dropped for good. 0: never. */
  wasteEvery: number;
  /** Takes no notice of a storm in the forecast: shelters only once it has broken. */
  ignoresForecast: boolean;
  /**
   * Keeps its hands off what it gathered for stock food. The careful bot never needed to and is
   * left as it was, so its runs stay comparable. The careless one eats late and a lot at once:
   * without this it eats its own apples and then waits three days for the trees.
   */
  guardsIngredients: boolean;
}

export const CAREFUL: BotHabits = {
  eatBelow: 55, eatUntil: 55, drinkBelow: 50, drinkUntil: 50, larder: 80, waterCarried: 6,
  bailAt: 50, bailUntil: 6, powerUntil: 55, runUntil: 50,
  hesitation: 0, detourEvery: 0, wanderEvery: 0, wasteEvery: 0, ignoresForecast: false, guardsIngredients: false,
};

export const CARELESS: BotHabits = {
  eatBelow: 25, eatUntil: 60, drinkBelow: 25, drinkUntil: 60, larder: 30, waterCarried: 2,
  bailAt: 75, bailUntil: 40, powerUntil: 20, runUntil: 20,
  hesitation: 4, detourEvery: 4, wanderEvery: 5, wasteEvery: 8, ignoresForecast: true, guardsIngredients: true,
};

export interface BotDriverOptions {
  /** Stop after this quest completes. */
  untilQuest?: QuestId;
  /** How carefully it plays. Default `CAREFUL`. */
  habits?: BotHabits;
  /** Receives a line per high-level action. */
  log?: (line: string) => void;
  /**
   * Where the bot sends its commands. Defaults to the rules engine's
   * `dispatch` on the state. A live client passes its own command path here,
   * so the bot plays through the same door as a person.
   */
  dispatch?: (command: Command) => CommandResult;
}

export interface BotOptions extends Omit<BotDriverOptions, 'dispatch'> {
  seed: number;
  difficulty?: Difficulty;
  /** Give up after this much played time, seconds. */
  maximumSeconds?: number;
}

/**
 * The bot as a step-by-step driver: ask it for the input of the next fixed
 * step, step the simulation yourself, ask again. It reads the state it was
 * given and sends commands through `dispatch`; it never steps or drains
 * events, so a live client can own the loop.
 */
export interface BotDriver {
  /** Input for the next 1/60 s step, or null once the bot has finished or is stuck. */
  next(): StepInput | null;
  /** True once `next` has returned null. */
  readonly finished: boolean;
  /** Why the bot stopped early, or null. */
  readonly stoppedBecause: string | null;
}

class BotStuck extends Error {}
/** Thrown into the bot's script when the rules wash it ashore, so it drops what it was doing and plans afresh. */
class WashedAshore extends Error {}

const clamp = (value: number, minimum: number, maximum: number): number => Math.max(minimum, Math.min(maximum, value));
const distance = (first: Point, second: Point): number => Math.hypot(first.x - second.x, first.z - second.z);

/** Where every item comes from: nodes, survivors' gifts. Built once from the tables. */
interface NodeSource {
  node: NodeDefinition;
  actionIndex: number;
  guaranteed: boolean;
}

/** The wild trees and stones (`sim/gathering.ts`), as spots: the bot gathers from them as a player would. */
const WILD_SPOTS: NodeDefinition[] = wildIndex().nodes.map((wild) => wild.definition);

/**
 * A wild tree or stone the bot can walk to from its island's landing, worked out once each. A placed spot always
 * can (the tests hold that); a boulder on a rock in the water, a spruce boxed in by others, cannot.
 */
const WILD_REACHABLE = new Map<string, boolean>();
function wildReachable(node: NodeDefinition): boolean {
  let known = WILD_REACHABLE.get(node.id);
  if (known === undefined) {
    known = footReachable(node.islandId, walkGoal(node.position, 1.6).target);
    WILD_REACHABLE.set(node.id, known);
  }
  return known;
}

const NODE_SOURCES = new Map<ItemId, NodeSource[]>();
for (const node of [...NODES, ...WILD_SPOTS]) {
  node.actions.forEach((action, actionIndex) => {
    const table = LOOT_TABLES[action.lootTableId];
    const add = (itemId: ItemId, guaranteed: boolean): void => {
      const list = NODE_SOURCES.get(itemId) ?? [];
      if (!list.some((source) => source.node === node && source.actionIndex === actionIndex)) {
        list.push({ node, actionIndex, guaranteed });
      }
      NODE_SOURCES.set(itemId, list);
    };
    for (const entry of table.guaranteed) add(entry.itemId, true);
    for (const entry of table.pool) add(entry.itemId, false);
  });
}

const GIFT_SOURCES = new Map<ItemId, NpcId>();
const FLAG_SOURCES = new Map<string, NpcId>();
for (const npcId of NPC_IDS) {
  for (const node of Object.values(NPCS[npcId].nodes)) {
    for (const option of node.options) {
      for (const effect of option.effects ?? []) {
        if (effect.type === 'give_items') for (const item of effect.items) GIFT_SOURCES.set(item.itemId, npcId);
        if (effect.type === 'set_flag') FLAG_SOURCES.set(effect.flag, npcId);
      }
    }
  }
}

const RECIPE_FOR = new Map<ItemId, RecipeDefinition>();
for (const recipeId of RECIPE_IDS) {
  const recipe = RECIPES[recipeId];
  if (!RECIPE_FOR.has(recipe.output.itemId)) RECIPE_FOR.set(recipe.output.itemId, recipe);
}

const FOOD_IDS = (Object.keys(ITEMS) as ItemId[]).filter((itemId) => {
  const definition = ITEMS[itemId];
  return definition.edible !== null && !definition.isDrink && definition.category !== 'stock';
});

/** Build a driver that plays `state` forward from wherever it is. */
export function createBotDriver(state: GameState, options: BotDriverOptions = {}): BotDriver {
  const log = (line: string): void => options.log?.(`${(state.playedSeconds / 60).toFixed(1).padStart(6)}  ${line}`);
  const habits = options.habits ?? CAREFUL;
  // The bot's own dice, for its lapses. Seeded from the game's seed and never the game's dice, so a
  // lapse changes nothing but what the bot does. A careful bot never rolls them.
  let dice = (state.seed ^ 0x51ed270b) >>> 0;
  const roll = (sides: number): number => {
    dice = (Math.imul(dice, 1664525) + 1013904223) >>> 0;
    return (dice >>> 8) % sides;
  };
  const lapse = (oneIn: number): boolean => oneIn > 0 && roll(oneIn) === 0;

  // --- Reading the state ----------------------------------------------------

  // The bot is player 0.
  const player = state.players[0];
  const canoe = state.canoe;
  const here = (): IslandId | null => (player.mode === 'foot' ? player.islandId : null);
  const held = (itemId: ItemId): number => {
    if (ITEMS[itemId].category === 'tool') return state.tools.includes(itemId as ToolId) ? 1 : 0;
    if (!isStackable(itemId)) return state.keyItems[itemId] ?? 0;
    let total = 0;
    for (const stack of player.backpack) if (stack.itemId === itemId) total += stack.count;
    for (const stack of canoe.cargo) if (stack.itemId === itemId) total += stack.count;
    return total;
  };
  const inReach = (itemId: ItemId): number => {
    const inventory = selectInventory(state);
    let total = 0;
    for (const stack of inventory.backpack) if (stack.itemId === itemId) total += stack.count;
    if (inventory.cargoAccessible) for (const stack of inventory.cargo) if (stack.itemId === itemId) total += stack.count;
    return total;
  };
  const limits = (): Seaworthiness => {
    const stats = selectCanoeStats(state);
    return { stability: stats.stability, fogGear: stats.canCrossFog };
  };
  const hasAttachment = (attachmentId: AttachmentId): boolean => canoe.attachments.includes(attachmentId);
  const nodeReady = (node: NodeDefinition, actionIndex: number): boolean => {
    const nodeState = state.nodes[node.id];
    if (!nodeState) return true;
    const readyAt = nodeState.readyAt[actionIndex];
    return readyAt !== null && readyAt <= state.time;
  };
  const questDone = (questId: QuestId): boolean => state.quests[questId].status === 'completed';
  /** Wild trees and stones the bot walked to and could not use: never tried again. */
  const passedOver = new Set<string>();
  const send = options.dispatch ?? ((command: Command): CommandResult => dispatch(state, command));
  const must = (command: Command): void => {
    const result = send(command);
    if (!result.ok) throw new BotStuck(`${command.type} failed: ${result.reason} ${JSON.stringify(result.missing ?? '')}`);
  };

  // --- Demand: what the plan still needs ------------------------------------

  /** Items consumed (and tools needed) by one objective, before recipes are unfolded. */
  const objectiveNeeds = (objective: ObjectiveDefinition): ItemAmount[] => {
    switch (objective.type) {
      case 'have_item':
        return [{ itemId: objective.itemId, count: objective.count }];
      case 'have_tool':
        return [{ itemId: objective.toolId, count: 1 }];
      case 'craft':
        return [{ itemId: objective.itemIds[0], count: objective.count }];
      case 'hull': {
        const needs: ItemAmount[] = [];
        for (let tier = canoe.hullTier + 1; tier <= objective.tier; tier += 1) {
          needs.push(...HULL_TIERS[tier].cost, ...HULL_TIERS[tier].tools.map((toolId) => ({ itemId: toolId as ItemId, count: 1 })));
        }
        return needs;
      }
      case 'attachment':
        return attachmentNeeds(objective.attachmentId);
      default:
        return [];
    }
  };
  const attachmentNeeds = (attachmentId: AttachmentId): ItemAmount[] => {
    if (hasAttachment(attachmentId)) return [];
    const definition = ATTACHMENTS[attachmentId];
    const needs: ItemAmount[] = [...definition.cost, ...definition.tools.map((toolId) => ({ itemId: toolId as ItemId, count: 1 }))];
    for (const required of definition.requiresAttachments) needs.push(...attachmentNeeds(required));
    for (let tier = canoe.hullTier + 1; tier <= definition.minimumHullTier; tier += 1) needs.push(...HULL_TIERS[tier].cost);
    return needs;
  };

  /**
   * Unfold needs through recipes down to raw items. With `shortOnly` what is
   * already held is used up first, so the result is what still has to be found.
   */
  const rawDemand = (needs: ItemAmount[], shortOnly = true): Map<ItemId, number> => {
    const pool = new Map<ItemId, number>();
    const demand = new Map<ItemId, number>();
    const plannedTools = new Set<ItemId>();
    const need = (itemId: ItemId, count: number, depth: number): void => {
      const reusable = !isStackable(itemId) && ITEMS[itemId].category === 'tool';
      if (reusable) {
        if (held(itemId) > 0 || plannedTools.has(itemId)) return;
        plannedTools.add(itemId);
      } else {
        if (!pool.has(itemId)) pool.set(itemId, shortOnly ? held(itemId) : 0);
        const used = Math.min(pool.get(itemId)!, count);
        pool.set(itemId, pool.get(itemId)! - used);
        count -= used;
        if (count <= 0) return;
      }
      const recipe = RECIPE_FOR.get(itemId);
      if (recipe && depth < 8) {
        const times = Math.ceil(count / recipe.output.count);
        for (const toolId of recipe.tools) need(toolId, 1, depth + 1);
        for (const input of recipe.inputs) need(input.itemId, input.count * times, depth + 1);
        if (!reusable) pool.set(itemId, (pool.get(itemId) ?? 0) + times * recipe.output.count - count);
      } else {
        demand.set(itemId, (demand.get(itemId) ?? 0) + count);
      }
    };
    for (const { itemId, count } of needs) need(itemId, count, 0);
    return demand;
  };

  /** Needs of the quests from the current one through `lookahead` more. */
  const upcomingNeeds = (lookahead: number): ItemAmount[] => {
    const needs: ItemAmount[] = [];
    const currentIndex = MAIN_QUESTS.findIndex((quest) => !questDone(quest.id));
    if (currentIndex === -1) return needs;
    for (const quest of MAIN_QUESTS.slice(currentIndex, currentIndex + 1 + lookahead)) {
      quest.objectives.forEach((objective, index) => {
        if (state.quests[quest.id].progress[index] >= 1 && objective.type !== 'have_item' && objective.type !== 'craft') return;
        if (quest.id === MAIN_QUESTS[currentIndex].id && objectiveComplete(quest, index)) return;
        needs.push(...objectiveNeeds(objective));
      });
      for (const extra of STRATEGY) {
        if (extra.questId === quest.id) for (const attachmentId of extra.attachments) needs.push(...attachmentNeeds(attachmentId));
      }
    }
    return needs;
  };
  const objectiveComplete = (quest: QuestDefinition, index: number): boolean => {
    const view = selectActiveQuests(state).find((entry) => entry.questId === quest.id);
    return view ? view.objectives[index].done : questDone(quest.id);
  };

  let extraWanted = new Map<ItemId, number>();
  /** Raw items worth picking up while passing: the next quests' needs, short of what is held. */
  const wanted = (): Map<ItemId, number> => {
    const demand = rawDemand(upcomingNeeds(2));
    for (const [itemId, count] of extraWanted) {
      const short = count - held(itemId);
      if (short > 0) demand.set(itemId, Math.max(demand.get(itemId) ?? 0, short));
    }
    return demand;
  };

  // --- Low-level control ----------------------------------------------------

  let lastUpkeepTick = -1000;
  let reserved = new Map<ItemId, number>();
  let powerOn = false;
  let runOn = false;

  /** Eat and drink from what is in reach. Instant commands, safe to call any time. */
  const upkeep = (): void => {
    if (player.dialogue || state.tick - lastUpkeepTick < 30) return;
    lastUpkeepTick = state.tick;
    const spare = (itemId: ItemId): number => inReach(itemId) - (reserved.get(itemId) ?? 0);
    const thirsty = player.thirst < habits.drinkBelow;
    if (thirsty && spare('clean_water') <= 0 && selectInventory(state).stations.includes('fire')) {
      // Fire in reach and nothing to drink: scoop and boil.
      if (inReach('dirty_water') < 3) send({ type: 'fill_water', count: 4 });
      useFire();
    }
    while (thirsty && player.thirst < habits.drinkUntil && spare('clean_water') > 0) must({ type: 'drink', itemId: 'clean_water' });
    if (player.thirst < 12 && inReach('dirty_water') > 0) must({ type: 'drink', itemId: 'dirty_water' });
    const hungry = player.hunger < habits.eatBelow;
    for (let guard = 0; hungry && guard < 6 && player.hunger < habits.eatUntil; guard += 1) {
      // Finish small stacks first: every stack eaten is a slot back.
      const candidates = FOOD_IDS
        .filter((itemId) => spare(itemId) > 0 && !(itemId === 'cattail_root' && !questDone('something_to_eat')))
        .sort((first, second) => held(first) - held(second) || ITEMS[second].edible!.hunger - ITEMS[first].edible!.hunger);
      // Raw fish costs energy: keep it for the fire unless things are desperate.
      const choice = candidates.find((itemId) => itemId !== 'raw_fish' || player.hunger < 20);
      if (choice) {
        must({ type: 'eat', itemId: choice });
        continue;
      }
      const stock = STOCK_FOOD_IDS.find((itemId) => spare(itemId) > 0);
      if (stock && player.hunger < 25) must({ type: 'eat', itemId: stock });
      else break;
    }
    if (hasAttachment('lantern_mast') && !canoe.lanternLit) must({ type: 'toggle_lantern' });
  };

  /** Boil water and cook whatever is raw, when a fire is in reach. */
  const useFire = (): void => {
    if (!selectInventory(state).stations.includes('fire')) return;
    const dirty = inReach('dirty_water');
    if (dirty > 0) send({ type: 'craft', recipeId: 'clean_water', count: dirty });
    const fish = inReach('raw_fish') - (reserved.get('raw_fish') ?? 0);
    if (fish > 0) send({ type: 'craft', recipeId: 'cooked_fish', count: fish });
    if (questDone('something_to_eat')) {
      const pairs = Math.floor(inReach('cattail_root') / 2);
      if (pairs > 0) send({ type: 'craft', recipeId: 'roast_roots', count: pairs });
    }
  };

  /** Scoop flood water for the next fire, when at the canoe. */
  const scoopWater = (): void => {
    if (!selectInventory(state).cargoAccessible) return;
    const short = habits.waterCarried - held('clean_water') - held('dirty_water');
    if (short > 0) send({ type: 'fill_water', count: short });
  };

  function* idle(seconds: number): Generator<StepInput> {
    for (let tick = 0; tick < seconds * 60; tick += 1) {
      upkeep();
      yield NEUTRAL_INPUT;
    }
  }

  /** Hull point with the highest ground under it: where to board from. */
  const boardingPoint = (): Point => {
    let best: Point = { x: canoe.position.x, z: canoe.position.z };
    let bestHeight = -Infinity;
    for (const along of [2.2, 0, -2.2]) {
      const point = { x: canoe.position.x + Math.sin(canoe.heading) * along, z: canoe.position.z - Math.cos(canoe.heading) * along };
      const height = terrainHeight(point.x, point.z);
      if (height > bestHeight) {
        bestHeight = height;
        best = point;
      }
    }
    return best;
  };

  function* walkTo(goal: Point, reach: number): Generator<StepInput> {
    if (player.mode !== 'foot') throw new BotStuck('walkTo while aboard');
    const { target, range } = walkGoal(goal, reach);
    let attempts = 0;
    for (;;) {
      if (distance(player.position, target) <= range) return;
      const islandId = player.islandId;
      if (!islandId) throw new BotStuck('walkTo: not on an island');
      const route = findFootPath(islandId, player.position, target);
      if (!route) throw new BotStuck(`no walking route on ${islandId} to ${target.x.toFixed(0)},${target.z.toFixed(0)}`);
      let index = 0;
      let checkpoint = { x: player.position.x, z: player.position.z };
      let checkpointTick = state.tick;
      let blocked = false;
      while (!blocked) {
        const remaining = distance(player.position, target);
        if (remaining <= range) return;
        const waypoint = route[index];
        const toWaypoint = distance(player.position, waypoint);
        // On to the next waypoint once near this one, but early only if the way on from here is open: from a corner
        // of a wall, the line on from the waypoint is not the line on from here.
        if (index < route.length - 1 && (toWaypoint < 0.15 || (toWaypoint < 0.6 && clearGround(player.position, route[index + 1])))) {
          index += 1;
          continue;
        }
        if (player.energy > habits.runUntil + 20) runOn = true;
        if (player.energy < habits.runUntil) runOn = false;
        upkeep();
        yield {
          ...NEUTRAL_INPUT,
          moveX: (waypoint.x - player.position.x) / Math.max(toWaypoint, 1e-6),
          moveY: -(waypoint.z - player.position.z) / Math.max(toWaypoint, 1e-6),
          run: runOn && remaining > 6,
          cameraYaw: 0,
        };
        if (state.tick - checkpointTick >= 120) {
          if (distance(player.position, checkpoint) < 0.5) blocked = true;
          checkpoint = { x: player.position.x, z: player.position.z };
          checkpointTick = state.tick;
        }
      }
      attempts += 1;
      if (attempts > 4) throw new BotStuck(`walking stuck on ${islandId} at ${player.position.x.toFixed(1)},${player.position.z.toFixed(1)} going to ${target.x.toFixed(1)},${target.z.toFixed(1)}`);
      // Planning again from the very spot it is wedged in gives the same line and the same push: step clear first.
      yield* stepClear();
    }
  }

  /**
   * Out of a corner, as a player would: straight to the nearest spot with the bot's usual berth round it. A walker
   * swings a little wide on a sharp turn (the rules ease it round), and can lodge against a wall's corner where every
   * slide is shut although the straight line on looks open.
   */
  function* stepClear(): Generator<StepInput> {
    const spot = freeSpotNear(player.position.x, player.position.z, 2, SOLID_CLEARANCE);
    if (!spot || distance(player.position, spot) < 0.05) return;
    log(`stepping clear of a corner at ${player.position.x.toFixed(1)},${player.position.z.toFixed(1)}`);
    for (let tick = 0; tick < 60; tick += 1) {
      const away = distance(player.position, spot);
      if (away < 0.05) return;
      upkeep();
      yield { ...NEUTRAL_INPUT, moveX: (spot.x - player.position.x) / away, moveY: -(spot.z - player.position.z) / away, cameraYaw: 0 };
    }
  }

  function* walkToCanoe(): Generator<StepInput> {
    if (player.mode === 'canoe') return;
    if (distance(player.position, canoe.position) > 5) yield* walkTo(boardingPoint(), 1.5);
  }

  /**
   * Free a slot by dropping a stack. In order: things the main line never
   * needs, true surplus, a scrap of raw food when there are many kinds, and
   * last, things only needed quests from now.
   */
  const makeRoom = (): boolean => {
    const gross = rawDemand(upcomingNeeds(MAIN_QUESTS.length), false);
    const near = rawDemand(upcomingNeeds(2), false);
    const containers = [
      { name: 'backpack' as const, stacks: player.backpack },
      ...(selectInventory(state).cargoAccessible ? [{ name: 'cargo' as const, stacks: canoe.cargo }] : []),
    ];
    const foodKinds = FOOD_IDS.filter((itemId) => held(itemId) > 0).length;
    let worst: { container: 'backpack' | 'cargo'; itemId: ItemId; count: number; score: number } | null = null;
    for (const container of containers) {
      for (const stack of container.stacks) {
        const itemId = stack.itemId;
        const definition = ITEMS[itemId];
        if ((reserved.get(itemId) ?? 0) > 0 || (extraWanted.get(itemId) ?? 0) > 0) continue;
        if (definition.category === 'stock' || itemId === 'clean_water') continue;
        const total = held(itemId);
        const needed = gross.get(itemId) ?? 0;
        let score: number;
        if (definition.edible) {
          if (RECIPE_FOR.has(itemId) || foodKinds < 3 || itemId === 'dirty_water') continue;
          score = 300 - total * definition.edible.hunger;
        } else if (RECIPE_FOR.has(itemId)) {
          continue;
        } else if (needed === 0) {
          score = 1000 + stack.count;
        } else if (total - needed >= stack.count) {
          score = 500 + total - needed;
        } else if ((near.get(itemId) ?? 0) === 0) {
          score = 100 - needed;
        } else {
          // Last resort: the smallest stack of something that grows back.
          score = -stack.count;
        }
        if (!worst || score > worst.score) worst = { container: container.name, itemId, count: stack.count, score };
      }
    }
    if (!worst) return false;
    log(`discard ${worst.count} ${worst.itemId}`);
    return send({ type: 'discard', from: worst.container, itemId: worst.itemId, count: worst.count }).ok;
  };

  const stow = (): void => {
    if (!selectInventory(state).cargoAccessible || player.backpack.length === 0) return;
    for (let guard = 0; guard < 4; guard += 1) {
      const result = send({ type: 'stow_backpack' });
      if (result.ok || !makeRoom()) break;
    }
  };

  function* harvest(node: NodeDefinition, actionIndex: number): Generator<StepInput> {
    const action = node.actions[actionIndex];
    yield* walkTo(node.position, 1.6);
    if (habits.hesitation > 0) yield* idle(habits.hesitation);
    if (action.energyCost > 0 && player.energy < action.energyCost + 12) yield* rest(40);
    if (player.selectedTool !== action.tool) must({ type: 'select_tool', toolId: action.tool });
    // Something left here on an earlier visit is in the way: it comes first, room made for it if need be.
    for (let guard = 0; guard < 6 && (state.nodes[node.id]?.leftover.length ?? 0) > 0; guard += 1) {
      send({ type: 'scavenge' });
      yield NEUTRAL_INPUT;
      if ((state.nodes[node.id]?.leftover.length ?? 0) > 0 && !makeRoom()) break;
    }
    if (nodeReady(node, actionIndex)) {
      const answers = (candidate: ReturnType<typeof selectInteractable>): boolean => candidate?.kind === 'node'
        && candidate.nodeId === node.id && candidate.available && candidate.actionIndex === actionIndex;
      let target = selectInteractable(state);
      // A tree or a stone nearer than the spot: step up to the spot itself, as a player would.
      if (!answers(target) && !isWildNodeId(node.id)) {
        yield* walkTo(node.position, 0.4);
        target = selectInteractable(state);
      }
      if (!target || target.kind !== 'node' || target.nodeId !== node.id || !target.available || target.actionIndex !== actionIndex) {
        // Another tree or stone is nearer, and gives the same: a player uses that one. Anything else, and a wild
        // one is passed over for good; a placed spot that cannot be used is a fault.
        const other = target?.kind === 'node' && target.available && target.actionIndex >= 0 ? NODES_BY_ID[target.nodeId] : undefined;
        if (other && target?.kind === 'node' && other.actions[target.actionIndex].lootTableId === action.lootTableId) {
          node = other;
          actionIndex = target.actionIndex;
        } else if (isWildNodeId(node.id)) {
          log(`passed over ${node.id}: ${target?.prompt ?? 'nothing in reach'}`);
          passedOver.add(node.id);
          return;
        } else {
          throw new BotStuck(`cannot use ${node.id}: ${JSON.stringify(target)}`);
        }
      }
      // One press and it is done.
      must({ type: 'scavenge' });
    }
    yield NEUTRAL_INPUT;
    // Loot that did not fit stays on the node: stow, make room, pick it up.
    for (let guard = 0; guard < 3 && (state.nodes[node.id]?.leftover.length ?? 0) > 0; guard += 1) {
      const keep = wanted();
      if (!state.nodes[node.id].leftover.some((stack) => (keep.get(stack.itemId) ?? 0) > 0 || ITEMS[stack.itemId].edible)) break;
      if (canoe.beached && canoe.lastBeached.islandId === here()) {
        yield* walkToCanoe();
        stow();
        yield* walkTo(node.position, 1.6);
      } else if (!makeRoom()) break;
      // One press picks up whatever fits now.
      const target = selectInteractable(state);
      if (target?.kind === 'node' && target.nodeId === node.id) send({ type: 'scavenge' });
      yield NEUTRAL_INPUT;
    }
    if (lapse(habits.wasteEvery) && player.backpack.length > 0) {
      // Careless with the everyday, not with the one battery: what only a couple of places give is kept.
      const dropped = player.backpack[roll(player.backpack.length)];
      const common = (NODE_SOURCES.get(dropped.itemId) ?? []).filter((source) => source.guaranteed).length >= 6 || RECIPE_FOR.has(dropped.itemId);
      if (common) {
        log(`careless: dropped ${dropped.count} ${dropped.itemId}`);
        send({ type: 'discard', from: 'backpack', itemId: dropped.itemId, count: dropped.count });
      }
    }
    if (lapse(habits.wanderEvery) && player.islandId) {
      const spots = NODES_BY_ISLAND[player.islandId].filter((other) => other.reach === 'foot');
      const far = spots[roll(spots.length)];
      if (far && findFootPath(player.islandId, player.position, far.position)) {
        log(`careless: wandering off toward ${far.id}`);
        yield* walkTo(far.position, 2);
      }
    }
  }

  function* rest(untilEnergy: number): Generator<StepInput> {
    const giveUpTick = state.tick + 240 * 60;
    while (player.energy < untilEnergy && state.tick < giveUpTick) {
      upkeep();
      yield NEUTRAL_INPUT;
    }
  }

  /** Where to lie down in an island's camp: its bed (the lean-to, a bedroll, the keeper's hut), not its fire. */
  const bedOf = (islandId: IslandId): Point => {
    const bed = CAMP_LAYOUTS[islandId]?.beds[0];
    if (!bed) throw new BotStuck(`no bed in the camp on ${islandId}`);
    return { x: bed.x, z: bed.z };
  };

  /** Sleep through the night when a bed is on this island. Costs no played time. */
  function* sleepIfNight(): Generator<StepInput> {
    const islandId = here();
    if (!islandId || !selectTimeOfDay(state).isNight) return;
    const definition = ISLANDS_BY_ID[islandId];
    if (!definition.camp?.sleep) return;
    yield* walkTo(bedOf(islandId), 2);
    useFire();
    upkeep();
    if (send({ type: 'sleep' }).ok) log(`slept on ${islandId}`);
  }

  // --- Canoe ----------------------------------------------------------------

  const manageSail = (): void => {
    if (!hasAttachment('mast_sail') || state.tick % 30 !== 0) return;
    const shouldRaise = selectCanoeStats(state).sailFactor > 0.25 && !canoe.beached;
    if (shouldRaise !== canoe.sailRaised) send({ type: 'set_sail', raised: shouldRaise });
  };

  let bailing = false;
  /** One paddling input toward a point, with bailing, power strokes and the sail handled. */
  const paddleToward = (target: Point): StepInput => {
    upkeep();
    manageSail();
    if (canoe.waterLevel >= habits.bailAt) bailing = true;
    if (canoe.waterLevel <= habits.bailUntil) bailing = false;
    // Rough water is filling the hull faster than a can empties it: keep moving.
    if (bailing && !canoe.takingWater) return { ...NEUTRAL_INPUT, bail: true };
    const turn = bearingDifference(bearingBetween(canoe.position.x, canoe.position.z, target.x, target.z), canoe.heading);
    if (player.energy > habits.powerUntil + 20) powerOn = true;
    if (player.energy < habits.powerUntil) powerOn = false;
    return {
      ...NEUTRAL_INPUT,
      paddle: Math.abs(turn) < 1.1 ? 1 : 0.2,
      steer: clamp(turn * 2.5, -1, 1),
      powerStroke: (powerOn || canoe.takingWater) && Math.abs(turn) < 0.6,
    };
  };

  function* backOff(seconds: number, metres = 9): Generator<StepInput> {
    if (canoe.sailRaised) send({ type: 'set_sail', raised: false });
    const start = { x: canoe.position.x, z: canoe.position.z };
    for (let tick = 0; tick < seconds * 60 && distance(canoe.position, start) < metres; tick += 1) {
      yield { ...NEUTRAL_INPUT, paddle: -1 };
    }
  }

  /** True when a storm would make any water on the straight run to a point too rough. */
  const stormWouldSwamp = (from: Point, to: Point): boolean => {
    const stability = selectCanoeStats(state).stability;
    const steps = Math.max(1, Math.ceil(distance(from, to) / 25));
    for (let step = 0; step <= steps; step += 1) {
      const z = from.z + ((to.z - from.z) * step) / steps;
      if (regionAt(0, z).roughness + 1 > stability) return true;
    }
    return false;
  };

  /** Wait ashore while a storm would swamp the canoe on the way. */
  function* waitForWeather(islandId: IslandId): Generator<StepInput> {
    const target = islandLanding(islandId).approach;
    if (!stormWouldSwamp(canoe.position, target)) return;
    const route = findWaterPath(canoe.position, target, limits());
    const travelSeconds = (route ? routeLength(canoe.position, route) : distance(canoe.position, target)) / 1.9 + 45;
    const giveUpTick = state.tick + 30 * 60 * 60;
    let waited = false;
    for (;;) {
      const weather = state.weather;
      const stormNow = weather.kind === 'storm' || weather.stormLevel > 0.02;
      const stormSoon = !habits.ignoresForecast && weather.nextKind === 'storm' && weather.secondsRemaining < travelSeconds;
      if (!stormNow && !stormSoon) break;
      if (!waited) {
        log(`waiting out a storm (${weather.kind}, next ${weather.nextKind} in ${weather.secondsRemaining.toFixed(0)} s)`);
        // Wait by the fire if there is one, otherwise by the canoe.
        const definition = here() ? ISLANDS_BY_ID[here()!] : null;
        if (definition?.camp) yield* walkTo(spotPosition(definition, definition.camp.spot), 3);
        else yield* walkToCanoe();
      }
      waited = true;
      if (state.tick > giveUpTick) throw new BotStuck('storm never passed');
      if (state.tick % 600 === 0) yield* maintain();
      upkeep();
      yield NEUTRAL_INPUT;
    }
  }

  /**
   * Afloat with a storm coming that the rest of the trip cannot take: the
   * island to shelter on, or null to carry on. Prefers the refuge nearest the
   * destination that can be reached in time (or through water a storm leaves
   * safe); failing that, the nearest island of all.
   */
  const stormRefuge = (destination: IslandId): IslandId | null => {
    const weather = state.weather;
    const goal = islandLanding(destination).approach;
    const stormNow = weather.kind === 'storm' || weather.stormLevel > 0.02;
    const eta = (distance(canoe.position, goal) * 1.15) / 2 + 25;
    if (!stormNow && (habits.ignoresForecast || !(weather.nextKind === 'storm' && weather.secondsRemaining < eta))) return null;
    if (!stormWouldSwamp(canoe.position, goal)) return null;
    const timeLeft = stormNow ? 0 : weather.secondsRemaining;
    let best: IslandId | null = null;
    let bestScore = Infinity;
    let nearest: IslandId = destination;
    let nearestSeconds = Infinity;
    for (const definition of ISLANDS) {
      if (!canReachIsland(definition.id, limits())) continue;
      const approach = islandLanding(definition.id).approach;
      const seconds = (distance(canoe.position, approach) * 1.15) / 2 + 25;
      if (seconds < nearestSeconds) {
        nearestSeconds = seconds;
        nearest = definition.id;
      }
      if (seconds >= timeLeft && stormWouldSwamp(canoe.position, approach)) continue;
      const score = distance(approach, goal);
      if (score < bestScore) {
        bestScore = score;
        best = definition.id;
      }
    }
    const refuge = best ?? nearest;
    return refuge === destination ? null : refuge;
  };

  function* board(): Generator<StepInput> {
    if (player.mode === 'canoe') return;
    yield* walkToCanoe();
    stow();
    scoopWater();
    useFire();
    upkeep();
    must({ type: 'board' });
  }

  /** Paddle to an island and beach there. Returns where it beached: the island, or a storm refuge. */
  function* paddleTo(islandId: IslandId, mayDivert = true): Generator<StepInput, IslandId> {
    const landing = islandLanding(islandId);
    for (let attempt = 0; attempt < 6; attempt += 1) {
      // Still grounding after three tries: back off farther each time, for room to turn.
      const further = Math.max(0, attempt - 2);
      if (canoe.beached) yield* backOff(8 + 10 * further, 9 + 15 * further);
      const route = findWaterPath(canoe.position, landing.approach, limits());
      if (!route) throw new BotStuck(`no water route to ${islandId} at stability ${limits().stability}`);
      let grounded = false;
      for (let index = 0; index < route.length && !grounded; index += 1) {
        const waypoint = route[index];
        const tolerance = index === route.length - 1 ? 8 : 14;
        const giveUpTick = state.tick + 30 * 60 * 60;
        while (distance(canoe.position, waypoint) > tolerance) {
          if (state.tick > giveUpTick) throw new BotStuck(`never reached a waypoint toward ${islandId}`);
          if (mayDivert && state.tick % 60 === 0) {
            const refuge = stormRefuge(islandId);
            if (refuge) {
              log(`storm coming: sheltering on ${refuge}`);
              return yield* paddleTo(refuge, false);
            }
          }
          yield paddleToward(waypoint);
          if (canoe.beached) {
            grounded = true;
            break;
          }
        }
      }
      if (grounded) {
        log(`grounded on the way to ${islandId}, backing off`);
        continue;
      }
      // Run the bow up the beach.
      const giveUpTick = state.tick + 90 * 60;
      while (!canoe.beached && state.tick < giveUpTick) yield paddleToward(landing.shore);
      if (canoe.beached && distance(canoe.position, landing.shore) < 30) return islandId;
    }
    throw new BotStuck(`could not land on ${islandId}`);
  }

  function* travelTo(islandId: IslandId, direct = false): Generator<StepInput> {
    for (let leg = 0; leg < 8; leg += 1) {
      if (here() === islandId) return;
      if (!canReachIsland(islandId, limits())) throw new BotStuck(`${islandId} is out of reach at stability ${limits().stability}`);
      if (player.mode === 'foot' && !direct && lapse(habits.detourEvery)) {
        const others = ISLANDS.filter((definition) => definition.id !== islandId && definition.id !== here()
          && canReachIsland(definition.id, limits()) && distance(canoe.position, definition.center) < 700);
        if (others.length > 0) {
          const wrong = others[roll(others.length)].id;
          log(`careless: heading for ${wrong} by mistake`);
          try {
            yield* travelTo(wrong, true);
          } catch (error) {
            // A mistaken trip that cannot be finished is just given up.
            if (!(error instanceof BotStuck)) throw error;
            log(`careless: gave up on ${wrong}`);
          }
          continue;
        }
      }
      if (player.mode === 'foot') {
        yield* sweepIsland();
        yield* sleepIfNight();
        yield* waitForWeather(islandId);
        yield* board();
      }
      log(`paddle to ${islandId}`);
      yield* paddleTo(islandId);
      must({ type: 'disembark' });
      scoopWater();
      useFire();
      upkeep();
      yield NEUTRAL_INPUT;
    }
    throw new BotStuck(`never arrived at ${islandId}`);
  }

  // --- Gathering ------------------------------------------------------------

  const travelCost = (node: NodeDefinition): number => {
    if (here() === node.islandId) return distance(player.position, node.position);
    return 120 + distance(canoe.position, islandLanding(node.islandId).approach);
  };

  const usable = (source: NodeSource): boolean => {
    const action = source.node.actions[source.actionIndex];
    return source.node.reach === 'foot' && action.questGate === null
      && (action.attachment === null || hasAttachment(action.attachment))
      && nodeReady(source.node, source.actionIndex)
      && canReachIsland(source.node.islandId, limits())
      && (!isWildNodeId(source.node.id) || (!passedOver.has(source.node.id) && wildReachable(source.node)));
  };

  /** Pick up everything on this island that the next quests want. */
  function* sweepIsland(): Generator<StepInput> {
    const islandId = here();
    if (!islandId) return;
    for (let guard = 0; guard < 40; guard += 1) {
      const want = wanted();
      const foodHeld = FOOD_IDS.reduce((sum, itemId) => sum + held(itemId) * ITEMS[itemId].edible!.hunger, 0);
      const wantsFood = foodHeld < habits.larder;
      const wantsWater = held('clean_water') + held('dirty_water') < Math.min(3, habits.waterCarried);
      let best: { node: NodeDefinition; actionIndex: number; cost: number } | null = null;
      for (const node of [...NODES_BY_ISLAND[islandId], ...wildNodesOn(islandId).map((wild) => wild.definition)]) {
        node.actions.forEach((action, actionIndex) => {
          if (!usable({ node, actionIndex, guaranteed: true })) return;
          if (action.tool && held(action.tool) === 0) return;
          const loot = LOOT_TABLES[action.lootTableId].guaranteed;
          const useful = loot.some((entry) => (want.get(entry.itemId) ?? 0) > 0
            || (wantsFood && FOOD_IDS.includes(entry.itemId))
            || (wantsWater && entry.itemId === 'clean_water'));
          if (!useful) return;
          const cost = distance(player.position, node.position);
          if (!best || cost < best.cost) best = { node, actionIndex, cost };
        });
      }
      if (!best) return;
      const choice: { node: NodeDefinition; actionIndex: number } = best;
      if (player.backpack.length >= TUNING.inventory.backpackSlots - 1 && canoe.lastBeached.islandId === islandId) {
        yield* walkToCanoe();
        stow();
      }
      yield* harvest(choice.node, choice.actionIndex);
    }
  }

  function* gather(itemId: ItemId, target: number): Generator<StepInput> {
    for (let guard = 0; guard < 80; guard += 1) {
      if (held(itemId) >= target) return;
      yield* maintain();
      // A trip for food or water sweeps the island on its way out, and may have picked this up already.
      if (held(itemId) >= target) return;
      const sources = (NODE_SOURCES.get(itemId) ?? []).filter(usable);
      if (sources.length === 0) {
        const all = NODE_SOURCES.get(itemId) ?? [];
        if (all.length === 0) throw new BotStuck(`nothing yields ${itemId}`);
        const waiting = all.filter((source) => source.node.reach === 'foot' && canReachIsland(source.node.islandId, limits())
          && state.nodes[source.node.id]?.readyAt[source.actionIndex] !== null);
        if (waiting.length === 0) throw new BotStuck(`every source of ${itemId} is out of reach or used up`);
        log(`waiting for ${itemId} to respawn`);
        yield* sleepIfNight();
        yield* idle(30);
        continue;
      }
      let best = sources[0];
      let bestCost = Infinity;
      for (const source of sources) {
        const tool = source.node.actions[source.actionIndex].tool;
        const cost = travelCost(source.node) + (source.guaranteed ? 0 : 500) + (tool && held(tool) === 0 ? 300 : 0);
        if (cost < bestCost) {
          bestCost = cost;
          best = source;
        }
      }
      const tool = best.node.actions[best.actionIndex].tool;
      if (tool && held(tool) === 0) {
        yield* ensureItems([{ itemId: tool, count: 1 }]);
        continue;
      }
      yield* travelTo(best.node.islandId);
      yield* harvest(best.node, best.actionIndex);
    }
    throw new BotStuck(`could not gather ${target} ${itemId}`);
  }

  function* talkTo(npcId: NpcId): Generator<StepInput> {
    const npc = NPCS[npcId];
    yield* travelTo(npc.islandId);
    yield* walkTo(spotPosition(ISLANDS_BY_ID[npc.islandId], npc.spot), 2.5);
    must({ type: 'talk', npcId });
    log(`talk to ${npcId}`);
    const visited = new Set<string>();
    for (let guard = 0; guard < 30 && player.dialogue; guard += 1) {
      const nodeId = player.dialogue.nodeId;
      const view = selectDialogue(state)!;
      const options = NPCS[npcId].nodes[nodeId].options;
      // Take what is offered (an option with an effect), otherwise say goodbye.
      const withEffect = view.options.find((visible) => {
        const option = options.find((candidate) => candidate.text === visible.text);
        return option?.effects?.some((effect) => effect.type === 'give_items' || effect.type === 'set_flag');
      });
      const leave = view.options.find((visible) => options.find((candidate) => candidate.text === visible.text)?.next === null);
      const choice = withEffect ?? (visited.has(nodeId) || leave ? leave : undefined) ?? view.options[0];
      visited.add(nodeId);
      if (!choice) {
        must({ type: 'end_dialogue' });
        break;
      }
      must({ type: 'choose_dialogue_option', optionIndex: choice.index });
      yield NEUTRAL_INPUT;
    }
    if (player.dialogue) must({ type: 'end_dialogue' });
  }

  // --- Crafting and building ------------------------------------------------

  function* goToStation(station: StationId): Generator<StepInput> {
    if (station === 'hands' || selectInventory(state).stations.includes(station)) return;
    const aboard = ATTACHMENT_IDS.find((attachmentId) => ATTACHMENTS[attachmentId].station === station && hasAttachment(attachmentId));
    if (aboard) {
      yield* walkToCanoe();
      return;
    }
    let best: IslandId | null = null;
    let bestCost = Infinity;
    for (const definition of ISLANDS) {
      if (!definition.camp?.stations.includes(station) || !canReachIsland(definition.id, limits())) continue;
      const cost = here() === definition.id ? 0 : distance(canoe.position, islandLanding(definition.id).approach);
      if (cost < bestCost) {
        bestCost = cost;
        best = definition.id;
      }
    }
    if (!best) {
      // No camp offers it: build the attachment that does.
      const provider = ATTACHMENT_IDS.find((attachmentId) => ATTACHMENTS[attachmentId].station === station);
      if (!provider) throw new BotStuck(`no ${station} station anywhere`);
      yield* ensureAttachment(provider);
      yield* walkToCanoe();
      return;
    }
    yield* travelTo(best);
    const definition = ISLANDS_BY_ID[best];
    yield* walkTo(spotPosition(definition, definition.camp!.spot), 3);
  }

  function* craftRecipe(recipe: RecipeDefinition, times: number): Generator<StepInput> {
    if (recipe.requiresFlag && !state.flags[recipe.requiresFlag]) {
      const teacher = FLAG_SOURCES.get(recipe.requiresFlag);
      if (!teacher) throw new BotStuck(`nobody teaches ${recipe.id}`);
      yield* talkTo(teacher);
    }
    yield* ensureItems(recipe.tools.map((toolId) => ({ itemId: toolId as ItemId, count: 1 })));
    for (let guard = 0; guard < 12; guard += 1) {
      // Inputs are consumed, so ask for them on top of what other steps hold back.
      yield* ensureItems(recipe.inputs.map((input) => ({ itemId: input.itemId, count: input.count * times })));
      yield* goToStation(recipe.station);
      // Inputs sitting in the cargo: go and stand by the canoe.
      if (recipe.inputs.some((input) => isStackable(input.itemId) && inReach(input.itemId) < input.count * times)) {
        if (recipe.inputs.some((input) => held(input.itemId) < input.count * times)) continue;
        if (recipe.station !== 'hands' && !hasAttachment(ATTACHMENT_IDS.find((id) => ATTACHMENTS[id].station === recipe.station) ?? 'flag')) {
          throw new BotStuck(`inputs for ${recipe.id} are out of reach of the ${recipe.station}`);
        }
        yield* walkToCanoe();
      }
      if (habits.hesitation > 0) yield* idle(habits.hesitation);
      const result = send({ type: 'craft', recipeId: recipe.id, count: times });
      if (result.ok) {
        log(`craft ${times} x ${recipe.id}`);
        yield NEUTRAL_INPUT;
        return;
      }
      if (result.reason === 'inventory_full') {
        stow();
        if (!makeRoom()) throw new BotStuck(`no room to craft ${recipe.id}`);
        continue;
      }
      if (result.reason !== 'missing_requirements') throw new BotStuck(`craft ${recipe.id}: ${result.reason}`);
    }
    throw new BotStuck(`could not craft ${recipe.id}`);
  }

  function* obtain(itemId: ItemId, target: number): Generator<StepInput> {
    if (itemId === 'dirty_water') {
      yield* walkToCanoe();
      must({ type: 'fill_water', count: Math.max(1, target - held('dirty_water')) });
      return;
    }
    const recipe = RECIPE_FOR.get(itemId);
    if (recipe) {
      yield* craftRecipe(recipe, Math.ceil((target - held(itemId)) / recipe.output.count));
      return;
    }
    if (NODE_SOURCES.has(itemId)) {
      yield* gather(itemId, target);
      return;
    }
    const giver = GIFT_SOURCES.get(itemId);
    if (giver) {
      yield* talkTo(giver);
      if (held(itemId) < target) throw new BotStuck(`${giver} did not give ${itemId}`);
      return;
    }
    throw new BotStuck(`no way to obtain ${itemId}`);
  }

  function* ensureItems(needs: ItemAmount[]): Generator<StepInput> {
    for (let guard = 0; guard < 200; guard += 1) {
      const short = needs.find((need) => held(need.itemId) < need.count);
      if (!short) return;
      yield* obtain(short.itemId, short.count);
    }
    throw new BotStuck(`could not collect ${JSON.stringify(needs)}`);
  }

  function* atBeachedCanoe(): Generator<StepInput> {
    if (player.mode === 'canoe') {
      if (!canoe.beached) throw new BotStuck('building while afloat');
      return;
    }
    yield* walkToCanoe();
  }

  function* ensureHull(tier: number): Generator<StepInput> {
    while (canoe.hullTier < tier) {
      const next = HULL_TIERS[canoe.hullTier + 1];
      yield* ensureItems([...next.tools.map((toolId) => ({ itemId: toolId as ItemId, count: 1 })), ...next.cost]);
      yield* atBeachedCanoe();
      must({ type: 'upgrade_hull' });
      log(`hull tier ${canoe.hullTier}`);
      yield NEUTRAL_INPUT;
    }
  }

  function* ensureAttachment(attachmentId: AttachmentId): Generator<StepInput> {
    if (hasAttachment(attachmentId)) return;
    const definition = ATTACHMENTS[attachmentId];
    yield* ensureHull(definition.minimumHullTier);
    for (const required of definition.requiresAttachments) yield* ensureAttachment(required);
    yield* ensureItems([...definition.tools.map((toolId) => ({ itemId: toolId as ItemId, count: 1 })), ...definition.cost]);
    yield* atBeachedCanoe();
    must({ type: 'build_attachment', attachmentId });
    log(`built ${attachmentId}`);
    yield NEUTRAL_INPUT;
  }

  // --- Staying alive --------------------------------------------------------

  let maintaining = false;
  function* maintain(): Generator<StepInput> {
    if (maintaining) return;
    maintaining = true;
    try {
      useFire();
      upkeep();
      const spareWater = inReach('clean_water') - (reserved.get('clean_water') ?? 0);
      if (player.thirst < Math.min(40, habits.drinkBelow) && spareWater <= 0) {
        log('out of water: boiling some');
        yield* ensureItems([{ itemId: 'clean_water', count: held('clean_water') + 5 }]);
        upkeep();
      }
      const foodInReach = FOOD_IDS.some((itemId) => inReach(itemId) > 0 && itemId !== 'raw_fish');
      if (player.hunger < Math.min(40, habits.eatBelow) && !foodInReach) {
        log('out of food: foraging');
        for (let guard = 0; guard < 3; guard += 1) {
          const sources = ['berries', 'apple', 'mushroom', 'cattail_root']
            .flatMap((itemId) => NODE_SOURCES.get(itemId as ItemId) ?? [])
            .filter((source) => usable(source) && source.node.actions[source.actionIndex].tool === null);
          if (sources.length === 0) break;
          sources.sort((first, second) => travelCost(first.node) - travelCost(second.node));
          yield* travelTo(sources[0].node.islandId);
          yield* harvest(sources[0].node, sources[0].actionIndex);
        }
        useFire();
        upkeep();
      }
      if (player.energy < 30) {
        yield* sleepIfNight();
        yield* rest(65);
      }
    } finally {
      maintaining = false;
    }
  }

  // --- Objectives -----------------------------------------------------------

  function* stockUp(stockFood: number, cleanWater: number): Generator<StepInput> {
    const stockHeld = (): number => STOCK_FOOD_IDS.reduce((sum, itemId) => sum + held(itemId), 0);
    reserved = new Map<ItemId, number>([['clean_water', cleanWater], ...STOCK_FOOD_IDS.map((itemId) => [itemId, 99] as [ItemId, number])]);
    for (let guard = 0; guard < 20 && stockHeld() < stockFood; guard += 1) {
      const remaining = stockFood - stockHeld();
      // Make whichever stock food is cheapest per piece from one stop: the
      // nearest island holding each ingredient, and how much it would give.
      let best: { recipe: RecipeDefinition; count: number; costEach: number } | null = null;
      for (const itemId of STOCK_FOOD_IDS) {
        const recipe = RECIPE_FOR.get(itemId);
        if (!recipe) continue;
        let cost = selectInventory(state).stations.includes(recipe.station)
          || ATTACHMENT_IDS.some((id) => ATTACHMENTS[id].station === recipe.station && hasAttachment(id)) ? 0 : 250;
        let count = remaining;
        for (const input of recipe.inputs) {
          const have = held(input.itemId);
          if (have >= input.count * remaining) continue;
          const sources = (NODE_SOURCES.get(input.itemId) ?? []).filter((source) => usable(source) && source.guaranteed);
          if (sources.length === 0) {
            count = Math.min(count, Math.floor(have / input.count));
            continue;
          }
          sources.sort((first, second) => travelCost(first.node) - travelCost(second.node));
          const islandId = sources[0].node.islandId;
          let units = have;
          for (const source of sources) {
            if (source.node.islandId !== islandId) continue;
            const table = LOOT_TABLES[source.node.actions[source.actionIndex].lootTableId];
            units += table.guaranteed.find((entry) => entry.itemId === input.itemId)?.minimum ?? 0;
          }
          const tool = sources[0].node.actions[sources[0].actionIndex].tool;
          cost += travelCost(sources[0].node) + (tool && held(tool) === 0 ? 150 : 0);
          count = Math.min(count, Math.floor(units / input.count));
        }
        if (count < 1) continue;
        const costEach = (cost + 60) / count;
        if (!best || costEach < best.costEach) best = { recipe, count, costEach };
      }
      if (!best) {
        log('no stock food ingredients ready: waiting');
        yield* sleepIfNight();
        yield* idle(30);
        continue;
      }
      const plan: { recipe: RecipeDefinition; count: number } = best;
      log(`stock food: ${plan.count} x ${plan.recipe.id}`);
      extraWanted = new Map(plan.recipe.inputs.map((input) => [input.itemId, input.count * plan.count]));
      // What goes into the stock food is not for eating on the way.
      const kept = plan.recipe.inputs.filter((input) => habits.guardsIngredients && ITEMS[input.itemId].edible && !reserved.has(input.itemId));
      for (const input of kept) reserved.set(input.itemId, input.count * plan.count);
      yield* craftRecipe(plan.recipe, plan.count);
      for (const input of kept) reserved.delete(input.itemId);
    }
    extraWanted = new Map();
    yield* ensureItems([{ itemId: 'clean_water', count: cleanWater }]);
    yield* walkToCanoe();
    stow();
    yield NEUTRAL_INPUT;
  }

  function* pursue(quest: QuestDefinition, objective: ObjectiveDefinition): Generator<StepInput> {
    switch (objective.type) {
      case 'bail':
        while (canoe.waterLevel > objective.waterAtMost - 2) yield { ...NEUTRAL_INPUT, bail: true };
        return;
      case 'land':
        yield* travelTo(objective.islandId);
        return;
      case 'have_item':
        yield* ensureItems([{ itemId: objective.itemId, count: objective.count }]);
        return;
      case 'have_tool':
        yield* ensureItems([{ itemId: objective.toolId, count: 1 }]);
        return;
      case 'craft': {
        const recipe = RECIPE_FOR.get(objective.itemIds[0]);
        if (!recipe) throw new BotStuck(`no recipe for ${objective.itemIds[0]}`);
        const done = state.quests[quest.id].progress[quest.objectives.indexOf(objective)];
        yield* craftRecipe(recipe, Math.ceil((objective.count - done) / recipe.output.count));
        return;
      }
      case 'hull':
        yield* ensureHull(objective.tier);
        return;
      case 'attachment':
        yield* ensureAttachment(objective.attachmentId);
        return;
      case 'sleep': {
        let bed = ISLANDS.find((definition) => definition.id === here() && definition.camp?.sleep);
        bed ??= ISLANDS.find((definition) => definition.camp?.sleep && canReachIsland(definition.id, limits()));
        if (!bed) throw new BotStuck('no bed in reach');
        yield* travelTo(bed.id);
        yield* walkTo(bedOf(bed.id), 2);
        useFire();
        // Too early to sleep: rest by the fire until dusk.
        const giveUpTick = state.tick + 20 * 60 * 60;
        while (!send({ type: 'sleep' }).ok) {
          if (state.tick > giveUpTick) throw new BotStuck('never allowed to sleep');
          upkeep();
          yield NEUTRAL_INPUT;
        }
        log(`slept on ${bed.id}`);
        return;
      }
      case 'enter_region': {
        const target = ISLANDS.filter((definition) => definition.regionId === objective.regionId && canReachIsland(definition.id, limits()))
          .sort((first, second) => distance(canoe.position, first.center) - distance(canoe.position, second.center))[0];
        if (!target) throw new BotStuck(`this canoe cannot get to any island of the ${objective.regionId} region`);
        yield* travelTo(target.id);
        return;
      }
      case 'talk':
        yield* talkTo(objective.npcId);
        return;
      case 'node': {
        const node = NODES_BY_ID[objective.nodeId];
        yield* travelTo(node.islandId);
        yield* harvest(node, 0);
        return;
      }
      case 'stock':
        yield* stockUp(objective.stockFood, objective.cleanWater);
        return;
      default:
        throw new BotStuck(`the bot does not handle ${objective.type} objectives`);
    }
  }

  function* play(): Generator<StepInput> {
    for (const quest of MAIN_QUESTS) {
      // Every fail earns a few more tries: it costs cargo, and the step has to be planned again.
      for (let guard = 0; guard < 60 + 6 * state.statistics.fails && !questDone(quest.id); guard += 1) {
        try {
          const view = selectActiveQuests(state).find((entry) => entry.questId === quest.id);
          if (!view) {
            yield NEUTRAL_INPUT;
            continue;
          }
          const index = view.objectives.findIndex((entry) => !entry.done);
          if (index === -1) {
            yield* idle(0.25);
            continue;
          }
          for (const extra of STRATEGY) {
            if (extra.questId === quest.id && extra.beforeObjective === index) {
              for (const attachmentId of extra.attachments) yield* ensureAttachment(attachmentId);
            }
          }
          yield* maintain();
          log(`[${quest.name}] ${view.objectives[index].text}`);
          yield* pursue(quest, quest.objectives[index]);
          yield* idle(0.25);
        } catch (error) {
          if (!(error instanceof WashedAshore)) throw error;
          // Washed ashore at the respawn point, canoe beside it, half the cargo gone: start the step over.
          log('washed ashore: picking up again');
          bailing = false;
          powerOn = false;
          runOn = false;
          yield NEUTRAL_INPUT;
        }
      }
      if (!questDone(quest.id)) throw new BotStuck(`quest ${quest.id} never completed`);
      if (options.untilQuest === quest.id) return;
    }
  }

  const script = play();
  let finished = false;
  let stoppedBecause: string | null = null;
  let failsSeen = state.statistics.fails;
  return {
    next(): StepInput | null {
      if (finished) return null;
      try {
        const washed = state.statistics.fails !== failsSeen;
        failsSeen = state.statistics.fails;
        const result = washed ? script.throw(new WashedAshore()) : script.next();
        if (!result.done) return result.value;
      } catch (error) {
        if (!(error instanceof BotStuck)) throw error;
        stoppedBecause = error.message;
      }
      finished = true;
      return null;
    },
    get finished(): boolean {
      return finished;
    },
    get stoppedBecause(): string | null {
      return stoppedBecause;
    },
  };
}

/** Run the bot headless on a new game and report how each quest went. */
export function runBot(options: BotOptions): BotReport {
  const difficulty = options.difficulty ?? 'standard';
  const maximumSeconds = options.maximumSeconds ?? 4 * 3600;
  const state = createGame(options.seed, { difficulty });
  const player = state.players[0];
  const canoe = state.canoe;
  const log = (line: string): void => options.log?.(`${(state.playedSeconds / 60).toFixed(1).padStart(6)}  ${line}`);
  const driver = createBotDriver(state, { untilQuest: options.untilQuest, log: options.log, habits: options.habits });

  const reports: QuestReport[] = [];
  const freshTally = (): Omit<QuestReport, 'questId' | 'name' | 'completedAtSeconds' | 'completedAtClock'> => ({
    lowestHunger: player.hunger, lowestThirst: player.thirst, lowestEnergy: player.energy,
    highestWaterLevel: canoe.waterLevel, fails: 0,
  });
  let tally = freshTally();
  let stoppedBecause: string | null = null;
  const collect = (): void => {
    tally.lowestHunger = Math.min(tally.lowestHunger, player.hunger);
    tally.lowestThirst = Math.min(tally.lowestThirst, player.thirst);
    tally.lowestEnergy = Math.min(tally.lowestEnergy, player.energy);
    tally.highestWaterLevel = Math.max(tally.highestWaterLevel, canoe.waterLevel);
    for (const event of drainEvents(state)) {
      if (event.type === 'weather_changed') {
        log(`weather: ${event.kind}, then ${state.weather.nextKind} in ${state.weather.secondsRemaining.toFixed(0)} s`);
      }
      if (event.type === 'washed_ashore') {
        tally.fails += 1;
        log(`FAIL: ${event.cause}`);
      }
      if (event.type === 'quest_completed' && MAIN_QUESTS.some((quest) => quest.id === event.questId)) {
        const time = selectTimeOfDay(state);
        reports.push({
          questId: event.questId,
          name: MAIN_QUESTS.find((quest) => quest.id === event.questId)!.name,
          completedAtSeconds: state.playedSeconds,
          completedAtClock: `day ${time.day} ${time.clock}`,
          ...tally,
        });
        log(`== ${event.questId} done at ${(state.playedSeconds / 60).toFixed(1)} min`);
        tally = freshTally();
      }
    }
  };

  for (;;) {
    const input = driver.next();
    collect();
    if (input === null) break;
    step(state, input, FIXED_STEP);
    if (state.playedSeconds > maximumSeconds) {
      stoppedBecause = `ran past ${maximumSeconds} s of play`;
      break;
    }
  }
  collect();
  stoppedBecause = stoppedBecause ?? driver.stoppedBecause;

  return {
    seed: options.seed,
    difficulty,
    completed: state.flags.beacon_lit === true,
    quests: reports,
    totalSeconds: state.playedSeconds,
    worldDays: state.time / TUNING.time.daySeconds,
    fails: state.statistics.fails,
    stoppedBecause,
    distancePaddled: state.statistics.distancePaddled,
    distanceWalked: state.statistics.distanceWalked,
    state,
  };
}

/**
 * How much slower a person is than the bot. The bot knows where every node
 * is, never opens a menu, never explores and never backtracks for something
 * it forgot.
 */
export const HUMAN_TIME_FACTOR = 1.5;

/** The seed `npm run bot` and the bot test play: a run of typical length. */
export const BOT_SEED = 3;

/** The report as a plain-text table. */
export function formatReport(report: BotReport): string {
  const minutes = (seconds: number): string => (seconds / 60).toFixed(1).padStart(6);
  const number = (value: number): string => value.toFixed(0).padStart(4);
  const lines = [
    `Portage bot, seed ${report.seed}, ${report.difficulty} difficulty`,
    '',
    ' #  Quest                 Done at (min)  World clock   Hunger  Thirst  Energy  Water  Fails',
    '                                                         low     low     low    high',
  ];
  report.quests.forEach((quest, index) => {
    lines.push([
      String(index + 1).padStart(2), ' ', quest.name.padEnd(22), minutes(quest.completedAtSeconds).padStart(10),
      '      ', quest.completedAtClock.padEnd(12), number(quest.lowestHunger).padStart(7), number(quest.lowestThirst).padStart(8),
      number(quest.lowestEnergy).padStart(8), number(quest.highestWaterLevel).padStart(7), String(quest.fails).padStart(7),
    ].join(''));
  });
  lines.push(
    '',
    `Main line: ${report.completed ? 'Beacon lit' : 'NOT finished'} in ${(report.totalSeconds / 60).toFixed(1)} min of play`
      + ` (${report.worldDays.toFixed(1)} world days), ${report.fails} fails.`,
    `Paddled ${(report.distancePaddled / 1000).toFixed(1)} km, walked ${(report.distanceWalked / 1000).toFixed(1)} km.`,
    `Human estimate at ${HUMAN_TIME_FACTOR}x the bot: ${((report.totalSeconds * HUMAN_TIME_FACTOR) / 60).toFixed(0)} min.`,
  );
  if (report.stoppedBecause) lines.push(`Stopped: ${report.stoppedBecause}`);
  return lines.join('\n');
}

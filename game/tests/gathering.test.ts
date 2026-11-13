/**
 * Every tree and stone on an island is a scavenge spot (Luc's bugfix list, round 2: "Any tree/collectable on island
 * should be able to count/usable for trees/rocks whatever. Example spruce: there's a bunch of trees but not usable").
 * The wild spruce, pine, birch, boulder and crag work like the placed spot of their kind: the same prompt, tool, loot
 * and ten-minute refill, one tree at a time; they count for quests; a guest uses them like the host.
 */
import { describe, expect, it } from 'vitest';
import { ISLANDS, LOOT_TABLES, NODES, NODES_BY_ID, NODE_TYPES, TUNING, WILD_KINDS, floraMixFor } from '../src/data/index.ts';
import type { IslandId, ItemId, ToolId } from '../src/data/index.ts';
import { addPlayer, dispatch, drainEvents, selectInteractable } from '../src/sim/index.ts';
import type { GameState, PlayerState } from '../src/sim/index.ts';
import { findWildNode, wildIndex, wildNodesNear, wildNodesOn } from '../src/sim/gathering.ts';
import type { WildNode } from '../src/sim/gathering.ts';
import { scatterIsland } from '../src/sim/scatter.ts';
import { bodyBlocked, dressingAnchors } from '../src/sim/solids.ts';
import { terrainHeight } from '../src/sim/world.ts';
import { toastForEvent } from '../src/client/viewmodels/toasts.ts';
import { countIn, newGame, standOn } from './support.ts';

/** Put a player on foot at a point. */
function putAt(player: PlayerState, islandId: IslandId, x: number, z: number): void {
  player.mode = 'foot';
  player.seat = null;
  player.islandId = islandId;
  player.position = { x, y: terrainHeight(x, z), z };
}

/**
 * Stand a player a step from a wild thing, on clear dry ground where it is what F would act on. Returns false when
 * no such place is found round it.
 */
function standBy(state: GameState, wild: WildNode, playerId = 0): boolean {
  const player = state.players[playerId];
  for (const circle of wild.circles) {
    for (const out of [0.4, 0.7, 1]) {
      for (let step = 0; step < 24; step += 1) {
        const angle = (step / 24) * Math.PI * 2;
        const x = circle.x + Math.sin(angle) * (circle.radius + out);
        const z = circle.z - Math.cos(angle) * (circle.radius + out);
        if (terrainHeight(x, z) < -TUNING.foot.wadeDepth || bodyBlocked(x, z)) continue;
        putAt(player, wild.definition.islandId, x, z);
        const target = selectInteractable(state, playerId);
        if (target?.kind === 'node' && target.nodeId === wild.definition.id) return true;
      }
    }
  }
  return false;
}

/** The first wild thing of a kind on an island that a player can stand by. */
function wildOf(state: GameState, islandId: IslandId, kind: WildNode['kind'], playerId = 0): WildNode {
  for (const wild of wildNodesOn(islandId)) if (wild.kind === kind && standBy(state, wild, playerId)) return wild;
  throw new Error(`no ${kind} to stand by on ${islandId}`);
}

/** Metres from a point to a wild thing's bark or stone, worked out here and not by the rules. */
const bark = (node: WildNode, x: number, z: number): number =>
  Math.min(...node.circles.map((circle) => Math.hypot(circle.x - x, circle.z - z) - circle.radius));

const giveTool = (state: GameState, toolId: ToolId): void => {
  if (!state.tools.includes(toolId)) state.tools.push(toolId);
};

/** A game ashore on Home Knoll, past the first quest, fed and rested. */
function ashore(crew = 1): GameState {
  const state = newGame(7, { crew });
  standOn(state, 'home_knoll');
  state.quests.bail_out.status = 'completed';
  state.quests.first_haul.status = 'active';
  for (const player of state.players) Object.assign(player, { hunger: 100, thirst: 100, energy: 100 });
  drainEvents(state);
  return state;
}

describe('every tree and stone counts', () => {
  it('turns every scattered spruce, pine, birch and boulder, and every crag, into a spot; scrub, reeds and sedge stay scenery', () => {
    for (const island of ISLANDS) {
      const scattered = scatterIsland(island, floraMixFor(island));
      const anchors = dressingAnchors(island);
      const wild = wildNodesOn(island.id);
      const expected = [
        ...scattered.map((placement, at) => ({ kind: placement.kind as string, id: `${island.id}.scatter.${at}` })),
        ...anchors.map((anchor, at) => ({ kind: anchor.kind as string, id: `${island.id}.dressing.${at}` })),
      ].filter((entry) => Object.hasOwn(WILD_KINDS, entry.kind));
      expect(wild.map((node) => node.definition.id), island.id).toEqual(expected.map((entry) => entry.id));
      expect(wild.map((node) => node.kind), island.id).toEqual(expected.map((entry) => entry.kind));
    }
    expect(Object.keys(WILD_KINDS).sort()).toEqual(['birch', 'boulder', 'crag', 'pine', 'spruce']);
    const counts: Record<string, number> = {};
    for (const node of wildIndex().nodes) counts[node.kind] = (counts[node.kind] ?? 0) + 1;
    // The valley as the scatter places it today: hundreds where there were 41 placed trees and outcrops.
    expect(counts).toEqual({ spruce: 387, pine: 104, birch: 131, boulder: 297, crag: 58 });
    expect(NODES.filter((node) => ['spruce', 'birch', 'stone_outcrop'].includes(node.typeId))).toHaveLength(41);
  });

  it('gives each a stable id of its island and its place in the seeded scatter, never one a placed spot has', () => {
    const ids = wildIndex().nodes.map((node) => node.definition.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z_]+\.(scatter|dressing)\.\d+$/);
      expect(NODES.some((node) => node.id === id)).toBe(false);
    }
    // Built again from scratch, the same ids land on the same places.
    const knoll = wildNodesOn('home_knoll');
    const again = scatterIsland(ISLANDS.find((island) => island.id === 'home_knoll')!, floraMixFor(ISLANDS.find((island) => island.id === 'home_knoll')!));
    for (const node of knoll.filter((entry) => entry.definition.id.includes('.scatter.'))) {
      const at = Number(node.definition.id.split('.')[2]);
      expect(node.definition.position).toEqual({ x: again[at].x, z: again[at].z });
    }
  });

  it('names a used tree by its id for the screen, the sound and the toasts, and lists only the placed spots', () => {
    const spruce = wildNodesOn('home_knoll').find((node) => node.kind === 'spruce')!;
    expect(NODES_BY_ID[spruce.definition.id]).toBe(spruce.definition);
    expect(spruce.definition.id in NODES_BY_ID).toBe(true);
    expect(NODES_BY_ID['home_knoll.scatter.99999']).toBeUndefined();
    expect(Object.keys(NODES_BY_ID)).toEqual(NODES.map((node) => node.id));
    expect(findWildNode('home_knoll.spruce.1')).toBeUndefined();
  });

  it('can be stood next to and used: all but two of them, on foot', () => {
    const state = ashore();
    const shut = wildIndex().nodes.filter((node) => !standBy(state, node)).map((node) => node.definition.id);
    // Two spruces on the Beacon: one boxed in by its neighbours, one against a crag that is always the nearer.
    expect(shut).toEqual(['the_beacon.scatter.143', 'the_beacon.scatter.237']);
  });
});

describe('a tree works like a spot', () => {
  it('a spruce: gum by hand, logs with the hatchet, in the words of the spruce spot', () => {
    const state = ashore();
    const spruce = wildOf(state, 'home_knoll', 'spruce');
    expect(selectInteractable(state)).toMatchObject({
      kind: 'node', nodeId: spruce.definition.id, name: 'Spruce', prompt: 'Scrape gum: Spruce', available: true, command: { type: 'scavenge' },
    });
    expect(dispatch(state, { type: 'scavenge' }).ok).toBe(true);
    const gum = countIn(state.players[0].backpack, 'spruce_gum');
    expect(gum).toBeGreaterThanOrEqual(2);
    expect(gum).toBeLessThanOrEqual(3);
    // The gum is used; the logs need the hatchet, as at the spot.
    expect(selectInteractable(state)).toMatchObject({ nodeId: spruce.definition.id, prompt: 'Spruce needs hatchet', available: false });
    expect(dispatch(state, { type: 'scavenge' })).toMatchObject({ ok: false, reason: 'missing_requirements', missing: { tools: ['hatchet'] } });
    giveTool(state, 'hatchet');
    expect(selectInteractable(state)).toMatchObject({ nodeId: spruce.definition.id, prompt: 'Chop: Spruce', available: true });
    const energy = state.players[0].energy;
    expect(dispatch(state, { type: 'scavenge' }).ok).toBe(true);
    expect(countIn(state.players[0].backpack, 'log')).toBe(3);
    expect(state.players[0].energy).toBe(energy - NODE_TYPES.spruce.actions[1].energyCost);
  });

  it('a birch: bark with the knife, and says so without it', () => {
    const state = ashore();
    const birch = wildOf(state, 'birch_islet', 'birch');
    expect(selectInteractable(state)).toMatchObject({ nodeId: birch.definition.id, prompt: 'Birch needs stone knife', available: false });
    giveTool(state, 'stone_knife');
    expect(selectInteractable(state)).toMatchObject({ nodeId: birch.definition.id, prompt: 'Peel: Birch', available: true });
    dispatch(state, { type: 'scavenge' });
    expect(countIn(state.players[0].backpack, 'birch_bark')).toBeGreaterThanOrEqual(2);
  });

  it('a boulder and a crag: stone by hand, for the outcrop\'s effort', () => {
    const state = ashore();
    for (const [islandId, kind, name] of [['home_knoll', 'boulder', 'Boulder'], ['quarry_face', 'crag', 'Crag']] as const) {
      const before = countIn(state.players[0].backpack, 'stone');
      const stone = wildOf(state, islandId, kind);
      expect(selectInteractable(state)).toMatchObject({ nodeId: stone.definition.id, prompt: `Break: ${name}`, available: true });
      const energy = state.players[0].energy;
      dispatch(state, { type: 'scavenge' });
      const got = countIn(state.players[0].backpack, 'stone') - before;
      expect(got).toBeGreaterThanOrEqual(3);
      expect(got).toBeLessThanOrEqual(4);
      expect(state.players[0].energy).toBe(energy - NODE_TYPES.stone_outcrop.actions[0].energyCost);
    }
  });

  it('a pine: logs with the hatchet and nothing by hand', () => {
    const state = ashore();
    const pine = wildOf(state, 'home_knoll', 'pine');
    expect(pine.definition.actions.map((action) => action.verb)).toEqual(['Chop']);
    expect(selectInteractable(state)).toMatchObject({ nodeId: pine.definition.id, prompt: 'Pine needs hatchet', available: false });
    giveTool(state, 'hatchet');
    expect(selectInteractable(state)).toMatchObject({ prompt: 'Chop: Pine', available: true });
    dispatch(state, { type: 'scavenge' });
    expect(countIn(state.players[0].backpack, 'log')).toBe(3);
  });

  it('every kind has the actions, tools, loot and refill of the spot it is named for', () => {
    for (const node of wildIndex().nodes) {
      const spot = NODE_TYPES[node.definition.typeId];
      for (const action of node.definition.actions) {
        expect(spot.actions).toContain(action);
        expect(LOOT_TABLES[action.lootTableId]).toBeDefined();
        expect(action.respawnDays).not.toBeNull();
      }
      expect(node.definition.reach).toBe('foot');
    }
  });

  it('refills ten minutes after it is used, one tree at a time, and the state keeps only the trees in use', () => {
    const state = ashore();
    giveTool(state, 'stone_knife');
    const first = wildOf(state, 'birch_islet', 'birch');
    dispatch(state, { type: 'scavenge' });
    expect(Object.keys(state.nodes)).toEqual([first.definition.id]);
    expect(state.nodes[first.definition.id].readyAt).toEqual([state.time + TUNING.nodes.refillSeconds]);
    // A second tree is its own: full, whatever the first one is.
    const second = wildNodesOn('birch_islet').find((node) => node.kind === 'birch' && node !== first && standBy(state, node))!;
    expect(selectInteractable(state)).toMatchObject({ nodeId: second.definition.id, prompt: 'Peel: Birch', available: true });
    expect(standBy(state, first)).toBe(false);
    state.time += TUNING.nodes.refillSeconds - 10;
    expect(standBy(state, first)).toBe(false);
    state.time += 11;
    expect(standBy(state, first)).toBe(true);
    expect(selectInteractable(state)).toMatchObject({ prompt: 'Peel: Birch', available: true });
    // The next harvest anywhere lets the refilled tree go: only the tree just used is kept.
    standBy(state, second);
    dispatch(state, { type: 'scavenge' });
    expect(Object.keys(state.nodes)).toEqual([second.definition.id]);
  });

  it('the nearest wins, a placed spot or a tree: measured from a spot\'s middle and from a tree\'s bark', () => {
    const state = ashore();
    const spot = NODES_BY_ID['home_knoll.spruce.1'];
    const tree = wildNodesOn('home_knoll')
      .filter((node) => node.kind === 'spruce')
      .sort((first, second) => bark(first, spot.position.x, spot.position.z) - bark(second, spot.position.x, spot.position.z))[0];
    // Walk the line from the spot to the nearest tree: at each step the nearer of everything in reach answers.
    const answers: string[] = [];
    for (let share = 0; share <= 1; share += 0.02) {
      const x = spot.position.x + (tree.definition.position.x - spot.position.x) * share;
      const z = spot.position.z + (tree.definition.position.z - spot.position.z) * share;
      if (bodyBlocked(x, z)) continue;
      putAt(state.players[0], 'home_knoll', x, z);
      const candidates = [
        ...NODES.filter((node) => node.islandId === 'home_knoll' && node.reach === 'foot')
          .map((node) => ({ id: node.id, distance: Math.hypot(x - node.position.x, z - node.position.z), reach: TUNING.foot.nodeRange })),
        ...wildNodesOn('home_knoll').map((node) => ({ id: node.definition.id, distance: bark(node, x, z), reach: TUNING.nodes.wildReach })),
      ].filter((candidate) => candidate.distance <= candidate.reach).sort((first, second) => first.distance - second.distance);
      const target = selectInteractable(state);
      expect(target?.kind === 'node' ? target.nodeId : null).toBe(candidates[0]?.id ?? null);
      if (target?.kind === 'node' && answers.at(-1) !== target.nodeId) answers.push(target.nodeId);
    }
    expect(answers[0]).toBe('home_knoll.spruce.1');
    expect(answers.at(-1)).toBe(tree.definition.id);
  });

  it('a toast and a blocked press name the tree', () => {
    const state = ashore();
    const birch = wildOf(state, 'birch_islet', 'birch');
    dispatch(state, { type: 'scavenge' });
    const events = drainEvents(state);
    const blocked = events.find((event) => event.type === 'harvest_blocked')!;
    expect(blocked).toMatchObject({ nodeId: birch.definition.id });
    expect(toastForEvent(blocked, state)?.text).toBe('Birch: needs stone knife');
    const leftBehind = { type: 'item_left_behind', nodeId: birch.definition.id, itemId: 'birch_bark' as ItemId, count: 2, playerId: 0 } as const;
    expect(toastForEvent(leftBehind, state)?.text).toBe('No room: 2 x Birch bark left at the birch');
  });

  it('keeps loot that does not fit on the tree, to pick up there', () => {
    const state = ashore();
    // On Birch Islet, away from the canoe's cargo: the backpack is all there is.
    giveTool(state, 'stone_knife');
    const birch = wildOf(state, 'birch_islet', 'birch');
    const fillers: ItemId[] = ['stone', 'driftwood', 'fiber', 'clay', 'berries', 'apple', 'mushroom', 'cattail_root'];
    state.players[0].backpack = fillers.map((itemId) => ({ itemId, count: TUNING.inventory.stackSize }));
    dispatch(state, { type: 'scavenge' });
    expect(state.nodes[birch.definition.id].leftover[0].itemId).toBe('birch_bark');
    expect(selectInteractable(state)).toMatchObject({ nodeId: birch.definition.id, prompt: 'Pick up from Birch' });
  });
});

describe('quests and the crew', () => {
  it('counts what a tree gives toward a quest that asks for it, as from a spot', () => {
    const state = ashore();
    state.quests.first_haul.status = 'completed';
    state.quests.stop_the_leak.status = 'active';
    giveTool(state, 'stone_knife');
    wildOf(state, 'home_knoll', 'spruce');
    dispatch(state, { type: 'scavenge' });
    const gum = countIn(state.players[0].backpack, 'spruce_gum');
    wildOf(state, 'home_knoll', 'birch');
    dispatch(state, { type: 'scavenge' });
    const bark = countIn(state.players[0].backpack, 'birch_bark');
    expect(state.quests.stop_the_leak.progress.slice(0, 2)).toEqual([gum, bark]);
  });

  it('a guest sees the same tree, uses it like the host, and the crew shares its refill', () => {
    const state = ashore(1);
    const guestId = addPlayer(state)!.id;
    expect(guestId).toBe(1);
    Object.assign(state.players[1], { hunger: 100, thirst: 100, energy: 100 });
    const birch = wildOf(state, 'home_knoll', 'birch', guestId);
    giveTool(state, 'stone_knife');
    // The guest's own screen works it out from its copy of the state: the same answer.
    const copy = JSON.parse(JSON.stringify(state)) as GameState;
    expect(selectInteractable(copy, guestId)).toEqual(selectInteractable(state, guestId));
    expect(selectInteractable(state, guestId)).toMatchObject({ nodeId: birch.definition.id, prompt: 'Peel: Birch', available: true });
    expect(dispatch(state, { type: 'scavenge' }, guestId).ok).toBe(true);
    expect(countIn(state.players[1].backpack, 'birch_bark')).toBeGreaterThanOrEqual(2);
    expect(countIn(state.players[0].backpack, 'birch_bark')).toBe(0);
    expect(drainEvents(state)).toContainEqual({ type: 'node_depleted', nodeId: birch.definition.id, playerId: guestId });
    // The host, at the same tree, finds it used.
    expect(standBy(state, birch, 0)).toBe(false);
  });
});

describe('cheap', () => {
  it('asks one cell of a grid: at most three wild things to measure from anywhere in the valley', () => {
    let most = 0;
    for (const list of wildIndex().cells.values()) most = Math.max(most, list.length);
    expect(most).toBeLessThanOrEqual(3);
    // And the cell holds every wild thing in reach.
    for (const node of wildIndex().nodes.slice(0, 200)) {
      const circle = node.circles[0];
      for (let step = 0; step < 8; step += 1) {
        const angle = (step / 8) * Math.PI * 2;
        const x = circle.x + Math.sin(angle) * (circle.radius + TUNING.nodes.wildReach - 0.01);
        const z = circle.z - Math.cos(angle) * (circle.radius + TUNING.nodes.wildReach - 0.01);
        expect(wildNodesNear(x, z)).toContain(node);
      }
    }
  });
});
